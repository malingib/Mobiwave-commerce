# Social Commerce private media architecture

Status: implementation decision; infrastructure provisioning and runtime integration remain gated.

## Decision

Use a **private Cloudflare R2 bucket** for WhatsApp/Instagram conversation media. Keep PostgreSQL as the metadata and authorization source of truth. Use the R2 S3-compatible API from the existing Node.js application; do not expose a public bucket, `r2.dev` URL, or permanent object URL. Issue short-lived, operation-specific presigned URLs only after tenant membership and attachment authorization checks.

This fits the existing Next.js/Node runtime without introducing a second worker platform or a new database. R2 remains an infrastructure dependency: no bucket or credentials are assumed to exist.

## Required infrastructure configuration

Create a dedicated bucket for production media, separate from public storefront assets. Configure application server-only environment variables:

- `R2_ACCOUNT_ID`
- `R2_BUCKET_NAME`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_S3_ENDPOINT` (the account's R2 S3 endpoint)

Use a scoped R2 token limited to the dedicated bucket and the minimum object read/write permissions. Do not reuse Cloudflare Global API keys. Do not place credentials in browser bundles, database rows, GitHub commits, logs, or client-visible API responses.

Configure bucket CORS only for the exact production and approved preview origins, and only the required methods/headers. CORS is not authorization.

## Object key and metadata contract

Generate keys server-side; never accept a caller-supplied key or path:

`stores/{store_uuid}/conversations/{conversation_uuid}/{attachment_uuid}`

The original filename is display metadata only and must never be used as a path component. Persist the object key, declared and detected MIME types, byte size, SHA-256 checksum, provider media ID, scan state, and creation/retention timestamps in `conversation_attachments`. Enforce tenant-consistent foreign keys and RLS on all attachment reads/writes.

Recommended lifecycle states: `pending`, `quarantined`, `available`, `rejected`, `deleted`. A file must not become downloadable or eligible for outbound sending until verification has completed.

## Inbound Meta media flow

1. Webhook ingress persists the signed, deduplicated provider event only; it does not trust a provider URL as a durable attachment URL.
2. The channel worker extracts the provider media ID and records a pending attachment against the normalized message.
3. A media-processing worker obtains the channel credential server-side, asks Meta for media metadata, and downloads bytes from the verified Meta Graph host only. Reject redirects to untrusted hosts; enforce connection/read timeouts and a hard streaming byte limit.
4. Validate the actual file signature (magic bytes) against the allowlist; do not trust the extension, provider MIME header, or user-supplied filename. Compute SHA-256 while streaming.
5. Upload to the private R2 bucket using the server-generated key. Mark the attachment available only after upload and verification succeed. Retry transient failures safely; make the media job idempotent by provider media ID and attachment ID.
6. Never persist Meta access tokens, temporary Meta download URLs, or public R2 URLs in message content or logs.

## Initial allowlist and limits

Initial conservative limits pending a product-level media matrix:

- Images: JPEG, PNG, WebP; 10 MiB maximum.
- Documents: PDF; 20 MiB maximum.
- Audio: OGG/Opus, MPEG audio, MP4/AAC where confirmed by the relevant Meta channel API; 16 MiB maximum.
- Video: MP4; 25 MiB maximum.
- Reject SVG, HTML, XML, executable formats, archives, unknown MIME types, and mismatched file signatures.
- Treat all media as untrusted. Add malware scanning/quarantine before enabling downloads or outbound re-use; if no scanner is configured, keep files quarantined and fail closed.

These are application limits, not claims about Meta's platform limits. Confirm the current channel-specific Meta media constraints before enabling each type.

## Download and outbound use

- Authorize store membership and confirm the attachment belongs to the requested store/conversation before issuing a short-lived GET URL (target 60 seconds).
- Set `Content-Disposition: attachment`, a sanitized filename, and the verified MIME type. Use `X-Content-Type-Options: nosniff`.
- Do not proxy arbitrary URLs or accept arbitrary object keys from clients.
- For outbound media, upload the verified object to the appropriate Meta media endpoint using the connected channel credential, persist the returned provider media ID, then enqueue the message through the existing idempotent outbox. Never send an R2 URL to Meta as if it were a public media URL.
- Delete abandoned pending uploads and expired/rejected objects through a retention job. Keep metadata/audit records according to the product retention policy.

## Required tests before activation

- Cross-tenant attachment lookup and signed URL issuance are denied.
- Guessed attachment IDs and modified conversation IDs do not disclose objects.
- MIME spoofing, extension mismatch, oversized streams, truncated files, redirect-to-untrusted-host, and timeout cases fail closed.
- Presigned URLs expire and cannot be used for a different method/key.
- Duplicate webhook/media jobs do not create duplicate attachment rows or outbound sends.
- RLS tests prove the application role cannot enumerate another tenant's attachment metadata.
- Verify inbound WhatsApp image/document/audio/video test assets and outbound Meta media sends with real test assets before enabling the UI.

## Current release gate

The schema has a `conversation_attachments` table, but that table is not a functioning storage pipeline. No R2 bucket, credentials, media downloader, scanner, signed download endpoint, or outbound media upload flow is currently configured. Do not mark media support complete until the implementation and tests above are present and real Meta test assets pass.
