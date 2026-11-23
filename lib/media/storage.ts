import { randomUUID } from "node:crypto";
import { createPresignedS3Url, createS3AuthorizationHeaders } from "@/lib/media/sigv4";
import { getPlatformProviderConfig } from "@/lib/platform-provider-config";

let configCache: {
  bucket: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
} | undefined;

async function configuration() {
  if (configCache) return configCache;
  const saved = await getPlatformProviderConfig("r2");
  const accountId = saved?.accountId || process.env.R2_ACCOUNT_ID || "";
  const bucket = saved?.bucketName || process.env.R2_BUCKET_NAME || "";
  const endpoint = (saved?.endpoint || process.env.R2_S3_ENDPOINT || "").replace(/\\/+$/, "");
  const accessKeyId = saved?.accessKeyId || process.env.R2_ACCESS_KEY_ID || "";
  const secretAccessKey = saved?.secretAccessKey || process.env.R2_SECRET_ACCESS_KEY || "";
  if (!/^[a-f0-9]{32}$/i.test(accountId) || !/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(bucket)) {
    throw new Error("R2 account or bucket configuration is invalid");
  }
  const parsed = new URL(endpoint);
  if (parsed.protocol !== "https:" || parsed.hostname !== accountId + ".r2.cloudflarestorage.com" || parsed.pathname !== "") {
    throw new Error("R2 endpoint must match the configured Cloudflare account");
  }
  if (!accessKeyId || !secretAccessKey) throw new Error("R2 S3 credentials are not configured");
  configCache = { bucket, endpoint: parsed.origin, accessKeyId, secretAccessKey };
  return configCache;
}

async function credentials() {
  return { ...(await configuration()) };
}

async function signedRequest(input: {
  key: string;
  method: "GET" | "HEAD" | "PUT" | "DELETE";
  headers?: Record<string, string>;
}) {
  const config = await credentials();
  const headers = createS3AuthorizationHeaders({ ...config, ...input });
  const url = config.endpoint + "/" + config.bucket + "/" + input.key.split("/").map(encodeURIComponent).join("/");
  return fetch(url, { method: input.method, headers, cache: "no-store", redirect: "error" });
}

export async function createPrivateUploadUrl(input: { key: string; contentType: string }) {
  const config = await credentials();
  return createPresignedS3Url({
    ...config,
    key: input.key,
    method: "PUT",
    expiresIn: 300,
    headers: { "content-type": input.contentType },
  });
}

export async function getPrivateObjectSize(key: string) {
  const response = await signedRequest({ key, method: "HEAD" });
  if (!response.ok) throw new Error("R2 object metadata request failed: " + response.status);
  return Number(response.headers.get("content-length") || 0);
}

export async function readPrivateObject(key: string) {
  const response = await signedRequest({ key, method: "GET" });
  if (!response.ok) throw new Error("R2 object read failed: " + response.status);
  return Buffer.from(await response.arrayBuffer());
}

export async function copyPrivateObject(input: { sourceKey: string; destinationKey: string }) {
  const config = await credentials();
  const copySource = "/" + config.bucket + "/" + input.sourceKey.split("/").map(encodeURIComponent).join("/");
  const response = await signedRequest({
    key: input.destinationKey,
    method: "PUT",
    headers: {
      "x-amz-copy-source": copySource,
      "x-amz-metadata-directive": "COPY",
    },
  });
  if (!response.ok) throw new Error("R2 object promotion failed: " + response.status);
}

export async function deletePrivateObject(key: string) {
  const response = await signedRequest({ key, method: "DELETE" });
  if (!response.ok && response.status !== 404) throw new Error("R2 object deletion failed: " + response.status);
}

export async function createPrivateDownloadUrl(input: { key: string; contentType: string; fileName: string }) {
  const config = credentials();
  const safeName = input.fileName.replace(/[\r\n"\\]/g, "_").slice(0, 120) || "attachment";
  return createPresignedS3Url({
    ...config,
    key: input.key,
    method: "GET",
    expiresIn: 60,
    query: {
      "response-content-type": input.contentType,
      "response-content-disposition": 'attachment; filename="' + safeName + '"',
      "response-cache-control": "private, no-store",
    },
  });
}


/** Verifies R2 write, metadata, read and delete access using an isolated disposable key. */
export async function verifyPrivateStorageAccess() {
  const key = `health-checks/${randomUUID()}.txt`;
  const bytes = Buffer.from("MobiWave private media storage health check", "utf8");
  let uploaded = false;
  try {
    const url = await createPrivateUploadUrl({ key, contentType: "text/plain" });
    const response = await fetch(url, {
      method: "PUT",
      headers: { "content-type": "text/plain" },
      body: new Uint8Array(bytes),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error("r2_upload_failed");
    uploaded = true;
    const size = await getPrivateObjectSize(key);
    if (size !== bytes.length) throw new Error("r2_size_mismatch");
    const stored = await readPrivateObject(key);
    if (!stored.equals(bytes)) throw new Error("r2_readback_mismatch");
    return { status: "verified" as const, bytes: size };
  } finally {
    if (uploaded) await deletePrivateObject(key);
  }
}
