# MobiWave Commerce

MobiWave Commerce is MobiWave-owned, multi-tenant B2C commerce SaaS for Kenyan merchants. The current implementation is a custom Next.js 16, React 19, TypeScript, PostgreSQL/Neon and Better Auth application. Take App and Bumpa are market benchmarks, not the platform foundation.

## Implemented application capabilities

- Better Auth email/password registration and sign-in, with a minimum 12-character password. Email verification is enabled when Brevo is configured; platform-admin access always requires a verified, allowlisted email.
- Merchant store provisioning, normalized free subdomains and role-checked merchant workspaces.
- Tenant-aware PostgreSQL schema with RLS and a dedicated commerce_runtime role (NOBYPASSRLS).
- Separate commerce_auth_runtime database role for Better Auth identity/session tables; authentication does not use the commerce data role.
- Product CRUD/status, public storefront, stock-aware checkout, idempotency and merchant order fulfilment.
- Server-side free-subdomain routing and custom-domain registration, DNS TXT verification, admin activation and custom-domain storefront resolution.
- Daraja credential configuration at platform and merchant scope; encrypted credentials (AES-256-GCM), merchant/platform fallback for order STK Push, and East Africa Time timestamps.
- Replay-safe Daraja callback handling, amount/currency/phone correlation, cross-order/subscription receipt claims and payment reconciliation queue.
- Six-tier subscription catalogue with a permanent Free plan (no expiry/card), approved KES monthly prices, server-side capacity and communication entitlements, M-Pesa subscription STK collection and callback-based activation.
- Transactional SMS outbox, deduplication, lease-based processing, retry/backoff and an authenticated worker endpoint.
- Official Meta webhook ingress for WhatsApp Cloud API and Instagram Messaging, including raw-body signature verification, account matching, event normalization and deduplicated durable webhook storage.
- Authenticated inbound event worker that creates channel-scoped identities/conversations, persists inbound messages and applies provider delivery/read statuses with replay-safe writes and bounded retries.
- Meta WhatsApp Embedded Signup v4 and Instagram Login onboarding foundation, one-time tenant-bound OAuth state, encrypted provider-token vault, asset verification and webhook subscription.
- Public Commerce landing page, About and Contact pages with MobiWave brand styling and responsive navigation. The Contact form sends directly through TalkSasa SMTP, with database-backed rate limiting, input validation and a honeypot; it does not use Brevo.\n- GitHub Actions CI for tests, typecheck, lint, dependency audit and production build.

## Environment and secrets

DATABASE_URL must connect as the Neon commerce_app login role, without embedding an application role-switch option. The application creates separate PostgreSQL pools: lib/db.ts switches each commerce query to commerce_runtime, while Better Auth switches to commerce_auth_runtime. Both are non-login, NOBYPASSRLS roles. Never use the Neon owner connection string in the application.

After creating the commerce_app login role, run db/roles/commerce-runtime-bootstrap.sql as the Neon project owner before applying migrations; migration 0009 grants privileges to commerce_runtime. After applying the base schema and migrations, run both role scripts as the Neon project owner:
- db/roles/commerce-runtime.sql
- db/roles/commerce-auth-runtime.sql

CI runs db/roles/commerce-runtime-bootstrap.sql, the full migration sequence, both role scripts and cross-tenant/least-privilege checks against PostgreSQL 17.

The first role receives only the commerce data privileges explicitly granted by the migrations. The second role receives access only to Better Auth's public."user", session, account and verification tables. Verify both roles report rolbypassrls=false and that commerce_auth_runtime cannot read stores.

Copy .env.example to .env.local and configure:

- DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL, NEXT_PUBLIC_APP_URL.
- NEXT_PUBLIC_ROOT_DOMAIN and SUPERADMIN_EMAILS.
- BREVO_API_KEY, BREVO_SENDER_EMAIL, BREVO_SENDER_NAME to enable account verification and recovery email.\n- SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD and SMTP_ENCRYPTION plus CONTACT_MAIL_FROM, CONTACT_MAIL_FROM_NAME and CONTACT_MAIL_TO for direct contact-form delivery. Keep SMTP_PASSWORD encrypted in Vercel; the configured TalkSasa SMTP sender is no-reply@mobiwave.co.ke and enquiries go to sales@mobiwave.co.ke.
- MPESA_CREDENTIALS_ENCRYPTION_KEY (base64-encoded 32-byte key) and MPESA_CALLBACK_TOKEN.
- MOBIWAVE_SMS_API_URL, MOBIWAVE_SMS_API_KEY, MOBIWAVE_SMS_SENDER_ID.
- CHANNEL_WORKER_SECRET for the Neon-triggered Meta webhook, outbound messaging and SMS outbox workers.
- COMMERCE_BILLING_WORKER_TOKEN for the separately authenticated subscription dunning and merchant/billing email worker. Keep it distinct from CHANNEL_WORKER_SECRET.
- META_APP_ID, META_APP_SECRET, META_WHATSAPP_CONFIG_ID and META_GRAPH_API_VERSION for WhatsApp Embedded Signup v4.
- META_INSTAGRAM_REDIRECT_URI for Instagram Login; register the exact callback URI in the Meta app.
- CHANNEL_CREDENTIALS_ENCRYPTION_KEY (base64-encoded 32-byte key) for the encrypted Meta token vault.
- META_WEBHOOK_VERIFY_TOKEN for the official Meta webhook endpoint (server-side only).

