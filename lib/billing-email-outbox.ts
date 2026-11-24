import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";

type BillingEmail = {
  id:string; store_id:string; recipient:string; template_key:string;
  dedupe_key:string; payload:Record<string,unknown>; attempt_count:number; lease_token:string;
};

function escapeHtml(value:string) {
  return value.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c] || c));
}
function renderBillingEmail(template:string,payload:Record<string,unknown>,billingUrl:string) {
  const store=escapeHtml(String(payload.storeName || "your store").slice(0,100));
  const url=escapeHtml(billingUrl);
  if(template==="subscription_dunning_day_1") return {
    subject:"Payment reminder: your MobiWave Commerce subscription is due",
    heading:"Your subscription payment is due",
    intro:`The subscription for ${store} is overdue. Your paid features remain available during the recovery period. Please renew by Day 3 to avoid interruption.`,
    action:"Review billing",
    outro:"This is the first reminder. Your store data and orders remain safe.",
  };
  if(template==="subscription_dunning_day_2") return {
    subject:"Final reminder: paid features suspend tomorrow",
    heading:"Please renew your subscription",
    intro:`Payment for ${store} is still outstanding. This is the second and final reminder. Paid features will be suspended on Day 3 if payment is not verified.`,
    action:"Renew subscription",
    outro:"You can still sign in, manage billing and access or export your existing data.",
  };
  return {
    subject:"Paid features suspended: MobiWave Commerce",
    heading:"Your paid features are suspended",
    intro:`Paid features for ${store} have been suspended because the subscription remains unpaid. Your store, products, orders, customers and transaction history have been preserved.`,
    action:"Restore paid features",
    outro:"After a verified payment, paid entitlements are restored automatically. An STK prompt or unverified callback does not count as payment.",
  };
}

async function updateEvent(client:any,event:BillingEmail,status:"sent"|"queued"|"failed"|"delivery_unknown",errorCode:string|null=null,delay=0) {
  await client.query("BEGIN");
  try {
    await client.query("SELECT set_config('app.email_worker','true',true)");
    const result=await client.query(
      `UPDATE message_events SET status=$1,
        sent_at=CASE WHEN $1='sent' THEN now() ELSE sent_at END,
        next_attempt_at=CASE WHEN $1='queued' THEN now()+($2::int*interval '1 second') ELSE next_attempt_at END,
        locked_at=NULL,locked_by=NULL,error_code=$3,updated_at=now()
       WHERE id=$4 AND lease_token=$5 AND status IN ('processing','delivery_unknown') RETURNING id`,
      [status,delay,errorCode,event.id,event.lease_token],
    );
    await client.query("COMMIT");
    return result.rowCount===1;
  } catch(error) { await client.query("ROLLBACK").catch(()=>undefined); throw error; }
}

