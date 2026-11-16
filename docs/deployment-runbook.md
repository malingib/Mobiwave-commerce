# Deployment and operations runbook

## 1. Release branch and review

- Current implementation branch: codex/commerce-complete-roadmap.
- Review the draft pull request before merging.
- Do not deploy while CI is queued or failing.
- Keep production untouched until the migration plan, secrets and provider tests are approved.

## 2. Neon database

1. Confirm the intended production Neon project, database and branch before applying anything.
2. On a disposable Neon branch, apply `db/schema.sql` as the initial baseline, then apply `db/migrations/0002-auth.sql` through `0017-commerce-hardening.sql` in numeric order. If the database already has earlier migrations, reconcile migration state first; do not replay baseline DDL blindly.
3. Before applying migration 0009, run `db/roles/commerce-runtime-bootstrap.sql` as the Neon project owner. Migration 0009 grants privileges to `commerce_runtime` and therefore requires this role to exist.
4. After all schema migrations are applied, run `db/roles/commerce-runtime.sql` and `db/roles/commerce-auth-runtime.sql` as the Neon project owner.
5. Set strong passwords for the generated login roles `commerce_runtime_app` and `commerce_auth_app` in Neon. Configure `DATABASE_URL` with the `commerce_runtime_app` connection string and `AUTH_DATABASE_URL` with the separate `commerce_auth_app` connection string. Never use the Neon owner or a BYPASSRLS login for either application pool.
6. The application uses separate pools without PostgreSQL startup role options: `commerce_runtime_app` is NOBYPASSRLS and inherits `commerce_runtime`; `commerce_auth_app` is NOBYPASSRLS and inherits `commerce_auth_runtime`. Both inherited runtime roles must be NOLOGIN and NOBYPASSRLS. Neon pooled endpoints reject custom startup options such as `-c role=...`.
7. Verify `commerce_runtime_app` can read commerce tables but cannot read Better Auth identity/session tables. Verify `commerce_auth_app` can read/write Better Auth tables but cannot read stores, orders or payment data. Verify both login roles report `rolbypassrls=false`.
8. Verify two separate merchant users cannot read each other's orders, payment attempts, configuration, domains or messages.
9. Verify callback, checkout, worker and admin capability flags are set only inside their intended server-side transactions.

Do not grant future tables to `commerce_runtime` by default. Each application migration must explicitly grant the required table/sequence privileges to that role.

### Existing-database signup repair

The previous pool configuration passed `-c role=commerce_runtime` and `-c role=commerce_auth_runtime` as PostgreSQL startup options. Neon pooled endpoints reject the `role` startup parameter, causing database connection failures before Better Auth can validate its schema. The fix is to use two dedicated NOBYPASSRLS login roles and omit startup role options entirely.

On a disposable Neon branch, run both role scripts as the database owner, set passwords for the two login roles, and test the application using the corresponding separate connection strings. Verify:

- `commerce_runtime_app` is a member of `commerce_runtime`, has RLS enabled, and cannot read Better Auth identity/session tables.
- `commerce_auth_app` is a member of `commerce_auth_runtime`, can read/write Better Auth tables, and cannot read commerce tables.
- Neither login role has BYPASSRLS; both inherited runtime roles are NOLOGIN/NOBYPASSRLS.
- `/api/health` returns HTTP 200 and a disposable test registration succeeds.

Only after the target branch and backup/rollback point are confirmed should these role scripts and role-specific connection strings be applied to production. After the new application connections are verified, revoke the legacy `commerce_app` membership in `commerce_runtime` so the old BYPASSRLS login no longer has commerce-table access.

## 3. Vercel environment variables

Set these as server-side Vercel environment variables for Preview and Production as appropriate. DATABASE_URL and AUTH_DATABASE_URL must be separate role-specific connection strings:

- DATABASE_URL
- AUTH_DATABASE_URL
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

Use a verified Brevo sender. When Brevo is configured, account verification is required. Platform-admin access always requires a verified email and membership in SUPERADMIN_EMAILS; never disable that check to work around missing email delivery.

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

Free subdomains require wildcard DNS and TLS for the configured NEXT_PUBLIC_ROOT_DOMAIN. The platform root, root-domain hostname and wildcard hostname must each be verified on the Vercel project.

## 6. Transactional SMS

The outbox is enabled in code, but live provider delivery requires the exact MobiWave API endpoint, bearer key and sender ID. The current adapter posts JSON with to, message, senderId and clientReference. Public service documentation confirms bearer-token REST authentication but does not expose the precise endpoint/payload contract; confirm those details against the developer API reference before enabling production sends.

Set MOBIWAVE_SMS_API_URL, MOBIWAVE_SMS_API_KEY, MOBIWAVE_SMS_SENDER_ID and CRON_SECRET in Vercel. Add GitHub repository secrets:

- COMMERCE_BASE_URL: canonical production app URL.
- COMMERCE_CRON_SECRET: exactly the same value as Vercel CRON_SECRET.

The GitHub scheduled workflow calls POST /api/internal/messages/process every five minutes for retries. Next.js after() attempts immediate delivery after checkout, payment and order status updates. Verify provider idempotency behavior and delivery receipts before relying on automatic retry.

## 7. Production acceptance

- [ ] Confirm target Vercel project and production domain.
- [ ] Confirm all CI jobs pass on the exact merge commit.
- [ ] Commit the generated npm lockfile and use npm ci for deployment.
- [ ] Apply reviewed migrations to the intended Neon production branch only after disposable-branch verification.
- [ ] Verify both runtime roles and effective RLS.
- [ ] Verify signup, email verification, login and superadmin allowlist.
- [ ] Run two-merchant isolation tests.
- [ ] Run product, inventory, checkout and order fulfilment tests.
- [ ] Run Daraja Sandbox success/failure/duplicate/timeout/reconciliation tests.
- [ ] Run SMS provider send/retry/dedupe tests.
- [ ] Verify custom domain DNS/TLS and storefront routing.
- [ ] Verify database backup and restore.
- [ ] Deploy and smoke-test production; retain rollback point.

No production deployment or production migration is considered complete until the exact deployed commit and runtime behavior have been verified.
