## Context

handlebars <=4.7.9 is flagged by three advisories published 2026-10-08. It enters the root and frontend
trees only via `ts-jest` (dev). 4.7.10 is patched and satisfies both ts-jest ranges.

## Decisions

1. **Lockfile-only in-range bump, not an override.** `npm update handlebars --package-lock-only` in each of
   root and `frontend/`. An `overrides` entry is only needed when the patched version is outside the parent's
   declared range (HEL-1364 js-yaml case); here it is inside, so HEL-1319's lockfile-only approach is the
   minimal, existing pattern. Trade-off: the declared range still admits 4.7.9, so a future lockfile regeneration could in principle
   re-resolve it; the `security` audit gate would fail that immediately. Same trade-off accepted in HEL-1319.
2. **Verify the delta really changed** (HEL-1364 trap: `--package-lock-only` reporting "up to date"). The
   executor diffs every `packages` key's `version` between base and branch lockfiles; the changed set must be
   exactly `{node_modules/handlebars: 4.7.9 -> 4.7.10}` per tree (plus that entry's resolved/integrity). If it
   is not (e.g. minimist moves), stop and report rather than accept an unrelated upgrade.
3. **braces: no action.** Only root path is the HEL-1246-allowlisted `micromatch>braces`; CI does not report
   it; no patched release exists. No allowlist edit. If the executor finds braces reported on any OTHER path,
   that is an escalation (owner ruling: no self-authored allowlist entry), not a fix.
4. **helio-mcp: no change**, but its audit is re-run as evidence.

## Verification

- Red/green: each of the three CI audit commands, verbatim from ci.yml, run on base (red for root+frontend,
  green for helio-mcp) and on branch (all green).
- `npm ci` in root and frontend from the new lockfiles (scratchpad `npm_config_cache`; HUSKY=0 with
  `--ignore-scripts` only if needed, disclosed), then: root `npx jest` (full root suite), frontend `npm test`,
  helio-mcp tests (root jest covers `helio-mcp/src`), plus frontend `npm run typecheck`. Workers capped at
  3, `nice -n 19`.

## Risks

- ts-jest's use of handlebars changes behavior in 4.7.10: mitigated by the full jest suites in both trees.

## Gate-Chain Implications Checklist

Not applicable — no `.husky/**` or pre-commit-invoked script is touched.
