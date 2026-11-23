import type { PoolClient } from "pg";

export type SmsWalletCharge = {
  totalSegments: number;
  includedSegments: number;
  billableSegments: number;
  unitRateMinor: number;
  amountMinor: number;
};

export function calculateSmsWalletCharge(totalSegments: number, includedSegments: number, unitRateMinor: number): SmsWalletCharge {
  for (const [name, value] of Object.entries({ totalSegments, includedSegments, unitRateMinor })) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("invalid_" + name);
  }
  const billableSegments = Math.max(0, totalSegments - includedSegments);
  const amountMinor = billableSegments * unitRateMinor;
  if (!Number.isSafeInteger(amountMinor)) throw new Error("sms_charge_overflow");
  return { totalSegments, includedSegments, billableSegments, unitRateMinor, amountMinor };
}


const GSM7_BASIC = new Set(Array.from("@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"));
const GSM7_EXTENSION = new Set(Array.from("\\^{}\\\\[~]|€"));

export function countSmsSegments(message: string): { encoding: "GSM-7" | "UCS-2"; units: number; segments: number } {
  if (typeof message !== "string") throw new Error("invalid_sms_message");
  if (message.length === 0) return { encoding: "GSM-7", units: 0, segments: 0 };
  let septets = 0;
  let gsm = true;
  for (const character of Array.from(message)) {
    if (GSM7_BASIC.has(character)) septets += 1;
    else if (GSM7_EXTENSION.has(character)) septets += 2;
    else { gsm = false; break; }
  }
  if (gsm) return { encoding: "GSM-7", units: septets, segments: septets <= 160 ? 1 : Math.ceil(septets / 153) };
  const units = message.length; // UTF-16 code units, matching UCS-2 surrogate-pair accounting.
  return { encoding: "UCS-2", units, segments: units <= 70 ? 1 : Math.ceil(units / 67) };
}

export type SmsUsageReservation =
  | { ok: true; usageId: string; walletReservationId: string | null; totalSegments: number; includedSegments: number; billableSegments: number; amountMinor: number }
  | { ok: false; reason: "sms_billing_not_configured" | "wallet_not_configured" | "wallet_blocked" | "insufficient_funds" | "wallet_currency_mismatch" };

export async function reserveSmsUsage(client: PoolClient, input: {
  storeId: string; eventId: string; totalSegments: number;
}): Promise<SmsUsageReservation> {
  if (!input.storeId || !input.eventId || !Number.isSafeInteger(input.totalSegments) || input.totalSegments < 1) {
    throw new Error("invalid_sms_usage_reservation");
  }
  await client.query("SELECT set_config('app.wallet_worker','true',true), set_config('app.message_worker','true',true)");
  const config = await client.query(
    "SELECT included_segments_per_month, unit_rate_minor, currency FROM store_sms_billing_config WHERE store_id=$1 AND enabled=true FOR UPDATE",
    [input.storeId],
  );
  if (!config.rowCount) return { ok: false, reason: "sms_billing_not_configured" };
  const existing = await client.query(
    "SELECT id, wallet_reservation_id, total_segments, included_segments, billable_segments, amount_minor, status " +
    "FROM store_sms_usage WHERE store_id=$1 AND event_id=$2",
    [input.storeId,input.eventId],
  );
  if (existing.rowCount) {
    const row = existing.rows[0];
    if (Number(row.total_segments) !== input.totalSegments) throw new Error("sms_usage_idempotency_conflict");
    if (row.status === "released") throw new Error("sms_usage_already_released");
    return { ok:true, usageId:row.id, walletReservationId:row.wallet_reservation_id,
      totalSegments:Number(row.total_segments), includedSegments:Number(row.included_segments),
      billableSegments:Number(row.billable_segments), amountMinor:Number(row.amount_minor) };
  }
  const period = await client.query("SELECT date_trunc('month', now() AT TIME ZONE 'UTC')::date AS period_start");
  const periodStart = period.rows[0].period_start;
  const consumed = await client.query(
    "SELECT COALESCE(SUM(total_segments),0)::bigint AS used FROM store_sms_usage " +
    "WHERE store_id=$1 AND period_start=$2 AND status IN ('reserved','committed')",
    [input.storeId,periodStart],
  );
  const allowance = Number(config.rows[0].included_segments_per_month);
  const alreadyUsed = Number(consumed.rows[0].used);
  const includedSegments = Math.min(input.totalSegments,Math.max(0,allowance-alreadyUsed));
  const billableSegments = input.totalSegments-includedSegments;
  const unitRateMinor = Number(config.rows[0].unit_rate_minor);
  const amountMinor = billableSegments*unitRateMinor;
  if (!Number.isSafeInteger(amountMinor)) throw new Error("sms_charge_overflow");
  let walletReservationId: string | null = null;
  if (amountMinor > 0) {
    const account = await client.query("SELECT currency FROM store_wallet_accounts WHERE store_id=$1", [input.storeId]);
    if (!account.rowCount) return { ok:false, reason:"wallet_not_configured" };
    if (String(account.rows[0].currency).trim() !== String(config.rows[0].currency).trim()) {
      return { ok:false, reason:"wallet_currency_mismatch" };
    }
    const reservation = await reserveStoreWalletFunds(client,{
      storeId:input.storeId, amountMinor, idempotencyKey:"sms:"+input.eventId, referenceId:input.eventId,
    });
    if (!reservation.ok) return reservation;
    walletReservationId=reservation.reservationId;
  }
  const inserted = await client.query(
    "INSERT INTO store_sms_usage (store_id,event_id,period_start,total_segments,included_segments,billable_segments,unit_rate_minor,amount_minor,currency,wallet_reservation_id,status) " +
    "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'reserved') RETURNING id",
    [input.storeId,input.eventId,periodStart,input.totalSegments,includedSegments,billableSegments,unitRateMinor,amountMinor,
      config.rows[0].currency,walletReservationId],
  );
  return {ok:true,usageId:inserted.rows[0].id,walletReservationId,totalSegments:input.totalSegments,
    includedSegments,billableSegments,amountMinor};
}

