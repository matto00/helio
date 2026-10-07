## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: `2536334b3cad684a17433a49a58cf26feda1f4bf`. Diff base resolved live: `5f3990f8ee873b3124e936875bbfb1cef2335d25` (`resolve-review-base.sh`).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/frontend-moderate-npm-advisories/hel-1320`.

### Phase 1: Spec Review — PASS
Issues: none

- AC1 (per-advisory triage): design.md table covers all 20 rows of GHSA-hp3w-g68c-fv3c, with package, parent, runtime/dev and raw fixAvailable. Parent is the lockfile dependent, not npm `via`, so C1 is honored. Dev-only claim: all 4 changed lockfile entries carry `"dev": true` at base, and the base `npm audit` reproduces 20 moderate / 0 high.
- AC2 (bump and list every changed lockfile package): I recomputed the `.packages` delta myself. It is exactly `argparse 1.0.10 -> 2.0.1`, `esprima 4.0.1 -> removed`, `js-yaml 3.15.2 -> 4.3.2`, `sprintf-js 1.0.3 -> removed`, and the root `""` entry is unchanged. This matches audit-proof.md and files-modified.md. The lockfile is in sync with package.json: `npm install --package-lock-only` on a scratch copy of HEAD's package.json and lockfile produced a byte-identical lockfile. No direct devDependency changed and there is no major-version churn on a direct dependency. The js-yaml 3->4 jump is a transitive nested override, as owner ruling Q1 approved.
- AC3 (allowlist for unfixable advisories): nothing is left unfixable, so the allowlist correctly stays `[]`. The spec delta's "fixable -> no allowlist entry" scenario holds.
- AC4 (threshold ruling): Q2 = moderate is recorded in workflow-state.md (Linear comment e3992779) and implemented in `frontend/.audit-ci.jsonc:8`.
- Tasks 1.1–3.4 are all checked and match the diff. Scope matches proposal Impact. The root override at `package.json:58-59` (still `^3.15.2`) was correctly left alone as a stated non-goal.
- `openspec validate frontend-moderate-npm-advisories --strict` passes: "Change ... is valid".
- Constraint C1 is honored (see above).

### Phase 2: Code Review — PASS
Issues: none

I ran every gate myself, in WORKTREE_PATH, with `nice -n 19`:
- `npm run lint`: rc=0
- `npm run format:check`: rc=0 ("All matched files use Prettier code style!")
- Tests. `npm test` chains root `jest` and frontend jest, so I ran the two halves separately to cap workers at 3:
  - root `npx jest --maxWorkers=3`: 39 suites / 376 tests passed, rc=0
  - frontend `npm test -- --maxWorkers=3`: 456 suites / 4807 tests passed, rc=0
- `npm --prefix frontend run build`: rc=0
- Backend gate: N/A (no `backend/**` changes)

The red/green audit-ci proof was re-run independently. I used scratch copies of the base and HEAD `frontend/package.json` and `package-lock.json` (taken via `git show`) and the worktree's `frontend/node_modules/.bin/audit-ci`:

| lockfile | config | rc | result |
| --- | --- | --- | --- |
| base (5f3990f8e) | new (moderate) | 1 | "Failed ... moderate vulnerabilities", GHSA-hp3w-g68c-fv3c |
| base | old (high) | 0 | passed (the old gate was blind) |
| HEAD | new (moderate) | 0 | passed |
| HEAD | old (high) | 0 | passed |

Raw `npm audit --json` counts: base is moderate 20 / total 20, HEAD is total 0. The gate bites, and it bites for the right reason.

js-yaml 4 swap, runtime check:
- I called `loadNycConfig` directly against a scratch-dir `.nycrc.yaml` (outside the worktree). It parsed to `{"all":true,"reporter":["text"]}` with js-yaml 4.3.2.
- I ran a coverage-instrumented jest run (`--coverage`, `collectCoverageFrom=src/**/*Slice.ts`, assistantConversationsSlice.test.ts). 37 passed, non-zero coverage was collected, rc=0. babel-plugin-istanbul invokes load-nyc-config through `load-nyc-config-sync.js`, so the swapped dependency sits on this path.

Docs and comments:
- The ci.yml, MISTAKES.md, docs/dependency-management.md and helio-mcp/.audit-ci.jsonc edits are comment/doc-only.
- A repo-wide grep (excluding archive and this change dir) finds no stale claim that frontend/ runs at `"high"`.

Stash check: `git stash list` is empty and `git status --porcelain` is clean. The executor's stash is unreachable commit `65ab348d2` (WIP, 11:27:44). `git diff 65ab348d2 HEAD -- . ':!openspec'` is empty, so every stashed change landed in the commit. The stash has no untracked-files parent (`^3`), so the untracked openspec artifacts were never stashed. Nothing was lost and nothing is left stashed.

The worktree's `frontend/node_modules` is a real directory, not a symlink. The main checkout still has js-yaml 3.15.2, so the executor's `npm install` did not corrupt it.

### Phase 3: UI Review — N/A
Reason: a `frontend/**` trigger matches only on `frontend/package.json`, `frontend/package-lock.json` and `frontend/.audit-ci.jsonc`. These are dependency/CI-config files with no source, style, schema or route change. All 4 changed lockfile packages are `"dev": true` (test/coverage chain only), so the production bundle cannot change. The build was re-run and passes. Nothing is observable in the browser, so dev servers were not started.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- The root tree has the same sprintf-js chain. Root `package.json:58-59` keeps the `@istanbuljs/load-nyc-config > js-yaml ^3.15.2` override, and root `npm audit` reports moderate findings (plus high ones covered by the HEL-1246 braces allowlist). This is a non-goal here, but it is a natural follow-up ticket if the root ever moves to moderate.
- `docs/dependency-management.md:108-109`: the "Source:" line lists `.audit-ci.jsonc` and `frontend/.audit-ci.jsonc` but not `helio-mcp/.audit-ci.jsonc`, even though the paragraph above now names all three. This was already missing at base.
- `MISTAKES.md:230-233` has a short wrapped line ("vulnerable lockfile). The"). Cosmetic only; prettier accepts it.
