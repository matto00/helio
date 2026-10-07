## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `2536334b3cad684a17433a49a58cf26feda1f4bf`. Base resolved live with `resolve-review-base.sh`: `5f3990f8ee873b3124e936875bbfb1cef2335d25` (rc 0).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/frontend-moderate-npm-advisories/hel-1320`.

### What I verified (with evidence)

All probes ran in scratch copies under the session scratchpad, made with `git show <rev>:frontend/{package.json,package-lock.json,.audit-ci.jsonc}`. They ran under `nice -n 19`. The worktree was not modified: `git status --porcelain` shows only the evaluator's untracked `evaluation-1.md`, before and after my probes.

- **Diff scope.** `git diff BASE...HEAD --stat` touches 18 files. Code and config: `frontend/package.json` (one override line, js-yaml `^3.15.2` -> `^4.1.1` under `@istanbuljs/load-nyc-config`), `frontend/package-lock.json`, and `frontend/.audit-ci.jsonc` (`"high"` -> `"moderate"`, allowlist `[]`). Comment-only or doc-only: `ci.yml`, `MISTAKES.md`, `docs/dependency-management.md` and `helio-mcp/.audit-ci.jsonc`. The rest are openspec artifacts.
- **Lockfile delta.** I read it in the raw diff. The only package changes are argparse 1.0.10 -> 2.0.1, esprima removed, js-yaml 3.15.2 -> 4.3.2 and sprintf-js removed. This matches the AC2 list in audit-proof.md and files-modified.md. js-yaml has a single entry in the lockfile (`node_modules/js-yaml`), so nothing else resolves to a different copy.
- **Lockfile is in sync with package.json.** In a scratch copy of HEAD, `npm install --package-lock-only --ignore-scripts` returned rc 0, and `cmp` against the committed lockfile says IDENTICAL. `npm ci` in CI will therefore not fail on drift.
- **Raw audit counts.** `npm audit --json` metadata in scratch: base `{"moderate":20,"high":0,"total":20}` and HEAD `{"moderate":0,"high":0,"critical":0,"total":0}`.
- **The gate bites (red first).** I used the worktree's `frontend/node_modules/.bin/audit-ci`:
  - base lockfile + new moderate config: rc=1, "Vulnerable advisories ... GHSA-hp3w-g68c-fv3c"
  - base lockfile + old high config: rc=0. The old gate was blind to these advisories.
  - HEAD lockfile + new config: rc=0, "Passed npm security audit."
- **The CI step actually reads this config.** `.github/workflows/ci.yml:411-414` "Frontend audit (frontend/)" runs `npx audit-ci --config .audit-ci.jsonc` with `working-directory: frontend`. The workflow logic is unchanged.
- **The js-yaml 4 swap is safe at runtime.**
  - The only consumer is `@istanbuljs/load-nyc-config/index.js:80`, which calls `require('js-yaml').load(...)`. That API exists in js-yaml 4. `safeLoad` is not used anywhere.
  - Probe: `loadNycConfig` against a scratch `.nycrc.yaml` (map, list and glob string) parsed to `{"all":true,"reporter":["text"],"exclude":["**/*.test.ts"]}` with resolved js-yaml 4.3.2, rc 0.
  - Instrumented path: babel-plugin-istanbul reaches load-nyc-config through `lib/load-nyc-config-sync.js`. A `jest --no-cache --coverage` run of `assistantConversationsSlice.test.ts`, with coverage written to scratch, passed 37/37 with non-zero coverage (5.26% stmts), rc 0. So instrumentation runs end to end on the new dependency. `--no-cache` matters here: without it, a cached transform could skip the plugin.
- **AC1 (triage table).** `design.md` has 20 rows. They match the base audit count of 20, all for the same advisory. Each row gives the parent as the lockfile dependent, which satisfies C1, and every row is dev-only. The dev-only claim holds: all 4 changed lockfile entries carry `"dev": true` in the diff. Raw fixAvailable is shown, and the two runs disagreed on it; the disagreement is disclosed. The ticket's "20 moderate" count matches the fresh base.
- **AC2 (non-major bumps, changed packages listed).** No direct dependency changed. The one transitive major (js-yaml 3 -> 4, via a nested override) is the owner's ruling Q1. Every changed package is listed.
- **AC3 (allowlist for unfixables).** Nothing is left unfixable (HEAD audit total is 0), so `allowlist: []` is correct. The config comment documents the path-scoped entry convention for future entries.
- **AC4 (threshold ruling).** The owner ruled Q2 = moderate (workflow-state.md, Linear comment e3992779), and it is implemented at `frontend/.audit-ci.jsonc:8`. I did not independently fetch the Linear comment body. The orchestrator's spawn brief states both rulings are settled.
- **Docs consistency.** A repo-wide `git grep` for a frontend "high" threshold claim (in `*.md`, `*.yml` and `*.jsonc`, excluding the archive and this change dir) found only the two updated, correct comments. No stale claims remain.
- **Iron Laws.** This is not a bug fix, so the debugging law does not apply. For verification, I re-ran every load-bearing check above myself and did not rely on the evaluator's narrative. I did not re-run the full frontend jest suite or lint. The evaluator pasted full-suite results (456 suites / 4807 tests, rc 0, plus lint/format/build rc 0). Those results are unambiguous, and the only runtime-relevant change (the js-yaml consumer path) is covered by my targeted probes.
- **UI (step 4).** Not applicable. There is no source, style or route change. The four changed packages are dev-only (test/coverage chain), so the production bundle cannot change and there is nothing visual to judge. I did not start servers.

### Verdict: CONFIRM

### Non-blocking notes
- The root `package.json` still overrides load-nyc-config's js-yaml to `^3.15.2`, so the root tree carries the same sprintf-js chain. That is a declared non-goal here (root stays at "high"). It is a natural follow-up if the root ever moves to moderate.
- `docs/dependency-management.md`: the "Source:" line still omits `helio-mcp/.audit-ci.jsonc` even though the paragraph above it now names all three trees. This gap predates the change.
- The argparse license changes from MIT to Python-2.0 (a permissive license, dev-only). Mentioned only in case a license allowlist is ever added.
