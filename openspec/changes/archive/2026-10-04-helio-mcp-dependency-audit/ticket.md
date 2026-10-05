# HEL-1204: helio-mcp: bump 8 moderate runtime deps (hono, ip-address, fast-uri) and add its lockfile to CI's security audit

## Description

origin_kind: followup
origin_ticket: HEL-1202

### Why

GitHub reported 8 moderate Dependabot alerts when v0.8.6 was pushed (2026-09-30). All 8 are in
`helio-mcp/package-lock.json`, runtime scope, and CI never sees them. The `security` job's `audit-ci` covers only
the root and `frontend/` lockfiles (`.github/workflows/ci.yml` ~l.270-275; see the HEL-1202 fix). helio-mcp's
dependency tree is never audited in CI.

| Alert | Package | Advisory | Fixed in | Summary |
| -- | -- | -- | -- | -- |
| 122 | fast-uri | GHSA-hrr3-gc8f-f4qj | 3.1.8 | host case normalization via percent-encoded octets |
| 121 | ip-address | GHSA-j6r3-76f7-8jcv | 10.7.1 | isInSubnet compares across address families |
| 120 | ip-address | GHSA-h3mg-xc3c-68pw | 10.7.1 | unbounded Address6 parse diagnostic (DoS) |
| 119 | ip-address | GHSA-rpw4-54j3-4h4q | 10.5.1 | isLinkLocal uses fe80::/64 not /10 (SSRF bypass) |
| 118 | ip-address | GHSA-2vr4-cq9g-pvrc | 10.5.1 | NAT64 local-use range not classified (SSRF bypass) |
| 117 | hono | GHSA-gqvv-2mrq-wpjv | 4.13.5 | toSSG path traversal (incomplete CVE-2026-39408 fix) |
| 116 | hono | GHSA-g6gw-c38x-mqfc | 4.13.5 | parseBody dot-notation nesting memory exhaustion |
| 115 | hono | GHSA-crvj-82cr-hjcx | 4.13.5 | query parser reads params after the URL fragment |

### Scope

1. Bump the helio-mcp lockfile so all 8 are patched (lockfile-only if the semver ranges allow; any `package.json`
   change must be justified). Note which parent pulls in `hono` and `ip-address` (likely the MCP SDK / HTTP
   transport) and whether helio-mcp actually reaches the vulnerable paths. Record reachability, but patch regardless.
2. Add `helio-mcp/` to the CI `security` job: an `audit-ci` step with its own `.audit-ci.jsonc` mirroring the root
   and `frontend/` setup, so the next advisory there fails CI instead of surfacing only as a Dependabot banner.

## Acceptance Criteria

- Red-first: the new CI audit step fails on the current lockfile (or `npm audit` in `helio-mcp/` shows these
  advisories), then passes after the bump.
- Dependabot shows 0 open alerts for `helio-mcp/package-lock.json` after merge.
- helio-mcp tests pass unchanged.

## Driver additions (2026-10-04)

- Verify against a fresh `npm audit` in helio-mcp; count/packages may have changed since filing. (Live at Setup:
  9 advisories in 3 packages — the 8 above plus hono GHSA-hxh3-vqpv-xpqv, hono/jsx XSS; hono range now <=4.13.6.)
- Every advisory gets a real patched version where one exists. Allowlist only when no patch exists, using the
  HEL-1246 `.audit-ci.jsonc` pattern (path-scoped, ticket, reason, review-by date), each entry justified.
- Prove the gate is real: temporarily reintroduce a vulnerable version, observe red, revert.
- Run helio-mcp's full test suite, and its smoke test against a running backend (`npm run verify`).
