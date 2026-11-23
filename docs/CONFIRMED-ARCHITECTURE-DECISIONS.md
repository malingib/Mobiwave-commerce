# MobiWave Commerce — Confirmed Architecture Decisions & Implementation Dependencies

**Status:** Approved baseline  
**Decision record:** 2026-11-23  
**Applies to:** MobiWave Commerce multi-tenant storefront platform

This document records the confirmed product and infrastructure decisions. These decisions refine, rather than replace, the existing hybrid domain architecture, the `shop.mobiwave.co.ke` merchant namespace, external merchant domain registration, shared MobiWave SMS sender, hybrid plan-plus-usage SMS billing, single-store-per-merchant model, and guided onboarding.

## 1. Confirmed decisions

| Area | Decision | Normative requirement |
|---|---|---|
| Hosting | Pilot | Keep the current Vercel Hobby project for a restricted pilot only. Do not represent Hobby as the scale-ready production hosting tier. |
| Custom domains | Both | Support apex/root domains and merchant subdomains, including `www`, `shop`, and other valid hostnames. |
| Canonical host | www | For a merchant-owned domain, canonicalize to `www.<merchant-domain>`. Redirect the apex to www after DNS and TLS readiness. |
| SMS overage | Wallet | Charge over-plan SMS usage against the merchant's Commerce wallet. |
| SMS spend control | Block | Do not submit chargeable SMS if wallet funds are insufficient or a reservation cannot be made atomically. |
| Launch approval | Hybrid | Auto-launch when all mandatory checks pass; route configured risk flags and exceptions to platform review. |

## 2. Hosting: restricted pilot on Vercel Hobby

### Policy
- Keep the existing Vercel project and current Hobby plan for internal testing and a small, explicitly allowlisted pilot.
- Pilot eligibility must be controlled by a platform setting and/or merchant allowlist, not by an undocumented manual convention.
- Set conservative pilot limits for active merchants, custom domains, traffic, background jobs, and support commitments. Make limits configurable; do not hard-code plan assumptions across the application.
- Do not onboard the general public or promise production-scale custom-domain capacity while on Hobby.
- Before public rollout, upgrade the project-owning Vercel team to an appropriate paid plan and verify current domain, usage, build, and operational limits. The upgrade is a release gate, not an automatic action.
- Keep a provider abstraction around domain attachment so hosting/routing can be migrated without changing merchant-facing domain records.

### Dependencies
1. Confirm the Vercel project is attached to the intended team/account and that billing ownership is clear.
2. Implement platform-level rollout mode: `internal`, `pilot`, `public`.
3. Add pilot allowlist and configurable quotas; deny new merchant activation when the pilot cap is reached.
4. Add operational monitoring for deployments, function duration/concurrency, domain count, build quota, and errors.
5. Document the paid-plan upgrade and capacity verification checklist as a production release gate.
6. Keep GitHub Actions for CI/CD only; use Neon Function Triggers to initiate scheduled/background Commerce workers, preserving existing worker logic wherever practical.

## 3. Domain architecture: apex and subdomain support, www canonical

### Hostname model
- Platform-owned merchant address: `<store-slug>.shop.mobiwave.co.ke`.
- Merchant-owned domain: support both `merchant.example` and `www.merchant.example`, plus other validated subdomains such as `shop.merchant.example`.
- A merchant registers a new domain with an external registrar and connects it to Commerce. Commerce does not promise registrar purchase/registration in this phase.
- One store remains associated with one merchant account. A store may have its platform subdomain and multiple custom hostnames, but exactly one canonical primary hostname at a time.
- The canonical custom hostname is `www.<registrable-domain>`. If a merchant connects only a subdomain, that hostname can be used as the canonical host when the platform's domain policy explicitly classifies it as the merchant's selected custom hostname; do not blindly prepend www to an already nested hostname.

