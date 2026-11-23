import { getPlatformProviderConfig } from "@/lib/platform-provider-config";
export type MediaScanStatus = "available" | "rejected" | "quarantined";

export async function scanMediaObject(input: {
  bytes: Uint8Array;
  mimeType: string;
  sha256: string;
  scannerUrl?: string;
  scannerToken?: string;
  scannerProvider?: string;
  fetcher?: typeof fetch;
}): Promise<MediaScanStatus> {
  const saved = await getPlatformProviderConfig("media_scanner").catch(() => null);
  const token = input.scannerToken || saved?.scannerToken || "";
  const provider = input.scannerProvider || saved?.provider || "custom";
  if (!token) return "quarantined";

  const fetcher = input.fetcher || fetch;
  const timeout = AbortSignal.timeout(20_000);

  try {
    if (provider === "cloudmersive") {
      const form = new FormData();
      const bytes = new Uint8Array(input.bytes);
      form.append("inputFile", new Blob([bytes], { type: input.mimeType }), "attachment");
      const response = await fetcher("https://api.cloudmersive.com/virus/scan/file", {
        method: "POST",
        headers: { Apikey: token },
        body: form,
        cache: "no-store",
        redirect: "error",
        signal: timeout,
      });
      if (!response.ok) return "quarantined";
      const result = await response.json() as { CleanResult?: unknown };
      if (result.CleanResult === true) return "available";
      if (result.CleanResult === false) return "rejected";
      return "quarantined";
    }

    const scannerUrl = input.scannerUrl || saved?.scannerUrl || "";
    if (!scannerUrl) return "quarantined";
    const url = new URL(scannerUrl);
    if (url.protocol !== "https:") return "quarantined";

    const response = await fetcher(url, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/octet-stream",
        "X-File-Mime-Type": input.mimeType,
        "X-File-SHA256": input.sha256,
      },
      body: new Uint8Array(input.bytes),
      cache: "no-store",
      redirect: "error",
      signal: timeout,
    });
    if (!response.ok) return "quarantined";
    const result = await response.json() as { status?: string };
    if (result.status === "clean") return "available";
    if (result.status === "infected") return "rejected";
    return "quarantined";
  } catch {
    return "quarantined";
  }
}
