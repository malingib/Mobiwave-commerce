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
