## Context

See proposal.md (Why). Ground truth (orchestrator premise check, CI run 37347856913 @ 94e996d3, 4-vCPU
`ubuntu-latest`): job 12m39s = ~21 s runner setup/checkout/cache + ~13 s sbt boot + ~40 s compile (444 sources) +
~38 s test-compile (434 sources) + **10m30s ScalaTest** (5954 tests). `backend/build.sbt` already forks tests into 8
hash groups (`HEL924_TEST_GROUP_COUNT`), at most 4 forked JVMs at once (`HEL924_TEST_GROUP_CONCURRENCY`), suites
within a group sequential (`testForkedParallel := false`, HEL-1018/HEL-924 — raising in-JVM parallelism re-creates
the HEL-924 EmbeddedPostgres contention flakes). ~203 of 434 test files start their own `EmbeddedPostgres`.
`ci-complete` already `needs: [frontend, backend, security, e2e]` and fails on any `failure`/`cancelled` result.

Budget arithmetic: with ~1.9 min of fixed per-job overhead, test execution per job must be ≤ ~3.3 min to land at
5.5 min, i.e. a ≥ 3.2x cut of test wall-clock. Removing redundant tests and trimming sleeps cannot plausibly deliver
3.2x on their own; parallel shards are the structural lever, and the other two reduce the per-shard tail.

## Goals / Non-Goals

**Goals:** a committed before/after profile; a removal ledger with named surviving coverage; a sharded backend job
whose slowest leg is ≤ 5.5 min (aim ≤ 5.0 min on PR runs for margin); no loss of any test suite in CI.

**Non-Goals:** changing local `sbt testFull` behaviour or defaults; `backend/.sbtopts`; the HEL-1228 timeout and guard;
the e2e job (HEL-1288) and frontend/security beyond job-level `timeout-minutes`; raising in-JVM suite parallelism.

## Decisions

**D1 — Profile from CI, committed as `profile.md` in this change.** Per-phase times come from the CI job's step
timestamps and sbt log line timestamps ("compiling N Scala sources" / "done compiling" / "Run completed in").
Per-suite durations come from sbt's JUnit XML (`target/**/test-reports/*.xml`, `time` attribute per testsuite),
uploaded from CI as a workflow artifact (`actions/upload-artifact`, `if: always()`) so before *and* after are
CI-measured, not local. Setup-vs-assertion split per suite: suite wall time minus the sum of its testcase times
approximates `beforeAll`/`afterAll` (EmbeddedPostgres + Flyway) cost; report it for the top 20. The "before" profile
uses a PR CI run of a commit that adds only the artifact upload (no behaviour change), so before/after share a
measurement method. Alternative rejected: local profiling — 2-fork local runs on a different CPU don't measure CI.

**D2 — Sharding: a GitHub Actions matrix on the existing `backend` job, capped at 4 legs (owner ruling).**
`strategy.matrix.shard: [0..3]`, `fail-fast: false`, the shard count derived from `strategy.job-total` so it cannot
disagree with the matrix. Owner ruling (relayed by the driver, 2026-10-05): backend + e2e together may use ~8 legs, so
the backend job gets ~4; per-leg time is tuned with forks/workers inside a leg and fixed-cost cuts (D7, D6), **never
more legs**. Rationale to verify: ~20 concurrent jobs per account on the free plan, and an 8-leg run was observed
starting legs one after another. Keeping the job id `backend` means `ci-complete`'s `needs: backend` waits for every
leg and receives the aggregate result (any failed leg ⇒ `failure`); confirm on a real PR run. Forks per leg stay at 2
(`HEL924_TEST_GROUP_CONCURRENCY=2`) unless 3 is shown stable — `ConnectorCompletionServiceSpec` flaked once at 3. Each
leg compiles independently. Alternative rejected: one compile job + artifact hand-off — a serial job and a second
runner boot on the critical path. If 4 legs cannot reach the target without dropping coverage, escalate with the
measured numbers; do not add legs.