### DNS and TLS
- For a root/apex domain, show the exact provider-required apex record(s) returned by the hosting/domain adapter. Do not invent or hard-code a universal apex target.
- For `www` and other subdomains, show the exact CNAME/validation records returned by the provider.
- Apex-to-www redirect is enabled only after both hosts are attached, ownership is verified, DNS is valid, and TLS is active for the destination and redirecting host.
- DNS instructions must account for existing records and warn before a conflicting record is replaced.
- Store the expected DNS record set and provider state per hostname. Ownership verification and provider/TLS readiness are distinct states.
- A hostname is routable only when ownership, provider attachment, DNS, TLS, store status, and conflict checks all pass.
- Domain activation and detachment must be asynchronous, idempotent, auditable operations. No unverified manual activation bypass.

### Domain data and API dependencies
Extend the existing `store_domains` model (additively) to record normalized hostname, hostname role/type, primary/canonical flags, provider and provider-domain ID, ownership status, DNS status, TLS status, routing status, verification-token hash and expiry, required DNS records, last check/error, activation and detachment timestamps. Enforce:
- unique normalized hostname globally;
- at most one primary custom hostname per store;
- no hostname shared across stores;
- expiring, hashed verification tokens (never persist or expose plaintext tokens after issuance);
- immutable domain event history for registration, verification, provider attachment, DNS/TLS changes, primary changes, suspension and detach.

Implement or complete provider-neutral domain services and endpoints for registration, verification, provisioning, status/recheck, primary selection, redirects, and detach. Vercel-specific API calls belong in a server-side adapter using server-only credentials. Never expose Vercel tokens to the browser or tenant-readable tables.

### Routing and SEO dependencies
- Resolve both `<slug>.shop.mobiwave.co.ke` and custom hostnames to the same tenant-safe storefront resolver.
- Preserve pathname, query string, encoded path segments and HTTP method where appropriate when rewriting.
- All public storefront routes (home, products, categories, cart, checkout, pages, assets where applicable) must resolve under custom domains; fix any root-only rewrite/matcher.
- Exclude internal APIs, authentication callbacks, framework assets and static files from storefront rewrites unless explicitly designed otherwise.
- Add host-header validation and ensure cache keys include the normalized hostname/store identity to prevent cross-tenant cache leakage.
- Redirect non-canonical aliases with 301 only after the canonical target is healthy. Avoid redirect loops.
- Generate canonical URLs, sitemap entries, Open Graph URLs and structured data using the canonical www host. Update robots/sitemap and absolute links accordingly.
- Test apex and www on two stores with identical product slugs to prove routing and cache isolation.

### DNS platform dependency
The current recommendation remains a delegated `shop.mobiwave.co.ke` subzone for wildcard merchant subdomains, while the root `mobiwave.co.ke` zone remains on Cloudflare. This requires a staging proof-of-concept: obtain the exact nameservers from Vercel, delegate only the subzone in Cloudflare, verify wildcard certificate issuance and test tenant routing. Never guess nameserver values. Pilot custom-domain count must remain within the actual Hobby account/project limits; confirm the live limit before enabling a merchant domain.

## 4. SMS: shared sender, wallet-funded overage, hard block

### Billing semantics
- Plan allowance remains included and is consumed first.
- Once included allowance is exhausted, each billable SMS segment requires a wallet reservation at the configured overage rate.
- Use integer minor currency units and immutable ledger entries; do not use floating-point arithmetic for balances or charges.
- Wallet balance must be reserved atomically before provider submission. Concurrent workers must not overspend the same balance.
- If available funds are insufficient, reservation fails and the message is not submitted. Mark the event as `blocked_insufficient_funds`, surface the reason to the merchant, and provide a top-up path.
- No negative wallet balance, silent credit, deferred debt, or fallback to a shared MobiWave account is permitted under this decision.
- Release a reservation on a definite pre-submission/provider rejection when the provider confirms it is not billable. Commit only according to the provider's billable/delivery contract.
- Ambiguous network outcomes must enter `delivery_unknown` / reconciliation. Do not blindly retry or charge twice.
- SMS segments, not message count, are the billing unit. Segment calculation must match the actual provider encoding/concatenation rules and be tested for GSM-7, Unicode/UCS-2, and multipart messages.

### Sender and tenant controls
- All merchant notifications use the approved shared MobiWave sender ID. Merchants cannot select arbitrary sender IDs or read provider credentials.
- Provider credentials and sender configuration remain platform-admin-only and encrypted at rest.
- Separate transactional notifications from marketing. Marketing requires consent, opt-out handling and suppression checks; transactional classification must not be used to bypass consent requirements where law/policy requires consent.
- Enforce per-merchant spend controls and usage visibility, but the confirmed insufficient-wallet behavior is block.

