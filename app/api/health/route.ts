import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const client = await db.connect();
  try {
    const result = await client.query(
      "SELECT current_user AS role_name, COALESCE((SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user), true) AS bypass_rls, to_regclass('public.stores') IS NOT NULL AS commerce_schema_ready, to_regclass('public.session') IS NOT NULL AS auth_schema_ready"
    );
    const state = result.rows[0] as { role_name: string; bypass_rls: boolean; commerce_schema_ready: boolean; auth_schema_ready: boolean };
    if (state.role_name !== "commerce_runtime" || state.bypass_rls || !state.commerce_schema_ready || !state.auth_schema_ready) {
      return NextResponse.json({ status: "misconfigured" }, { status: 503 });
    }
    return NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  } finally {
    client.release();
  }
}
