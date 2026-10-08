## Context

See proposal.md - Why. Ground truth at base 8364b3cee (root `npm audit --json`, npm 10.9.8): 5 moderate, 27 high.
All 5 moderate entries are one chain, all devDependencies:

`jest > @jest/core > @jest/transform > babel-plugin-istanbul@7.0.1 > @istanbuljs/load-nyc-config@1.1.0 >`
`js-yaml@3.15.2 (nested, overridden) > argparse@1.0.10 (nested) > sprintf-js@1.0.3`

(moderate entries: @istanbuljs/load-nyc-config, babel-plugin-istanbul, js-yaml, argparse, sprintf-js). All 27 high
entries trace to GHSA-vfj7-8cjw-p6xm (braces via micromatch), already path-allowlisted by HEL-1246
(`GHSA-vfj7-8cjw-p6xm|*micromatch>braces*`). The root tree also has a separate `@eslint/eslintrc > js-yaml ^4.3.2`
override (top-level `node_modules/js-yaml@4.3.2`), untouched here.

HEL-1320 (67c8ab224, archived change `2026-10-07-frontend-moderate-npm-advisories`) made the identical fix in
frontend/; its D1 analysis of js-yaml 4 vs load-nyc-config applies unchanged: load-nyc-config's only js-yaml use is
`require('js-yaml').load(...)` for a `.nycrc.yaml`/`.nycrc.yml` (none exists in the repo); js-yaml 4 keeps `load()`.

## Goals / Non-Goals

**Goals:** root audit at 0 moderate; root CI gate at moderate (owner ruling); every changed lockfile entry listed;
root tooling (jest incl. coverage path, lint, typecheck) still works; no stale "root at high" claim left in the repo.
**Non-Goals:** see proposal.md Non-goals.

## Decisions

**D1 - Retarget the root nested override to js-yaml `^4.1.1`.** Same value as frontend/ (HEL-1320 D1, owner ruling
Q1 there). Alternatives (allowlist, `overrides.sprintf-js`, argparse override, jest downgrade) were rejected in
HEL-1320 for the same tree shape and are not reopened.

**D2 - Root `.audit-ci.jsonc` to `"moderate": true` (owner ruling, 2026-10-08, recorded on HEL-1364).** Reason:
consistency across the three npm trees, and with D1 the root has 0 moderate, so the HEL-1246 braces entry (a high
advisory) is the only allowlist entry needed. audit-ci allowlist entries apply at every threshold, so that entry
keeps covering braces. The header comment is rewritten to say moderate, cite HEL-1364, and keep the
`"<GHSA>|<path-scope>*"` convention; the braces entry and its comment are kept byte-for-byte.

**D3 - Lockfile regeneration trap (probe-confirmed).** In a scratch copy, editing only the override and running
`npm install --package-lock-only` printed "up to date" and left js-yaml 3.15.2 in the lockfile (5 moderate remained).
Only after removing the two stale nested lockfile entries
(`node_modules/@istanbuljs/load-nyc-config/node_modules/js-yaml` and `.../node_modules/argparse`) did npm re-resolve,
giving exactly: removed nested js-yaml 3.15.2, nested argparse 1.0.10, `node_modules/esprima` 4.0.1,
`node_modules/sprintf-js` 1.0.3; nothing added, nothing else changed. The executor MUST therefore (a) regenerate the
lockfile with the repo's npm (never hand-edit versions; deleting the two stale entries before re-running npm is
allowed and must be disclosed), and (b) prove the delta by diffing `.packages` key+version before/after, which must
equal exactly those 4 removals. "npm install exited 0" is not evidence.

**D4 - Red-first proof that the gate bites.** With root `npx audit-ci --config .audit-ci.jsonc`:
base lockfile + old config (high) -> exit 0 (the old gate was blind); base lockfile + new config (moderate) -> non-zero,
naming GHSA-hp3w-g68c-fv3c; new lockfile + new config -> exit 0. Transcripts kept in `audit-proof.md` in the change dir
and summarised in the PR body.

**D5 - Root tooling still works.** Under jest, load-nyc-config is NOT reached (skeptic-design-1, verified):
`@jest/transform` passes explicit options to babel-plugin-istanbul, whose `findConfig` returns before calling
`loadNycConfig`; and load-nyc-config `require`s js-yaml lazily only for a `.yaml`/`.yml` config. So the only real proof
of the changed package is calling `require('@istanbuljs/load-nyc-config').loadNycConfig({cwd: <dir>})` (named export,
inside an async IIFE) against a temporary `.nycrc.yaml` plus a `{}` `package.json` (load-nyc-config resets cwd to the
nearest package.json) in a scratch dir outside the worktree, run from the worktree root, printing the parsed value and the resolved js-yaml path + version
(must be 4.x and under the worktree's own `node_modules`), then deleting the temp files. Root `npx jest`, one file with
`--coverage`, `npm run lint` and `npm run typecheck` are run as general tooling regression checks only. The worktree is
nested inside the main checkout, so all of this requires the worktree's own `node_modules` (`npm ci` first); otherwise
Node walks up and resolves the main checkout's js-yaml 3.

**D6 - Docs/comments.** `.github/workflows/ci.yml` security-job comment (lines ~263-267, comment only),
`docs/dependency-management.md` (Frontend gate paragraph ~102-106), `MISTAKES.md` security-gate entry (heading and
body ~228-240: all three npm trees at moderate; root allowlist keeps HEL-1246; reword the "separate override floor
for each" js-yaml 3.x/4.x sentence as history, since no tree overrides to 3.x any more), `helio-mcp/.audit-ci.jsonc` header
(lines 2-5 call it "stricter than the root config (`"high": true`...)" - reword so it no longer claims root is high).
Verification: `git grep -n -E '"high": true|at "high"|root.{0,40}high'` outside `openspec/changes/` and lockfiles
returns no stale root-threshold claim.

## Risks / Trade-offs

- [Future moderate advisory in the root tree turns every PR red] -> intended; HEL-1246-style path-scoped allowlist
  with review-by date is the escape hatch.
- [Concurrent HEL-1361 PR #822 edits root package.json `scripts`] -> different block; at most a trivial textual merge.
- [Nested override silently ignored if load-nyc-config later drops js-yaml 3] -> harmless, same as frontend/.

## Planner Notes

- Self-approved: the advisory list in Context replaces a per-row triage table (5 rows, one chain; HEL-1320 has the
  full table for the identical chain). No `specs/` delta for the frontend/helio-mcp specs (unchanged behaviour).
- Owner ruling D2 recorded as a Linear comment on HEL-1364.
