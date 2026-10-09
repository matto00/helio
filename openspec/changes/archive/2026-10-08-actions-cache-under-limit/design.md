## Context

See proposal.md (Why) and ticket.md (re-measured baseline, 2026-10-08: 11.66 GB / 25 entries). Facts this design is
built on (all re-checked on main 6caba6b1):

- `ci.yml` backend job (4 shards): `actions/cache@v6` "Cache sbt" (`~/.sbt`, `~/.ivy2/cache`, `~/.cache/coursier`,
  key `sbt-${hashFiles('**/build.sbt')}`, `restore-keys: sbt-`) — restore AND save on every job/ref. The same step is
  duplicated in the `security` job and the 4 `e2e` legs. So any PR that changes `build.sbt` mints a PR-scoped 911 MB
  entry (up to 9 racing writers).
- Backend compile cache (HEL-1287 D7): `actions/cache/restore` + a main-only, shard-0 `actions/cache/save` of
  `backend/target/out` + `~/.cache/sbt`. Already never saved by PRs. The growth source: `~/.cache/sbt/v2/cas` is sbt
  2's content-addressed store; every main run restores the previous entry, adds that build's blobs, and saves the
  union. Measured: 1,720 -> 1,778 -> 1,806 -> 1,834 MB over four consecutive pushes today (a dev machine's local
  CAS is 22 GB). Old entries are never restored again (restore-keys picks the newest) but stay until eviction.
- CodeQL default setup (`actions`, `javascript-typescript`, `python`) writes one `codeql-overlay-base-database-*`
  entry per language per `main` push (~153 MB JS, ~4.4 MB Python). Default setup exposes no cache knob.
- `cd-frontend.yml` (`push: tags: v*` + `workflow_dispatch`) uses `setup-node cache: npm` -> writes a tag-scoped
  entry no other run can restore. `cd-backend.yml` uses no cache.

## Goals / Non-Goals

**Goals:** steady state well under 6 GB (estimate below); no PR-, tag-scoped or superseded entries survive beyond a
janitor/close cycle; compile + dependency cache hits preserved on `main` and PRs (AC5).

**Non-Goals:** CodeQL configuration changes; altering cache *keys* in ways that reset HEL-1287's hit rate;
sharding/timeouts.

## Decisions

**D1 — sbt dependency cache: restore everywhere, save once on main.** Replace each "Cache sbt" `actions/cache` with
`actions/cache/restore` (same paths/key/restore-keys; the backend one gets an `id` the save's `cache-hit` check reads). Add one `actions/cache/save` in backend shard 0, gated
`push && refs/heads/main && cache-hit != 'true'`, placed after compile/test so coursier holds the full resolution.
Same key expression, so existing hits continue. Alternative (keep save on PRs + rely on close-cleanup) rejected: a
911 MB PR entry still pushes the repo over limit while open, evicting main's entries. Path trimming: the executor
measures the restored entry's composition in a PR CI step (`du -sh` per path) and drops a path only if it is provably
unused by sbt 2 (e.g. empty `~/.ivy2/cache`); no trim on guesswork.

**D2 — prune the compile cache to what the current output references.** New `scripts/ci-prune-sbt-cas.sh`
(modes `report` | `prune`): resolve every symlink under `backend/target/out` (absolute links into
`~/.cache/sbt/v2/cas`, verified by `readlink`), delete CAS blobs no link references; in `~/.cache/sbt/v2/ac` (sbt's task action cache, JSON entries naming output
blobs as `sha256-...`) keep an entry only if every blob it names survives and drop the rest (so task-cache hits for the
current outputs are preserved and no entry dangles); never touch `v2/proc`, coursier or ivy paths; print before/after
sizes and its own run time. Wiring: on **main** shard 0 it runs `prune`
after compile/test, immediately before "Save backend compile output". On **every PR run** it runs `prune` right after
"Restore backend compile output" and *before* `compile; testFull` — so each PR's real CI build (compile, build
definition incl. `project/TestShards.scala`, test compile, testFull) runs from exactly the content a pruned main entry
would hold. That is the proof (C1): green PR legs, each leg's "Compile and test" step time compared with the same steps of the
base `main` run the PR was cut from (unpruned restore), and — via a temporary, reverted commit that adds a one-line
comment to one `backend/src` file (and to `backend/build.sbt`, doubling as the AC3 demo) — a log showing a small
"compiling N" count, i.e. incremental compile from a pruned entry on a real changed source. PRs never save, so this is safe and stays as a
permanent canary. No local experiment: sbt's links are absolute into `~/.cache`, so a scratch-copy prune proves
nothing and a real prune would write under `~`.
Decision rule (C2): the executor records the measured pruned size from the PR log and recomputes the steady-state
projection below; if it exceeds 5 GB, the PR legs fail or recompile everything, or any backend leg's "Compile and test" step is more
than 10% (and more than 30 s) slower than the base main run's same leg, the lane returns to the design gate
with the numbers (options: KEEP=1 for compile, or a weekly epoch in the compile key — bounded growth, one cold compile
per week). No silent swap.

