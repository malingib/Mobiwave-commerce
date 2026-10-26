# Implementation plan

## Milestone 0 — repository and UX shell
- [x] Initialize repository and document product decisions.
- [x] Add responsive product landing page shell.
- [ ] Install dependencies and run typecheck/build.
- [ ] Commit lockfile and CI checks.

## Milestone 1 — commerce engine bootstrap
- [ ] Bring in the official Medusa DTC Starter backend and storefront baseline, pin compatible versions, and retain upstream attribution/license.
- [ ] Configure environment templates and database migrations.
- [ ] Verify local development and production build.

## Milestone 2 — tenant/control plane
- [ ] Define tenant, store, domain, membership, plan and usage records.
- [ ] Implement validated slug reservation and store provisioning.
- [ ] Implement server-side host resolution.
- [ ] Add membership authorization and tenant isolation tests.
- [ ] Add superadmin tenant/domain/plan overview.

## Milestone 3 — merchant and shopper journey
- [ ] Merchant onboarding and product creation.
- [ ] Publish/unpublish storefront.
- [ ] Product listing/detail, cart and checkout.
- [ ] Cash-on-delivery/manual payment order flow.
- [ ] Order management and fulfilment statuses.

## Milestone 4 — local integrations
- [ ] M-Pesa STK Push, verified callbacks and idempotency.
- [ ] MobiWave SMS transactional notifications and delivery reports.
- [ ] Custom domain verification and routing.
- [ ] Email and official WhatsApp integrations where commercially and technically supported.

## Milestone 5 — hardening and launch
- [ ] Cross-tenant penetration/authorization tests.
- [ ] Accessibility, mobile and browser end-to-end checks.
- [ ] Rate limiting, audit logs, backups, monitoring and incident runbooks.
- [ ] Configure persistent backend, PostgreSQL, secrets, domain routing and TLS.
- [ ] Deploy and smoke-test the actual production flows.

## Current honest status

Only the repository documentation and landing-page shell have been committed so far. The shop registration, product/order persistence, payment, SMS, tenant controls and production deployment are not implemented yet. Do not market the current shell as a working store.
