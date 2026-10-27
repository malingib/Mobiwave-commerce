import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getRequestUser } from "@/lib/request-user";

export const runtime = "nodejs";

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.startsWith("0") && digits.length === 10) return `254${digits.slice(1)}`;
  if (digits.startsWith("254") && digits.length === 12) return digits;
  if (digits.startsWith("7") && digits.length === 9) return `254${digits}`;
  if (digits.startsWith("1") && digits.length === 9) return `254${digits}`;
  return null;
}

function timestamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}${String(d.getHours()).padStart(2,"0")}${String(d.getMinutes()).padStart(2,"0")}${String(d.getSeconds()).padStart(2,"0")}`;
}

export async function POST(request: Request, context: { params: Promise<{ storeId: string; orderId: string }> }) {
  const user = await getRequestUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { storeId, orderId } = await context.params;
  const consumerKey = process.env.MPESA_CONSUMER_KEY;
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
  const shortcode = process.env.MPESA_SHORTCODE;
  const passkey = process.env.MPESA_PASSKEY;
  const callbackToken = process.env.MPESA_CALLBACK_TOKEN;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!consumerKey || !consumerSecret || !shortcode || !passkey || !callbackToken || !appUrl) {
    return NextResponse.json({ error: "M-Pesa STK Push is not configured for this environment yet." }, { status: 503 });
  }

  const client = await db.connect();
  let attemptId: string | null = null;
  let stkRequestStarted = false;
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [user.id]);
    const result = await client.query(
      "SELECT id, customer_phone, total_minor, currency, payment_status FROM orders WHERE id=$1 AND store_id=$2 FOR UPDATE",
      [orderId, storeId]
    );
    if (!result.rowCount) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Order not found or access denied" }, { status: 404 }); }
    const order = result.rows[0] as { id:string; customer_phone:string; total_minor:string|number; currency:string; payment_status:string };
    if (order.payment_status === "paid") { await client.query("ROLLBACK"); return NextResponse.json({ error: "This order is already paid." }, { status: 409 }); }
    if (order.currency !== "KES" || Number(order.total_minor) <= 0 || Number(order.total_minor) % 100 !== 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "M-Pesa requires a positive total in whole Kenyan shillings." }, { status: 400 });
    }
    const phone = normalizePhone(order.customer_phone);
    if (!phone) { await client.query("ROLLBACK"); return NextResponse.json({ error: "The customer's phone number is not a valid Kenyan mobile number." }, { status: 400 }); }
    const existing = await client.query("SELECT id FROM payment_attempts WHERE store_id=$1 AND order_id=$2 AND provider='mpesa' AND status='pending' LIMIT 1", [storeId, orderId]);
    if (existing.rowCount) { await client.query("ROLLBACK"); return NextResponse.json({ error: "An M-Pesa request is already pending for this order." }, { status: 409 }); }
    const inserted = await client.query(
      "INSERT INTO payment_attempts (store_id, order_id, provider, status, amount_minor, currency, idempotency_key) VALUES ($1,$2,'mpesa','pending',$3,'KES',$4) RETURNING id",
      [storeId, orderId, Number(order.total_minor), randomUUID()]
    );
    attemptId = inserted.rows[0].id;
    await client.query("UPDATE orders SET payment_status='pending', updated_at=now() WHERE id=$1 AND store_id=$2", [orderId, storeId]);
    await client.query("COMMIT");

    const baseUrl = process.env.MPESA_ENV === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke";
    const authResponse = await fetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64")}` },
      cache: "no-store",
    });
    if (!authResponse.ok) throw new Error("M-Pesa authentication failed");
    const authData = await authResponse.json() as { access_token?: string };
    if (!authData.access_token) throw new Error("M-Pesa did not return an access token");

    const time = timestamp();
    const password = Buffer.from(`${shortcode}${passkey}${time}`).toString("base64");
    stkRequestStarted = true;
    const stkResponse = await fetch(`${baseUrl}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: { Authorization: `Bearer ${authData.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        BusinessShortCode: shortcode,
        Password: password,
        Timestamp: time,
        TransactionType: process.env.MPESA_TRANSACTION_TYPE || "CustomerPayBillOnline",
        Amount: Number(order.total_minor) / 100,
        PartyA: normalizePhone(order.customer_phone),
        PartyB: shortcode,
        PhoneNumber: normalizePhone(order.customer_phone),
        CallBackURL: `${appUrl.replace(/\/$/, "")}/api/payments/mpesa/callback?token=${encodeURIComponent(callbackToken)}`,
        AccountReference: `MW-${orderId.replace(/-/g, "").slice(0, 10).toUpperCase()}`,
        TransactionDesc: "MobiWave Commerce order",
      }),
      cache: "no-store",
    });
    const stkData = await stkResponse.json() as { CheckoutRequestID?: string; MerchantRequestID?: string; ResponseCode?: string; ResponseDescription?: string; errorMessage?: string };
    if (!stkResponse.ok || stkData.ResponseCode !== "0" || !stkData.CheckoutRequestID) throw new Error(stkData.errorMessage || stkData.ResponseDescription || "M-Pesa rejected the STK request");

    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [user.id]);
    await client.query(
      "UPDATE payment_attempts SET checkout_request_id=$1, merchant_request_id=$2, updated_at=now() WHERE id=$3 AND store_id=$4",
      [stkData.CheckoutRequestID, stkData.MerchantRequestID || null, attemptId, storeId]
    );
    await client.query("COMMIT");
    return NextResponse.json({ message: "STK Push sent. Ask the customer to enter their M-Pesa PIN on their phone.", checkoutRequestId: stkData.CheckoutRequestID });
  } catch (error) {
    await client.query("ROLLBACK").catch(()=>undefined);
    if (attemptId) {
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.user_id', $1, true)", [user.id]);
        const uncertainStatus = stkRequestStarted ? "review_required" : "failed";
        await client.query("UPDATE payment_attempts SET status=$1::payment_status, updated_at=now() WHERE id=$2 AND store_id=$3 AND status <> 'paid'", [uncertainStatus, attemptId, storeId]);
        await client.query("UPDATE orders SET payment_status=$1::payment_status, updated_at=now() WHERE id=$2 AND store_id=$3 AND payment_status='pending'", [uncertainStatus, orderId, storeId]);
        await client.query("COMMIT");
      } catch {
        await client.query("ROLLBACK").catch(()=>undefined);
      }
    }
    const message = error instanceof Error ? error.message : "M-Pesa request failed";
    return NextResponse.json({ error: process.env.NODE_ENV === "production" ? "M-Pesa request failed. Check provider configuration and try again." : message }, { status: 502 });
  } finally {
    client.release();
  }
}
