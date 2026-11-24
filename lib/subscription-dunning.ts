import type { PoolClient } from "pg";
import { db } from "@/lib/db";
import { normalizeKenyanPhone } from "@/lib/mpesa-utils";

type DunningResult = {
  dueMarked: number;
  day1: number;
  day2: number;
  suspended: number;
};

function validEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function enqueueNotice(
  client: PoolClient,
  input: { storeId: string; subscriptionId: string; cycleKey: string; eventType: "retry_day_1" | "retry_day_2" | "suspended"; storeName: string; email: string | null; phone: string | null; billingUrl: string },
) {
  const templateKey = input.eventType === "retry_day_1" ? "subscription_dunning_day_1"
    : input.eventType === "retry_day_2" ? "subscription_dunning_day_2" : "subscription_suspended";
  const payload = JSON.stringify({ storeName: input.storeName, billingUrl: input.billingUrl });
  const dedupeBase = "subscription:" + input.subscriptionId + ":" + input.cycleKey + ":" + input.eventType;
  if (validEmail(input.email)) {
    await client.query(
      `INSERT INTO message_events(store_id,channel,recipient,template_key,status,dedupe_key,payload)
       VALUES($1,'email',$2,$3,'queued',$4,$5::jsonb)
       ON CONFLICT(store_id,dedupe_key) DO NOTHING`,
      [input.storeId,input.email.trim().toLowerCase(),templateKey,dedupeBase + ":email",payload],
    );
  }
  const phone = input.phone ? normalizeKenyanPhone(input.phone) : null;
  if (phone) {
    await client.query(
      `INSERT INTO message_events(store_id,channel,recipient,template_key,status,dedupe_key,payload)
       VALUES($1,'sms',$2,$3,'queued',$4,$5::jsonb)
       ON CONFLICT(store_id,dedupe_key) DO NOTHING`,
      [input.storeId,phone,templateKey,dedupeBase + ":sms",payload],
    );
  }
}

export async function processSubscriptionDunningBatch(batchSize = 50): Promise<DunningResult> {
  const client = await db.connect();
  const result: DunningResult = { dueMarked: 0, day1: 0, day2: 0, suspended: 0 };
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://mobiwave-commerce.vercel.app").replace(/\/$/, "");
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.billing_worker','true',true)");

    const due = await client.query(
      `UPDATE subscriptions
          SET status='past_due',
              past_due_since=COALESCE(past_due_since,current_period_end,now()),
              dunning_attempts=0,
              next_dunning_at=COALESCE(current_period_end,now()) + interval '1 day',
              billing_cycle_key=COALESCE(billing_cycle_key,to_char(COALESCE(current_period_end,now()) AT TIME ZONE 'UTC','YYYYMMDDHH24MISS')),
              updated_at=now()
        WHERE plan_code<>'free' AND status='active'
          AND current_period_end IS NOT NULL AND current_period_end<=now()
        RETURNING id,store_id,billing_cycle_key`,
    );
    result.dueMarked = due.rowCount || 0;
    for (const row of due.rows) {
      await client.query(
        `INSERT INTO subscription_billing_events(subscription_id,store_id,cycle_key,event_type,event_key,metadata)
         VALUES($1,$2,$3,'payment_due',$4,'{"reason":"period_end_reached"}'::jsonb)
         ON CONFLICT DO NOTHING`,
        [row.id,row.store_id,row.billing_cycle_key,"subscription:" + row.id + ":" + row.billing_cycle_key + ":payment_due"],
      );
    }

    const retryRows = await client.query(
      `SELECT s.id AS subscription_id,s.store_id,s.billing_cycle_key,s.dunning_attempts,
              st.name AS store_name,st.contact_email,st.contact_phone AS phone
         FROM subscriptions s JOIN stores st ON st.id=s.store_id
        WHERE s.plan_code<>'free' AND s.status='past_due'
          AND s.dunning_attempts<2 AND s.next_dunning_at<=now()
        ORDER BY s.next_dunning_at
        LIMIT $1 FOR UPDATE OF s SKIP LOCKED`,
      [Math.max(1,Math.min(100,Math.floor(batchSize)||50))],
    );
    for (const row of retryRows.rows) {
      const attempt = Number(row.dunning_attempts) + 1;
      const eventType = attempt === 1 ? "retry_day_1" : "retry_day_2";
      const eventKey = "subscription:" + row.subscription_id + ":" + row.billing_cycle_key + ":" + eventType;
      const inserted = await client.query(
        `INSERT INTO subscription_billing_events(subscription_id,store_id,cycle_key,event_type,event_key,metadata)
         VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT DO NOTHING RETURNING id`,
        [row.subscription_id,row.store_id,row.billing_cycle_key,eventType,eventKey,JSON.stringify({attempt,scheduledDay:attempt})],
      );
      await client.query(
        `UPDATE subscriptions SET dunning_attempts=$1,
          next_dunning_at=past_due_since + CASE WHEN $1=1 THEN interval '2 days' ELSE interval '3 days' END,
          updated_at=now() WHERE id=$2 AND status='past_due'`,
        [attempt,row.subscription_id],
      );
      if (inserted.rowCount) {
        await enqueueNotice(client,{
          storeId:row.store_id,subscriptionId:row.subscription_id,cycleKey:row.billing_cycle_key,
          eventType,storeName:row.store_name,email:row.contact_email,phone:row.phone,billingUrl:appUrl + "/dashboard/" + row.store_id + "/billing",
        });
        if (attempt===1) result.day1++; else result.day2++;
      }
    }

    const suspendRows = await client.query(
      `SELECT s.id AS subscription_id,s.store_id,s.billing_cycle_key,st.name AS store_name,st.contact_email,
              (SELECT p.customer_phone FROM subscription_payment_attempts p
                WHERE p.subscription_id=s.id ORDER BY p.created_at DESC LIMIT 1) AS phone
         FROM subscriptions s JOIN stores st ON st.id=s.store_id
        WHERE s.plan_code<>'free' AND s.status='past_due'
          AND s.dunning_attempts=2 AND s.past_due_since<=now()-interval '3 days'
        ORDER BY s.past_due_since
        LIMIT $1 FOR UPDATE OF s SKIP LOCKED`,
      [Math.max(1,Math.min(100,Math.floor(batchSize)||50))],
    );
    for (const row of suspendRows.rows) {
      const eventKey = "subscription:" + row.subscription_id + ":" + row.billing_cycle_key + ":suspended";
      const inserted = await client.query(
        `INSERT INTO subscription_billing_events(subscription_id,store_id,cycle_key,event_type,event_key,metadata)
         VALUES($1,$2,$3,'suspended',$4,'{"day":3,"preserveStoreData":true}'::jsonb)
         ON CONFLICT DO NOTHING RETURNING id`,
        [row.subscription_id,row.store_id,row.billing_cycle_key,eventKey],
      );
      await client.query(
        "UPDATE subscriptions SET status='suspended',suspended_at=now(),next_dunning_at=NULL,updated_at=now() WHERE id=$1 AND status='past_due'",
        [row.subscription_id],
      );
      if (inserted.rowCount) {
        await enqueueNotice(client,{
          storeId:row.store_id,subscriptionId:row.subscription_id,cycleKey:row.billing_cycle_key,
          eventType:"suspended",storeName:row.store_name,email:row.contact_email,phone:row.phone,billingUrl:appUrl + "/dashboard/" + row.store_id + "/billing",
        });
        result.suspended++;
      }
    }
    await client.query("COMMIT");
    return result;
  } catch(error) {
    await client.query("ROLLBACK").catch(()=>undefined);
    throw error;
  } finally { client.release(); }
}
