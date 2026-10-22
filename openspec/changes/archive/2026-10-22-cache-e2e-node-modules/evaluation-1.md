## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: c75be83bb5e3fda2fc6c0bad9f45fea67fcf8259. Base, resolved live: da39f0f14aee2de7dc4599ed8a0e9b3eb7e82dd9.

### Phase 1: Spec Review — PASS
Issues: none.

- AC1 (install time cut). D1-D3 are implemented as designed. `.github/actions/e2e-setup/action.yml` now:
  - restores an exact-key cache (`e2e-node-modules-v1-<os>-<arch>-node<resolved>-<hash of both lockfiles>`, no `restore-keys`);
  - skips both `npm ci` steps on a hit;
  - saves right after install, only when all of these hold: input `'true'`, a `push` event, ref `refs/heads/main`, and a restore miss.

  `ci.yml` `e2e` passes `${{ matrix.shard == 1 }}`, so only one job saves. `e2e-prod-build` (ci.yml:724) and `e2e-slow.yml:59` keep the default `"false"`, so they only restore. Per C1, the hit side of AC1 cannot be proven before merge. Task 4.3 (PR-body miss-path plan) and 5.1 (post-merge hit runs) are correctly left open for the Delivery phase and the orchestrator.
- AC2 (lane prod-build run). `scripts/e2e-backend.sh lane-start` matches D5. The `start`/`wait` branches are byte-identical in the diff; only the `*)` usage line changed. The README and `e2e-prod-build.mjs` header carry the D6 sequence verbatim. The executor's verbatim run (`lane-readme-sequence.txt`) shows:
  - lane-start healthy, with the log line `CORS allowed origins: http://localhost:7131`;
  - guard plus 2 `@prod-build` tests passed, rc=0;
  - stop-servers `STOPPED`, recorded PGID empty, both ports free;
  - start-servers READY and `assert-phase servers` PASS.
- No timeout changed: grep shows no `timeout-minutes` in the diff. No scope creep: no product code, schema or migration.
- Spec deltas match the code: the janitor family `keep: 1` and the MODIFIED cache-budget requirements.
- Standing constraints:
  - C1 is honoured: no PR-side save, and the tasks keep the post-merge evidence open.
  - C2 is honoured: the selftest copies the script and lib into a throwaway `git init` repo. I ran `selftest:e2e-backend-lane` with lane servers up, and the real worktree's `concertino-servers/backend.pid` sha256 was `09f0233b...` before and after.

### Phase 2: Code Review — FAIL
The project gates are not triggered: no `frontend/**` or `backend/**` file changed. I ran these fresh in WORKTREE_PATH, and all passed:
- `selftest:e2e-backend-lane` (13/13)
- `selftest:cache-janitor` (incl. the new node_modules case)
- `check:ci-sbt-guard` and `check:ci-sbt-guard:selftest`
- `selftest:ci-sbt`
- `check:ci-complete-needs` and `:selftest`
- `check:cache-cleanup-pr`
- `check:e2e-prod-build-projects`
- `check:precommit-ci-parity`
- `check:openspec`
- `prettier --check` on every changed yml/md/mjs/json
- `bash -n` on both shell scripts
- a Python YAML parse of `action.yml` and `ci.yml`: step order and `if:` guards as designed

I also ran a live spot check: `DEV_PORT=7131 BACKEND_PORT=10038 scripts/e2e-backend.sh lane-start` with the lane servers running. It refused with rc=1, named the record file and live pid 3975950, and left the record's sha256 unchanged.

Code quality is otherwise clean:
- no pattern kill; liveness is checked only with `kill -0`;
- the admin dir is resolved from the script's own repo root, as D5 specifies;
- the CI `start`/`wait` path is unchanged;
- the janitor regex is anchored and the near-miss key is covered.

Issues:
1. **The new selftest is wired into nothing mandatory.** `package.json:20` adds `selftest:e2e-backend-lane`, but no workflow or hook runs it: `grep -n selftest:e2e-backend .github/workflows/* .husky/*` returns zero hits. Its sibling selftests in the same domain all run in CI: `selftest:cache-janitor` and `selftest:ci-prune-sbt-cas` at `ci.yml:158-159`, and `selftest:ci-sbt` at `ci.yml:289`. `ci.yml` itself records this exact defect class several times: HEL-913 (comment at ci.yml:42-49), HEL-846 and HEL-996 — "existed as runnable npm scripts, wired only into ... nothing mandatory, so the guard never fired". The risk is concrete here. `lane-start` is exercised nowhere in CI and depends on `start`'s env contract (`BACKEND_LOG`, `BACKEND_PGIDFILE`, `BACKEND_DIR`, `$0 start`). A future edit to `start` (e.g. HEL-1339-style tuning) can break lane-start, and the only test that would catch it never runs.

### Phase 3: UI Review — N/A
No trigger path changed: none under `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**`. The spec deltas live under `openspec/changes/**`. The lane servers were left running and untouched; I made no Playwright run, as instructed.

### Overall: FAIL

### Change Requests
1. `.github/workflows/ci.yml`, after line 159 (`- run: npm run selftest:ci-prune-sbt-cas`) in the `frontend` job's HEL-1299 cache-budget block, add:
   ```yaml
         # HEL-1699: lane-start selftest (throwaway git repo, stub sbt; CI-only like the selftests above, no `.husky/**` change).
         - run: npm run selftest:e2e-backend-lane
   ```
   It needs only bash, git, python3, curl and setsid, all on ubuntu runners. Then re-run `check:ci-complete-needs`, `check:precommit-ci-parity` and `check:ci-sbt-guard` (it scans ci.yml), and add `ci.yml`'s extra line to `files-modified.md`.

### Non-blocking Suggestions
- `scripts/e2e-backend.sh` lane-start calls `"$0" start` / `exec "$0" wait`, which needs the exec bit (mode 100755 is committed, so this is fine). A `bash scripts/e2e-backend.sh lane-start` invocation from a copy without the bit would fail at `start`. Using `bash "$0"` would remove that dependency. This is minor; the README invokes it directly.
- When lane-start's `wait` fails (`die`), the backend group is deliberately left running, matching CI. Mention in the README that a failed lane-start is cleaned up with `stop-servers.sh`. The record is written before `wait`, so `stop-servers.sh` does handle it.
