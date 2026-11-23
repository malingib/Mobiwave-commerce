# MobiWave Commerce private media storage

Status: upload reservation, presigned R2 transfer, verification, quarantine, promotion and signed-download endpoints are implemented. The R2 bucket is private, CORS is restricted to the production app origins, and staging objects expire after one day. Production R2 credentials and the Cloudmersive scanner token are configured in Vercel; the authenticated production smoke check verifies live read/write and scanner connectivity after deployment. Inbound WhatsApp and Instagram media retrieval is wired into the webhook worker.

## Storage model

- Provider: Cloudflare R2 through its S3-compatible API.
- Bucket: `mobiwave-commerce-media`.
- Visibility: private; do not enable the public R2 development domain.
- Application credentials: bucket-scoped Object Read & Write S3 credentials stored only in Vercel server-side environment variables.
- Object keys: random attachment IDs under `staging/` before verification and `stores/` after promotion.
- Database metadata: `conversation_attachments`, with checksum, detected MIME type, scan state and timestamps.

## Upload lifecycle

1. An authenticated store member requests an upload reservation using POST `/api/stores/{storeId}/conversations/{conversationId}/attachments` with `messageId`, `fileName`, `mimeType` and `byteSize`.
2. The server verifies store membership and that the message belongs to the requested conversation. It creates a pending metadata row and returns a five-minute presigned PUT URL for a random staging key.
3. The browser uploads directly to R2 using the returned URL and exact Content-Type header. No R2 credentials are sent to the browser.
4. The browser calls POST `/api/stores/{storeId}/conversations/{conversationId}/attachments/{attachmentId}/complete`.
5. The server verifies the stored byte size, downloads the object privately, checks the file signature against the declared MIME type, enforces the file limit and computes SHA-256.
6. If the scanner returns clean, the server copies the staging object to its final key, updates the database to available, then deletes the staging object. The presigned upload URL can no longer overwrite the final object.
7. If the scanner returns infected, the object is deleted and metadata is marked rejected. If no scanner is configured or the scanner is unavailable, metadata remains quarantined and downloads are denied. Verification can be retried after the scanner is configured.
8. Authenticated members can request a download URL through GET `/api/stores/{storeId}/conversations/{conversationId}/attachments/{attachmentId}`. Only available objects receive a 60-second presigned GET URL.

## File policy

| MIME type | Maximum size |
|---|---:|
| JPEG | 10 MiB |
| PNG | 10 MiB |
| WebP | 10 MiB |
| PDF | 20 MiB |
| MP4 | 25 MiB |

SVG, HTML, archives, executable formats and unknown MIME types are rejected. The server trusts file signatures, not the filename or browser MIME declaration.

## Required environment variables

- `R2_ACCOUNT_ID`
- `R2_BUCKET_NAME`
- `R2_S3_ENDPOINT` (must be the HTTPS endpoint for the configured account)
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `MEDIA_SCANNER_URL` (optional until an HTTPS scanner is available)
- `MEDIA_SCANNER_TOKEN` (optional until an HTTPS scanner is available)

Create the R2 S3 credentials in Cloudflare Dashboard → Storage & databases → R2 → Overview → Manage API Tokens. Select Object Read & Write and restrict access to the `mobiwave-commerce-media` bucket. Store the Access Key ID and Secret Access Key as Vercel sensitive environment variables. Do not use a general Cloudflare account API token.

## Malware scanner contract

The application sends an HTTPS POST to `MEDIA_SCANNER_URL` with:
- Bearer token from `MEDIA_SCANNER_TOKEN`
- Raw object bytes as `application/octet-stream`
- `X-File-Mime-Type` and `X-File-SHA256` headers

The scanner must return JSON `{"status":"clean"}` or `{"status":"infected"}`. Any timeout, non-2xx response, invalid JSON or unknown status is treated as inconclusive and leaves the attachment quarantined. The scanner must not store or redistribute uploaded content.

## Bucket CORS

The configured R2 CORS rule allows PUT, GET and HEAD from:
- `https://mobiwave-commerce.vercel.app`
- `https://commerce.mobiwave.co.ke`

Only the `Content-Type` request header is allowed; `ETag` is exposed. Add a new exact origin only after verifying the app domain. Do not use a wildcard origin. The `r2.dev` managed public domain is disabled. A lifecycle rule deletes objects under `staging/` after 24 hours and aborts incomplete multipart uploads after seven days.

## Database migration

Migration `0022-conversation-attachment-security.sql` adds checksum and scan lifecycle metadata. It is a forward-only migration and must be applied once, after migrations 0018–0021 have been applied to the target branch. Do not run it against a different Neon project or replay the initial schema.

## Operational safeguards

- Staging objects are never downloadable.
- Only rows with `scan_status = 'available'` can receive signed download URLs.
- Final objects use random immutable keys, separate from temporary upload keys.
- Upload URLs expire after five minutes; download URLs expire after 60 seconds.
- No scanner means quarantine, not fail-open access.
- Never put R2 secrets in `NEXT_PUBLIC_*` variables, HTML, logs or client bundles.

## Meta channel media follow-up

The current implementation provides secure merchant-uploaded conversation attachments. It does not yet fetch inbound Meta media by provider media ID or send media through WhatsApp/Instagram APIs. Before enabling those flows:

- Download inbound media only through the official Meta Graph API using the tenant's stored channel credential; validate the provider media URL and do not follow arbitrary redirects.
- Stream provider bytes into the same private staging pipeline, then run signature, size, checksum and malware checks before promotion.
- For outbound media, retrieve only an attachment marked available, upload it to the correct Meta media endpoint using the connected channel credential, persist the returned provider media ID, and enqueue the message through the existing idempotent outbox.
- Never send a private R2 URL to Meta as a public media URL or expose provider access tokens to the browser.

## Additional release tests

- Cross-tenant attachment lookup and signed URL issuance are denied.
- Guessed attachment IDs and modified conversation IDs do not disclose objects.
- MIME spoofing, extension mismatch, oversized streams, truncated files and scanner timeouts fail closed.
- Presigned upload URLs are short-lived and scoped to one staging key; promotion copies verified content to a separate final key so a still-valid upload URL cannot overwrite an approved object.
- Duplicate completion calls cannot promote or expose a different tenant's object.
- RLS tests prove the application role cannot enumerate another tenant's attachment metadata.
- Verify inbound WhatsApp image/document/audio/video test assets and outbound Meta media sends with real test assets before enabling the UI.
- A retention job or R2 lifecycle policy removes abandoned staging objects; the bucket currently expires the staging prefix after 24 hours.
