# Store onboarding and custom-domain lifecycle

Status: implementation branch `feat/store-launch-domain-lifecycle`
Database migration: `0031-store-launch-domain-lifecycle.sql`
Production activation: **not yet approved or deployed**

## Draft-first merchant onboarding

New stores are created with `stores.status = 'draft'`. The creation transaction also creates the owner membership, Free subscription, onboarding record and audit event. Draft stores are not exposed through the public storefront APIs.

The merchant completes the onboarding checklist at `/dashboard/{storeId}/onboarding`:

- Verify the account email with Better Auth.
- Enter a valid Kenyan business contact phone (E.164, 254-prefixed or local 07/01 format).
- Select a business category.
- Provide a meaningful business description (at least 30 characters).
- Publish at least one product.

The server-side validator is the authority; browser state is not trusted.

### Launch outcomes

| Decision | Condition | Result |
|---|---|---|
| Incomplete | Any required checklist item is missing | Store stays draft; API returns actionable missing items |
| Automatic launch | All checks pass and category is not flagged | Store becomes active and launch status is auto_approved |
| Manual review | All required checks pass but category is regulated or uncategorized | Store stays draft with pending_review status |

The initial manual-review categories are `regulated` and `other`. Extend the controlled category list and review flags deliberately; do not weaken the server validator to make the UI appear complete.

Platform administrators review the queue at `/admin/launch-reviews`. Approval activates the store and records the reviewer, time and audit event. Rejection requires a review note and returns the store to draft so the owner can correct the profile. The existing admin store PATCH route cannot bypass the launch decision.

Product creation and publishing remain available while the store is draft, so the merchant can complete the product requirement before launch.

## Custom-domain ownership and lifecycle

### Ownership proof

- Domain verification tokens are generated from 32 cryptographically random bytes.
- Only SHA-256 token hashes are persisted in `store_domains.verification_token_hash`.
- The raw TXT value is returned once on creation or explicit token rotation; it is not returned by GET.
- If the owner loses the value, they can rotate it. Rotation invalidates the previous value and resets all readiness states.
- DNS verification resolves the exact `_mobiwave-commerce.{hostname}` TXT name and compares the token hash using constant-time comparison.

### Vercel attachment and readiness

Domain activation now requires all of these states:

1. TXT ownership is verified.
2. The hostname is attached to the MobiWave Commerce Vercel project.
3. DNS resolves to Vercel (`cname.vercel-dns.com` or A record `76.76.21.21`).
4. TLS presents a valid publicly trusted certificate for the hostname.

Vercel project attachment is currently an explicit platform-operator step: add the verified hostname to the Commerce project in the correct Vercel team, then record the provider domain reference in the admin domain queue. The app does not yet hold a Vercel API token and must not pretend this provider attachment is automatic.

After recording the Vercel reference, the admin action `Check DNS + TLS` performs DNS resolution and a TLS handshake. It blocks private/reserved IP targets and only accepts a Vercel DNS target and a valid hostname certificate. The result and last error are stored and audited. Failed checks can be retried after DNS/TLS changes.

### Canonical host

- For apex domains, the corresponding `www` hostname must be verified, attached, DNS-ready and TLS-ready first.
- Activate `www.example.com` before activating `example.com`.
- The apex row stores a canonical redirect to `https://www.example.com`.
- The admin cannot select an apex hostname as primary. A ready non-apex hostname (normally `www`) can be selected as the single primary domain for the store.
- Public routing serves only active stores and domains with verified ownership, provider attachment, DNS readiness and TLS readiness. Apex requests redirect to the canonical target.

## Migration and environment safety

Migration 0031 creates the onboarding table, RLS policies and review queue index; backfills one onboarding row per existing store; hashes existing domain verification tokens; removes the plaintext token column; and adds provider, DNS, TLS and canonical-domain state.

The migration has been applied only to the isolated Neon preview branch `commerce-preview-isolated-2026-11-25`. It has **not** been applied to production main.

Preview environment variables are branch-scoped and sensitive:
- `DATABASE_URL` uses the preview branch's `commerce_runtime_app` login.
- `AUTH_DATABASE_URL` uses its separate `commerce_auth_app` login.
- `BETTER_AUTH_SECRET` is independently generated for this preview branch.

Do not copy production database credentials into Preview. Do not apply migration 0031 to production until the PR is reviewed, CI and preview runtime tests pass, and production migration approval is explicit.

## Acceptance tests before merge

- Create a draft store; verify public storefront APIs cannot expose it.
- Confirm owner-only onboarding writes and owner/manager reads.
- Verify email, phone, description and published-product checks.
- Confirm low-risk complete store auto-launches exactly once.
- Confirm regulated/other complete store enters manual review and remains private.
- Confirm admin approval activates, rejection requires a note, and all decisions are audited.
- Confirm direct admin PATCH cannot activate a store that has not passed launch approval.
- Confirm raw domain token is never stored or returned by GET; rotation invalidates old token.
- Confirm TXT verification rejects missing, wrong and stale values.
- Confirm DNS checker rejects non-Vercel targets, private IPs and invalid TLS certificates.
- Confirm activation is blocked until provider, DNS and TLS states are ready.
- Confirm apex cannot activate until its www pair is ready and apex requests redirect to www.
- Run cross-tenant RLS tests for onboarding and domain metadata.
