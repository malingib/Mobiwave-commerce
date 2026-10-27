# MobiWave Commerce

MobiWave Commerce is MobiWave-owned commerce SaaS for Kenyan merchants. The initial MVP uses Next.js, PostgreSQL/Neon and Better Auth. Take App and Bumpa are market benchmarks, not the platform foundation.

## Current implementation

- Email/password sign-up and sign-in using Better Auth, with a minimum 12-character password.
- Merchant store creation with unique normalized subdomain slugs.
- Tenant-aware PostgreSQL tables and row-level security for stores, products, orders, order items, payments, subscriptions, messaging events and audit events.
- Dedicated `commerce_runtime` role with `NOBYPASSRLS`; the application connection must set this role at connection startup. Never use the Neon owner connection string in the app.
- Product creation, draft/active/archived status and publish/unpublish controls.
- Public product storefront at `/shop/{slug}`.
- Customer checkout with server-calculated totals, cash-on-delivery/manual payment selection, transactional order creation and stock decrement for tracked inventory.
- Merchant order list and validated order-status transitions.
- Superadmin overview with store suspension/reactivation, plan assignment and audited admin changes; access is controlled by the `SUPERADMIN_EMAILS` allowlist.
- Hostname routing for free store subdomains (`{slug}.shop.mobiwave.co.ke`) when wildcard DNS and the Vercel domain are verified.
- Audit events for store/product/order status actions.
- GitHub Actions CI for unit tests, typecheck, lint and production build.

## Environment

The production `DATABASE_URL` must connect through the Neon `commerce_app` login and set `options=-c%20role%3Dcommerce_runtime`. Set `SUPERADMIN_EMAILS` to the comma-separated email address(es) allowed to access `/admin`. This switches each connection into the non-login, non-BYPASSRLS runtime role. See `db/roles/commerce-runtime.sql`. The Neon owner role is reserved for migrations and administration.

Copy `.env.example` to `.env.local` and configure:

- `DATABASE_URL`: the Neon PostgreSQL connection string for the Commerce project.
- `BETTER_AUTH_SECRET`: a cryptographically random secret of at least 32 characters.
- `BETTER_AUTH_URL`: canonical app URL.
- `NEXT_PUBLIC_APP_URL`: canonical app URL.

Do not commit `.env.local` or put secrets in `NEXT_PUBLIC_*` variables. Authentication and data APIs intentionally fail closed if the required database/auth secrets are absent.

## Development

```bash
npm install
npm run dev
```

Then visit `/signup` to create an account, `/dashboard` to create a store, add products, publish them, and use `/shop/{slug}` to test the public checkout. Store order management is available at `/dashboard/{storeId}/orders`.

## Architecture and launch boundaries

- Store membership is checked server-side; client-supplied store IDs never prove access.
- Public catalog policies expose only active stores and active products and are restricted to requests without an authenticated tenant context.
- Checkout totals are derived from database product prices. Browser redirects do not mark orders paid.
- Merchant-triggered M-Pesa STK Push initiation and callback validation are implemented behind server-side environment variables, but have not been tested against Safaricom sandbox/production credentials. Pesapal/Paystack, SMS delivery, WhatsApp, email notifications, custom domain activation, automated subscription billing, customer notifications and custom-domain activation are not enabled yet. Superadmin store/plan controls exist, but paid plan collection is still manual.
- The free store subdomain DNS/TLS wildcard and production domain routing still need to be configured and tested.
- The repository currently contains a custom MVP foundation rather than a full Medusa DTC Starter integration. Medusa remains a candidate if/when the engine's operational value outweighs the cost of merging it with the current model.

## Production checklist

Before a public launch: configure production secrets in Vercel, deploy the connected project, verify DB connectivity/auth/session cookies, test store isolation with two independent users, run a complete checkout and inventory-concurrency test, verify status transitions, add rate limits and abuse controls, set up backup/restore and monitoring, and configure wildcard DNS/TLS. Do not accept real online payments until provider callback verification and reconciliation are implemented.