**D3 — tag deploys write no cache.** In `cd-frontend.yml`, remove `cache: npm` from `setup-node` (tag runs could only
ever restore an entry keyed on `frontend/package-lock.json` alone, which no `main` run writes, so restore-only would
always miss — removing it costs nothing a tag run currently gets from it except its own unrestorable save). Measure
the `npm ci` step time on the last three tag runs as the baseline the change is compared against.

**D4 — cache janitor (new `.github/workflows/cache-janitor.yml`).** Triggers: `workflow_run` of `CI` completed on
`main`, `schedule` (every 6 h, catches CodeQL pushes, whose dynamic workflow cannot be a reliable `workflow_run`
source), `workflow_dispatch` with `dry_run` (default true for dispatch). `permissions: actions: write` only, no
checkout of PR code. Logic in `scripts/cache-janitor.mjs` (node built-ins + `gh api`, paginated): list caches, keep
only `ref == refs/heads/main`, group by an explicit allowlist of family regexes —
`^backend-compile-v3-Linux-`, `^codeql-overlay-base-database-\d+-[0-9a-f]+-javascript-`, `...-python-`,
`...-actions-` (KEEP=2, headroom for an in-flight run that restored the previous one) and the sbt dependency cache
`^sbt-[0-9a-f]{64}$` (KEEP=1: content-keyed, superseded the moment `build.sbt` changes on main, 5 times since
2026-09-28) — sort each group by `created_at` desc, keep the newest KEEP, delete the rest **by cache id**, logging `key ref size_in_bytes`. Unknown families, other
refs (PR/tag) and npm/setup-sbt entries are never touched. `workflow_run` is filtered `branches: [main]`; a
`concurrency` group serialises janitor runs; its checkout is of the default branch only (never PR code). A selftest (`scripts/cache-janitor.selftest.mjs`) feeds a fixture listing and asserts the exact deletion set,
including the non-allowlisted and non-main entries surviving; it is wired into CI's frontend job like the other
selftests and must be shown red against a mutated selector. First live run deletes today's superseded entries —
announced to the driver before merge (see Migration).

**D5 — PR-close cleanup (new `.github/workflows/cache-cleanup-pr.yml`).** `on: pull_request_target: types: [closed]`
(write token even for Dependabot/fork PRs, base-branch workflow code; no checkout, no PR-controlled string in any
`run:` — only the integer PR number via `env`). One step:
`gh cache delete --all --ref "refs/pull/${PR_NUMBER}/merge" --succeed-on-no-caches -R "$GITHUB_REPOSITORY"`.
Exact ref only (driver constraint). `permissions: actions: write`. Acceptance: an in-lane static check (selftest
asserting the workflow text: the exact `--ref "refs/pull/${PR_NUMBER}/merge"`, `PR_NUMBER` set only from
`github.event.pull_request.number` via `env`, no `actions/checkout`, no other `gh cache delete`) and a driver
post-merge check (the next closed PR's ref has 0 entries; main's entry count did not drop because of it).

**D6 — CodeQL left on default setup (AC4).** No change to languages/suite/schedule; switching to advanced setup was
considered and rejected: it is not needed once D4 bounds overlay-base retention, and it would move coverage
ownership into a file. Deleting a superseded overlay base only forces a later run to rebuild a base — never fewer
languages.

## Steady-state estimate (to be verified post-merge, AC1)

compile 2 x S (S = pruned size measured in PR CI by D2; projection recomputed per C2) + sbt deps 0.9 GB (KEEP=1) + CodeQL 2 x 0.16 GB + npm main
keys ~0.3 GB + setup-sbt 0.05 GB + transient PR npm entries (deleted on close) ~= 1.6 GB + 2S, vs 6 GB target (C2 threshold 5 GB, i.e. S <= ~1.7 GB).

## Risks / Trade-offs

- [Pruned CAS breaks or slows compile] -> prune-before-compile on every PR run (C1) with timing + incremental
  evidence; C2 thresholds send it back to the design gate (KEEP=1 / weekly epoch) rather than a silent swap.