export async function processQueuedBillingEmails(batchSize=20) {
  const apiKey=process.env.BREVO_API_KEY;
  const senderEmail=process.env.BREVO_SENDER_EMAIL;
  if(!apiKey || !senderEmail) return {claimed:0,sent:0,retried:0,failed:0,deliveryUnknown:0,skipped:"email_provider_not_configured" as const};
  const senderName=process.env.BREVO_SENDER_NAME || "MobiWave Commerce";
  const appUrl=(process.env.NEXT_PUBLIC_APP_URL || "https://mobiwave-commerce.vercel.app").replace(/\/$/,"");
  const client=await db.connect();
  const events:BillingEmail[]=[];
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.email_worker','true',true)");
    await client.query(
      "UPDATE message_events SET status='delivery_unknown',delivery_unknown_at=COALESCE(delivery_unknown_at,now()),error_code='email_worker_lease_expired',locked_at=NULL,locked_by=NULL,updated_at=now() WHERE channel='email' AND status='processing' AND locked_at<now()-interval '15 minutes'",
    );
    const due=await client.query(
      `SELECT id,store_id,recipient,template_key,dedupe_key,payload,attempt_count
         FROM message_events WHERE channel='email'
          AND template_key IN ('subscription_dunning_day_1','subscription_dunning_day_2','subscription_suspended')
          AND status='queued' AND next_attempt_at<=now()
         ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [Math.max(1,Math.min(50,Math.floor(batchSize)||20))],
    );
    for(const row of due.rows) {
      const lease=randomUUID();
      const claimed=await client.query(
        "UPDATE message_events SET status='processing',attempt_count=attempt_count+1,last_attempt_at=now(),locked_at=now(),locked_by='commerce-billing-email',lease_token=$1,updated_at=now() WHERE id=$2 AND status='queued' RETURNING attempt_count",
        [lease,row.id],
      );
      if(claimed.rowCount) events.push({...row,attempt_count:Number(claimed.rows[0].attempt_count),lease_token:lease});
    }
    await client.query("COMMIT");
  } catch(error) { await client.query("ROLLBACK").catch(()=>undefined); throw error; }
  finally { client.release(); }

  let sent=0,retried=0,failed=0,deliveryUnknown=0;
  for(const event of events) {
    const worker=await db.connect();
    try {
      const billingUrl=appUrl+"/dashboard/"+event.store_id+"/billing";
      const content=renderBillingEmail(event.template_key,event.payload||{},billingUrl);
      const html=`<!doctype html><html lang="en"><body style="margin:0;background:#f5f6f8;font-family:Arial,sans-serif;color:#171923"><main style="max-width:560px;margin:40px auto;padding:36px;background:#fff;border:1px solid #e5e7eb;border-radius:12px"><p style="font-size:13px;font-weight:700;letter-spacing:.08em;color:#5955D1">MOBIWAVE COMMERCE</p><h1>${escapeHtml(content.heading)}</h1><p>${escapeHtml(content.intro)}</p><p style="margin:30px 0"><a href="${escapeHtml(billingUrl)}" style="display:inline-block;background:#171923;color:#fff;text-decoration:none;padding:13px 20px;border-radius:7px;font-weight:700">${escapeHtml(content.action)}</a></p><p style="font-size:13px;line-height:1.6;color:#626778">${escapeHtml(content.outro)}</p></main></body></html>`;
      const textBody=`${content.heading}\n\n${content.intro}\n\n${content.action}: ${billingUrl}\n\n${content.outro}`;
      let response:Response;
      try {
        response=await fetch("https://api.brevo.com/v3/smtp/email",{
          method:"POST",
          headers:{"api-key":apiKey,"accept":"application/json","content-type":"application/json","Idempotency-Key":event.dedupe_key},
          body:JSON.stringify({sender:{name:senderName,email:senderEmail},to:[{email:event.recipient}],subject:content.subject,htmlContent:html,textContent:textBody}),
          cache:"no-store",signal:AbortSignal.timeout(10000),
        });
      } catch {
        await updateEvent(worker,event,"delivery_unknown","email_provider_network_outcome_unknown");
        deliveryUnknown++; continue;
      }
      if(response.status===429) {
        const retry=Number(response.headers.get("retry-after"));
        await updateEvent(worker,event,"queued","email_provider_rate_limited",Number.isFinite(retry)&&retry>0?Math.min(3600,Math.floor(retry)):120);
        retried++; continue;
      }
      if(response.status===408 || response.status>=500) {
        await updateEvent(worker,event,"delivery_unknown","email_provider_http_"+response.status+"_outcome_unknown");
        deliveryUnknown++; continue;
      }
      if(!response.ok) {
        await updateEvent(worker,event,"failed","email_provider_http_"+response.status);
        failed++; continue;
      }
      await updateEvent(worker,event,"sent");
      sent++;
    } catch {
      await updateEvent(worker,event,"delivery_unknown","email_worker_state_update_unknown").catch(()=>undefined);
      deliveryUnknown++;
    } finally { worker.release(); }
  }
  return {claimed:events.length,sent,retried,failed,deliveryUnknown};
}
