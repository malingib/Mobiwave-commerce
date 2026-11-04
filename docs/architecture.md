# Architecture decisions

## Decision 001 — MobiWave owns the platform

MobiWave Commerce is MobiWave-owned software. Take App and Bumpa are market benchmarks, not the platform foundation.

## Decision 002 — application and persistence

The active application is a custom Next.js 15 / React 19 / TypeScript application using Better Auth and Neon PostgreSQL. A Medusa DTC Starter integration is deferred; it is not part of the current runtime. Do not describe this repository as a completed Medusa integration.

## Decision 003 — tenant identity and authorization

- Every merchant-owned resource is associated with an internal store ID.
- Authenticated dashboard requests validate membership and role server-side.
- Public storefront resolution uses a validated free-subdomain parser or an explicitly activated custom-domain registry entry.
- The application uses the restricted commerce_runtime database role with NOBYPASSRLS; the Neon owner role is migration-only.
- Callback, worker, checkout and platform-admin database capabilities use distinct transaction-local PostgreSQL settings and RLS policies.
- Tenant isolation is tested with two synthetic merchant workspaces on an isolated Neon branch. Production Neon has not been modified.

## Decision 004 — domain strategy

- Free stores use a slug under the MobiWave-controlled root domain.
- Custom domains are a paid capability and are quota-controlled by the plan catalogue.
- Ownership verification uses a unique DNS TXT record at _mobiwave-commerce.<hostname>.
- DNS ownership verification, Vercel project attachment and platform activation are separate steps. Only verified and activated domains resolve to a merchant storefront.
- Production wildcard DNS, TLS and Vercel custom-domain attachment still require operational verification.

## Decision 005 — payments

- Order and subscription M-Pesa STK Push flows use encrypted platform or merchant Daraja credentials.
- STK requests are correlated with durable payment attempts.
- Callbacks validate the configured callback token, checkout request, amount, currency, customer phone and receipt uniqueness.
- A shared receipt-claim table prevents one receipt from being applied to multiple order/subscription payments.
- Uncertain outcomes enter review_required; a verified platform administrator can reconcile against Safaricom evidence.
- Subscription activation occurs only after a verified callback or audited manual reconciliation.
- Browser redirects and STK initiation responses never mark payments paid.
- Real Safaricom sandbox/production credentials and live end-to-end tests remain outstanding.

## Decision 006 — messaging

Transactional SMS uses a tenant-scoped outbox with deduplication, worker leases, bounded retries and exponential backoff. Immediate dispatch uses Next.js after(); an authenticated worker endpoint supports scheduled retries. The MobiWave SMS endpoint and payload contract must be verified against the provider's documentation before live sending. Bulk/marketing messaging, opt-out handling, provider delivery reports and official WhatsApp integration are not enabled.

## Decision 007 — subscriptions and entitlements

The platform plan catalogue is configurable by a verified platform administrator. Paid plan prices remain unset until MobiWave approves commercial rates. Product and custom-domain quotas are enforced from plan limits; blank limits mean unlimited. Subscription payment is a manual M-Pesa STK flow with monthly renewal, not an automatic recurring mandate.

## Deployment boundaries

The Next.js app, Neon database, provider credentials, DNS/TLS and scheduled message worker are separate production dependencies. A preview deployment is not production verification. All migrations must be tested on a disposable Neon branch before production application.