Never commit .env.local, expose provider secrets through NEXT_PUBLIC_ variables, or rotate either credential-encryption key without re-encrypting all stored credentials.

## Database migrations

db/schema.sql is the initial schema baseline. Apply every db/migrations/*.sql file in numeric order through 0028-commerce-plan-tiers.sql. Migrations 0018–0021 add the official-channel connection registry, webhook inbox, channel identities/conversations/messages, service-only encrypted token vault, tenant-bound OAuth state and outbound message worker access. Migrations 0024–0027 add the wallet ledger, SMS delivery idempotency, SMS wallet enforcement and M-Pesa wallet top-ups. Migration 0028 seeds the permanent Free plan and six-tier catalogue, migrates legacy Pro subscriptions to Professional, and adds suspended/expired subscription states. Migration 0029 adds the idempotent Day 1/Day 2 dunning and Day 3 paid-entitlement suspension ledger; migration 0030 adds the RLS-protected monthly email usage ledger. Always validate migrations on a disposable Neon branch before production. This feature branch has not applied migration 0028 to production.

## Development

Run `npm ci` and then `npm run dev`. Run `npm test` for the 58 Node-native unit tests, `npm run typecheck` for TypeScript validation, `npm run lint` for JavaScript/config linting, and `npm run build` for the production build.

Visit /signup, create a store in /dashboard, manage products/orders, and test its public storefront at /shop/{slug}. Merchant billing is at /dashboard/{storeId}/billing; merchant domain and M-Pesa settings are in the store dashboard.

Platform administration:
- /admin — platform overview.
- /admin/plans — paid plan prices and quotas.
- /admin/domains — custom-domain activation.
- /admin/integrations/mpesa — platform Daraja configuration.
- /admin/reconciliation — uncertain payment reconciliation.

## Integration and launch boundaries

- Free is a permanent KES 0 plan, not a trial. Paid subscriptions retain entitlements during Day 0–2 `past_due` recovery, receive Day 1 and Day 2 reminders, and move to `suspended` on Day 3 if still unpaid. Suspension does not change the store record or remove data; a verified M-Pesa payment restores active status and clears dunning state. The current catalogue is Free (KES 0), Starter (KES 299), Growth (KES 999), Professional (KES 2,499), Business (KES 4,999), and Enterprise (negotiated). Monthly email/SMS allowances are 20, 30, 50, 100, 200 and negotiated respectively. Free plan limits are 20 products, 1 staff account and no custom domain. Plan changes are applied through reviewed migrations and audited admin updates.
- Daraja credentials and callbacks are implemented, but real sandbox/production credentials and live callback tests are still required. Browser redirects never activate payments.
- SMS messages are queued and retried. The worker now reads included SMS segments from the active plan entitlement; wallet overage still requires a configured per-store billing rate and active wallet. The adapter currently sends a bearer-authenticated JSON request with recipient, message, sender_id and Idempotency-Key. The exact provider endpoint and payload contract must be confirmed before live sending.
- Immediate SMS dispatch uses Next.js after(). Background SMS, email and subscription billing work is exposed through `POST /api/workers/subscription-billing`, protected by `COMMERCE_BILLING_WORKER_TOKEN` (minimum 32 characters). Configure the hourly commerce-subscription-billing Neon Function Trigger only after production approval; GitHub Actions remains CI/CD only. Merchant email sends are metered against the monthly plan allowance; MobiWave billing notices are platform transactional messages and do not consume merchant allowance.
- Custom domains require merchant DNS TXT verification, manual attachment to the Vercel project, then platform-admin activation. Production wildcard DNS, Vercel domain attachment and TLS have not been verified.
- Social Commerce Phases 1–6 are merged to main as of 17 November 2026. The release includes tenant-scoped channel/conversation storage, verified Meta webhook ingress, inbound processing, WhatsApp Embedded Signup and Instagram Login foundations, encrypted provider-token storage, idempotent outbound text messaging, and the merchant unified inbox. Production Neon and production deployment have not been modified.
- Remaining Social Commerce work: live Meta test-asset onboarding and App Review/permission acceptance; approved template sends; media download/storage; explicit delivery reconciliation; richer team assignment, labels and saved views; browser-level workflow acceptance. The inbox/outbound paths have CI coverage, but have not been validated end-to-end with live Meta assets. Pesapal/Paystack, email order notifications, automatic recurring card/M-Pesa mandates, and a full subscription usage-metering system remain future work.

## Production readiness

Do not treat a passing TypeScript/build check as proof of live payment readiness. Before launch, apply reviewed migrations to the intended Neon production database, configure all secrets, verify both database roles and RLS with the actual runtime roles, complete two-tenant negative tests, test Daraja sandbox callbacks and reconciliation, confirm SMS provider schema and delivery, attach custom domains, restore a backup in a test environment, and deploy/smoke-test the actual Vercel production project. See docs/deployment-runbook.md.