### Required data and services
- Create/extend an immutable `sms_usage_ledger` with store, event, billing period, segment count, included segments, overage segments, unit rate, amount in minor units, wallet reservation/transaction references, provider reference, billing state and reconciliation timestamps.
- Add atomic wallet reserve/commit/release operations, idempotency keys, unique constraints and concurrency tests.
- Maintain an auditable wallet transaction ledger and top-up/payment reconciliation. A displayed balance must be derived from ledger-consistent state.
- Outbox status and financial usage ledger are separate concepts; do not treat the message outbox as the accounting ledger.
- Implement provider delivery callbacks only against the confirmed MobiWave SMS callback/signature contract. Validate authenticity, deduplicate callbacks, prevent status regression and reconcile provider references.
- Confirm exact MobiWave SMS API submission, segment, rejection, idempotency and delivery-report contracts before enabling live sends. An Idempotency-Key header alone does not prove provider-side idempotency.

### Merchant UX dependencies
- Show included allowance, used segments, overage rate, wallet available balance, reserved amount, blocked messages and billing-period reconciliation.
- Warn before allowance exhaustion and at configurable wallet thresholds.
- When blocked, explain whether the merchant needs to top up or whether a provider/configuration issue exists. Do not display a false sent/delivered state.
- Platform admin can inspect wallet reservations, ledger entries, provider references and reconciliation outcomes without exposing secrets.

## 5. Store launch: hybrid approval

### Automated path
A store may automatically launch only when all mandatory launch checks pass:
- merchant identity/business profile and required contact details complete;
- store setup and required policy pages complete;
- catalogue contains valid purchasable items with valid prices and required inventory/stock policy;
- checkout and order creation pass server-side validation;
- at least one supported payment method is configured and verified for the store's intended operating mode;
- delivery or pickup method is configured;
- platform subdomain is reserved and storefront preview/health checks pass;
- store owner and membership permissions are valid;
- no unresolved security, fraud, policy, domain ownership or payment-risk flag exists.

Optional integrations may be warnings, not fabricated success. A custom domain is not mandatory if the platform subdomain is healthy.

### Manual review path
- Route to platform review when risk rules fire, identity/business data conflicts, domain ownership is disputed, payment configuration is exceptional, policy/content review is required, or automated checks return an indeterminate result.
- Reviewer actions: approve, request changes, reject/suspend, with reason codes, notes, actor, timestamp and audit event.
- No reviewer action may bypass tenant isolation, payment verification, domain ownership or other hard security gates.
- Review queues need assignment, SLA/age, evidence, history and re-review after material changes.

### Lifecycle and onboarding dependencies
- Store creation should produce a `draft` store, owner membership, subscription, onboarding record, provisioning job and audit event in one DB transaction. Do not create an active storefront before launch validation.
- Provisioning must be asynchronous and idempotent. Keep external provider calls outside the initial database transaction.
- Add onboarding tasks for business profile, branding, catalogue, payments, delivery, notifications, domain, preview and launch.
- Store lifecycle states should distinguish `draft`, `provisioning`, `pending_review`, `ready`, `active`, `suspended`, `rejected`, and `failed` (or map cleanly to existing states).
- A single launch validator must be shared by the merchant UI, admin review UI and server-side launch command. Client-side completion flags are never authoritative.
- Launch approval and activation must be an audited, transactional state transition with race protection.

## 6. Cross-cutting implementation dependencies

