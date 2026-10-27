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
  let body: { Body?: { stkCallback?: { CheckoutRequestID?: string; ResultCode?: number; ResultDesc?: string; CallbackMetadata?: { Item?: Array<{ Name?: string; Value?: string|number }> } } } };
  try { body = await request.json(); } catch { return NextResponse.json({ ResultCode: 1, ResultDesc: "Invalid callback body" }, { status: 400 }); }
  const callback = body.Body?.stkCallback;
  const checkoutRequestId = callback?.CheckoutRequestID;
  if (!checkoutRequestId || typeof callback?.ResultCode !== "number") {
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Missing checkout result" }, { status: 400 });
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      "SELECT id, store_id, order_id, amount_minor, status FROM payment_attempts WHERE provider='mpesa' AND checkout_request_id=$1 FOR UPDATE",
      [checkoutRequestId]
    );
    if (!result.rowCount) { await client.query("ROLLBACK"); return NextResponse.json({ ResultCode: 1, ResultDesc: "Unknown checkout request" }, { status: 404 }); }
    const attempt = result.rows[0];
    if (attempt.status === "paid") { await client.query("COMMIT"); return NextResponse.json({ ResultCode: 0, ResultDesc: "Already processed" }); }

    if (callback.ResultCode !== 0) {
      await client.query("UPDATE payment_attempts SET status='failed', updated_at=now() WHERE id=$1", [attempt.id]);
      await client.query("UPDATE orders SET payment_status='failed', updated_at=now() WHERE id=$1 AND store_id=$2 AND payment_status <> 'paid'", [attempt.order_id, attempt.store_id]);
      await client.query("COMMIT");
      return NextResponse.json({ ResultCode: 0, ResultDesc: "Payment failure recorded" });
    }

    const values = callback.CallbackMetadata?.Item || [];
    const getValue = (key: string) => values.find(item => item.Name === key)?.Value;
    const amount = Number(getValue("Amount"));
    const receipt = getValue("MpesaReceiptNumber");
    if (!Number.isFinite(amount) || amount * 100 !== Number(attempt.amount_minor) || typeof receipt !== "string" || !/^[A-Z0-9]{6,20}$/.test(receipt)) {
      await client.query("UPDATE payment_attempts SET status='failed', updated_at=now() WHERE id=$1", [attempt.id]);
      await client.query("UPDATE orders SET payment_status='failed', updated_at=now() WHERE id=$1 AND store_id=$2 AND payment_status <> 'paid'", [attempt.order_id, attempt.store_id]);
      await client.query("COMMIT");
      return NextResponse.json({ ResultCode: 1, ResultDesc: "Payment details failed validation" }, { status: 400 });
    }

    await client.query(
      "UPDATE payment_attempts SET status='paid', provider_reference=$1, callback_payload=$2::jsonb, updated_at=now() WHERE id=$3",
      [receipt, JSON.stringify({ resultCode: callback.ResultCode, amount, receipt }), attempt.id]
    );
    await client.query("UPDATE orders SET payment_status='paid', updated_at=now() WHERE id=$1 AND store_id=$2", [attempt.order_id, attempt.store_id]);
    await client.query("COMMIT");
    return NextResponse.json({ ResultCode: 0, ResultDesc: "Payment recorded" });
  } catch {
    await client.query("ROLLBACK");
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Callback processing failed" }, { status: 500 });
  } finally { client.release(); }
}