**D3 — Partition in the build, verified every run.** A pure object in `backend/project/` (e.g. `TestShards.scala`)
computes the assignment from `(Test / definedTests)` names: longest-processing-time-first greedy bin packing over
committed per-suite weights (`backend/project/test-suite-weights.tsv`, `SuiteName<TAB>seconds`, regenerated from the
CI JUnit artifact by a small committed script), unknown suites weighted at the median weight, ties broken by suite
name for determinism. `Test / testGrouping` filters to the selected shard only when both env vars are set; with
neither set, grouping is byte-for-byte today's behaviour (spec: "Unsharded runs are unchanged"). Exactly one var set,
a non-integer, `COUNT < 1`, or `INDEX ∉ [0, COUNT)` fails the build loudly — never silently runs all or none. Before
returning groups, the task computes **all** N shards and asserts their union equals `definedTests` with no suite in
two shards, failing with the offending names otherwise. Within a shard, suites are split into
`HEL924_TEST_GROUP_COUNT` forked groups by the same LPT method (hash grouping inside a small shard is badly
unbalanced). Stale weights only degrade balance, never coverage. The guard needs a recorded red: a temporary mutation
(e.g. drop one suite from shard 0's assignment) shown failing the build with the suite named, then reverted.
Alternative rejected: ScalaTest-level `-z`/tag filtering — splits tests not suites, and gives no exactly-once check.

**D4 — Heap setting unchanged per leg.** Each leg keeps today's `printf -Xmx3g > .jvmopts` + `sbt -batch -J-Xmx3g
"eval ...maxMemory; compile; testFull"` lines verbatim (the leading `eval` keeps the heap visible in every leg's log).
This is not a restructure, so HEL-1292 is **not** folded in. One correction: the step comment's claim of "batch mode
(no thin client / background server)" is contradicted by the post-#769 log ("entering thin client ... starting sbt
server in the background"); the comment is reworded to state only what the log shows. If the executor does need to
change the heap mechanism, HEL-1292 folds in (`.gitignore` + `git check-ignore` proof) and this decision is revised.

**D5 — Redundancy pass first, ledger-gated.** Candidates: suites for retired features (e.g. Types/Metrics routes
retired by HEL-903/904), suites whose assertions duplicate another suite's, copy-pasted variants. Each removal is a
row in `removed-tests.md`: removed suite + test name, reason class, surviving suite + test name, and the evidence
(the surviving assertion quoted with file:line). No row ⇒ no removal; a candidate without a nameable survivor is
returned to the orchestrator as an `ESCALATION` (driver/owner ruling), never removed by assertion alone. Never
touched: `HelioRouteTest`, `RouteTestBaseGuardSpec`, any spec named in a HEL-1228/HEL-924 flake fix, any test whose
only motivation for removal is flakiness.

**D6 — Long-runner optimisation, profile-driven and assertion-preserving.** For each top-20 suite the executor
classifies the cost (fixed `Thread.sleep`/polling, `eventually` patience, fixture size, per-test DB re-creation where
`beforeAll` would preserve isolation, Flyway per suite) and fixes only where the assertion set is unchanged and the
suite's isolation is preserved; each fix records a local before/after `testOnly` time (2 forks, `nice -n 19`).
Per-suite EmbeddedPostgres + Flyway setup (~47% of test time) is the remaining large lever. A shared per-forked-JVM
EmbeddedPostgres with one Flyway-migrated template database, each suite getting its own database cloned from it
(`CREATE DATABASE ... TEMPLATE`), is in scope **only if** the 4-leg + D7 configuration's measured slowest-leg median
on CI exceeds 5.0 min; it must keep per-suite isolation, never use the shared dev DB, and leave suites that create
cluster-global objects (roles, e.g. the non-superuser harnesses) on their own instance. Before starting it, the
executor states the expected saving from measurements and the file count it touches; otherwise it is a follow-up.

**D7 — Caching (revised: owner cache-hygiene scope, HEL-1299 context).** The sbt dependency cache key is **reverted to
`main`'s** `sbt-${{ hashFiles('**/build.sbt') }}` (the widened backend-only key bought nothing — `restore-keys: sbt-`
already falls back on a miss — and would split the one entry shared with `security`/`e2e` into two ~911 MB entries
after merge; HEL-1299 owns trimming it). The cycle-1 widening is withdrawn. Compile output is cached because compile + test-compile (~2.2 min/leg on slow runners) is
the largest fixed cost at a 4-leg cap. sbt 2.0.9 writes compile outputs into its content-addressed cache
(`~/.cache/sbt`) and leaves symlinks under `backend/target/out`, so both paths are one entry (probe: restoring
`target/out` alone left dangling links and failed every leg in run 37382209230 attempt 2). Hygiene: every run
**restores** with `actions/cache/restore` (exact key, then the `backend-compile-v3-<os>-` prefix (outside the `sbt-` namespace, so the dependency step's `restore-keys: sbt-` can never match it), so zinc compiles
incrementally); only a `push` to `main`, and only from shard 0, **saves** with `actions/cache/save`, guarded by the restore step's `cache-hit != 'true'` — one entry per `main` push
that changes backend inputs, none per PR or per leg. PR runs then restore the newest `main` entry
(base-branch scope) — documented GitHub behaviour that can only be shown after merge; it is verified in Phase 4 and
recorded. Pre-merge warm timing is the exact-hit rerun already measured on this PR. Stale `main` entries age out by
GitHub's LRU / 7-day eviction; active pruning is left to HEL-1299 (stated in the PR). The executor reports each entry's
size and entries written per run, including `sbt/setup-sbt`'s own `sbt-diskcache`/`sbt-runner` entries. If the cache shows no CI saving it is removed.

**D10 — Concurrency (owner scope).** Workflow-level `concurrency: { group: ci-<workflow>-<key>, cancel-in-progress:
<is pull_request> }` where `<key>` is the PR number for `pull_request` events and the unique `github.run_id` for every
other event. Per-run groups for `main` pushes are required, not cosmetic: within one concurrency group GitHub allows one
running and one pending run and cancels an older *pending* run even with `cancel-in-progress: false`, so a per-ref group
on `main` would silently drop a queued `main` run. Cross-PR job capping is not native to Actions and was dropped by the
owner. `strategy.max-parallel: 4` is set on the backend matrix equal to its leg count — it documents the cap from C6
rather than throttling (a lower value would serialise legs and miss the target). Proof: push twice to the PR in quick
succession and record the first run's `cancelled` conclusion and the second's success.

**D11 — Job timeouts (owner scope).** `timeout-minutes` ≈ 2–3x the measured typical duration, from this PR's and
recent `main` runs: backend legs (4–6.5 min, cold ≈ 6.5) → 15; `frontend` (5–7.7 min) → 20; `security` job (1.1–1.5
min) → 5; `ci-complete` (≈ 5 s) → 2 (1 is the floor; 2 leaves room for runner start-up jitter). HEL-1288 owns e2e timeouts; HEL-1296 owns the security
step-level timeout and its hang. The PR body tabulates expected vs timeout per job with the source run ids; the executor
re-derives the numbers from measured runs rather than copying these.

**D8 — Measurement and acceptance (revised for D7's main-only save).** CI is the measurement. Under the final YAML
no PR run can restore a warm compile entry before merge (PRs never save; `main` has none yet), so every pre-merge run
of the final head is **cold**. Each recorded run is labelled cold / partial-hit / exact-hit with its cache source.
Pre-merge evidence, both required: (a) ≥ 3 green runs of the final head (reruns allowed, one at a time), cold, slowest
leg ≤ 7.0 min each — a no-regression bound against the 12m39s single job, **not** the target; (b) the warm path, from
the exact-hit runs already measured on this PR while it still saved PR-scoped entries (run 37387080368 attempt ≥ 2,
head 517b98ea — identical build and test code apart from cache-step YAML), slowest-leg median ≤ 5.0 min. Per-leg
"Total number of tests run" summed must reconcile with 5954 − removed + added (+ any tests merged from `main`). The
≤ 5.5 min median of 5 post-merge `main` runs is **only provable after merge**: the first post-merge `main` run is cold
(it seeds the entry); later ones restore it (partial hit). The orchestrator measures the 5-run median, the cache-hit
state of each run, PR restore of a `main` entry, and the post-merge flake rate (FirstRunRoutesSpec et al.) in Phase 4;
if the median misses, the AC is reported unmet, not softened. The PR body and the auditor are told this AC is
post-merge by construction.

**D9 — Docs.** `MISTAKES.md` "The backend CI job takes ~12 minutes" is rewritten to the measured after-number and the
shard model (the CON-159 note stays).

## Risks / Trade-offs

- [Shard imbalance from stale weights] → LPT + median default; regenerate weights from the CI artifact in this change.
- [Silent suite loss] → D3 exactly-once guard runs in every leg, with a recorded red; per-leg test counts reconciled.
- [Per-leg runner variance makes one leg slow] → aim ≤ 5.0 min on PR runs; N may rise to 5 if margin is thin.
- [More concurrent embedded Postgres per runner] → unchanged: each leg keeps the HEL-924 4-fork cap on its own runner.
- [Runner-minute cost ~N x compile] → accepted for wall-clock; recorded in profile.md.
- [HEL-1288 edits ci.yml concurrently] → C7: this change owns the backend job, the one workflow-level `concurrency:`
  stanza, and `timeout-minutes` on frontend/security/ci-complete; HEL-1288 owns the e2e job only and adds no
  workflow-level block. Whichever PR merges second rebases and keeps both sets of edits.

## Planner Notes

- Self-approved: matrix sharding inside the existing `backend` job id (no new required check); weights file in
  `backend/project/`; profile/ledger as change-dir artefacts (archived with the change).
- Target ≤ 5.5 min absolute per driver; true baseline is 12m39s (premise validation), not 9–11 min.
