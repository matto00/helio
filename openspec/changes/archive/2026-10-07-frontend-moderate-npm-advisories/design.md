## Context

See proposal.md - Why. Ground truth at base 5f3990f8e (`npm audit --json` in `frontend/`): 20 moderate, 0 high.
Exactly one advisory: GHSA-hp3w-g68c-fv3c, sprintf-js `<= 1.1.3`, CVSS 5.3, `first_patched_version: null` (latest
published is 1.1.3). Single path, all devDependencies (`npm ls --omit=dev sprintf-js` is empty):

`ts-jest@29.4.9 > @jest/transform@30.3.0 > babel-plugin-istanbul@7.0.1 > @istanbuljs/load-nyc-config@1.1.0 >`
`js-yaml@3.15.2 (overridden, HEL-287) > argparse@1.0.10 > sprintf-js@1.0.3`

### Advisory triage (AC1)

All 20 rows are the same advisory (GHSA-hp3w-g68c-fv3c). **parent** = the package that requires it (the dependent,
read from `package-lock.json` `dependencies`), NOT npm's `via` (which points the other way). **runtime/dev**: every
row is dev/build-only, grounded by `npm ls --omit=dev sprintf-js js-yaml` printing `(empty)`. **npm fixAvailable** is
the raw value from base `npm audit --json`; **real fix?** is the planner's reading of it. A `{name,version}` value is
a major/older jest or ts-jest install (ts-jest 29.1.2 / jest 25.0.0), and it cannot fix the advisory. jest@30 itself
pulls `@jest/transform > babel-plugin-istanbul > load-nyc-config > js-yaml@3`, and sprintf-js has no patched release.
A `true` value means npm expects the package to clear once its own vulnerable dependency does. It is not a standalone
bump.

| package@version | parent (dependent, lockfile `dependencies`) | runtime/dev | npm fixAvailable (run1 / run2) | real fix? |
| --- | --- | --- | --- | --- |
| `@istanbuljs/load-nyc-config@1.1.0` | babel-plugin-istanbul@7.0.1 | dev | ts-jest@29.1.2 (major) | clears once js-yaml/argparse/sprintf-js chain is gone |
| `@jest/core@30.3.0` | jest@30.3.0, jest-cli@30.3.0 | dev | jest@25.0.0 (major) | clears once js-yaml/argparse/sprintf-js chain is gone |
| `@jest/expect@30.3.0` | @jest/globals@30.3.0, jest-circus@30.3.0 | dev | true / jest@25.0.0 (major) | clears once js-yaml/argparse/sprintf-js chain is gone |
| `@jest/globals@30.3.0` | jest-runtime@30.3.0 | dev | true / jest@25.0.0 (major) | clears once js-yaml/argparse/sprintf-js chain is gone |
| `@jest/reporters@30.3.0` | @jest/core@30.3.0 | dev | true | clears once js-yaml/argparse/sprintf-js chain is gone |
| `@jest/transform@30.3.0` | @jest/core@30.3.0, @jest/reporters@30.3.0, babel-jest@30.3.0, jest-runner@30.3.0, jest-runtime@30.3.0, jest-snapshot@30.3.0 | dev | ts-jest@29.1.2 (major) | clears once js-yaml/argparse/sprintf-js chain is gone |
| `argparse@1.0.10` | js-yaml@3.15.2 | dev | ts-jest@29.1.2 (major) | override retarget removes it |
| `babel-jest@30.3.0` | jest-config@30.3.0 | dev | ts-jest@29.1.2 (major) | clears once js-yaml/argparse/sprintf-js chain is gone |
| `babel-plugin-istanbul@7.0.1` | @jest/transform@30.3.0, babel-jest@30.3.0 | dev | ts-jest@29.1.2 (major) | clears once js-yaml/argparse/sprintf-js chain is gone |
| `jest@30.3.0` | helio-frontend (direct devDep) | dev | jest@25.0.0 (major) | clears once js-yaml/argparse/sprintf-js chain is gone |
| `jest-circus@30.3.0` | jest-config@30.3.0 | dev | true | clears once js-yaml/argparse/sprintf-js chain is gone |
| `jest-cli@30.3.0` | jest@30.3.0 | dev | true | clears once js-yaml/argparse/sprintf-js chain is gone |
| `jest-config@30.3.0` | @jest/core@30.3.0, jest-cli@30.3.0 | dev | true | clears once js-yaml/argparse/sprintf-js chain is gone |
| `jest-resolve-dependencies@30.3.0` | @jest/core@30.3.0 | dev | true | clears once js-yaml/argparse/sprintf-js chain is gone |
| `jest-runner@30.3.0` | @jest/core@30.3.0, jest-config@30.3.0 | dev | true / jest@25.0.0 (major) | clears once js-yaml/argparse/sprintf-js chain is gone |
| `jest-runtime@30.3.0` | @jest/core@30.3.0, jest-circus@30.3.0, jest-runner@30.3.0 | dev | true / jest@25.0.0 (major) | clears once js-yaml/argparse/sprintf-js chain is gone |
| `jest-snapshot@30.3.0` | @jest/core@30.3.0, @jest/expect@30.3.0, jest-circus@30.3.0, jest-resolve-dependencies@30.3.0, jest-runtime@30.3.0 | dev | jest@25.0.0 (major) | clears once js-yaml/argparse/sprintf-js chain is gone |
| `js-yaml@3.15.2` | @istanbuljs/load-nyc-config@1.1.0 | dev | ts-jest@29.1.2 (major) | override retarget removes it |
| `sprintf-js@1.0.3` | argparse@1.0.10 | dev | ts-jest@29.1.2 (major) | no patch exists; removed by override |
| `ts-jest@29.4.9` | helio-frontend (direct devDep) | dev | ts-jest@29.1.2 (major) | clears once js-yaml/argparse/sprintf-js chain is gone |

