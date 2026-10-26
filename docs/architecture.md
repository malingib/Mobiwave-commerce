# Architecture decisions

## Decision 001 — own the platform

MobiWave Commerce is built as MobiWave-owned software. Take App and Bumpa are market benchmarks and possible integration partners, not the platform foundation.

## Decision 002 — commerce engine

Medusa DTC Starter is the leading candidate because it provides a Next.js storefront and mature commerce primitives. Its current official requirements and workspace layout must be rechecked at bootstrap. This repository currently contains a frontend proof of direction, not a completed Medusa integration.

## Decision 003 — tenant identity

- Every merchant-owned resource must be associated with an internal tenant/store ID.
- Public storefront tenant resolution must use a validated hostname-to-store mapping.
- Authenticated dashboard requests must validate membership and role on the server.
- Never accept a tenant ID from a request body as proof of access.
- Tenant filters must be enforced in backend services/workflows and covered by negative authorization tests.

## Decision 004 — domain strategy

- Free stores use a slug under the MobiWave-controlled root domain.
- Slugs are unique, normalized and reserved words are blocked.
- Custom domains are a paid capability.
- Domain verification and activation are separate states; an unverified hostname must never route to a merchant.
- DNS wildcard, TLS, edge routing and canonical URL behaviour must be validated before launch.

## Decision 005 — payment sequence

1. Cash on delivery and manual payment instructions/order status.
2. M-Pesa STK Push initiation through server-side credentials.
3. Provider callback signature/validation, transaction lookup and idempotent payment updates.
4. Reconciliation, retries and observability.
5. Other gateways after the M-Pesa flow is tested.

The storefront must not mark an order paid based solely on a browser redirect.

## Decision 006 — messaging

MobiWave SMS is a first-party integration and usage revenue line. Message sends should be queued, deduplicated and logged against the correct tenant. Consent, sender ID, opt-out, delivery reports and failure handling must be designed before bulk or marketing messaging is enabled. WhatsApp should use official supported APIs only.

## Deployment boundaries

A Next.js storefront deployment alone does not deploy a Medusa backend, database, jobs or webhooks. Production requires a persistent Node.js backend, managed PostgreSQL, secrets, migrations, background work where required, object storage and DNS/domain routing. Deployment is not complete until all these are configured and smoke-tested.
