import { createHash } from "node:crypto";

const DEFAULT_GRAPH_VERSION = "v27.0";
const MAX_MEDIA_BYTES = 25 * 1024 * 1024;

type MetaMediaMetadata = {
  url?: string;
  mime_type?: string;
  file_size?: number;
  sha256?: string;
};

function graphVersion() {
  const version = process.env.META_GRAPH_API_VERSION || DEFAULT_GRAPH_VERSION;
  if (!/^v\d+\.\d+$/.test(version)) throw new Error("invalid_meta_graph_version");
  return version;
}

function safeMediaUrl(value: unknown): URL {
  if (typeof value !== "string") throw new Error("meta_media_url_missing");
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  const allowed = host === "lookaside.fbsbx.com" || host === "graph.facebook.com" ||
    host.endsWith(".fbcdn.net") || host.endsWith(".fbsbx.com") || host.endsWith(".facebook.com") || host.endsWith(".cdninstagram.com") || host === "cdninstagram.com";
  if (url.protocol !== "https:" || !allowed || url.username || url.password || (url.port && url.port !== "443")) {
    throw new Error("meta_media_url_rejected");
  }
  return url;
}


/** Download an Instagram attachment URL without following redirects or accepting arbitrary hosts. */
export async function downloadInstagramMedia(input: { url: string; maxBytes?: number }): Promise<{ bytes: Buffer; mimeType: string; sha256: string }> {
  const url = safeMediaUrl(input.url);
  const host = url.hostname.toLowerCase();
  if (!(host.endsWith(".cdninstagram.com") || host === "cdninstagram.com" ||
        host.endsWith(".fbcdn.net") || host === "lookaside.fbsbx.com")) {
    throw new Error("instagram_media_host_rejected");
  }
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new Error("instagram_media_download_unavailable");
  }
  if (!response.ok) throw new Error("instagram_media_download_http_" + response.status);
  const bytes = await readLimited(response, Math.min(input.maxBytes || MAX_MEDIA_BYTES, MAX_MEDIA_BYTES));
  const mimeType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!mimeType) throw new Error("instagram_media_mime_missing");
  return { bytes, mimeType, sha256: createSha256(bytes) };
}

async function readLimited(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new Error("meta_media_too_large");
  if (!response.body) throw new Error("meta_media_body_missing");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error("meta_media_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!total) throw new Error("meta_media_size_invalid");
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), total);
}

export async function downloadMetaMedia(input: {
  mediaId: string;
  accessToken: string;
  maxBytes?: number;
}): Promise<{ bytes: Buffer; mimeType: string; sha256: string }> {
  if (!/^[A-Za-z0-9_-]{3,256}$/.test(input.mediaId) || !input.accessToken) {
    throw new Error("invalid_meta_media_request");
  }
  const metadataUrl = new URL(
    "https://graph.facebook.com/" + graphVersion() + "/" + encodeURIComponent(input.mediaId),
  );
  let metadataResponse: Response;
  try {
    metadataResponse = await fetch(metadataUrl, {
      headers: { Authorization: "Bearer " + input.accessToken },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("meta_media_metadata_unavailable");
  }
  if (!metadataResponse.ok) throw new Error("meta_media_metadata_http_" + metadataResponse.status);
  const metadata = await metadataResponse.json() as MetaMediaMetadata;
  const url = safeMediaUrl(metadata.url);
  const maxBytes = Math.min(input.maxBytes || MAX_MEDIA_BYTES, MAX_MEDIA_BYTES);
  if (typeof metadata.file_size === "number" && metadata.file_size > maxBytes) {
    throw new Error("meta_media_too_large");
  }
  let mediaResponse: Response;
  try {
    mediaResponse = await fetch(url, {
      headers: { Authorization: "Bearer " + input.accessToken },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error("meta_media_download_unavailable");
  }
  if (!mediaResponse.ok) throw new Error("meta_media_download_http_" + mediaResponse.status);
  const bytes = await readLimited(mediaResponse, maxBytes);
  const mimeType = (mediaResponse.headers.get("content-type") || metadata.mime_type || "")
    .split(";")[0].trim().toLowerCase();
  if (!mimeType) throw new Error("meta_media_mime_missing");
  return {
    bytes,
    mimeType,
    sha256: createSha256(bytes),
  };
}

function createSha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function uploadMetaMedia(input: {
  phoneNumberId: string;
  accessToken: string;
  bytes: Buffer;
  mimeType: string;
  fileName: string;
}): Promise<string> {
  if (!/^[A-Za-z0-9_-]{3,128}$/.test(input.phoneNumberId) || !input.accessToken ||
      !input.bytes.length || input.bytes.length > MAX_MEDIA_BYTES) {
    throw new Error("invalid_meta_media_upload");
  }
  const form = new FormData();
  form.set("messaging_product", "whatsapp");
  form.set("type", input.mimeType);
  form.set("file", new Blob([new Uint8Array(input.bytes)], { type: input.mimeType }), input.fileName);
  let response: Response;
  try {
    response = await fetch(
      "https://graph.facebook.com/" + graphVersion() + "/" + encodeURIComponent(input.phoneNumberId) + "/media",
      {
        method: "POST",
        headers: { Authorization: "Bearer " + input.accessToken },
        body: form,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      },
    );
  } catch {
    throw new Error("meta_media_upload_unavailable");
  }
  const payload = await response.json().catch(() => ({})) as { id?: string; error?: { code?: number } };
  if (!response.ok || typeof payload.id !== "string" || !payload.id) {
    throw new Error("meta_media_upload_failed_" + (payload.error?.code || response.status));
  }
  return payload.id;
}

export async function sendMetaMediaMessage(input: {
  phoneNumberId: string;
  recipientId: string;
  accessToken: string;
  mediaId: string;
  mediaType: "image" | "video" | "audio" | "document";
  caption?: string | null;
  fileName?: string | null;
}): Promise<{ messageId: string }> {
  if (!/^[A-Za-z0-9_-]{3,128}$/.test(input.phoneNumberId) ||
      !/^[A-Za-z0-9_-]{3,256}$/.test(input.mediaId) ||
      !input.recipientId || !input.accessToken) throw new Error("invalid_meta_media_message");
  const media: Record<string, string> = { id: input.mediaId };
  if (input.caption && input.mediaType !== "audio") media.caption = input.caption.slice(0, 1024);
  if (input.fileName && input.mediaType === "document") media.filename = input.fileName.slice(0, 120);
  let response: Response;
  try {
    response = await fetch(
      "https://graph.facebook.com/" + graphVersion() + "/" + encodeURIComponent(input.phoneNumberId) + "/messages",
      {
        method: "POST",
        headers: { Authorization: "Bearer " + input.accessToken, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: input.recipientId,
          type: input.mediaType,
          [input.mediaType]: media,
        }),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch {
    throw new Error("delivery_unknown");
  }
  const payload = await response.json().catch(() => ({})) as {
    messages?: Array<{ id?: string }>;
    error?: { code?: number };
  };
  if (!response.ok || payload.error) {
    throw new Error("meta_api_" + (payload.error?.code || "http_" + response.status));
  }
  const messageId = payload.messages?.[0]?.id;
  if (!messageId) throw new Error("delivery_unknown");
  return { messageId };
}
