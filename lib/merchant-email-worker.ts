import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { db } from "@/lib/db";

type MerchantEmail = {
  id:string; store_id:string; recipient:string; dedupe_key:string;
  payload:Record<string,unknown>; lease_token:string;
};

async function reserveAllowance(event:MerchantEmail) {
  const client=await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.email_worker','true',true)");
    const subscription=await client.query(
      "SELECT s.status,p.limits->>'includedEmailSendsPerMonth' AS allowance " +
      "FROM subscriptions s JOIN commerce_plans p ON p.code=s.plan_code " +
      "WHERE s.store_id=$1 FOR UPDATE OF s",
      [event.store_id],
    );
    if(!subscription.rowCount || !["active","trialing","past_due"].includes(String(subscription.rows[0].status))) {
      await client.query("COMMIT");
      return {ok:false as const,reason:"subscription_not_active"};
    }
    const raw=subscription.rows[0].allowance;
    if(raw===null || raw===undefined || !/^\d+$/.test(String(raw))) {
      await client.query("COMMIT");
      return {ok:false as const,reason:"email_allowance_not_configured"};
    }
    const allowance=Number(raw);
    if(!Number.isSafeInteger(allowance) || allowance<0) throw new Error("email_allowance_invalid");
    const existing=await client.query("SELECT status FROM email_usage_ledger WHERE message_event_id=$1 FOR UPDATE",[event.id]);
    if(existing.rowCount && existing.rows[0].status!=="released") {
      await client.query("COMMIT");
      return {ok:false as const,reason:"email_usage_already_reserved"};
    }
    const period=await client.query(
      "SELECT date_trunc('month',now() AT TIME ZONE 'UTC')::date AS period_start,"+
      "(date_trunc('month',now() AT TIME ZONE 'UTC')+interval '1 month')::date AS period_end",
    );
    const start=period.rows[0].period_start;
    const end=period.rows[0].period_end;
    const used=await client.query(
      "SELECT COALESCE(sum(amount),0)::integer AS used FROM email_usage_ledger "+
      "WHERE store_id=$1 AND period_start=$2 AND status IN ('reserved','accepted','unknown')",
      [event.store_id,start],
    );
    if(Number(used.rows[0].used)>=allowance) {
      await client.query("COMMIT");
      return {ok:false as const,reason:"email_allowance_exhausted"};
    }
    const saved=await client.query(
      "INSERT INTO email_usage_ledger(store_id,message_event_id,period_start,period_end,status) "+
      "VALUES($1,$2,$3,$4,'reserved') "+
      "ON CONFLICT(message_event_id) DO UPDATE SET period_start=EXCLUDED.period_start,"+
      "period_end=EXCLUDED.period_end,status='reserved',updated_at=now() "+
      "WHERE email_usage_ledger.status='released' RETURNING id",
      [event.store_id,event.id,start,end],
    );
    if(!saved.rowCount) {
      await client.query("COMMIT");
      return {ok:false as const,reason:"email_usage_already_reserved"};
    }
    await client.query("COMMIT");
    return {ok:true as const};
  } catch(error) {
    await client.query("ROLLBACK").catch(()=>undefined);
    throw error;
  } finally { client.release(); }
}

async function finishEvent(
  client:PoolClient,event:MerchantEmail,status:"sent"|"queued"|"failed"|"delivery_unknown",
  errorCode:string|null,usageStatus:"accepted"|"released"|"unknown"|null,providerReference:string|null=null,delaySeconds=0,
) {
  await client.query("BEGIN");
  try {
    await client.query("SELECT set_config('app.email_worker','true',true)");
    if(usageStatus) {
      await client.query(
        "UPDATE email_usage_ledger SET status=$1,provider_reference=$2,"+
        "accepted_at=CASE WHEN $1='accepted' THEN now() ELSE accepted_at END,updated_at=now() "+
        "WHERE message_event_id=$3",
        [usageStatus,providerReference,event.id],
      );
    }
    await client.query(
      "UPDATE message_events SET status=$1,error_code=$2,"+
      "sent_at=CASE WHEN $1='sent' THEN now() ELSE sent_at END,"+
      "next_attempt_at=CASE WHEN $1='queued' THEN now()+($3::int*interval '1 second') ELSE next_attempt_at END,"+
      "locked_at=NULL,locked_by=NULL,updated_at=now() "+
      "WHERE id=$4 AND lease_token=$5 AND status='processing'",
      [status,errorCode,delaySeconds,event.id,event.lease_token],
    );
    await client.query("COMMIT");
  } catch(error) {
    await client.query("ROLLBACK").catch(()=>undefined);
    throw error;
  }
}

function escapeHtml(value:string) {
  return value.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]||c));
}

