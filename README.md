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
- Configurable subscription plan catalogue, admin-managed KES prices/quotas, M-Pesa subscription STK collection, callback-based activation and manual renewal.
- Transactional SMS outbox, deduplication, lease-based processing, retry/backoff and an authenticated worker endpoint.
- GitHub Actions CI for tests, typecheck, lint, dependency audit and production build.

## Environment and secrets

DATABASE_URL must connect as the Neon commerce_app login role, without embedding an application role-switch option. The application creates separate PostgreSQL pools: lib/db.ts switches each commerce query to commerce_runtime, while Better Auth switches to commerce_auth_runtime. Both are non-login, NOBYPASSRLS roles. Never use the Neon owner connection string in the application.

After applying the base schema and migrations, run both role scripts as the Neon project owner:
- db/roles/commerce-runtime.sql
- db/roles/commerce-auth-runtime.sql

The first role receives only the commerce data privileges explicitly granted by the migrations. The second role receives access only to Better Auth's public."user", session, account and verification tables. Verify both roles report rolbypassrls=false and that commerce_auth_runtime cannot read stores.

Copy .env.example to .env.local and configure:

- DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL, NEXT_PUBLIC_APP_URL.
- NEXT_PUBLIC_ROOT_DOMAIN and SUPERADMIN_EMAILS.
- BREVO_API_KEY, BREVO_SENDER_EMAIL, BREVO_SENDER_NAME to enable account verification and recovery email.
- MPESA_CREDENTIALS_ENCRYPTION_KEY (base64-encoded 32-byte key) and MPESA_CALLBACK_TOKEN.
- MOBIWAVE_SMS_API_URL, MOBIWAVE_SMS_API_KEY, MOBIWAVE_SMS_SENDER_ID.
- CRON_SECRET for the authenticated message worker endpoint.

Never commit .env.local, expose provider secrets through NEXT_PUBLIC_ variables, or rotate the M-Pesa encryption key without re-encrypting all stored credentials.

## Database migrations

db/schema.sql is the initial schema baseline. Apply db/migrations/0002-auth.sql through 0016-mpesa-callback-read-policies.sql in numeric order. Apply and validate migrations on a disposable Neon branch first. Production migrations have not been applied as part of this implementation work.

## Development

Run npm install and npm run dev.

Visit /signup, create a store in /dashboard, manage products/orders, and test its public storefront at /shop/{slug}. Merchant billing is at /dashboard/{storeId}/billing; merchant domain and M-Pesa settings are in the store dashboard.

Platform administration:
- /admin — platform overview.
- /admin/plans — paid plan prices and quotas.
- /admin/domains — custom-domain activation.
- /admin/integrations/mpesa — platform Daraja configuration.
- /admin/reconciliation — uncertain payment reconciliation.

## Integration and launch boundaries

- Paid plan prices intentionally remain unconfigured (NULL) until MobiWave approves commercial rates. Free plan custom-domain quota is zero. Quotas are enforced when configured.
- Daraja credentials and callbacks are implemented, but real sandbox/production credentials and live callback tests are still required. Browser redirects never activate payments.
- SMS messages are queued and retried. The adapter currently sends a bearer-authenticated JSON request with to, message, senderId and clientReference. The exact MobiWave SMS endpoint and payload contract must be confirmed against the provider documentation before live sending. No SMS has been sent from this audit.
- Immediate SMS dispatch uses Next.js after(). The GitHub scheduled worker is available for retries; configure repository secrets COMMERCE_BASE_URL and COMMERCE_CRON_SECRET (same value as Vercel CRON_SECRET) after production deployment.
- Custom domains require merchant DNS TXT verification, manual attachment to the Vercel project, then platform-admin activation. Production wildcard DNS, Vercel domain attachment and TLS have not been verified.
- The current work is in a development branch and draft PR. Production Neon was not modified. The latest Vercel preview is still being verified.
- Pesapal/Paystack, official WhatsApp messaging, email order notifications, automatic recurring card/M-Pesa mandates, and a full subscription usage-metering system remain future work.

## Production readiness

Do not treat a passing TypeScript/build check as proof of live payment readiness. Before launch, apply reviewed migrations to the intended Neon production database, configure all secrets, verify both database roles and RLS with the actual runtime roles, complete two-tenant negative tests, test Daraja sandbox callbacks and reconciliation, confirm SMS provider schema and delivery, attach custom domains, restore a backup in a test environment, and deploy/smoke-test the actual Vercel production project. See docs/deployment-runbook.md.
