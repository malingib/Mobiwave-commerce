# Dependency audit status — 18 November 2026

The full CI dependency audit currently reports 16 high-severity findings through the `picomatch` dependency chain. The reported advisory is [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) / CVE-2026-112366, a ReDoS finding affecting picomatch through 4.0.7. The advisory currently lists no patched version. The published package release list currently identifies 4.0.7 as latest.

The dependency paths in the CI report are under the development-tool chain (Vite/Vitest and ESLint/TypeScript ESLint). CI now runs a production-only audit separately and continues unit tests, typecheck, lint and build after a full-audit failure, while preserving the overall failed status when the full audit fails.

This is not a waiver:
- Do not use `npm audit fix --force`; CI indicates that it would downgrade Vitest to a breaking version.
- Do not add an npm audit ignore or silently lower the audit threshold.
- Keep the full audit as a merge gate until an upstream patched release is available or a separately reviewed security decision is recorded.
- Confirm the production-only audit is clean and all code checks pass independently.
- Re-evaluate the advisory and transitive dependency tree on every dependency refresh.

Upstream references:
- https://github.com/advisories/GHSA-fc5q-39xc-vjpf
- https://github.com/micromatch/picomatch/releases
- https://github.com/micromatch/picomatch/pull/235
