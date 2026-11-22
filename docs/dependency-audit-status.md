# Dependency audit status — 22 November 2026

## Status: resolved in the Social Commerce PR branch

The published advisory [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) / CVE-2026-112366 had no fixed `picomatch` release when this remediation began. A version bump or `npm audit fix --force` would not have resolved the advisory safely.

Instead, the vulnerable development-tool dependency paths were removed:

- Removed Vite and Vitest; the repository's 58 tests now run on Node's built-in `node:test` runner through `tsx`.
- Removed the obsolete `vitest.config.ts`.
- Removed the Jest/Vitest assertion and mock packages that introduced another `picomatch` path. The small test runtime uses Node's `assert/strict` and local mocks; all existing assertions and mock expectations remain active.
- Removed the Next.js ESLint preset and TypeScript ESLint parser/plugin because their dependency trees pulled in `fast-glob`, `micromatch` and vulnerable `picomatch`. The remaining ESLint configuration covers JavaScript/config files; TypeScript remains checked by strict `tsc --noEmit`.
- Added and committed `package-lock.json`. CI uses `npm ci` against the generated lockfile and preserves lockfile changes on same-repository PR branches.

## Latest verified CI

Workflow run [45010997653](https://github.com/malingib/Mobiwave-commerce/actions/runs/45010997653) on the PR branch completed successfully on 22 November 2026:

- Database roles and tenant-isolation verification: passed.
- Full `npm audit --audit-level=high`: passed.
- Unit tests: 58 passed, 0 failed, 0 skipped.
- TypeScript typecheck: passed.
- ESLint: passed.
- Production Next.js build: passed.

The committed lockfile contains zero `picomatch` package entries and zero `fast-glob` entries. No audit threshold was lowered, no advisory was ignored, and no `npm audit fix --force` was used.

## Scope and remaining release gates

This resolves the dependency audit blocker for this branch. It does not establish production acceptance. The following remain separate operational gates:

- Configure the application and GitHub Actions worker secrets described in [worker-deployment.md](./worker-deployment.md).
- Provision/verify the private R2 media pipeline, including quarantine and malware scanning, before enabling media downloads or outbound media.
- Complete real Meta WhatsApp/Instagram test-asset acceptance.
- Run Daraja sandbox STK, callback, duplicate/replay and reconciliation tests.
- Apply production migrations and deploy only after explicit production approval and acceptance testing.

No production database, provider credentials or production deployment were modified by this dependency remediation.
