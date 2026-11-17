import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getRequestUser } from "@/lib/request-user";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ storeId: string; conversationId: string }> }) {
  const user = await getRequestUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { storeId, conversationId } = await context.params;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body" }, { status: 400 }); }
  const note = typeof body.body === "string" ? body.body.trim() : "";
  if (!note || note.length > 10000) return NextResponse.json({ error: "Note must contain 1–10,000 characters" }, { status: 400 });
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id',$1,true)", [user.id]);
    const membership = await client.query("SELECT 1 FROM store_memberships WHERE store_id=$1 AND user_id=$2", [storeId,user.id]);
    if (!membership.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Store membership required" }, { status: 403 });
    }
    const result = await client.query(
      `INSERT INTO conversation_notes (store_id,conversation_id,author_user_id,body)
       SELECT $1,$2,$3,$4
        WHERE EXISTS (SELECT 1 FROM conversations WHERE store_id=$1 AND id=$2)
       RETURNING id,author_user_id,body,created_at`,
      [storeId,conversationId,user.id,note],
    );
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
    await client.query("COMMIT");
    return NextResponse.json({ note: result.rows[0] }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch {
    await client.query("ROLLBACK").catch(() => undefined);
    return NextResponse.json({ error: "Could not save note" }, { status: 500 });
  } finally { client.release(); }
}
