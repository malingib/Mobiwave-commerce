import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

function secureTokenMatch(expected: string, received: string | null) {
  if (!received) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
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
    const result = await client.query(
      "SELECT id, store_id, order_id, amount_minor, status FROM payment_attempts WHERE provider='mpesa' AND checkout_request_id=$1 FOR UPDATE",
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
      await client.query("COMMIT");
      return NextResponse.json({ ResultCode: 0, ResultDesc: "Payment failure recorded" });
    }

    const values = callback.CallbackMetadata?.Item || [];
    const getValue = (key: string) => values.find(item => item.Name === key)?.Value;
    const amount = Number(getValue("Amount"));
    const receipt = getValue("MpesaReceiptNumber");
    const validAmount = Number.isFinite(amount) && Number.isSafeInteger(amount * 100) && amount * 100 === Number(attempt.amount_minor);
    const validReceipt = typeof receipt === "string" && /^[A-Z0-9]{6,20}$/.test(receipt);
    const phone = getValue("PhoneNumber");
    const transactionDate = getValue("TransactionDate");

    if (!validAmount || !validReceipt) {
      const reviewPayload = {
        resultCode: callback.ResultCode,
        amount: Number.isFinite(amount) ? amount : null,
        receipt: typeof receipt === "string" ? receipt.slice(0, 32) : null,
        reason: !validAmount ? "amount_mismatch" : "invalid_receipt",
      };
      await client.query(
        "UPDATE payment_attempts SET status='review_required', callback_payload=$1::jsonb, updated_at=now() WHERE id=$2",
        [JSON.stringify(reviewPayload), attempt.id],
      );
      await client.query(
        "UPDATE orders SET payment_status='review_required', updated_at=now() WHERE id=$1 AND store_id=$2 AND payment_status <> 'paid'",
        [attempt.order_id, attempt.store_id],
      );
      await client.query("COMMIT");
      return NextResponse.json({ ResultCode: 0, ResultDesc: "Payment requires reconciliation" });
    }

    const duplicateReceipt = await client.query(
      "SELECT id FROM payment_attempts WHERE provider='mpesa' AND provider_reference=$1 AND id<>$2 LIMIT 1",
      [receipt, attempt.id],
    );
    if (duplicateReceipt.rowCount) {
      await client.query(
        "UPDATE payment_attempts SET status='review_required', callback_payload=$1::jsonb, updated_at=now() WHERE id=$2",
        [JSON.stringify({ resultCode: callback.ResultCode, amount, receipt, reason: "receipt_already_used" }), attempt.id],
      );
      await client.query(
        "UPDATE orders SET payment_status='review_required', updated_at=now() WHERE id=$1 AND store_id=$2 AND payment_status <> 'paid'",
        [attempt.order_id, attempt.store_id],
      );
      await client.query("COMMIT");
      return NextResponse.json({ ResultCode: 0, ResultDesc: "Payment requires reconciliation" });
    }

    await client.query(
      "UPDATE payment_attempts SET status='paid', provider_reference=$1, callback_payload=$2::jsonb, updated_at=now() WHERE id=$3",
      [receipt, JSON.stringify({
        resultCode: callback.ResultCode,
        amount,
        receipt,
        phone: typeof phone === "string" || typeof phone === "number" ? String(phone).slice(0, 20) : null,
        transactionDate: typeof transactionDate === "string" || typeof transactionDate === "number" ? String(transactionDate).slice(0, 20) : null,
      }), attempt.id],
    );
    await client.query(
      "UPDATE orders SET payment_status='paid', updated_at=now() WHERE id=$1 AND store_id=$2 AND payment_status <> 'paid'",
      [attempt.order_id, attempt.store_id],
    );
    await client.query("COMMIT");
    return NextResponse.json({ ResultCode: 0, ResultDesc: "Payment recorded" });
  } catch {
    await client.query("ROLLBACK").catch(() => undefined);
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Callback processing failed" }, { status: 500 });
  } finally {
    client.release();
  }
}