- [Janitor deletes a needed entry] -> allowlist + main-only + keep 2 + selftest with mutation red + dry-run dispatch.
- [`pull_request_target` misuse] -> no checkout, no untrusted interpolation, single exact-ref delete.
- [`build.sbt` PRs lose a warm dependency cache] -> they restore main's nearest `sbt-` entry and download only the
  delta (same as today's first PR run).

## Migration Plan

Before merge: tell the driver the janitor's first run will delete superseded `backend-compile-v3` / CodeQL entries
(listed by a dry run in the PR evidence). Rollback: revert the PR; deleted entries are regenerated by the next main
push. Post-merge measurement commands (driver-run), recorded in tasks.md section 6.

## Planner Notes

- Self-approved: KEEP=2; 6-hourly schedule; janitor in node (repo convention: `scripts/*.mjs` + `.selftest.mjs`).
- AC3 is demonstrated on this change's own PR by a temporary `backend/build.sbt` comment commit (reverted before
  merge), with the `refs/pull/<N>/merge` cache listing captured.

## Execution Notes (cycle 1)

- **ac/CAS name forms (skeptic-design-3 note 1):** an `ac` entry names a blob as `...>sha256-<hex>/<size>`; the CAS
  file is `sha256-<hex>-<size>`. `scripts/ci-prune-sbt-cas.sh` normalises `/` to `-`; its selftest includes a
  wrong-size reference and shows red when the normalisation is removed (3 checks fail). The prune log reports
  `ac: total= kept= dropped=` and `cas: total= kept= dropped=`.
- **Task 3.1 baseline (`npm ci`, CD Frontend tag runs, `gh run view`):** v0.8.9 (37254527399) 13 s, v0.8.8 (37161310961)
  12 s, v0.8.7 (37060475819) 13 s; the post-job npm cache save (the tag-scoped write) added 3-4 s.
- **Task 1.3:** report-only `du -sh` step added for PR shard 0 (`Report sbt cache composition`); composition of the
  restored paths is to be recorded from the PR CI log (cycle 2). No path is trimmed on guesswork.
- **Task 4.1 dry run:** `janitor-dry-run-2026-10-08.txt` (GET only): would delete 14 of 27 entries, 4,658,775,037 bytes
  (2 backend-compile, 6 CodeQL javascript, 6 CodeQL python); sole `sbt-<hash>`, npm and setup-sbt entries untouched.
- **Wiring choice:** the new selftests/check run in CI's `frontend` job only (no `.husky/**` change, so no gate-chain
  checklist); `check:precommit-ci-parity` only requires hook checks to appear in CI, not the reverse, and passes.
- Local read-only sanity: `ci-prune-sbt-cas.sh report` against the real ~/.cache/sbt (22k ac, 14k CAS blobs) parses and
  finishes in under a second; the fixture-based selftest is the correctness proof, PR CI (task 2.3) the compile proof.

## Execution Notes (cycle 2, PR #860)

Full numbers in `ci-evidence-pr860.md`. Summary:
- **C2 not tripped.** Pruned S = ~275 MB uncompressed (cas 93 MB + ac 7.8 MB + target/out 174 MB; pre-prune cas 1.97 GB); prune step 10-11 s; ac kept 1899 of 2033 (93%);
  no full recompile; all legs green. Attempt 1 leg 3 "Compile and test" was +31 s (+17%) vs base, a re-run showed +4 s (all legs < 30 s), and main legs vary 138..233 s run to run.
- **Projection** (recomputed): ~2.1 GB steady state vs the 5 GB threshold / 6 GB target.
- **1.3 composition:** `~/.sbt` 364 MB, `~/.cache/coursier` 668 MB, `~/.ivy2/cache` absent; nothing trimmed.
- **6.1a AC3:** PR touching `backend/build.sbt` created no `sbt-*` and no `backend-compile-v3-*` entry; only a 51 KB `sbt/setup-sbt` diskcache entry under `refs/pull/860/merge`.
- **6.1b:** a changed `backend/src` file compiled "1 Scala source" incrementally from the pruned entry on all four legs.
- **Observation, not part of this change:** e2e (3) `hel1023-breakpoint-layout-derivation` failed twice of three attempts on the PR (passes on main).

## Execution Notes (cycle 3, evaluation-1)

- CR1: `ci-prune-sbt-cas.sh` aborted silently (errexit + pipefail) when the last symlink `find` returned did not point into the CAS. Fixed with an
  `if` test against a CAS path resolved once; selftest case "non-CAS symlink does not abort prune" is red (2 checks) against the old script and green now.
- Report step now has `continue-on-error` only (no redundant `|| true`); the main-side prune carries a comment that it must fail loudly.
- The `security` job failures on PR #860 / main are three Handlebars advisories (GHSA-8r5x-fm3f-whwj, GHSA-p8wg-vrv2-v86f, GHSA-xw65-4hp5-5hc7); not fixed in this lane.
