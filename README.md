# MobiWave Commerce

MobiWave Commerce is a multi-tenant commerce SaaS for Kenyan merchants. It gives merchants a useful free storefront and a path to paid domains, advanced workflows, and MobiWave messaging.

## Product decisions

- Build and own the MobiWave platform; Take App is a competitor/benchmark, not the foundation.
- Core storefront and essential order management remain useful on the free plan.
- Free stores use a MobiWave subdomain; custom domains are a paid upgrade.
- Kenyan shilling pricing and mobile-first seller onboarding.
- Cash on delivery/manual payment first; verified M-Pesa STK Push follows as a separate integration milestone.
- MobiWave SMS is a first-party notification channel. WhatsApp/email require supported official integrations.
- Shared infrastructure, explicit tenant scoping, and tests preventing cross-tenant access.
- No per-merchant servers/containers and no percentage-of-sales fee in the initial release.

## Architecture direction

Medusa DTC Starter is the leading commerce engine candidate for the product catalogue, cart, checkout and order lifecycle. It is not itself a complete multi-tenant SaaS; the tenant/domain/provisioning layer must be designed and tested by MobiWave.

Expected application areas:

- `apps/backend`: Medusa commerce backend and MobiWave extensions.
- `apps/storefront`: Next.js customer storefront.
- `apps/control-plane`: tenant onboarding, store/domain provisioning and MobiWave superadmin (to be implemented after the engine is bootstrapped).
- `docs`: architecture decisions, security model, deployment and runbooks.

## First milestone

1. Merchant creates a store with a unique, validated slug.
2. The platform provisions an isolated store context and a subdomain.
3. Merchant creates and publishes a product.
4. A customer can submit an order using cash on delivery/manual payment.
5. Automated tests prove tenant A cannot read or mutate tenant B's data.

## Development status

Repository initialized. The Medusa DTC Starter integration, tenant module, storefront branding, test suite and deployment are not yet complete. Do not treat this repository as production-ready until build, integration, isolation and deployment checks pass.

## Prerequisites for the Medusa starter

See the [official Medusa DTC Starter](https://github.com/medusajs/dtc-starter) for its current Node.js, PostgreSQL and pnpm requirements. Pin compatible dependency versions and commit a lockfile during bootstrap.

## Security principles

- Resolve tenant identity server-side from a verified hostname/store mapping or authenticated membership, never from a client-supplied tenant ID alone.
- Enforce tenant ownership in backend workflows and database queries.
- Keep secrets server-side; never commit credentials or real environment files.
- Use idempotency and verified provider callbacks for payment state changes.
- Test authorization failures as first-class cases.
