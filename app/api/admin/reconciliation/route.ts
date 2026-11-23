import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSuperAdmin } from "@/lib/admin";
import { matchesKenyanPhone } from "@/lib/mpesa-utils";
import { creditStoreWalletFromMpesa } from "@/lib/wallet";

export const runtime = "nodejs";

export async function GET() {
  const user = await getSuperAdmin();
  if (!user) return NextResponse.json({ error: "Superadmin access required" }, { status: 403 });
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.admin', 'true', true)");
    const result = await client.query(
      `SELECT p.id, p.store_id, p.amount_minor, p.currency, p.status, p.provider_reference,
              p.checkout_request_id, o.customer_phone, s.name AS store_name,
              o.order_number::text AS resource_label, p.created_at, 'order' AS attempt_type
         FROM payment_attempts p
         JOIN orders o ON o.id=p.order_id AND o.store_id=p.store_id
         JOIN stores s ON s.id=p.store_id
        WHERE p.provider='mpesa' AND p.status='review_required'
       UNION ALL
       SELECT p.id, p.store_id, p.amount_minor, p.currency, p.status, p.provider_reference,
              p.checkout_request_id, p.customer_phone, s.name AS store_name,
              p.plan_code AS resource_label, p.created_at, 'subscription' AS attempt_type
         FROM subscription_payment_attempts p
         JOIN stores s ON s.id=p.store_id
        WHERE p.provider='mpesa' AND p.status='review_required'
       UNION ALL
       SELECT p.id,p.store_id,p.amount_minor,p.currency,p.status,p.provider_reference,
              p.checkout_request_id,p.customer_phone,s.name AS store_name,
              'Wallet top-up' AS resource_label,p.created_at,'wallet_topup' AS attempt_type
         FROM wallet_topup_attempts p
         JOIN stores s ON s.id=p.store_id
        WHERE p.provider='mpesa' AND p.status='review_required'
       ORDER BY created_at DESC`,
    );
    await client.query("COMMIT");
    return NextResponse.json({ attempts: result.rows }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: "Could not load payment reconciliation queue" }, { status: 500 });
  } finally { client.release(); }
}

