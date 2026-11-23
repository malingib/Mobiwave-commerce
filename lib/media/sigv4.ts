import { createHash, createHmac } from "node:crypto";

type S3Credentials = {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

function awsEncode(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    "%" + character.charCodeAt(0).toString(16).toUpperCase(),
  );
}

function encodedPath(value: string) {
  return value.split("/").map(awsEncode).join("/");
}

function canonicalQuery(values: Record<string, string>) {
  return Object.entries(values)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => awsEncode(key) + "=" + awsEncode(value))
    .join("&");
}

function hash(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmac(key: Buffer | string, value: string) {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function signingKey(secret: string, date: string) {
  const dateKey = hmac("AWS4" + secret, date);
  const regionKey = hmac(dateKey, "auto");
  const serviceKey = hmac(regionKey, "s3");
  return hmac(serviceKey, "aws4_request");
}

function timestamp(now: Date) {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate, date: amzDate.slice(0, 8) };
}

function normalizedHeaders(input: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key.toLowerCase(),
      value.trim().replace(/\s+/g, " "),
    ]),
  );
}

export function createPresignedS3Url(input: S3Credentials & {
  key: string;
  method: "GET" | "PUT";
  expiresIn: number;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  now?: Date;
}) {
  const endpoint = new URL(input.endpoint);
  const uri = "/" + input.bucket + "/" + encodedPath(input.key);
  const { amzDate, date } = timestamp(input.now || new Date());
  const scope = date + "/auto/s3/aws4_request";
  const signed = normalizedHeaders({ host: endpoint.host, ...(input.headers || {}) });
  const signedHeaders = Object.keys(signed).sort().join(";");
  const canonicalHeaders = Object.keys(signed)
    .sort()
    .map((key) => key + ":" + signed[key] + "\n")
    .join("");
  const parameters: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": input.accessKeyId + "/" + scope,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(input.expiresIn),
    "X-Amz-SignedHeaders": signedHeaders,
    ...(input.query || {}),
  };
  const request = [
    input.method,
    uri,
    canonicalQuery(parameters),
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    hash(request),
  ].join("\n");
  const signature = hmac(signingKey(input.secretAccessKey, date), stringToSign).toString("hex");
  parameters["X-Amz-Signature"] = signature;
  return endpoint.origin + uri + "?" + canonicalQuery(parameters);
}

export function createS3AuthorizationHeaders(input: S3Credentials & {
  key: string;
  method: "GET" | "HEAD" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  now?: Date;
}) {
  const endpoint = new URL(input.endpoint);
  const uri = "/" + input.bucket + "/" + encodedPath(input.key);
  const { amzDate, date } = timestamp(input.now || new Date());
  const payloadHash = "UNSIGNED-PAYLOAD";
  const requestHeaders = normalizedHeaders({
    host: endpoint.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...(input.headers || {}),
  });
  const signedHeaders = Object.keys(requestHeaders).sort().join(";");
  const canonicalHeaders = Object.keys(requestHeaders)
    .sort()
    .map((key) => key + ":" + requestHeaders[key] + "\n")
    .join("");
  const request = [
    input.method,
    uri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = date + "/auto/s3/aws4_request";
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    hash(request),
  ].join("\n");
  const signature = hmac(signingKey(input.secretAccessKey, date), stringToSign).toString("hex");
  return {
    ...(input.headers || {}),
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    Authorization:
      "AWS4-HMAC-SHA256 Credential=" + input.accessKeyId + "/" + scope +
      ", SignedHeaders=" + signedHeaders + ", Signature=" + signature,
  };
}