export async function settleSmsUsage(client: PoolClient, input: {
  storeId: string; eventId: string; outcome: "commit" | "release";
}) {
  await client.query("SELECT set_config('app.wallet_worker','true',true), set_config('app.message_worker','true',true)");
  const result = await client.query(
    "SELECT id,wallet_reservation_id,status FROM store_sms_usage WHERE store_id=$1 AND event_id=$2 FOR UPDATE",
    [input.storeId,input.eventId],
  );
  if (!result.rowCount) return { status:"not_found" as const };
  const usage=result.rows[0];
  if (usage.status === "committed" && input.outcome === "commit") return {status:"committed" as const};
  if (usage.status === "released" && input.outcome === "release") return {status:"released" as const};
  if (usage.status !== "reserved") throw new Error("sms_usage_already_settled");
  if (usage.wallet_reservation_id) {
    await settleStoreWalletReservation(client,{
      storeId:input.storeId,reservationId:usage.wallet_reservation_id,
      outcome:input.outcome,idempotencyKey:input.outcome+":"+input.eventId,
    });
  }
  const status=input.outcome === "commit" ? "committed" : "released";
  await client.query("UPDATE store_sms_usage SET status=$3, settled_at=now() WHERE store_id=$1 AND id=$2",
    [input.storeId,usage.id,status]);
  return {status};
}

export type WalletReservationResult =
  | { ok: true; reservationId: string; status: "reserved" | "committed" }
  | { ok: false; reason: "wallet_not_configured" | "wallet_blocked" | "insufficient_funds" };