Regenerated at execution from fresh base `npm audit --json` (2 runs, npm 10.9.8) plus the base lockfile. Parent = the
lockfile `dependencies` edges only; peer edges (e.g. ts-jest's peers on @jest/transform, babel-jest, jest) are excluded.
Run 1 vs run 2 disagreed on raw fixAvailable for `@jest/expect`, `@jest/globals`, `jest-runner`, `jest-runtime`
(`true` vs `jest@25.0.0 (major)`); both shown as run1 / run2. Both runs reported 20 moderate, 0 high. Every row is
dev-only: `npm ls --omit=dev sprintf-js js-yaml` prints `(empty)`.

## Goals / Non-Goals

**Goals:** frontend/ audit at 0 moderate+; CI gate at moderate; every changed lockfile entry listed.
**Non-Goals:** see proposal.md Non-goals. No direct devDependency version changes.

## Decisions

**D1 - Retarget the existing nested override to js-yaml `^4.1.1` (owner ruling Q1, 2026-10-07).** The only js-yaml in
the tree is the one under load-nyc-config, and its only use is `require('js-yaml').load(...)` in
`@istanbuljs/load-nyc-config/index.js` for a `.nycrc.yaml` (no nycrc file exists in the repo). js-yaml 4 keeps
`load()` (safe schema by default; only `safeLoad`/unsafe types were removed), and depends on argparse@2, which has no
sprintf-js. Probed delta (scratch copy, `npm install --package-lock-only`): js-yaml 3.15.2 -> 4.3.2, argparse
1.0.10 -> 2.0.1, esprima 4.0.1 removed, sprintf-js 1.0.3 removed; audit -> 0. The `^4.1.1` floor is above
js-yaml 4.1.0's prototype-pollution fix (GHSA-mh29-5h37-fv8m).
Alternatives: allowlist-only (owner rejected); global `overrides.sprintf-js` (impossible, no patched version);
override `argparse` to 2 (breaks js-yaml 3's CLI contract, still a major, less direct); jest/ts-jest downgrade (no).

**D2 - Gate at `"moderate": true` (owner ruling Q2).** Matches helio-mcp (HEL-1204). With D1 the tree is clean, so the
allowlist stays `[]`. The config comment is rewritten to state moderate and to cite HEL-1320, mirroring
helio-mcp/.audit-ci.jsonc's `"<GHSA>|<path-scope>*"` allowlist convention for future entries.

**D3 - Proof the gate actually bites (red first).** Running `npx audit-ci --config .audit-ci.jsonc` in frontend/ must
be shown red at moderate against the BASE lockfile (base package-lock with the new config) and green against the new
lockfile; and green at `high` on base (proving the old threshold was blind). Transcripts go in the PR body.

**D4 - Coverage path still works.** load-nyc-config only runs when babel-plugin-istanbul instruments, i.e. under
`jest --coverage`. Run one test file with `--coverage` (and the full `npm test`) after the change to prove the
js-yaml 4 swap does not break that code path; also exercise `require('js-yaml').load` via load-nyc-config directly
against a temporary `.nycrc.yaml` (created and removed inside the worktree) to prove the YAML branch, which the repo
never hits on its own.

**D5 - Docs/comments.** `.github/workflows/ci.yml` security-job comment, `docs/dependency-management.md` (Frontend
gate paragraph and allowlist paragraph), and `MISTAKES.md` "The security gate is unconditional on high/critical"
entry (heading + body: frontend/ joins helio-mcp at moderate), and the `helio-mcp/.audit-ci.jsonc` header comment
(lines 2-5, which call helio-mcp "stricter than the root and frontend/ configs") all state frontend/ at moderate. Comment/doc-only
edits; no workflow logic. A repo-wide grep for the old frontend threshold must come back with zero stale hits.

## Risks / Trade-offs

- [Upstream babel-plugin-istanbul may later depend on load-nyc-config 2 with its own js-yaml] -> the nested override
  key is scoped to `@istanbuljs/load-nyc-config`; npm will then simply ignore it. Note in the override's commit.
- [Moderate gate fails CI on future moderate advisories in jest's tree] -> intended; HEL-1246-style path-scoped
  allowlist with review-by date is the documented escape hatch.
- [npm `overrides` semantics: nested override must not conflict with a direct dep] -> js-yaml is not a direct dep.

## Planner Notes

- Self-approved: the triage table lives in design.md + PR body (AC1); no separate artifact file.
- Lockfile must be regenerated with the repo's own npm (`npm install` in frontend/), never hand-edited; the executor
  diffs `.packages` keys/versions before/after and lists exactly the changed entries (AC2).
