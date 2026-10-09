## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `91e12a2dc8aafaf6803a23f090ff8125da61af13` (PR #860, draft). Base resolved live via
`resolve-review-base.sh` → `2dd4ed6237817b1feef22d69f8bc8058e58541db`. Spawn-cwd guard: `READY`.
No UI changes (diff touches `.github/workflows/**`, `scripts/*`, `package.json`, change dir only;
`git diff 2dd4ed62...HEAD -- backend frontend` is empty), so the design-judgment step does not apply.

### What I verified (with evidence)

**CI state (claim: green apart from an unrelated `security` failure).** `gh pr view 860` checks: frontend,
backend 0-3, e2e 1-4, CodeQL (actions/js-ts/python) all SUCCESS; `security` and `ci-complete` FAILURE. I pulled
the `security` job logs for main run 37838151040 (2dd4ed62, job 113520405634) and PR run 37841651996 (91e12a2d,
job 113532230636). Both list the same advisory set (GHSA-7286-pgfv-vxvh, -8r5x-fm3f-whwj, -p8wg-vrv2-v86f,
-r978-9m6m-6gm6, -vfj7-8cjw-p6xm, -vx9q-rhv9-3jvg, -xw65-4hp5-5hc7, all `handlebars`), with identical counts.
Confirmed: the failure exists on main and this change did not cause it.

**Gates re-run locally (exit 0 each):** `selftest:cache-janitor`, `selftest:ci-prune-sbt-cas`,
`check:cache-cleanup-pr`, `check:cache-cleanup-pr:selftest`, `check:precommit-ci-parity`.

**Janitor selftest catches mutations.** I copied the janitor into a scratch directory and ran the selftest against five
mutants: ref filter removed, keep 2→1, sort order reversed, `sbt-` regex loosened, `-javascript-` dropped from the
CodeQL regex. All five failed with exit 1, and the unmutated copy passed with exit 0.

**Janitor first live run (irreversible path).** I ran `node scripts/cache-janitor.mjs --dry-run --repo matto00/helio`
myself at 2026-10-08T21:04Z. Its `--dry-run` path only lists caches; the DELETE is behind `if (!dryRun)`.
Result: 13 of 27 entries, 6,507,310,707 bytes. The deletions are 3 older `backend-compile-v3` entries (keeps
a7a7… 2.03 GB and be98… 1.98 GB, the newest two), 5 older CodeQL javascript and 5 older CodeQL python overlay
bases (keeps the newest two of each). Every selected entry has `ref=refs/heads/main`. Nothing outside the
allowlist is selected: the `sbt-42d9…` dependency entry (the only one, KEEP=1), npm main entries, setup-sbt
runner/diskcache, and the PR-scoped entries (`refs/pull/858`, `refs/pull/860`) all survive. The lane's
`janitor-dry-run-2026-10-08.txt` is an older snapshot (14 entries). The selection rule is deterministic, and my
fresh run matches it.

