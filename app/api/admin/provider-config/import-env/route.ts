import { NextResponse } from "next/server";
import { getSuperAdmin } from "@/lib/admin";
import { savePlatformProviderConfig, type ProviderName } from "@/lib/platform-provider-config";

export const runtime = "nodejs";

function deploymentConfig(provider: ProviderName): Record<string, string> {
  if (provider === "meta") return {
    appId: process.env.META_APP_ID || "",
    appSecret: process.env.META_APP_SECRET || "",
    whatsappConfigId: process.env.META_WHATSAPP_CONFIG_ID || "",
    graphVersion: process.env.META_GRAPH_API_VERSION || "v27.0",
    instagramRedirectUri: process.env.META_INSTAGRAM_REDIRECT_URI || "",
    webhookVerifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN || "",
  };
  if (provider === "mobiwave_sms") return {
    apiUrl: process.env.MOBIWAVE_SMS_API_URL || "https://sms.mobiwave.co.ke/api/v3",
    apiKey: process.env.MOBIWAVE_SMS_API_KEY || "",
    senderId: process.env.MOBIWAVE_SMS_SENDER_ID || "",
  };
  if (provider === "r2") return {
    accountId: process.env.R2_ACCOUNT_ID || "",
    endpoint: process.env.R2_S3_ENDPOINT || "",
    bucketName: process.env.R2_BUCKET_NAME || "",
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
  };
  const scannerProvider = process.env.MEDIA_SCANNER_PROVIDER || "custom";
  return {
    provider: scannerProvider,
    scannerUrl: process.env.MEDIA_SCANNER_URL || (scannerProvider === "cloudmersive" ? "https://api.cloudmersive.com/virus/scan/file" : ""),
    scannerToken: process.env.MEDIA_SCANNER_TOKEN || "",
  };
}

export async function POST(request: Request) {
  const user = await getSuperAdmin();
  if (!user) return NextResponse.json({ error: "Superadmin access required" }, { status: 403 });
  let body: { provider?: ProviderName };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const provider = body.provider;
  if (!provider || !["meta", "mobiwave_sms", "r2", "media_scanner"].includes(provider)) {
    return NextResponse.json({ error: "Unsupported provider" }, { status: 400 });
  }
  const config = deploymentConfig(provider);
  if (Object.values(config).some(value => !value.trim())) {
    return NextResponse.json({ error: "No complete deployment configuration exists for this provider" }, { status: 409 });
  }
  try {
    await savePlatformProviderConfig(provider, config, user.id, "environment");
    return NextResponse.json({
      ok: true,
      status: "configured",
      message: "Existing server-side credentials imported and encrypted. No secret values were returned.",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not securely import deployment credentials" }, { status: 503 });
  }
}
