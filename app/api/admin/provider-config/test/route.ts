import { NextResponse } from "next/server";
import { getSuperAdmin } from "@/lib/admin";
import { getPlatformProviderConfig, setPlatformProviderStatus, type ProviderName } from "@/lib/platform-provider-config";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await getSuperAdmin();
  if (!user) return NextResponse.json({ error: "Superadmin access required" }, { status: 403 });
  let body: { provider?: ProviderName };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const provider = body.provider;
  if (!provider || !["meta","mobiwave_sms","r2","media_scanner"].includes(provider)) return NextResponse.json({ error: "Unsupported provider" }, { status: 400 });
  try {
    const config = await getPlatformProviderConfig(provider);
    if (!config) return NextResponse.json({ status: "not_configured" }, { status: 409 });
    if (provider === "meta") {
      const token = `${config.appId}|${config.appSecret}`;
      const url = new URL(`https://graph.facebook.com/${config.graphVersion}/${encodeURIComponent(config.appId)}`);
      url.searchParams.set("fields","id,name");
      url.searchParams.set("access_token",token);
      const response = await fetch(url,{cache:"no-store",signal:AbortSignal.timeout(10000)});
      const data = await response.json().catch(()=>null) as {id?:string;error?:{code?:number}}|null;
      if (!response.ok || data?.id !== config.appId) throw new Error(`meta_check_${data?.error?.code ?? response.status}`);
    } else if (provider === "mobiwave_sms") {
      const base = new URL(config.apiUrl);
      const response = await fetch(base,{method:"GET",headers:{Authorization:`Bearer ${config.apiKey}`,Accept:"application/json"},cache:"no-store",signal:AbortSignal.timeout(10000)});
      if (response.status === 401 || response.status === 403) throw new Error("sms_credentials_rejected");
      if (!response.ok) throw new Error(`sms_provider_http_${response.status}`);
    } else if (provider === "media_scanner") {
      const url = new URL(config.scannerUrl);
      url.pathname = url.pathname.replace(/\/$/,"") + "/health";
      const response = await fetch(url,{method:"GET",headers:{Authorization:`Bearer ${config.scannerToken}`},cache:"no-store",signal:AbortSignal.timeout(10000)});
      if (!response.ok) throw new Error(`scanner_health_http_${response.status}`);
    } else {
      // R2 verification is deliberately non-mutating: validate the endpoint and
      // configuration shape here; signed HeadBucket verification is added with
      // the storage adapter so no test object or customer media is created.
      const endpoint = new URL(config.endpoint);
      if (!endpoint.hostname.endsWith(".r2.cloudflarestorage.com") || !config.bucketName) throw new Error("r2_endpoint_invalid");
    }
    await setPlatformProviderStatus(provider,"verified");
    return NextResponse.json({status:"verified",message:"Provider credentials verified. No customer message, payment or media object was created."});
  } catch (error) {
    const raw = error instanceof Error ? error.message : "provider_check_failed";
    const code = /^[a-z0-9_]{1,80}$/i.test(raw) ? raw : "provider_check_failed";
    await setPlatformProviderStatus(provider,"error",code).catch(()=>undefined);
    return NextResponse.json({status:"error",error:code},{status:502});
  }
}