| Priority | Dependency | Required outcome |
|---|---|---|
| P0 | Schema/migration review | Additive migrations for domain lifecycle, onboarding/review, wallet ledger/reservations and SMS usage ledger; preserve current data and runtime roles. |
| P0 | Tenant security | RLS and server authorization tests for all new tables and operations; merchant cannot access another store's domains, wallet, SMS ledger or review records. |
| P0 | Wallet atomicity | Database transaction/locking or equivalent atomic primitive prevents concurrent overspend and duplicate charge. |
| P0 | SMS provider contract | Confirm live API, sender, segmentation, idempotency, rejection, callback signature and delivery-report semantics. |
| P0 | Launch validator | Server-authoritative checklist and state machine; no direct activation from client. |
| P0 | Domain provider adapter | Vercel attach/check/remove operations, idempotency, rate-limit handling, DNS instructions and TLS polling. |
| P1 | Canonical routing | Full-path custom-domain routing, apex-to-www redirects, canonical metadata, sitemap and cache isolation. |
| P1 | Pilot controls | Platform rollout mode, allowlist, quotas, monitoring and production upgrade gate. |
| P1 | Merchant/admin UX | Domain wizard, wallet/usage screen, blocked-message explanation, onboarding checklist and review console. |
| P1 | Workers | Neon Function Triggers initiate durable workers for domain checks, provisioning, SMS delivery/reconciliation and review notifications. GitHub Actions remain CI/CD only. |
| P1 | Observability | Correlation IDs, structured logs, metrics, dead-letter queues, alerting and manual recovery tools. |
| P2 | Scale readiness | Load/concurrency tests, domain-capacity verification, Vercel paid-plan upgrade, support/runbook and rollback rehearsal. |

## 7. Required acceptance tests

### Hosting/pilot
- Non-allowlisted merchant cannot activate during pilot.
- Configured merchant/domain/usage caps are enforced server-side.
- Public rollout remains blocked until hosting upgrade and capacity checklist are signed off.

### Domains
- Apex and www can both be attached and independently verified.
- Apex redirects to www only after destination and redirect host TLS are active.
- Subdomain-only merchant domains are not incorrectly rewritten to a prefixed hostname.
- Verification token expiry, wrong TXT, duplicate hostname, cross-store conflict and concurrent registration are handled.
- Product/category/cart/checkout paths work on platform subdomains and custom domains.
- Same slug on two stores cannot leak data through routing or caching.
- Suspended/detached domain cannot continue serving a tenant.

### Wallet/SMS
- Included plan allowance is consumed before overage.
- Insufficient wallet funds blocks provider submission.
- Concurrent sends cannot overspend or double-reserve.
- Duplicate event/callback cannot double-charge.
- Definite provider rejection releases reservation correctly.
- Ambiguous timeout does not trigger unsafe retry or premature charge.
- GSM-7, Unicode and multipart segment counts match provider billing.
- Shared sender is enforced and provider secrets are inaccessible to merchants.
- Marketing opt-out and suppression rules are enforced.

### Launch
- Passing mandatory checks auto-launch a clean store.
- A flagged store enters review and cannot self-activate.
- Reviewer decisions are audited and cannot bypass hard security gates.
- A material change invalidates affected checks and may require re-review.
- Two-store isolation tests cover onboarding, domains, wallet, SMS and admin review.

## 8. Rollout sequence

1. Inspect current schema, migrations, RLS, existing wallet/payment primitives, store lifecycle and worker implementation. Map this specification to existing code before adding duplicate abstractions.
2. Add additive schema changes and test them on a disposable Neon branch; verify least-privilege runtime roles and rollback/recovery.
3. Implement wallet ledger and atomic reservation before enabling wallet-funded SMS overage.
4. Confirm MobiWave SMS provider contract, then implement segment calculation, delivery state machine, callback verification and reconciliation.
5. Implement launch validator, draft-first onboarding and hybrid review workflow.
6. Implement domain provider adapter and lifecycle, then prove wildcard subzone delegation and custom-domain attach/TLS in staging.
7. Complete full-path host routing, www canonicalization, apex redirects, SEO and cache-isolation tests.
8. Enable restricted pilot allowlist and observe operational metrics.
9. Upgrade hosting and pass capacity/security/load checks before public rollout.

## 9. Explicit non-goals / guardrails

- No shared MobiWave sending account that silently absorbs merchant overage costs.
- No merchant-controlled arbitrary SMS sender ID.
- No automatic negative wallet balance or unapproved credit.
- No automatic public launch when review flags or hard checks are unresolved.
- No per-merchant Vercel project; all stores share the platform application and tenant-safe routing.
- No guessed DNS targets, nameservers, provider callback contracts or capacity limits.
- No production-scale launch on Hobby.
- No migration that drops or rewrites existing tenant data without a reviewed compatibility and rollback plan.
