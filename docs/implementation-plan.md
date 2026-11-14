# Implementation plan

## Milestone 0 — repository and UX shell
- [x] Establish the custom Next.js/React application and repository documentation.
- [x] Add responsive merchant and platform administration surfaces.
- [x] Add CI for unit tests, typecheck, lint, dependency audit and production build.
- [ ] Commit a reproducible lockfile and complete dependency pinning.

## Milestone 1 — application and database foundation
- [x] Better Auth email/password registration and session handling.
- [x] Verified-email gate for platform-admin allowlisting.
- [x] Neon PostgreSQL schema, tenant foreign keys and RLS.
- [x] Dedicated restricted commerce_runtime role and transaction-local capability flags.
- [x] Validate migrations 0010–0016 on an isolated Neon branch.
- [ ] Apply reviewed migrations to the intended production Neon database after release approval.

## Milestone 2 — merchant and shopper journey
- [x] Store provisioning and free-subdomain slug validation.
- [x] Product creation, editing, publishing and archiving.
- [x] Public storefront and server-calculated checkout.
- [x] Stock-aware order creation and checkout idempotency.
- [x] Merchant order list and guarded fulfilment transitions.
- [x] Two-workspace RLS tests on isolated Neon branch.
- [ ] Full browser E2E and production two-merchant acceptance.

## Milestone 3 — control plane and domains
- [x] Platform overview and store administration.
- [x] Custom-domain registration and DNS TXT verification.
- [x] Separate platform activation/disable controls.
- [x] Custom-domain storefront routing.
- [x] Configurable plan catalogue and product/domain quotas.
- [ ] Attach production wildcard and merchant custom domains to Vercel; verify DNS/TLS.

## Milestone 4 — payments and reconciliation
- [x] AES-256-GCM encrypted platform and merchant Daraja configuration.
- [x] Merchant/platform credential selection for order STK Push.
- [x] Subscription STK Push using platform Daraja credentials.
- [x] East Africa Time timestamp generation.
- [x] Callback amount/currency/phone/receipt correlation and replay-safe updates.
- [x] Cross-order/subscription receipt claims.
- [x] Platform-admin reconciliation queue and audited manual resolution.
- [ ] Configure real Daraja sandbox credentials and run success, failure, timeout, duplicate callback and reconciliation tests.
- [ ] Production Daraja approval and live transaction acceptance.

## Milestone 5 — transactional notifications
- [x] Tenant-scoped SMS outbox and dedupe keys.
- [x] Transactional order, payment and subscription SMS templates.
- [x] Worker lease, retry/backoff and authenticated processing endpoint.
- [x] GitHub scheduled worker workflow.
- [ ] Confirm MobiWave SMS API endpoint/payload contract and configure API credentials/sender ID.
- [ ] Add GitHub worker secrets and verify real send, retry and delivery reports.

## Milestone 6 — release hardening
- [x] Add focused unit tests for plan limits, domain validation, Daraja utilities and SMS templates.
- [x] Add dependency audit to CI.
- [ ] Complete all current CI runs and resolve failures.
- [ ] Verify latest Vercel preview after deployment quota/rate-limit clears.
- [ ] Verify production Neon role, RLS, backups and restore procedure.
- [ ] Run browser accessibility, mobile, concurrency and cross-tenant E2E.
- [ ] Configure production secrets and deploy only after provider acceptance.

## Current honest status

Core application workflows and the security-sensitive integration code are implemented on the development branch. Migrations 0010–0015 and RLS behavior were tested on an isolated Neon branch with synthetic tenants. Production Neon has not been changed. Real Daraja and MobiWave SMS credentials are not configured for live testing. The latest CI run is queued, and the latest Vercel preview has not been verified because of deployment rate limiting. The work is not yet production-ready.
