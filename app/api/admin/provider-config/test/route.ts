import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getSuperAdmin } from "@/lib/admin";
import { verifyPrivateStorageAccess } from "@/lib/media/storage";
import { scanMediaObject } from "@/lib/media/scanner";
import { getPlatformProviderConfig, setPlatformProviderStatus, type ProviderName } from "@/lib/platform-provider-config";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await getSuperAdmin();
  if (!user) return NextResponse.json({ error: "Superadmin access required" }, { status: 403 });
  let body: { provider?: ProviderName };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const provider = body.provider;
  if (!provider || !["meta", "mobiwave_sms", "r2", "media_scanner"].includes(provider)) {
    return NextResponse.json({ error: "Unsupported provider" }, { status: 400 });
  }
  try {
    const config = await getPlatformProviderConfig(provider);
    if (!config) return NextResponse.json({ status: "not_configured" }, { status: 409 });
    if (provider === "meta") {
      const token = `${config.appId}|${config.appSecret}`;
      const url = new URL(`https://graph.facebook.com/${config.graphVersion}/${encodeURIComponent(config.appId)}`);
      url.searchParams.set("fields", "id,name");
      url.searchParams.set("access_token", token);
      const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
      const data = await response.json().catch(() => null) as { id?: string; error?: { code?: number } } | null;
      if (!response.ok || data?.id !== config.appId) throw new Error(`meta_check_${data?.error?.code ?? response.status}`);
    } else if (provider === "mobiwave_sms") {
      const profileUrl = new URL(config.apiUrl);
      profileUrl.pathname = profileUrl.pathname.replace(/\/+$/, "") + "/me";
      const response = await fetch(profileUrl, {
        method: "GET",
        headers: { Authorization: `Bearer ${config.apiKey}`, Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      if (response.status === 401 || response.status === 403) throw new Error("sms_credentials_rejected");
      if (!response.ok) throw new Error(`sms_provider_http_${response.status}`);
      const profile = await response.json().catch(() => null) as { status?: string } | null;
      if (profile?.status !== "success") throw new Error("sms_profile_check_rejected");
    } else if (provider === "r2") {
      await verifyPrivateStorageAccess();
    } else {
      const bytes = Buffer.from("MobiWave Commerce scanner health check", "utf8");
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const result = await scanMediaObject({
        bytes, mimeType: "text/plain", sha256,
        scannerUrl: config.scannerUrl, scannerToken: config.scannerToken, scannerProvider: config.provider,
      });
      if (result !== "available") throw new Error(result === "rejected" ? "scanner_rejected_clean_test" : "scanner_health_check_unavailable");
    }
    await setPlatformProviderStatus(provider, "verified");
    return NextResponse.json({
      status: "verified",
      message: "Provider credentials verified. No customer message or payment was sent; R2 used a disposable health-check object that was deleted.",
    });
  } catch (error) {
    const raw = error instanceof Error ? error.message : "provider_check_failed";
    const code = /^[a-z0-9_]{1,80}$/i.test(raw) ? raw : "provider_check_failed";
    await setPlatformProviderStatus(provider, "error", code).catch(() => undefined);
    return NextResponse.json({ status: "error", error: code }, { status: 502 });
  }
}
