# MobiWave Commerce deployment and operations runbook

Last verified: 25 November 2026
Repository: malingib/Mobiwave-commerce
Production project: Vercel mobiwave-commerce in Dwayne's projects (Hobby plan; restricted pilot only)
Production database: Neon project mobiwave-commerce, project ID jolly-mountain-13278023, default branch main

## 1. Current release state

- GitHub main is at 83160c5c463ed3a295524ca0f418dd18bb33bef6.
- The matching Vercel production deployment is READY and points to that commit.
- GitHub Actions CI run #569 passed database-role/tenant-isolation checks, unit tests, dependency audit, typecheck, lint and production build.
- GET /api/health returned HTTP 200 on 25 November. It verifies the runtime role and schema/role-isolation readiness; it does not prove payment, media or Meta provider acceptance.
- GitHub main is currently unprotected. Configure required CI checks and prevent direct unreviewed pushes before public rollout.
- The Vercel Hobby project is approved for restricted internal/pilot use only, not public or scale-ready production.
- A passing build or health check is not permission to run production migrations, enable provider sends, activate billing suspension or promote a new release.

## 2. Neon database and migrations

The live database currently contains the commerce, authentication, social-channel, attachment, wallet, subscription-dunning and email-usage tables. The live role health check passes with separate commerce_runtime_app and commerce_auth_app logins and non-login, NOBYPASSRLS runtime roles.

For a new environment:

