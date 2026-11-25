import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSuperAdmin } from "@/lib/admin";

export const runtime = "nodejs";
type Context = { params: Promise<{ storeId: string }> };

export async function POST(request: Request, context: Context) {
  const user = await getSuperAdmin();
  if (!user) return NextResponse.json({ error: "Superadmin access required" }, { status: 403 });
  const { storeId } = await context.params;
  let body: { decision?: unknown; reviewNote?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body" }, { status: 400 }); }
  const decision = body.decision;
  const reviewNote = typeof body.reviewNote === "string" ? body.reviewNote.trim() : "";
  if ((decision !== "approve" && decision !== "reject") || (decision === "reject" && reviewNote.length < 10) || reviewNote.length > 2000) {
    return NextResponse.json({ error: "Choose approve or reject. Rejection requires a review note of at least 10 characters." }, { status: 400 });
  }
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.admin', 'true', true)");
    const current = await client.query("SELECT s.id, s.status, o.launch_status FROM stores s JOIN store_onboarding o ON o.store_id=s.id WHERE s.id=$1 FOR UPDATE OF s, o", [storeId]);
    if (!current.rowCount) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Store not found" }, { status: 404 }); }
    if (current.rows[0].launch_status !== "pending_review" || current.rows[0].status !== "draft") {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "This store is no longer awaiting launch review." }, { status: 409 });
    }
    if (decision === "approve") {
      await client.query("UPDATE stores SET status='active', updated_at=now() WHERE id=$1", [storeId]);
      await client.query("UPDATE store_onboarding SET launch_status='approved', reviewed_at=now(), reviewed_by=$1, review_note=$2, updated_at=now() WHERE store_id=$3", [user.id, reviewNote || "Approved by platform administrator.", storeId]);
    } else {
      await client.query("UPDATE store_onboarding SET launch_status='rejected', reviewed_at=now(), reviewed_by=$1, review_note=$2, updated_at=now() WHERE store_id=$3", [user.id, reviewNote, storeId]);
    }
    await client.query("INSERT INTO audit_events (store_id, actor_user_id, action, resource_type, resource_id, metadata) VALUES ($1,$2,$3,'store',$1,$4::jsonb)", [storeId, user.id, decision === "approve" ? "store.launch_approved" : "store.launch_rejected", JSON.stringify({ reviewNote })]);
    await client.query("COMMIT");
    return NextResponse.json({ success: true, status: decision === "approve" ? "active" : "draft" });
  } catch {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: "Could not save launch review decision" }, { status: 500 });
  } finally { client.release(); }
}