export async function reserveStoreWalletFunds(client: PoolClient, input: {
  storeId: string; amountMinor: number; idempotencyKey: string; referenceId?: string | null; expiresInMinutes?: number;
}): Promise<WalletReservationResult> {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new Error("invalid_wallet_reservation_amount");
  if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 180) throw new Error("invalid_wallet_idempotency_key");
  if (input.expiresInMinutes !== undefined && (!Number.isSafeInteger(input.expiresInMinutes) || input.expiresInMinutes <= 0)) {
    throw new Error("invalid_wallet_reservation_expiry");
  }
  await client.query("SELECT set_config('app.wallet_worker', 'true', true)");
  const account = await client.query(
    "SELECT available_balance_minor, currency, status FROM store_wallet_accounts WHERE store_id=$1 FOR UPDATE",
    [input.storeId],
  );
  if (!account.rowCount) return { ok: false, reason: "wallet_not_configured" };
  // The account lock serializes spend attempts. Re-check idempotency after acquiring it.
  const existing = await client.query(
    "SELECT id, amount_minor, status FROM store_wallet_reservations WHERE store_id=$1 AND idempotency_key=$2",
    [input.storeId, input.idempotencyKey],
  );
  if (existing.rowCount) {
    const row = existing.rows[0];
    if (Number(row.amount_minor) !== input.amountMinor) throw new Error("wallet_idempotency_conflict");
    if (row.status === "released") throw new Error("wallet_reservation_already_released");
    return { ok: true, reservationId: row.id, status: row.status };
  }
  if (account.rows[0].status !== "active") return { ok: false, reason: "wallet_blocked" };
  if (BigInt(account.rows[0].available_balance_minor) < BigInt(input.amountMinor)) {
    return { ok: false, reason: "insufficient_funds" };
  }
  const inserted = await client.query(
    "INSERT INTO store_wallet_reservations " +
      "(store_id, amount_minor, currency, idempotency_key, reference_type, reference_id, expires_at) " +
      "VALUES ($1,$2,$3,$4,'sms',$5,CASE WHEN $6::int IS NULL THEN NULL ELSE now()+($6::int * interval '1 minute') END) " +
      "RETURNING id, status",
    [input.storeId, input.amountMinor, account.rows[0].currency, input.idempotencyKey, input.referenceId || null, input.expiresInMinutes ?? null],
  );
  await client.query(
    "UPDATE store_wallet_accounts SET available_balance_minor=available_balance_minor-$2, updated_at=now() WHERE store_id=$1",
    [input.storeId, input.amountMinor],
  );
  await client.query(
    "INSERT INTO store_wallet_transactions " +
      "(store_id, transaction_type, amount_minor, currency, idempotency_key, reference_type, reference_id, description) " +
      "VALUES ($1,'sms_reserve',$2,$3,$4,'sms',$5,'SMS overage reservation')",
    [input.storeId, -input.amountMinor, account.rows[0].currency, "reserve:" + input.idempotencyKey, input.referenceId || null],
  );
  return { ok: true, reservationId: inserted.rows[0].id, status: "reserved" };
}

export async function settleStoreWalletReservation(client: PoolClient, input: {
  storeId: string; reservationId: string; outcome: "commit" | "release"; idempotencyKey: string;
}) {
  if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 180) throw new Error("invalid_wallet_idempotency_key");
  await client.query("SELECT set_config('app.wallet_worker', 'true', true)");
  // Keep lock order consistent with reservation creation to avoid deadlocks.
  await client.query("SELECT store_id FROM store_wallet_accounts WHERE store_id=$1 FOR UPDATE", [input.storeId]);
  const result = await client.query(
    "SELECT id, amount_minor, currency, status FROM store_wallet_reservations WHERE store_id=$1 AND id=$2 FOR UPDATE",
    [input.storeId, input.reservationId],
  );
  if (!result.rowCount) throw new Error("wallet_reservation_not_found");
  const reservation = result.rows[0];
  if (reservation.status === "committed" && input.outcome === "commit") return { status: "committed" as const };
  if (reservation.status === "released" && input.outcome === "release") return { status: "released" as const };
  if (reservation.status !== "reserved") throw new Error("wallet_reservation_already_settled");
  if (input.outcome === "release") {
    await client.query(
      "UPDATE store_wallet_accounts SET available_balance_minor=available_balance_minor+$2, updated_at=now() WHERE store_id=$1",
      [input.storeId, reservation.amount_minor],
    );
    await client.query(
      "INSERT INTO store_wallet_transactions " +
        "(store_id, transaction_type, amount_minor, currency, idempotency_key, reference_type, reference_id, description) " +
        "VALUES ($1,'sms_release',$2,$3,$4,'sms',$5,'Release unused SMS reservation')",
      [input.storeId, reservation.amount_minor, reservation.currency, "release:" + reservation.id, reservation.id],
    );
    await client.query(
      "UPDATE store_wallet_reservations SET status='released', released_at=now() WHERE store_id=$1 AND id=$2",
      [input.storeId, reservation.id],
    );
    return { status: "released" as const };
  }
  await client.query(
    "UPDATE store_wallet_reservations SET status='committed', committed_at=now() WHERE store_id=$1 AND id=$2",
    [input.storeId, reservation.id],
  );
  return { status: "committed" as const };
}
