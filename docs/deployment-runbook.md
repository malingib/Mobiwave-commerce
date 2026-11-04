# Deployment and operations runbook

## 1. Release branch and review

- Current implementation branch: codex/commerce-complete-roadmap.
- Review the draft pull request before merging.
- Do not deploy while CI is queued or failing.
- Keep production untouched until the migration plan, secrets and provider tests are approved.

## 2. Neon database

1. Confirm the intended production Neon project and database before applying anything.
2. Apply db/schema.sql as the initial baseline, then apply db/migrations/0002-auth.sql through 0015-mpesa-platform-order-fallback.sql in numeric order. If the existing database already has earlier migrations, reconcile migration state first; do not replay baseline DDL blindly.
3. Apply migrations first on a disposable Neon branch and run the tenant/RLS test suite.
4. The app connection must use the commerce_app login with options=-c%20role%3Dcommerce_runtime. Never put the owner connection string in Vercel.
5. Verify at runtime that current_user = 'commerce_runtime' and rolbypassrls = false.
6. Verify two separate merchant users cannot read each other's orders, payment attempts, configuration, domains or messages.
7. Verify callback, checkout, worker and admin capability flags are set only inside their intended server-side transactions.

## 3. Vercel environment variables

Set these as server-side Vercel environment variables for Preview and Production as appropriate:

- DATABASE_URL
- BETTER_AUTH_SECRET
- BETTER_AUTH_URL
- NEXT_PUBLIC_APP_URL
- NEXT_PUBLIC_ROOT_DOMAIN
- SUPERADMIN_EMAILS
- BREVO_API_KEY
- BREVO_SENDER_EMAIL
- BREVO_SENDER_NAME
- MPESA_CREDENTIALS_ENCRYPTION_KEY
- MPESA_CALLBACK_TOKEN
- MOBIWAVE_SMS_API_URL
- MOBIWAVE_SMS_API_KEY
- MOBIWAVE_SMS_SENDER_ID
- CRON_SECRET

Generate a 32-byte encryption key with openssl rand -base64 32. Generate a strong callback/worker secret with openssl rand -hex 32. Keep the M-Pesa encryption key stable; rotating it without re-encrypting stored credentials makes the saved Daraja configuration unreadable.

Use a verified Brevo sender. Email verification and password recovery must work before opening registration to customers.

## 4. M-Pesa configuration and tests

- Configure platform Daraja credentials at /admin/integrations/mpesa.
- Configure merchant-specific credentials at /dashboard/{storeId}/integrations/mpesa when a merchant uses its own shortcode.
- Store credentials only through the encrypted configuration APIs. Do not add consumer keys/passkeys to frontend variables.
- Set the callback token and canonical app URL in Vercel.
- Test Sandbox first: successful payment, rejected PIN, timeout/uncertain outcome, duplicate callback, wrong amount, wrong phone, duplicate receipt and manual reconciliation.
- Verify order payment status and subscription activation only change after a valid callback or audited admin reconciliation.
- Subscription prices are intentionally blank for paid plans. Set approved KES monthly prices at /admin/plans before enabling paid subscriptions.
- Do not enable production Daraja until the Safaricom account and shortcode are approved.

## 5. Custom domains

1. Merchant registers the hostname in the store dashboard.
2. Merchant creates the TXT record shown by the app: host _mobiwave-commerce.<hostname>, value mobiwave-commerce-verification=<token>.
3. Merchant verifies DNS ownership in the dashboard.
4. Platform administrator attaches the hostname to the MobiWave Commerce Vercel project and confirms DNS/TLS.
5. Platform administrator activates the domain at /admin/domains.
6. Verify that only active, verified domains route to the intended store.

Free subdomains require wildcard DNS and TLS for the configured NEXT_PUBLIC_ROOT_DOMAIN.

## 6. Transactional SMS

The outbox is enabled in code, but live provider delivery requires the exact MobiWave API endpoint, bearer key and sender ID. The current adapter posts JSON with to, message, senderId and clientReference; confirm these names and endpoint against the live API documentation before enabling production sends.

Set MOBIWAVE_SMS_API_URL, MOBIWAVE_SMS_API_KEY, MOBIWAVE_SMS_SENDER_ID and CRON_SECRET in Vercel. Add GitHub repository secrets:

- COMMERCE_BASE_URL: canonical production app URL.
- COMMERCE_CRON_SECRET: exactly the same value as Vercel CRON_SECRET.

The GitHub scheduled workflow calls POST /api/internal/messages/process every five minutes for retries. Next.js after() attempts immediate delivery after checkout, payment and order status updates. Verify provider idempotency behavior and delivery receipts before relying on automatic retry.

## 7. Production acceptance

- [ ] Confirm target Vercel project and production domain.
- [ ] Confirm all CI jobs pass on the exact merge commit.
- [ ] Apply reviewed migrations to the intended Neon production branch.
- [ ] Verify runtime role and effective RLS.
- [ ] Verify signup, email verification, login and superadmin allowlist.
- [ ] Run two-merchant isolation tests.
- [ ] Run product, inventory, checkout and order fulfilment tests.
- [ ] Run Daraja Sandbox success/failure/duplicate/timeout/reconciliation tests.
- [ ] Run SMS provider send/retry/dedupe tests.
- [ ] Verify custom domain DNS/TLS and storefront routing.
- [ ] Verify database backup and restore.
- [ ] Deploy and smoke-test production; retain rollback point.

No production deployment or production migration is considered complete until the exact deployed commit and runtime behavior have been verified.
