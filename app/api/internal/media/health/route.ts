import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { verifyPrivateStorageAccess } from "@/lib/media/storage";
import { scanMediaObject } from "@/lib/media/scanner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: Request) {
  const expected = process.env.CHANNEL_WORKER_SECRET || "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!process.env.CHANNEL_WORKER_SECRET) {
    return NextResponse.json({ error: "Media health check is not configured" }, { status: 503 });
  }
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let r2: { status: string; bytes?: number } = { status: "not_checked" };
  let scanner = "not_checked";
  try {
    r2 = await verifyPrivateStorageAccess();
  } catch {
    r2 = { status: "error" };
  }

  try {
    const bytes = Buffer.from("MobiWave clean media scanner connectivity check", "utf8");
    const result = await scanMediaObject({
      bytes,
      mimeType: "text/plain",
      sha256: "health-check",
      scannerToken: process.env.MEDIA_SCANNER_TOKEN,
      scannerProvider: process.env.MEDIA_SCANNER_PROVIDER,
      scannerUrl: process.env.MEDIA_SCANNER_URL,
    });
    scanner = result === "available" ? "verified" : result;
  } catch {
    scanner = "error";
  }

  const ok = r2.status === "verified" && scanner === "verified";
  return NextResponse.json(
    { ok, r2, scanner },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } },
  );
}