**PR-close workflow (`pull_request_target`, write token).** No checkout. The only expressions are `github.token` and
`github.event.pull_request.number`, both passed through env. The single command is
`gh cache delete --all --ref "refs/pull/${PR_NUMBER}/merge" --succeed-on-no-caches`, and permissions are only
`actions: write`. There is no injection surface. Scoping to the exact ref depends on gh honouring `--ref` with `--all`,
so I checked that:
- gh release notes show `--ref` added in v2.79.0 and `--all` + `--ref` added in v2.86.0 (cli/cli#12101).
- `pkg/cmd/cache/delete/delete.go@v2.101.0` line 134 lists caches with `GetCachesOptions{Ref: opts.Ref}` before
  deleting by id.
- The `ubuntu-24.04` runner image readme (image 20260927.320.1) ships GitHub CLI 2.101.0.

On the runner today the deletion is limited to the closed PR's ref.

**Can a main-side prune break main CI or save a bad entry?** Main prune (`ci.yml`, "Prune sbt CAS before save")
has no `continue-on-error`, and its `if:` has no status function, so it runs only after "Compile and test" succeeds.
Both save steps also have implicit `success()`. So a failed or refused prune skips both saves, and no unpruned or
half-pruned entry is saved. A failed prune does turn backend shard 0 red on main. That is a deliberate choice,
documented in a comment. The script refuses with exit 1 (and deletes nothing) when the output dir is missing or
references no CAS blob. The selftest covers this case ("refusal deletes nothing").

**Prune correctness on real CI (C1/C2).** I read the logs of run 37836314086 (ed1f679c, the temporary `backend/src`
edit), backend 0 and 3. Each leg:
- restored the fallback compile entry `be98…`
- pruned `cas total=471 kept=265 dropped=206 dangling_links=0`, `2034448 → 95960 KB`, and
  `ac total=2155 kept=2017 dropped=138`, in 9-10 s
- logged `compiling 1 Scala source ... done compiling`
- finished with `All tests passed` (1641 and 1797 tests)

So a pruned entry still compiles incrementally. The C2 timing re-run (leg 3 was +31 s / 17% on attempt 1) follows
skeptic-design-3's note to re-run on a small-margin trip. Attempt 3 deltas are all under 30 s and inside main's own
run-to-run spread, as recorded in `ci-evidence-pr860.md`.

**Acceptance criteria traced:**
- **AC1 (≤ 6 GB, ≥ 24 h after merge):** measured by the driver after merge.
  - Mechanism: compile entry S ≈ 275 MB uncompressed after prune (down from 1.9-2.0 GB), janitor KEEP=2,
    sbt deps restore-only with a single main writer.
  - My own estimate after the first janitor run, before any pruned compile save rotates in: 2.03 + 1.98 (compile)
    + 0.96 (sbt deps) + 0.33 (CodeQL) + 0.23 (npm main) + 0.06 (setup-sbt) + transient PR npm ≈ 5.6-5.8 GB.
    That is under 6 GB but tight. It falls to about 2 GB once two backend-changing main pushes have saved pruned
    entries. The merge commit itself does not change the backend key, so it gets an exact hit and saves nothing.
    That puts timing risk on AC1's measurement, not on correctness. See note 1.
- **AC2 (no `refs/tags/*` entries):** `cd-frontend.yml` no longer sets `cache: npm`. `cd-backend.yml` has no cache
  step (only checkout, gcloud auth/setup, deploy-cloudrun). `actions/setup-node@v7`'s `package-manager-cache` auto-cache
  only triggers on a `packageManager`/`devEngines` field, and neither root nor `frontend/package.json` has one (grep:
  no hits). The live listing has no `refs/tags/*` entries today. Final proof is driver-run after the next `v*` deploy.
- **AC3 (no 900 MB-class PR sbt entry):**
  - `ac3-pr860-cache-listing.txt` shows only the 51 KB setup-sbt diskcache entry on `refs/pull/860/merge` after the
    `build.sbt` commit.
  - My live listing at 21:04Z agrees (`8697461861`, 51,298 bytes).
  - Every sbt-dependency step on PRs is `actions/cache/restore`. The only `actions/cache/save` calls are main + shard 0.
- **AC4 (CodeQL coverage):** no CodeQL config changes. `gh api .../code-scanning/default-setup` reports `configured`,
  `default` suite, `weekly`, languages actions / javascript-typescript / python, the same as the baseline.
- **AC5 (CI wall-clock):** measured by the driver after merge (commands in `post-merge-measurement.md`). The in-lane
  C2 canary shows no regression outside noise.

### Verdict: CONFIRM

### Non-blocking notes
1. **AC1 timing.** If the driver measures AC1 exactly 24 h after merge and no backend-changing push has reached main,
   the two kept compile entries are still the old unpruned ~2 GB ones, and the total sits around 5.6-5.8 GB, inside
   but close to 6 GB. If it reads over, re-measure after the next backend-changing main push rather than calling
   AC1 failed. Also confirm the main shard-0 "Prune sbt CAS before save" log line and the saved entry size.
2. **First janitor run.** The janitor's `permissions:` grants only `actions: write`, so `contents` is `none` for
   its `actions/checkout`. On a public repo this is expected to work, but nothing has exercised it yet: the workflow
   only exists on main after merge. Watch the first `Cache Janitor` run. If checkout fails, add `contents: read`.
   A failure there is non-destructive: nothing gets deleted.
3. **gh version.** `cache-cleanup-pr.yml` relies on gh ≥ 2.86 for `--all --ref`. The runner ships 2.101 today. A
   one-line `gh --version` guard, or a check that fails below 2.86, would protect against a pinned or older runner.
   Optional.
4. **`cd-frontend.yml` relies on an implicit default.** It has no npm caching only because neither package.json
   declares `packageManager`. Setting `package-manager-cache: false` explicitly would stop a future `packageManager`
   field from silently bringing tag-scoped npm caches back.
5. **PR body (task 6.3).** Task 6.3 is ticked, but the PR body is still the draft placeholder. The post-merge commands
   exist only in `post-merge-measurement.md`. The orchestrator must put them into the PR body at delivery, as the
   task requires.
6. **`sbt run` main prune and sbt upgrades.** The PR canary prunes the restored (old) state, so a future sbt upgrade
   that changes the CAS symlink layout would first surface as a red main backend shard 0 (prune refuses), not on the
   upgrade PR. That failure is loud and saves nothing, which is acceptable as designed. Worth knowing when bumping sbt.

No gate defect to record: no report I drilled into rests on mtime-ordering evidence.
