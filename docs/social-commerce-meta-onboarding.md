# Meta channel onboarding

This implementation uses official Meta authentication and messaging APIs only.

## WhatsApp

Use Facebook Login for Business with a WhatsApp Embedded Signup **v4 configuration**. Do not use retired v2/v3 configuration patterns or pass a merchant access token through the browser.

Configure these server-side values:

- \`META_APP_ID\`
- \`META_APP_SECRET\`
- \`META_WHATSAPP_CONFIG_ID\`
- \`META_GRAPH_API_VERSION\` (default \`v27.0\`)
- \`CHANNEL_CREDENTIALS_ENCRYPTION_KEY\` (base64-encoded 32-byte key)

The client launches the Meta JavaScript SDK with the configured \`config_id\`, \`response_type: "code"\`, and \`override_default_response_type: true\`. The browser receives an authorization code and the Embedded Signup finish event supplies the WABA and phone-number IDs. The server exchanges the code, confirms that the selected phone number belongs to the returned WABA, subscribes the WABA to the app's webhooks, and stores the token encrypted.

The merchant-facing UI never receives the access token. It receives only the connection ID, display name and connection status.

## Instagram

Use **Instagram Login** for Instagram professional accounts, with the messaging permission only:

- \`instagram_business_basic\`
- \`instagram_business_manage_messages\`

Do not request publishing or comment-management permissions for this launch scope. The Instagram Login callback must be registered exactly as \`META_INSTAGRAM_REDIRECT_URI\`, for example:

\`https://commerce.example.com/api/oauth/meta/instagram/callback\`

The server exchanges the authorization code at \`api.instagram.com\`, exchanges the short-lived token for a long-lived token at \`graph.instagram.com\`, retrieves the account identity, subscribes the account to the \`messages\` webhook field, and encrypts the long-lived token.

## Security model

- Start endpoints require an authenticated store owner or manager.
- OAuth state is 256-bit random, stored only as SHA-256, bound to user/store/channel, expires after 10 minutes and can be consumed once.
- Provider tokens are encrypted with AES-256-GCM. The 32-byte key is a server-only deployment secret; never prefix it with \`NEXT_PUBLIC_\`.
- Encrypted credentials and OAuth state have forced RLS and are visible only under trusted server transaction-local capabilities.
- The channel connection row stores a credential reference, not the token.
- Provider API errors are reduced to safe error codes. Access tokens, app secrets and authorization codes must not be logged.
- Disconnect must revoke local credentials and mark the channel disconnected. Local disconnect does not by itself prove that the Meta app's asset permission has been revoked in Meta Business settings.

## Required Meta configuration and external gates

The application code cannot complete Meta's partner and compliance prerequisites. Before a live onboarding trial:

1. Configure the Meta app, Facebook Login for Business and a new WhatsApp Embedded Signup v4 configuration.
2. Configure Instagram Login in the same Meta app and register the exact redirect URI.
3. Configure the shared webhook callback \`/api/webhooks/meta\` and the verify token.
4. Complete Meta business verification, App Review and Advanced Access requirements for the permissions and provider programs that apply to MobiWave.
5. Add the required deployment secrets to the correct preview/production environment.
6. Apply migration 0020 to a disposable Neon branch and verify RLS before any production migration.
7. Run end-to-end onboarding with test assets, then send/receive test messages before enabling merchants.

The current code is an onboarding foundation. Do not claim a channel is live until the webhook delivery, outbound send, token health and tenant-isolation acceptance tests pass.

## Outbound text messaging

The outbound API is tenant-scoped and requires an `Idempotency-Key` header. It stores a request hash to reject reuse of a key with different content. Free-form text is accepted only while the latest inbound customer message is within the 24-hour customer-care window. Approved template messages and media are not part of this phase.

A separate authenticated worker sends queued text through the official WhatsApp Cloud API or Instagram Messaging API. Provider access tokens are decrypted only in the server worker. Provider timeouts and stale processing leases are marked `delivery_unknown` and are never automatically retried, because Meta may have accepted the message before the connection failed. Delivery receipts update the canonical conversation message through the existing webhook processor.