export async function POST(request: Request) {
  const user = await getSuperAdmin();
  if (!user) return NextResponse.json({ error: "Superadmin access required" }, { status: 403 });
  let body: {
    attemptType?: unknown; attemptId?: unknown; action?: unknown;
    providerReference?: unknown; verifiedAmountMinor?: unknown; verifiedPhone?: unknown; reason?: unknown;
  };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body" }, { status: 400 }); }
  if ((body.attemptType !== "order" && body.attemptType !== "subscription" && body.attemptType !== "wallet_topup")
    || typeof body.attemptId !== "string"
    || (body.action !== "mark_paid" && body.action !== "mark_failed")
    || typeof body.reason !== "string" || body.reason.trim().length < 12 || body.reason.length > 1000) {
    return NextResponse.json({ error: "Provide an attempt type, ID, action and a reconciliation note of at least 12 characters." }, { status: 400 });
  }
  const paid = body.action === "mark_paid";
  const receipt = typeof body.providerReference === "string" ? body.providerReference.trim().toUpperCase() : "";
  const verifiedAmount = Number(body.verifiedAmountMinor);
  const verifiedPhone = typeof body.verifiedPhone === "string" ? body.verifiedPhone : "";
  if (paid && (!/^[A-Z0-9]{6,20}$/.test(receipt) || !Number.isSafeInteger(verifiedAmount) || !matchesKenyanPhone(verifiedPhone, verifiedPhone))) {
    return NextResponse.json({ error: "For paid reconciliation, provide a valid M-Pesa receipt, verified amount and phone number." }, { status: 400 });
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.admin', 'true', true)");
      const selected = body.attemptType === "order"
      ? await client.query(
          "SELECT p.id,p.store_id,p.order_id,p.amount_minor,p.currency,p.status,o.customer_phone FROM payment_attempts p JOIN orders o ON o.id=p.order_id AND o.store_id=p.store_id WHERE p.id=$1 AND p.provider='mpesa' FOR UPDATE OF p,o",
          [body.attemptId],
        )
      : body.attemptType === "subscription" ? await client.query(
          "SELECT id,store_id,subscription_id,plan_code,amount_minor,currency,status,customer_phone FROM subscription_payment_attempts WHERE id=$1 AND provider='mpesa' FOR UPDATE",
          [body.attemptId],
        ) : await client.query(
          "SELECT id,store_id,amount_minor,currency,status,customer_phone FROM wallet_topup_attempts WHERE id=$1 AND provider='mpesa' FOR UPDATE",
          [body.attemptId],
        );
    if (!selected.rowCount || selected.rows[0].status !== "review_required") {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Payment attempt is not in the reconciliation queue." }, { status: 404 });
    }
    const attempt = selected.rows[0];
    if (paid) {
      if (attempt.currency !== "KES" || verifiedAmount !== Number(attempt.amount_minor) || !matchesKenyanPhone(attempt.customer_phone, verifiedPhone)) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "The verified amount or phone does not match the payment attempt." }, { status: 409 });
      }
      const duplicate = await client.query(
        "SELECT 1 FROM mpesa_receipt_claims WHERE receipt_number=$1 AND payment_attempt_id<>$2 UNION ALL SELECT 1 FROM payment_attempts WHERE provider_reference=$1 AND id<>$2 UNION ALL SELECT 1 FROM subscription_payment_attempts WHERE provider_reference=$1 AND id<>$2 UNION ALL SELECT 1 FROM wallet_topup_attempts WHERE provider_reference=$1 AND id<>$2 LIMIT 1",
        [receipt, attempt.id],
      );
      if (duplicate.rowCount) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "That M-Pesa receipt is already assigned to another payment." }, { status: 409 });
      }
      const receiptClaim = await client.query(
        "INSERT INTO mpesa_receipt_claims (receipt_number,payment_type,payment_attempt_id,store_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING receipt_number",
        [receipt, body.attemptType, attempt.id, attempt.store_id],
      );
      if (!receiptClaim.rowCount) {
        const sameAttemptClaim = await client.query(
          "SELECT 1 FROM mpesa_receipt_claims WHERE receipt_number=$1 AND payment_attempt_id=$2 AND payment_type=$3",
          [receipt,attempt.id,body.attemptType],
        );
        if (!sameAttemptClaim.rowCount) {
          await client.query("ROLLBACK");
          return NextResponse.json({error:"That M-Pesa receipt is already assigned to another payment."},{status:409});
        }
      }
      if (body.attemptType === "wallet_topup") {
        const credit = await creditStoreWalletFromMpesa(client,{
          storeId:attempt.store_id,attemptId:attempt.id,amountMinor:Number(attempt.amount_minor),
          currency:attempt.currency,receipt,
        });
        if (!credit.ok) {
          await client.query("ROLLBACK");
          return NextResponse.json({error:"Wallet credit could not be posted: "+credit.reason},{status:409});
        }
        await client.query(
          "UPDATE wallet_topup_attempts SET status='paid',provider_reference=$1,callback_payload=jsonb_build_object('manualReconciliation',true,'reason',$2,'verifiedAmountMinor',$3,'verifiedPhone',$4),updated_at=now() WHERE id=$5",
          [receipt,body.reason,verifiedAmount,verifiedPhone,attempt.id],
        );
      } else if (body.attemptType === "order") {
        await client.query(
          "UPDATE payment_attempts SET status='paid',provider_reference=$1,callback_payload=jsonb_build_object('manualReconciliation',true,'reason',$2,'verifiedAmountMinor',$3,'verifiedPhone',$4),updated_at=now() WHERE id=$5",
          [receipt, body.reason, verifiedAmount, verifiedPhone, attempt.id],
        );
        await client.query("UPDATE orders SET payment_status='paid',updated_at=now() WHERE id=$1 AND store_id=$2", [attempt.order_id, attempt.store_id]);
      } else {
        await client.query(
          "UPDATE subscription_payment_attempts SET status='paid',provider_reference=$1,callback_payload=jsonb_build_object('manualReconciliation',true,'reason',$2,'verifiedAmountMinor',$3,'verifiedPhone',$4),updated_at=now() WHERE id=$5",
          [receipt, body.reason, verifiedAmount, verifiedPhone, attempt.id],
        );
        await client.query(
          `UPDATE subscriptions SET plan_code=$1,status='active',
             current_period_start=GREATEST(COALESCE(current_period_end,now()),now()),
             current_period_end=GREATEST(COALESCE(current_period_end,now()),now())+interval '1 month',
             provider='mpesa',provider_reference=$2,updated_at=now()
           WHERE id=$3 AND store_id=$4`,
          [attempt.plan_code, receipt, attempt.subscription_id, attempt.store_id],
        );
      }
    } else {
      if (body.attemptType === "order") {
        await client.query("UPDATE payment_attempts SET status='failed',callback_payload=jsonb_build_object('manualReconciliation',true,'reason',$1),updated_at=now() WHERE id=$2", [body.reason, attempt.id]);
        await client.query("UPDATE orders SET payment_status='failed',updated_at=now() WHERE id=$1 AND store_id=$2 AND payment_status <> 'paid'", [attempt.order_id, attempt.store_id]);
      } else if (body.attemptType === "subscription") {
        await client.query("UPDATE subscription_payment_attempts SET status='failed',callback_payload=jsonb_build_object('manualReconciliation',true,'reason',$1),updated_at=now() WHERE id=$2", [body.reason, attempt.id]);
      } else {
        await client.query("UPDATE wallet_topup_attempts SET status='failed',callback_payload=jsonb_build_object('manualReconciliation',true,'reason',$1),updated_at=now() WHERE id=$2", [body.reason,attempt.id]);
      }
    }
    await client.query(
      "INSERT INTO audit_events (store_id,actor_user_id,action,resource_type,resource_id,metadata) VALUES ($1,$2,'payment.manually_reconciled','payment_attempt',$3,$4::jsonb)",
      [attempt.store_id, user.id, attempt.id, JSON.stringify({ attemptType: body.attemptType, action: body.action, providerReference: paid ? receipt : null, verifiedAmountMinor: paid ? verifiedAmount : null, verifiedPhone: paid ? verifiedPhone : null, reason: body.reason })],
    );
    await client.query("COMMIT");
    return NextResponse.json({ ok: true, status: paid ? "paid" : "failed" });
  } catch {
    await client.query("ROLLBACK").catch(() => undefined);
    return NextResponse.json({ error: "Could not reconcile this payment attempt" }, { status: 500 });
  } finally { client.release(); }
}
