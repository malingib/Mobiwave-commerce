import { NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let client: PoolClient | undefined;
  try {
    client = await db.connect();
    const result = await client.query(`
      SELECT
        current_user AS role_name,
        COALESCE((SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user), true) AS bypass_rls,
        to_regclass('public.stores') IS NOT NULL AS commerce_schema_ready,
        to_regclass('public.session') IS NOT NULL AS auth_schema_ready,
        COALESCE((
          SELECT NOT rolcanlogin AND NOT rolbypassrls
          FROM pg_roles WHERE rolname = 'commerce_auth_runtime'
        ), false) AS auth_role_secure,
        CASE
          WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'commerce_auth_runtime')
          THEN pg_has_role('commerce_app', 'commerce_auth_runtime', 'MEMBER')
          ELSE false
        END AS auth_role_granted,
        CASE
          WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'commerce_auth_runtime')
          THEN has_table_privilege('commerce_auth_runtime', 'public."user"', 'SELECT')
          ELSE false
        END AS auth_role_can_read_users,
        CASE
          WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'commerce_auth_runtime')
          THEN NOT has_table_privilege('commerce_auth_runtime', 'public.stores', 'SELECT')
          ELSE false
        END AS auth_role_isolated,
        NOT has_table_privilege('commerce_runtime', 'public."user"', 'SELECT') AS commerce_role_isolated
    `);
    const state = result.rows[0] as {
      role_name: string;
      bypass_rls: boolean;
      commerce_schema_ready: boolean;
      auth_schema_ready: boolean;
      auth_role_secure: boolean;
      auth_role_granted: boolean;
      auth_role_can_read_users: boolean;
      auth_role_isolated: boolean;
      commerce_role_isolated: boolean;
    };

    const ready =
      state.role_name === "commerce_runtime" &&
      !state.bypass_rls &&
      state.commerce_schema_ready &&
      state.auth_schema_ready &&
      state.auth_role_secure &&
      state.auth_role_granted &&
      state.auth_role_can_read_users &&
      state.auth_role_isolated &&
      state.commerce_role_isolated;

    if (!ready) {
      console.error("[health] Database role/schema readiness check failed", {
        commerceSchema: state.commerce_schema_ready,
        authSchema: state.auth_schema_ready,
        commerceRole: state.role_name,
        commerceBypassRls: state.bypass_rls,
        authRoleSecure: state.auth_role_secure,
        authRoleGranted: state.auth_role_granted,
        authRoleCanReadUsers: state.auth_role_can_read_users,
        authRoleIsolated: state.auth_role_isolated,
        commerceRoleIsolated: state.commerce_role_isolated,
      });
      return NextResponse.json(
        { status: "misconfigured" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json(
      { status: "ok" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[health] Database readiness check failed", {
      name: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { status: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    client?.release();
  }
}
