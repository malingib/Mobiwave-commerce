import { timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import { after, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { matchesKenyanPhone } from "@/lib/mpesa-utils";
import { enqueueSms, processQueuedSmsBatch } from "@/lib/message-outbox";

type CallbackData = {
  ResultCode: number;
  ResultDesc?: string;
  CallbackMetadata?: { Item?: Array<{ Name?: string; Value?: string | number }> };
};
type SubscriptionAttempt = {
  id: string;
  store_id: string;
  subscription_id: string;
  plan_code: string;
  amount_minor: string | number;
  currency: string;
  status: string;
  customer_phone: string;
  store_name: string;
};

export const runtime = "nodejs";

function secureTokenMatch(expected: string, received: string | null) {
  if (!received) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

function getCallbackValue(callback: CallbackData, key: string) {
  return callback.CallbackMetadata?.Item?.find(item => item.Name === key)?.Value;
}

function callbackMetadata(callback: CallbackData) {
  const amount = Number(getCallbackValue(callback, "Amount"));
  const receipt = getCallbackValue(callback, "MpesaReceiptNumber");
  const phone = getCallbackValue(callback, "PhoneNumber");
  const transactionDate = getCallbackValue(callback, "TransactionDate");
  return { amount, receipt, phone, transactionDate };
}

async function markSubscriptionReview(client: PoolClient, attempt: SubscriptionAttempt, callback: CallbackData, reason: string) {
  const { amount, receipt, phone } = callbackMetadata(callback);
  await client.query(
    "UPDATE subscription_payment_attempts SET status='review_required', callback_payload=$1::jsonb, updated_at=now() WHERE id=$2",
    [JSON.stringify({
      resultCode: callback.ResultCode,
      amount: Number.isFinite(amount) ? amount : null,
      receipt: typeof receipt === "string" ? receipt.slice(0, 32) : null,
      phone: typeof phone === "string" || typeof phone === "number" ? String(phone).slice(0, 20) : null,
      reason,
    }), attempt.id],
  );
  await client.query("COMMIT");
  return NextResponse.json({ ResultCode: 0, ResultDesc: "Subscription payment requires reconciliation" });
}

async function processSubscriptionCallback(client: PoolClient, attempt: SubscriptionAttempt, callback: CallbackData) {
  if (attempt.status === "paid") {
    await client.query("COMMIT");
    return NextResponse.json({ ResultCode: 0, ResultDesc: "Already processed" });
  }
  if (callback.ResultCode !== 0) {
    await client.query(
      "UPDATE subscription_payment_attempts SET status='failed', callback_payload=$1::jsonb, updated_at=now() WHERE id=$2 AND status <> 'paid'",
      [JSON.stringify({ resultCode: callback.ResultCode, resultDescription: String(callback.ResultDesc || "").slice(0, 300) }), attempt.id],
    );
    await client.query("COMMIT");
    return NextResponse.json({ ResultCode: 0, ResultDesc: "Subscription payment failure recorded" });
  }

  const { amount, receipt, phone, transactionDate } = callbackMetadata(callback);
  const validAmount = Number.isFinite(amount)
    && Number.isSafeInteger(amount * 100)
    && amount * 100 === Number(attempt.amount_minor)
    && attempt.currency === "KES";
  const validReceipt = typeof receipt === "string" && /^[A-Z0-9]{6,20}$/.test(receipt);
  const validPhone = (typeof phone === "string" || typeof phone === "number")
    && matchesKenyanPhone(attempt.customer_phone, String(phone));
  if (!validAmount || !validReceipt || !validPhone) {
    return markSubscriptionReview(client, attempt, callback,
      !validAmount ? "amount_or_currency_mismatch" : !validReceipt ? "invalid_receipt" : "phone_mismatch");
  }

  const duplicate = await client.query(
    `SELECT 1 FROM mpesa_receipt_claims WHERE receipt_number=$1
     UNION ALL SELECT 1 FROM payment_attempts WHERE provider='mpesa' AND provider_reference=$1
     UNION ALL SELECT 1 FROM subscription_payment_attempts WHERE provider_reference=$1 AND id<>$2
     LIMIT 1`,
    [receipt, attempt.id],
  );
  if (duplicate.rowCount) return markSubscriptionReview(client, attempt, callback, "receipt_already_used");

  const claim = await client.query(
    "INSERT INTO mpesa_receipt_claims (receipt_number, payment_type, payment_attempt_id, store_id) VALUES ($1,'subscription',$2,$3) ON CONFLICT DO NOTHING RETURNING receipt_number",
    [receipt, attempt.id, attempt.store_id],
  );
  if (!claim.rowCount) return markSubscriptionReview(client, attempt, callback, "receipt_claim_race");

  await client.query(
    "UPDATE subscription_payment_attempts SET status='paid', provider_reference=$1, callback_payload=$2::jsonb, updated_at=now() WHERE id=$3",
    [receipt, JSON.stringify({
      resultCode: callback.ResultCode,
      amount,
      receipt,
      phone: String(phone).slice(0, 20),
      transactionDate: typeof transactionDate === "string" || typeof transactionDate === "number" ? String(transactionDate).slice(0, 20) : null,
    }), attempt.id],
  );
  await client.query(
    `UPDATE subscriptions
        SET plan_code=$1,
            status='active',
            current_period_start=GREATEST(COALESCE(current_period_end, now()), now()),
            current_period_end=GREATEST(COALESCE(current_period_end, now()), now()) + interval '1 month',
            provider='mpesa',
            provider_reference=$2,
            updated_at=now()
      WHERE id=$3 AND store_id=$4`,
    [attempt.plan_code, receipt, attempt.subscription_id, attempt.store_id],
  );
  await enqueueSms(client, {
    storeId: attempt.store_id,
    recipient: attempt.customer_phone,
    templateKey: "subscription_payment_received",
    dedupeKey: `subscription:${attempt.subscription_id}:payment:${attempt.id}`,
    payload: { storeName: attempt.store_name, planName: attempt.plan_code },
  });
  await client.query("COMMIT");
  after(() => processQueuedSmsBatch());
  return NextResponse.json({ ResultCode: 0, ResultDesc: "Subscription payment recorded" });
}

export async function POST(request: Request) {
  const expectedToken = process.env.MPESA_CALLBACK_TOKEN;
  if (!expectedToken || !secureTokenMatch(expectedToken, new URL(request.url).searchParams.get("token"))) {
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Unauthorized callback" }, { status: 401 });
  }
  let body: { Body?: { stkCallback?: { CheckoutRequestID?: string; ResultCode?: number; ResultDesc?: string; CallbackMetadata?: { Item?: Array<{ Name?: string; Value?: string | number }> } } } };
  try { body = await request.json(); } catch { return NextResponse.json({ ResultCode: 1, ResultDesc: "Invalid callback body" }, { status: 400 }); }
  const callback = body.Body?.stkCallback;
  const checkoutRequestId = callback?.CheckoutRequestID;
  if (!checkoutRequestId || typeof callback?.ResultCode !== "number") {
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Missing checkout result" }, { status: 400 });
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.mpesa_callback', 'true', true)");

    const subscriptionResult = await client.query(
      "SELECT p.id, p.store_id, p.subscription_id, p.plan_code, p.amount_minor, p.currency, p.status, p.customer_phone, s.name AS store_name FROM subscription_payment_attempts p JOIN stores s ON s.id=p.store_id WHERE p.provider='mpesa' AND p.checkout_request_id=$1 FOR UPDATE OF p",
      [checkoutRequestId],
    );
    if (subscriptionResult.rowCount) {
      return await processSubscriptionCallback(client, subscriptionResult.rows[0] as SubscriptionAttempt, callback);
    }

    const result = await client.query(
      `SELECT p.id, p.store_id, p.order_id, p.amount_minor, p.currency, p.status,
              o.customer_phone, o.customer_name, o.order_number, o.currency AS order_currency, s.name AS store_name
         FROM payment_attempts p
         JOIN orders o ON o.id=p.order_id AND o.store_id=p.store_id
         JOIN stores s ON s.id=p.store_id
        WHERE p.provider='mpesa' AND p.checkout_request_id=$1
        FOR UPDATE OF p, o`,
      [checkoutRequestId],
    );
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ ResultCode: 1, ResultDesc: "Unknown checkout request" }, { status: 404 });
    }
    const attempt = result.rows[0];
    if (attempt.status === "paid") {
      await client.query("COMMIT");
      return NextResponse.json({ ResultCode: 0, ResultDesc: "Already processed" });
    }

    if (callback.ResultCode !== 0) {
      await client.query(
        "UPDATE payment_attempts SET status='failed', callback_payload=$1::jsonb, updated_at=now() WHERE id=$2 AND status <> 'paid'",
        [JSON.stringify({ resultCode: callback.ResultCode, resultDescription: String(callback.ResultDesc || "").slice(0, 300) }), attempt.id],
      );
      await client.query(
        "UPDATE orders SET payment_status='failed', updated_at=now() WHERE id=$1 AND store_id=$2 AND payment_status NOT IN ('paid','review_required')",
        [attempt.order_id, attempt.store_id],
      );
      await enqueueSms(client, {
        storeId: attempt.store_id,
        orderId: attempt.order_id,
        recipient: attempt.customer_phone,
        templateKey: "order_payment_failed",
        dedupeKey: `order:${attempt.order_id}:payment_failed:${attempt.id}`,
        payload: { storeName: attempt.store_name, customerName: attempt.customer_name, orderNumber: attempt.order_number },
      });
      await client.query("COMMIT");
  after(() => processQueuedSmsBatch());
  return NextResponse.json({ ResultCode: 0, ResultDesc: "Payment failure recorded" });
    }

    const { amount, receipt, phone, transactionDate } = callbackMetadata(callback);
    const validAmount = Number.isFinite(amount)
      && Number.isSafeInteger(amount * 100)
      && amount * 100 === Number(attempt.amount_minor)
      && attempt.currency === "KES"
      && attempt.order_currency === "KES";
    const validReceipt = typeof receipt === "string" && /^[A-Z0-9]{6,20}$/.test(receipt);
    const validPhone = (typeof phone === "string" || typeof phone === "number")
      && matchesKenyanPhone(attempt.customer_phone, String(phone));

    const markOrderReview = async (reason: string) => {
      await client.query(
        "UPDATE payment_attempts SET status='review_required', callback_payload=$1::jsonb, updated_at=now() WHERE id=$2",
        [JSON.stringify({
          resultCode: callback.ResultCode,
          amount: Number.isFinite(amount) ? amount : null,
          receipt: typeof receipt === "string" ? receipt.slice(0, 32) : null,
          phone: typeof phone === "string" || typeof phone === "number" ? String(phone).slice(0, 20) : null,
          reason,
        }), attempt.id],
      );
      await client.query(
        "UPDATE orders SET payment_status='review_required', updated_at=now() WHERE id=$1 AND store_id=$2 AND payment_status <> 'paid'",
        [attempt.order_id, attempt.store_id],
      );
      await client.query("COMMIT");
      return NextResponse.json({ ResultCode: 0, ResultDesc: "Payment requires reconciliation" });
    };

    if (!validAmount || !validReceipt || !validPhone) {
      return markOrderReview(!validAmount ? "amount_or_currency_mismatch" : !validReceipt ? "invalid_receipt" : "phone_mismatch");
    }

    const duplicateReceipt = await client.query(
      `SELECT 1 FROM mpesa_receipt_claims WHERE receipt_number=$1
       UNION ALL SELECT 1 FROM payment_attempts WHERE provider='mpesa' AND provider_reference=$1 AND id<>$2
       UNION ALL SELECT 1 FROM subscription_payment_attempts WHERE provider_reference=$1
       LIMIT 1`,
      [receipt, attempt.id],
    );
    if (duplicateReceipt.rowCount) return markOrderReview("receipt_already_used");

    const claim = await client.query(
      "INSERT INTO mpesa_receipt_claims (receipt_number, payment_type, payment_attempt_id, store_id) VALUES ($1,'order',$2,$3) ON CONFLICT DO NOTHING RETURNING receipt_number",
      [receipt, attempt.id, attempt.store_id],
    );
    if (!claim.rowCount) return markOrderReview("receipt_claim_race");

    await client.query(
      "UPDATE payment_attempts SET status='paid', provider_reference=$1, callback_payload=$2::jsonb, updated_at=now() WHERE id=$3",
      [receipt, JSON.stringify({
        resultCode: callback.ResultCode,
        amount,
        receipt,
        phone: String(phone).slice(0, 20),
        transactionDate: typeof transactionDate === "string" || typeof transactionDate === "number" ? String(transactionDate).slice(0, 20) : null,
      }), attempt.id],
    );
    await client.query(
      "UPDATE orders SET payment_status='paid', updated_at=now() WHERE id=$1 AND store_id=$2 AND payment_status <> 'paid'",
      [attempt.order_id, attempt.store_id],
    );
    await enqueueSms(client, {
      storeId: attempt.store_id,
      orderId: attempt.order_id,
      recipient: attempt.customer_phone,
      templateKey: "order_payment_received",
      dedupeKey: `order:${attempt.order_id}:payment_received`,
      payload: { storeName: attempt.store_name, customerName: attempt.customer_name, orderNumber: attempt.order_number, receipt },
    });
    await client.query("COMMIT");
  after(() => processQueuedSmsBatch());
  return NextResponse.json({ ResultCode: 0, ResultDesc: "Payment recorded" });
  } catch {
    await client.query("ROLLBACK").catch(() => undefined);
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Callback processing failed" }, { status: 500 });
  } finally {
    client.release();
  }
}
