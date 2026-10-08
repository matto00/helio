## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed: ticket.md, proposal.md, design.md, tasks.md, specs/ci-actions-cache-budget/spec.md (uncommitted, in the
worktree at HEAD 6caba6b1).

### What I verified (with evidence)

- Spawn guard: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/actions-cache-under-limit/HEL-1299`.
- Design facts about `ci.yml`, all confirmed by reading the file:
  - "Cache sbt" `actions/cache@v6` with key `sbt-${{ hashFiles('**/build.sbt') }}` / `restore-keys: sbt-` appears in
    backend (l.183-191), security (l.287-295) and e2e (l.526-534), so PR runs can save it from up to 9 jobs.
  - Compile cache: `actions/cache/restore` (l.201-210) plus main-only, shard-0 `actions/cache/save` (l.234-241) of
    `backend/target/out` + `~/.cache/sbt`. Already never saved by PRs.
- `cd-frontend.yml` uses `setup-node cache: npm` keyed on `frontend/package-lock.json` alone. Neither CI npm key
  (3 lockfiles in frontend/security, 2 in e2e) matches it, so D3's "restore-only would always miss" holds.
  `cd-backend.yml` has no `cache` reference (grep, no hits).
- CodeQL languages (AC4): `gh api repos/matto00/helio/code-scanning/default-setup` ->
  `languages: [actions, javascript, javascript-typescript, python, typescript]`, `query_suite: default`,
  `schedule: weekly`. D6 leaves this unchanged, and the spec's AC4 scenario checks the right field.
- Baseline TSV (`.concertino/runs/HEL-1299/evidence/cache-baseline-2026-10-08.tsv`): CodeQL keys are
  `codeql-overlay-base-database-1-<hex>-<lang>-2.27.1-<sha>-<runid>-1`. D4's regex
  `^codeql-overlay-base-database-\d+-[0-9a-f]+-javascript-` matches them. backend-compile-v3 entries are
  1.80 -> 1.86 -> 1.89 -> 1.92 GB, so most of the size is the base, not the per-push growth. Live usage right now:
  10,164,747,435 B / 26 entries.
- sbt 2 CAS layout (read-only `ls`/`find`/`readlink` on the main checkout and `~/.cache/sbt`): `backend/target/out`
  holds **absolute** symlinks into `/home/matt/.cache/sbt/v2/cas/...`, for example
  `zinc/inc_compile_3.zip`, `classes.sbtdir.zip`, jars and `value/*/48.json`. The meta-build
  (`backend-build-build-build`) also lives under `backend/target/out`. The local CAS is 22 GB with 14,113 blobs; `ac`
  is 90 MB. D2's "prune to referenced blobs" premise is structurally sound.
- `gh cache delete --help` (gh 2.97.0): `--all` combined with `--ref` deletes all caches for that ref, and
  `--succeed-on-no-caches` is valid with `--all`. D5's command exists.
- The selftest convention D4/5.1 relies on is real: `scripts/*.selftest.mjs` plus `check:*:selftest` npm scripts, and
  `check-precommit-ci-parity.mjs` exists.
- `backend/build.sbt` changed on main 5 times since 2026-09-28, about once a week. Each change mints a new ~0.95 GB
  `sbt-<hash>` main entry that the janitor deliberately does not touch.

### Verdict: REFUTE

The direction is sound and well grounded: D1/D3/D4/D6 are correct against the real files, and AC4 is protected.
Three planning gaps would let the lane "pass" without proving the claims the budget depends on.

### Change Requests

1. **The D2 local proof as written can come out vacuous (design.md D2, tasks 2.1/2.2).** sbt 2's `target/out` links
   are absolute paths into `~/.cache/sbt/v2/cas` (verified above). Copying `target/out` and a CAS into a scratch dir
   and pruning the copy proves nothing, because sbt keeps resolving the links into the real, unpruned 22 GB CAS. The
   build would succeed whatever the prune removed. The plan also never says how sbt is pointed at a scratch cache,
   and it must not write under `~`. Revise D2/2.2 to do one of these:
   - (a) Name the exact mechanism (system property / env var) that relocates sbt 2's local cache, and require
     evidence that every `target/out` symlink resolves under the scratch root (`find -type l | xargs readlink`)
     before the proof counts.
   - (b) Preferred: move the proof into the PR CI run. PRs never save, so a PR-only step can safely restore main's
     entry, run the prune in **prune** mode before "Compile and test", and then run the real CI command
     (`compile; testFull`, which covers Test/compile and the meta-build). Capture the zinc "compiling N sources"
     lines and the step time against an unpruned leg.

   Whichever option is chosen, the proof must exercise the command CI actually runs, not just one touched main
   source. The HEL-1287 failure mode ("Not found: TestShards", dangling meta-build links) lives in the meta-build
   and test outputs.
2. **D5 (PR-close cleanup) has no acceptance signal anywhere.** Task 4.3 is "Add the workflow" with no verify clause.
   Task 6.3's post-merge commands cover AC1/2/4/5 only, so the spec requirement "Closed pull requests leave no caches
   behind" is never observed. This is the one step that runs a `--all` delete on a shared resource. Add:
   - (a) An in-lane static check (or selftest assertion) that the `run:` line is exactly
     `gh cache delete --all --ref "refs/pull/${PR_NUMBER}/merge" --succeed-on-no-caches`, with `PR_NUMBER` sourced
     only from `github.event.pull_request.number` via `env`, and that there is no checkout step.
   - (b) A driver post-merge command in 6.3: after this PR or the next PR closes, list
     `actions/caches?ref=refs/pull/<N>/merge` (expect 0) and show that the `refs/heads/main` entry count did not drop.
3. **No in-lane decision rule for the D2 size outcome, and the steady-state estimate omits a known term.** The
   estimate assumes a pruned compile entry of about 0.5 GB or less, but nothing says what happens if the PR
   report-only run measures, say, 1.5 GB. With KEEP=2 that is 3 GB of compile cache alone. The estimate also counts
   one `sbt-<hash>` entry (0.9 GB), but `build.sbt` changes on main about weekly (5 times since 2026-09-28), and
   superseded `sbt-*` entries are excluded from the janitor, so expect up to about 1.9 GB until the 7-day idle
   eviction. Add a gate to tasks 2.3/6.2: record the measured pruned size and a recomputed projection (compile x
   KEEP + 2 x sbt deps + CodeQL x KEEP + npm + setup-sbt). If the projection exceeds about 5 GB (1 GB headroom under
   AC1's 6 GB), return to the design gate. Candidate fixes are KEEP=1 for the compile family, or adding superseded
   main `sbt-*` entries to the janitor allowlist; these would not be a silent swap.

### Non-blocking notes

- D1: the new `actions/cache/restore` "Cache sbt" step in the backend job needs an `id`, so the save's
  `cache-hit != 'true'` condition refers to it. The restore step's `id`, not the compile-cache id, must be the one
  referenced.
- D4: give `workflow_run` a `branches: [main]` filter (a PR's CI also completes a `CI` run). Also give the janitor a
  `concurrency` group so the 6-hourly schedule and a workflow_run trigger cannot double-delete.
- D4 checks out the default branch to run `scripts/cache-janitor.mjs`. For `workflow_run`/`schedule` that is main,
  which is fine. State it explicitly so nobody adds `ref: ${{ github.event.workflow_run.head_sha }}`.
- 6.1 (AC3): the temporary `build.sbt` comment commit also changes the compile-cache key. Confirm in the listing
  that neither `sbt-*` nor `backend-compile-v3-*` appears under `refs/pull/<N>/merge`; the spec scenario already
  says this.