1. Confirm the exact Neon project, database and branch.
2. On a disposable branch, apply db/schema.sql as the initial baseline, then every db/migrations/*.sql file in numeric order through 0030-email-usage-ledger.sql.
3. Before migration 0009, run db/roles/commerce-runtime-bootstrap.sql as the project owner.
4. After migrations, run db/roles/commerce-runtime.sql and db/roles/commerce-auth-runtime.sql as the project owner.
5. Configure DATABASE_URL with the commerce_runtime_app login and AUTH_DATABASE_URL with the separate commerce_auth_app login. Never use the Neon owner login or a BYPASSRLS login in application pools.
6. Verify the health endpoint, effective role memberships and two-merchant isolation before promoting a schema change.

For the existing production database, do not replay the baseline or migrations. The current schema has no dedicated migration-history table visible in the inspected public schema; reconcile the actual schema against the ordered migration files on a disposable branch before any production migration.

## 3. Vercel project, environment and domains

The active production deployment is mobiwave-commerce.vercel.app. The project has these domains attached:
- mobiwave-commerce.vercel.app — verified.
- shop.mobiwave.co.ke — pending TXT ownership verification.
- *.shop.mobiwave.co.ke — pending TXT ownership verification.

commerce.mobiwave.co.ke was not present in the current project-domain listing. Do not update BETTER_AUTH_URL or NEXT_PUBLIC_APP_URL to that hostname until it is attached, verified and TLS-ready. The current production app URL variables still point to the Vercel domain.

Sensitive production environment-variable entries exist for the database URLs, Better Auth, channel encryption/worker secrets, R2 credentials and scanner token. Their values are intentionally not exposed in this audit. Verify functionality through authenticated health checks rather than attempting to display secret values.

## 4. Preview environment isolation

The latest PR preview deployment builds successfully, but its GET /api/health check returns HTTP 503. Runtime logs identify the generic Preview DATABASE_URL as using the unsupported PostgreSQL startup parameter role. The generic Preview environment also lacks a separate AUTH_DATABASE_URL entry.

Do not fix this by copying production database credentials into Preview or by pointing a public preview at the production database. Before preview authentication/runtime acceptance, provision a disposable, sanitized Neon preview database with separate NOBYPASSRLS commerce and auth logins, then configure branch-specific DATABASE_URL and AUTH_DATABASE_URL values plus an independent BETTER_AUTH_SECRET for the PR branch. Verify the preview health endpoint and registration against that isolated database.

## 5. Worker architecture

GitHub Actions is CI/CD only. The production Neon commercescheduler function currently has three enabled one-minute triggers:
- commerce-channel-webhooks → POST /api/internal/channels/process?limit=50
- commerce-channel-outbound → POST /api/internal/channels/send?limit=4
- commerce-message-outbox → POST /api/internal/messages/process

Recent Neon logs show HTTP 200 for all three application endpoints. The subscription-billing worker endpoint exists, but its dedicated COMMERCE_BILLING_WORKER_TOKEN, scheduler route deployment and hourly trigger remain outstanding. See docs/worker-deployment.md. Do not enable the billing trigger until production activation is explicitly approved because it can send notices and suspend paid entitlements on Day 3.

## 6. Subscription plans and billing

The current catalogue is Free (KES 0, permanent), Starter (KES 299), Growth (KES 999), Professional (KES 2,499), Business (KES 4,999) and Enterprise (negotiated). Free is not a time-limited trial. Monthly included email/SMS allowances are 20, 30, 50, 100, 200 and negotiated respectively.

Paid subscriptions retain entitlements during the Day 0–2 recovery window. Day 1 and Day 2 reminders are queued; paid entitlements are suspended on Day 3 if payment remains outstanding. Store records and customer data are preserved. A verified M-Pesa payment restores paid status. Do not count an STK prompt, browser redirect or unverified callback as payment.

The dunning code and worker endpoint are merged, but scheduled production activation is not complete. Validate against disposable/test subscriptions before enabling the hourly trigger.

## 7. M-Pesa and SMS

Daraja integration code supports encrypted platform/merchant credentials, STK requests, callback correlation and reconciliation. Real Daraja sandbox success, rejected PIN, timeout/unknown outcome, duplicate callback, wrong amount/phone, duplicate receipt and manual reconciliation tests remain release gates. Do not enable production Daraja until Safaricom account/shortcode approval and explicit production authorization.

The SMS adapter uses the MobiWave v3 API. Confirm provider-side idempotency, segment billing, rejection semantics and delivery-report authenticity before relying on automatic retries or treating messages as delivered. Wallet-funded overage must reserve funds atomically and block submission when funds are insufficient.

## 8. Private R2 media

The private media pipeline is implemented in code. Vercel has production environment-variable entries for the R2 account, bucket and endpoint, plus sensitive access-key and scanner-token entries. Secret values were not exposed. The authenticated POST /api/internal/media/health route verifies R2 write/HEAD/read/delete and scanner connectivity; a successful live check has not yet been recorded. Keep media downloads and Meta media sending disabled until this check and real attachment tests pass.

Inbound Meta media retrieval and outbound WhatsApp/Instagram media sending are separate outstanding integrations; the existing merchant attachment pipeline does not prove those Meta flows work.

## 9. Production acceptance checklist

- [ ] Protect GitHub main with required green CI checks and reviewed changes.
- [ ] Confirm Vercel project ownership, paid-plan decision and pilot allowlist/caps.
- [ ] Verify production custom-domain DNS, ownership, TLS and canonical routing.
- [ ] Reconcile migrations on a disposable Neon branch; never replay production baseline.
- [ ] Verify both runtime roles, effective RLS and two-merchant negative tests.
- [ ] Complete signup, email verification, login and superadmin allowlist tests.
- [ ] Complete product, inventory, checkout, order and fulfilment tests.
- [ ] Complete Daraja sandbox callback/replay/reconciliation acceptance.
- [ ] Confirm MobiWave SMS provider contract, wallet reservations, duplicate behavior and delivery receipts.
- [ ] Run authenticated R2/scanner health check and cross-tenant attachment tests.
- [ ] Complete real Meta WhatsApp/Instagram test-asset acceptance, including templates and delivery status.
- [ ] Enable the subscription-billing trigger only after explicit production approval and test-subscription acceptance.
- [ ] Verify backup and restore in a test environment.
- [ ] Deploy the reviewed commit, smoke-test it, and retain a rollback point.

No production release is complete until the exact deployed commit and runtime behavior have been verified.