export async function processQueuedMerchantEmails(batchSize=20) {
  const apiKey=process.env.BREVO_API_KEY;
  const senderEmail=process.env.BREVO_SENDER_EMAIL;
  if(!apiKey || !senderEmail) return {claimed:0,sent:0,retried:0,failed:0,deliveryUnknown:0,skipped:"email_provider_not_configured" as const};
  const senderName=process.env.BREVO_SENDER_NAME || "MobiWave Commerce";
  const client=await db.connect();
  const events:MerchantEmail[]=[];
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.email_worker','true',true)");
    await client.query(
      "UPDATE message_events SET status='delivery_unknown',delivery_unknown_at=COALESCE(delivery_unknown_at,now()),"+
      "error_code='email_worker_lease_expired',locked_at=NULL,locked_by=NULL,updated_at=now() "+
      "WHERE channel='email' AND template_key='merchant_email' AND status='processing' "+
      "AND locked_at<now()-interval '15 minutes'",
    );
    const due=await client.query(
      "SELECT id,store_id,recipient,dedupe_key,payload FROM message_events "+
      "WHERE channel='email' AND template_key='merchant_email' AND status='queued' AND next_attempt_at<=now() "+
      "ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED",
      [Math.max(1,Math.min(50,Math.floor(batchSize)||20))],
    );
    for(const row of due.rows) {
      const lease=randomUUID();
      const claim=await client.query(
        "UPDATE message_events SET status='processing',attempt_count=attempt_count+1,last_attempt_at=now(),"+
        "locked_at=now(),locked_by='commerce-merchant-email',lease_token=$1,updated_at=now() "+
        "WHERE id=$2 AND status='queued' RETURNING id",
        [lease,row.id],
      );
      if(claim.rowCount) events.push({...row,lease_token:lease});
    }
    await client.query("COMMIT");
  } catch(error) {
    await client.query("ROLLBACK").catch(()=>undefined);
    throw error;
  } finally { client.release(); }

  let sent=0,retried=0,failed=0,deliveryUnknown=0;
  for(const event of events) {
    const worker=await db.connect();
    try {
      const reservation=await reserveAllowance(event);
      if(!reservation.ok) {
        await finishEvent(worker,event,"failed",reservation.reason,null);
        failed++;
        continue;
      }
      const payload=event.payload||{};
      const subject=String(payload.subject||"Message from your store").slice(0,180);
      const body=String(payload.textContent||"");
      const unsubscribe=typeof payload.unsubscribeUrl==="string"?payload.unsubscribeUrl:null;
      const html="<html><body><main style='font-family:Arial,sans-serif;line-height:1.6'>"+
        "<p>"+escapeHtml(body).replace(/\n/g,"<br>")+"</p>"+
        (unsubscribe?"<p style='font-size:12px'>To stop receiving these messages, <a href='"+escapeHtml(unsubscribe)+"'>unsubscribe</a>.</p>":"")+
        "</main></body></html>";
      const textBody=body+(unsubscribe?"\n\nUnsubscribe: "+unsubscribe:"");
      let response:Response;
      try {
        response=await fetch("https://api.brevo.com/v3/smtp/email",{
          method:"POST",
          headers:{"api-key":apiKey,"accept":"application/json","content-type":"application/json"},
          body:JSON.stringify({sender:{name:senderName,email:senderEmail},to:[{email:event.recipient}],subject,htmlContent:html,textContent:textBody}),
          cache:"no-store",signal:AbortSignal.timeout(10000),
        });
      } catch {
        await finishEvent(worker,event,"delivery_unknown","email_provider_network_outcome_unknown","unknown");
        deliveryUnknown++; continue;
      }
      if(response.status===429) {
        const retry=Number(response.headers.get("retry-after"));
        await finishEvent(worker,event,"queued","email_provider_rate_limited","released",null,
          Number.isFinite(retry)&&retry>0?Math.min(3600,Math.floor(retry)):120);
        retried++; continue;
      }
      if(response.status===408 || response.status>=500) {
        await finishEvent(worker,event,"delivery_unknown","email_provider_http_"+response.status+"_outcome_unknown","unknown");
        deliveryUnknown++; continue;
      }
      if(!response.ok) {
        await finishEvent(worker,event,"failed","email_provider_http_"+response.status,"released");
        failed++; continue;
      }
      let providerReference:string|null=null;
      try { const data=await response.json() as {messageId?:string}; providerReference=data.messageId||null; } catch { /* HTTP 2xx confirms provider acceptance */ }
      await finishEvent(worker,event,"sent",null,"accepted",providerReference);
      sent++;
    } catch {
      await finishEvent(worker,event,"delivery_unknown","email_worker_state_update_unknown","unknown").catch(()=>undefined);
      deliveryUnknown++;
    } finally { worker.release(); }
  }
  return {claimed:events.length,sent,retried,failed,deliveryUnknown};
}
