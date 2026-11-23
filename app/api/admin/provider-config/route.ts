import { NextResponse } from "next/server";
import { getSuperAdmin } from "@/lib/admin";
import { getPlatformProviderStatuses, savePlatformProviderConfig, type ProviderName } from "@/lib/platform-provider-config";

export const runtime = "nodejs";

const providers = new Set<ProviderName>(["meta","mobiwave_sms","r2","media_scanner"]);

export async function GET() {
  const user = await getSuperAdmin();
  if (!user) return NextResponse.json({ error: "Superadmin access required" }, { status: 403 });
  try {
    return NextResponse.json({ providers: await getPlatformProviderStatuses() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load provider settings" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const user = await getSuperAdmin();
  if (!user) return NextResponse.json({ error: "Superadmin access required" }, { status: 403 });
  let body: { provider?: ProviderName; config?: Record<string, unknown> };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  if (!body.provider || !providers.has(body.provider) || !body.config || typeof body.config !== "object" || Array.isArray(body.config)) {
    return NextResponse.json({ error: "A supported provider and configuration are required" }, { status: 400 });
  }
  const config: Record<string,string> = {};
  for (const [key,value] of Object.entries(body.config)) {
    if (typeof value !== "string" || value.length > 16_384) return NextResponse.json({ error: "Invalid configuration value" }, { status: 400 });
    config[key] = value.trim();
  }
  try {
    await savePlatformProviderConfig(body.provider, config, user.id);
    return NextResponse.json({ ok: true, status: "configured" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "provider_config_save_failed";
    const status = message.startsWith("missing_") || message.startsWith("invalid_") || message.endsWith("_requires_https") ? 400 : 503;
    return NextResponse.json({ error: status === 400 ? message : "Could not securely save provider configuration" }, { status });
  }
}
