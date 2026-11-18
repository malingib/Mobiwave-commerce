# Dependency audit status — 18 November 2026

The current PR head `55b1aa8a7cd2eca8e6afc253247553cae3e267d3` still fails the full CI dependency audit. The latest verified CI run is workflow run 44260247044. Database tenant-isolation checks, 58 unit tests, typecheck, lint and production build passed; the full dependency audit did not.

The audit reports 16 high-severity findings through the `picomatch` dependency chain. The reported advisory is [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) / CVE-2026-112366. The advisory states that picomatch versions through 4.0.7 are affected by a ReDoS involving single-branch repeated extglobs. Current advisory records still list no fixed release (checked 18 November 2026).

There is upstream disagreement: the picomatch maintainer's public response in the issue/PR discussion disputes classifying this behavior as a vulnerability and warns against allowing untrusted users to supply glob patterns. That disagreement does not change the published GitHub advisory or make the repository's current audit pass. The actual exploitability depends on whether attacker-controlled patterns reach vulnerable matching code in the deployed application; the present findings are on the Vite/Vitest and ESLint/TypeScript ESLint development-tool chain.

## Required handling

- Keep the full `npm audit --audit-level=high` as a required merge gate.
- Do not use `npm audit fix --force`, downgrade Vitest, add an ignore, lower the threshold, or label the audit clean based only on a production-only scan.
- Continue checking whether any patched upstream release or safe dependency-tree update is available.
- Review whether the affected packages are reachable from production runtime separately, but record that as risk analysis, not as a substitute for the full audit.
- Re-run the complete audit and all CI checks after any dependency update.

## References

- [GitHub advisory GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf)
- [OSV advisory record](https://osv.dev/vulnerability/GHSA-fc5q-39xc-vjpf)
- [Upstream picomatch issue #247](https://github.com/micromatch/picomatch/issues/247)
- [Upstream picomatch releases](https://github.com/micromatch/picomatch/releases)
- [VulnCheck advisory summary](https://www.vulncheck.com/advisories/picomatch-through-4.0.7-redos-via-single-branch-repeated-extglob-patterns)

## Preview deployment note

The latest Vercel preview comment reports the project has exceeded its deployment allowance (`api-deployments-free-per-day`) and asks to retry after 24 hours or change plan. This is a preview deployment quota failure, not evidence of a successful deployment and not evidence that the production deployment is affected. Do not claim preview or production acceptance until a deployment completes and is tested.
