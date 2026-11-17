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

## Milestone 6 — Social Commerce channel foundation
- [x] Add tenant-scoped channel connections, identities, conversations, messages, notes, attachments and outbound message outbox.
- [x] Add forced RLS, tenant-consistent composite foreign keys and worker-only raw webhook access.
- [x] Verify migration 0018 on a disposable Neon branch; production database unchanged.
- [x] Add Meta WhatsApp/Instagram webhook signature verification and event normalization.
- [x] Verify migration 0019 and webhook worker access in CI and on a disposable Neon branch.
- [x] Add worker RLS policies for normalized identities, conversations and messages; test cross-tenant worker writes and merchant isolation in CI.
- [x] Add tenant-bound, single-use OAuth state and encrypted provider-token vault.
- [x] Add WhatsApp Embedded Signup v4 code exchange, WABA/phone verification and webhook subscription.
- [x] Add Instagram Login, long-lived token exchange, profile verification and messaging webhook subscription.
- [x] Add local channel disconnect and Instagram long-lived token refresh controls.
- [ ] Complete live Meta test-asset onboarding and permission/App Review acceptance.
- [x] Build durable inbound event processor and replay-safe conversation/message creation.
- [x] Add authenticated worker endpoint and scheduled processing workflow.
- [x] Process WhatsApp status and Instagram delivery/read receipts without status regression.
- [x] Build official WhatsApp/Instagram text-send adapters and durable outbound worker.
- [x] Add tenant-scoped idempotency keys and request fingerprints; reject key reuse with different content.
- [x] Enforce the 24-hour free-form messaging window and conservative delivery-unknown handling; never auto-retry ambiguous sends.
- [ ] Add approved template sends, media and explicit delivery reconciliation.
- [x] Build unified merchant inbox with conversation list, channel/status filters, customer history, reply composer, assignment-to-self, internal notes, priority and status controls.
- [ ] Add richer team assignment, labels, saved views and browser-level workflow acceptance.

## Milestone 7 — release hardening
- [x] Add focused unit tests for plan limits, domain validation, Daraja utilities and SMS templates.
- [x] Add dependency audit to CI.
- [ ] Complete all current CI runs and resolve failures.
- [ ] Verify latest Vercel preview after deployment quota/rate-limit clears.
- [ ] Verify production Neon role, RLS, backups and restore procedure.
- [ ] Run browser accessibility, mobile, concurrency and cross-tenant E2E.
- [ ] Configure production secrets and deploy only after provider acceptance.

## Current honest status

Core commerce workflows are implemented. Social Commerce Phases 1–5 are merged to main. Migration 0021 passed CI database roles, forced-RLS and cross-tenant worker-write verification; disposable Neon validation covered its policy and outbox schema. Phase 6 unified inbox is under CI. Production Neon and production deployment have not been changed. Real Daraja and MobiWave SMS credentials remain unverified for live testing. The platform is not yet production-ready.
