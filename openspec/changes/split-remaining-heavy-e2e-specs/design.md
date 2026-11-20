## Context

See proposal.md (Why). `scripts/e2e-shard.mjs` places whole spec files on the 7 `e2e` legs by
longest-processing-time-first over `e2e/shard-weights.tsv`; a file is never split across legs. Playwright runs with
`fullyParallel: false`, `retries: 0`, 2 workers per leg, so a file without `test.describe.configure({ mode: "parallel" })`
runs its tests in order in one worker. Job limit `timeout-minutes: 25` (1500 s); the target is the slowest leg at or
under 1200 s on normal runs, without raising it. Each leg also runs the sbt backend and the Vite dev server on the same
runner (`.github/actions/e2e-setup`), so leg wall time is shared-CPU time.

HEL-1778 (archived at `openspec/changes/archive/2026-11-19-split-heavy-e2e-specs/`) is the method precedent: its
`variance.md` names the per-spec variance method and lists the six specs of this ticket as "material drivers outside
the three specs"; its `design.md` Decisions 1-6 are reused here where they still apply. Its scratch directory
(`.concertino/scratch/HEL-1778/`) was swept before this run; its scripts (`specvar.mjs`, `measure.mjs`, `proof.mjs`,
`legfiles.mjs`, `capture.sh`) are rebuilt in `.concertino/scratch/HEL-1789/` from the method text in that `variance.md`
and the PR #1183 body. `scripts/e2e-shard.mjs weights --list` (HEL-1778) already attributes results to split files by
title path, so no tool change is needed for weighting.

Planning probe (orchestrator, on main 2b33217e1):

| spec | weight (s) | lines | shape |
| --- | --- | --- | --- |
| hel1575-dashboard-tabs | 740 | 1069 | one file, stable |
| hel1582-sweep-375 | 358 | 7 | wrapper: `registerHeavySweeps(375)` from `e2e/support/hel1582Phone.ts` (C8 hit-area sweep + MAXIMAL sweep); the same function is called by `hel1582-sweep-390` / `-768` |
| hel1582-mobile-pipeline | 343 | 1204 | one describe, about 20 tests with `test.setTimeout` 120-590 s each, two size loops |
| hel1684-draft-structural | 337 | 642 | contains flake candidate `:427` |
| state-surface-contrast-guard | 276 | 993 | |
| hel1573-motion-primitives | 176 | 325 | |
| hel1774-modal-scroll-* (6 files) | none (default 50) | | added by HEL-1774 (a867001d7) |

Main CI runs since HEL-1778 merged (d8cdfb460): 44621024526, 44640957498, 44655001204, 44660016746 (success),
44667845106, 44683347610 (failure: e2e legs to be checked per the counting rule), 44687930342 (cancelled),
44692374356 (2b33217e1, in progress at planning time, the first with the HEL-1774 files). The surviving HEL-1778
data: the before/after tables in the PR #1183 body (main 7-leg runs 44446279352 ... 44589133697; PR run 44599315768
attempts 1-6). PR run attempts' JSON reports were replaced by each whole-run rerun; earlier attempts survive only as job
logs (the `list` reporter line per test, as HEL-1778 parsed them).

## Goals / Non-Goals

**Goals:**
- A named, evidenced variance cause for each of the six specs (spec-specific, leg-wide, or structural), before any
  split.
- No part of any of the six heavier than about 200 s median after the change, except a single test that alone exceeds
  it (named, with its duration; a test is never split).
- The leg-wide slowdown investigated from CI data, with a plain statement of what the existing artifacts can and cannot
  show, and a per-leg runner record added so future runs can show it.
- Every discovered spec weighted from CI evidence; any defaulted spec listed in the PR with the reason.
- Slowest and mean leg reported on at least 5 counting CI runs of the PR.

**Non-Goals:**
- Raising `timeout-minutes`, changing the leg count or runner size, or changing the partition algorithm (each is an
  owner decision; if the evidence points at one, it is escalated, not done).
- Fixing flakes (the C11 list and the two candidates). A split moves a flaky test verbatim; it is reported, not fixed.
- Editing HEL-1790's files (`e2e/hel1675-shared-hover.spec.ts`, `e2e/support/hel1790Rest.ts`,
  `e2e/hel1790-hover-probe.spec.ts`) or any sibling lane's spec.
- Changing any test's title, describe chain, project, viewport, timeout, fixture, body or assertions.
- Product code, schemas, migrations, CD or release workflows.

## Decisions

1. **Variance cause per spec, from CI artifacts only, before any split.** Populations, kept apart: (i) main: every
   counting 7-leg main run from 44446279352 onward (the HEL-1778 before set) plus every counting main run since
   d8cdfb460; (ii) PR #1183 run 44599315768 attempts 1-6 (JSON for the attempt whose reports survive, job logs for the
   rest, as HEL-1778 did). Counting = every e2e leg succeeded, all 7 `playwright-json-shard-*` reports present,
   `unexpected=0`, `flaky=0`, decided per e2e leg and report, not by the run conclusion. For each of the six specs:
   summed duration per run, its median, swing, share of the run total; the **spec ratio** (sum over its own median)
   against the **leg ratio** (the other files on the same leg in that run, sum over their medians) and the **rest ratio**
   (the rest of the run); per-test ratio spread (p10/p50/p90), and the tests carrying the largest absolute swing; in-file
   mode; per-test durations ranked, so the split boundaries are chosen on measured weight. Classification: the spec
   ratio tracks the leg ratio → **leg-wide** (a split only spreads it); the spec ratio swings while its leg-mates do
   not → **spec-specific**, which is then named further (which tests, what they wait on: read the test bodies for
   fixed waits, polling loops, per-step loops whose count scales with something, server-side runs); stable but large →
   **structural** (hel1575). The result is `variance.md` in this change directory, every number with its source (run
   id, attempt, JSON or log).
   - **Stop rule:** if a spec's swing is spec-specific and its cause sits inside an assertion path (e.g. a poll that
     measures what is asserted), the executor does not change it; it is split like the others, and the cause is named
     for a follow-up. If the analysis finds that none of the six drives any slowest-leg excess, the executor stops and
     reports before splitting.
   - Alternative: assume "leg-wide" for all six because HEL-1778 found it for its three. Rejected: the ticket asks
     for the cause per spec, and HEL-1778 found spec-specific candidates among these (hel1582-sweep-375 +167 s on
     main while its leg-mates were not slow).

2. **Remedy: split along existing boundaries; cut cost only for a named, setup-only waste.** Each of the six is split
   into parts of at most about 200 s median, along existing `describe` / loop / size-loop boundaries, balanced on the
   per-test medians from Decision 1. Names: `<original-stem>-<part>.spec.ts` with a short descriptive part; the original
   file is removed. Shared constants, types and helpers move once (verbatim) into `e2e/support/` (an existing module
   when one already holds them, e.g. `e2e/support/hel1582Phone.ts`, else `e2e/support/<original-stem>.ts`) and are
   called from each part, never copied. Each part repeats the original's file-level `test.describe.configure`,
   `test.setTimeout` and `test.use` exactly.
   - *As implemented:* `registerHeavySweeps`, `registerC8Sweep` and `registerMaximalSweep` are thin wrappers over a private `registerSweeps(size, kinds)` that keeps one `test.use` and one describe and selects the tests with `if (kinds.includes(...))`, so 390/768 keep one describe and no same-titled sibling describes exist (the proof binds `kinds` at each call).
   - **hel1582-sweep-375:** the wrapper calls `registerHeavySweeps(size)`. The 375 split registers its two sweeps in
     two files through two narrower exported functions (e.g. `registerC8Sweep(size)` and `registerMaximalSweep(size)`),
     with `registerHeavySweeps(size)` reimplemented as those two calls in the same order, so `hel1582-sweep-390` and
     `-768` discover exactly the same tests as before (proved by the Decision 3 list, which covers every file, and by
     `HELIO_E2E_SLOW=1 npx playwright test --list` for the gated sweeps). If one sweep is itself one test over 200 s,
     the part is that test alone, named.
   - **Serial files** (no `mode: "parallel"`): before choosing boundaries, check for module-level mutable state,
     `beforeAll`/`afterAll`, and tests that read state another test wrote (same user, same seeded entity, order-dependent
     server state). Splitting lets the parts run concurrently on two workers; a dependency found forces the dependent
     tests into the same part.
   - **References to the old file names:** working references are repointed and checked: `package.json`'s
     `e2e:state-contrast-guard` script (`playwright test e2e/state-surface-contrast-guard.spec.ts`) becomes a path filter
     matching every part (e.g. `playwright test e2e/state-surface-contrast-guard`), and `npm run
     e2e:state-contrast-guard -- --list` must list every part's tests; any `e2e-slow.yml`, `playwright.config.ts`
     `testIgnore` or script reference likewise. Comment-only references (in `e2e/`, `frontend/src/**` comments such as
     `App.css`, `themeParityGuard.css.test.ts`, `DashboardTabBar.css.test.ts`, `PipelineMobile.css.test.ts`, and
     `DESIGN.md`) are updated as comment/doc-only edits to name the new part (or the stem, when the reference is to the
     whole spec); they change no code, are allowed under "no product code", and each is listed in `files-modified.md`.
     A grep for each old **full** file name (`<stem>.spec.ts`) outside `openspec/changes/archive/` and this change
     directory is zero at the end. Bare stems legitimately remain (part file names, the `package.json` path filter, the
     `openspec/specs/state-surface-contrast-guard/` capability, DESIGN.md's change-path citations, the history comment
     in `scripts/e2e-shard.mjs`, `PipelineSpine.css`) and are not edited; `scripts/e2e-shard.mjs` is never edited for
     this. Comment references outside the `e2e` job (e.g. `ci.yml`'s frontend-job comment) are comment-only edits listed
     in `files-modified.md`; a comment inside a helper that moves verbatim (e.g. `finishCell` in
     state-surface-contrast-guard) may be updated and is noted in `variance.md`; a provenance comment such as
     `hel1573-motion-grid-chart.spec.ts:12` is reworded to name the stem or parts, never deleted.
   - **Cost cut:** only for a waste named by Decision 1 that lies in setup (seeding, navigation, waiting for readiness)
     and changes nothing asserted, listed in `variance.md` with per-test CI durations before and the reason. Anything
     touching an assertion, a wait that guards an assertion, or a timeout is out of scope.
   - Alternative: `mode: "parallel"` inside the heavy files instead of splitting. Rejected as the primary remedy: it
     only helps within one leg, does not let LPT spread parts across legs, and changes in-file isolation assumptions.

3. **Parity proof that nothing was lost or weakened, before list committed first.** (a) Before any spec edit, the
   executor captures `npx playwright test --list --reporter=json --project=dev` at the base, reduced to
   `project | describe chain > title` per test (file and line stripped), plus the same with `HELIO_E2E_SLOW=1` for the
   gated sweeps, and commits both reduced lists into this change directory (`list-before.txt`,
   `list-before-slow.txt`) as the first commit. (b) After the split, the same lists are regenerated
   (`list-after*.txt`) and must be identical as multisets with equal per-project counts. (c) A TypeScript-AST
   comparison of every `test(...)` call site's title source, parameters and body (whitespace-normalised) between the old
   files and the new parts plus support modules reports zero differences. (d) **Scope-chain parity, per test:** for every
   test (keyed by title path), the proof collects the chain of everything that applies to it from the file root down to
   its describe: every enclosing `test.use(...)` argument, `test.describe.configure(...)`, file- or describe-level
   `test.setTimeout`/`test.slow`, runtime `test.skip`/`test.fixme` calls outside the test body, and the source of every
   `beforeEach`/`afterEach`/`beforeAll`/`afterAll` hook, each whitespace-normalised, in order; the chain must be equal
   between base and branch for every test. (e) `expect(` counts are taken over test bodies **and** hook bodies, per
   original file, and must be equal. The proof must show, by name, that hel1684-draft-structural's `afterEach`
   `count429 ... toBe(0)` assertion (and its `beforeEach` `attachApiRequestCounter`) still applies to exactly the same
   tests, and that hel1582's MAXIMAL `test.skip` gate and the mobile/touch `test.use` still apply to both 375 parts and
   to 390/768. The proof is shown able to fail: one mutation (drop one `test.use` or hook from one part, in a scratch
   copy) makes it report a difference. The proof script lives in scratch; its output is summarised in `variance.md`.
   - Note: `HELIO_E2E_SLOW=1 --list` lists the same tests as the plain list (the gate is a runtime `test.skip`); (d) is
     what proves the gate is preserved. If each narrower register function opens its own
     `test.describe("HEL-1582 phone pipeline page (live)")`, 390/768 get two sibling describes with the same title;
     title paths are unchanged, and `variance.md` says so.

4. **Leg-wide slowdown: read what CI already records, then record what it does not.**
   - (a) From existing data, for the runs in Decision 1: per leg, the **leg factor** (median of per-test ratios of
     every test on the leg); correlate the slow legs (leg factor >= 1.15) with what each job log and the jobs API
     expose: runner name, runner image version, machine/host lines in "Set up job", the step durations of the
     CPU-bound setup steps (backend start / health wait, `npm ci` or cache restore, Playwright browser install) as a
     speed proxy, the leg index, the time of day and concurrent jobs of the same run. Also check whether the slow
     factor is constant through the leg (a slower machine) or starts mid-leg (a burst of contention), from per-test
     start times in the JSON reports. `variance.md` states which of these the artifacts can show and which they cannot
     (for example: CPU model and steal time are not recorded anywhere today, if that is what the logs show).
   - (b) Add a **per-leg runner record** to the `e2e` job in `.github/workflows/ci.yml`: a step before the suite that
     writes the CPU model, vCPU count and MemTotal (from `/proc/cpuinfo`, `nproc`, `/proc/meminfo`; no environment
     dump) to a file and the step summary; the existing `scripts/ci-load-sampler.cjs` started in the background as the
     first step after `actions/checkout` (so it covers setup and the whole suite, including a slow leg's) with a
     self-stop bound of 1400 s, which expires before the 1500 s job limit because only "Set up job", "Initialize
     containers" (postgres service and health check) and checkout precede it (about 28-32 s measured on run
     44660016746; the measurement reports the actual offset), and stopped by its recorded PID after the suite; and one
     `actions/upload-artifact` of that directory per leg, named `e2e-runner-shard-<n>` (never matching
     `playwright-json-shard-*`, which the weights tool requires to be exactly one report per leg; the directory never
     holds a file named `results.json`, since `findReports` treats any directory with one as a report). Every new step is
     `if: always()` and `continue-on-error: true` where it can fail, so the record can never fail or lengthen a leg
     beyond a few seconds. The sampler is reused unchanged unless a runner-identity field is added to it, in which case
     its existing test (`scripts/ci-load-sampler.test.js`) gains a case, shown red first.
   - (c) The measurement runs (Decision 6) read the record: per leg, CPU model, mean and p90 steal, mean run queue, and
     the leg factor; `variance.md` / the PR state whether slow legs coincide with a CPU model, with steal, or with
     neither.
   - If the evidence points at a remedy that is an owner decision (a larger runner class, fewer workers per leg, an
     eighth leg), it is reported with the numbers and escalated, never applied.
   - Alternative: only state that the artifacts cannot show it. Rejected: the ticket's slowdown recurs on every leg in
     turn and no weight can absorb it; without a record, the next ticket faces the same blind spot.

5. **Weights regenerated from CI, never by hand.** `node scripts/e2e-shard.mjs weights --list <list.json> <runDir>...`
   with `<list.json>` from `npx playwright test --list --reporter=json --project=dev` on the branch head, over the 5
   most recent counting 7-leg main runs. Done as the last execution step, and done again at Delivery, before any
   measurement run, once HEL-1790 has merged and main has been merged into the branch (so its files are weighted too).
   The header records the run ids. Every result re-attributed to a split part is listed on stderr and the counts are
   recorded. Any discovered spec with no counting main run (e.g. the HEL-1774 files if no counting main run contains them
   yet, or HEL-1790's) is listed in the PR as defaulted, with why. Main runs are never rerun by this lane.

6. **Proof is CI-only, on the PR, without whole-run reruns.** After the PR's first run, further measurement runs come
   from **empty-commit pushes** to the branch (`git commit --allow-empty -m "HEL-1789 CI measurement run <n>"`), each
   pushed only after the previous run has completed (the PR concurrency group cancels an in-flight run on a new push).
   A merge-from-main push also yields a run. Until 5 counting runs or 8 runs in total. If 8 runs yield fewer than 5
   counting runs, AC3 is unmet: the orchestrator escalates with the per-run failures (never reports it as met). Each run's
   `playwright-json-shard-*` and `e2e-runner-shard-*` artifacts are downloaded to scratch as soon as it completes. A
   failed e2e leg unrelated to the diff gets at most one `gh run rerun --job <id>` (C11), named in the PR; that rerun
   attempt is recorded but counted only if all 7 legs' reports of that attempt are present and clean. Per run, from the
   jobs API: slowest leg, mean leg, headroom under 1500 s, test step separately from setup, and the runner record per
   leg. Before set: the counting 7-leg main runs from Decision 1 (i), per-leg median/max and imbalance as the spec
   defines; for reference, HEL-1778's PR after-set numbers from the PR #1183 body.
   - **"e2e shard balance is measured in CI", clause by clause:** per-leg medians/maxima before and after with run ids:
     met by the measure script. 25-run before set: counting 7-leg main runs since 33dd755d9 are fewer than 25 unless
     main has gained them; the PR states the count. After imbalance <= 15 s: reported met / not met with the number
     (accepted as unmet by the owner at HEL-1361). Same-window count-based control: not applicable (no count-based heads
     since HEL-1361).
   - **"e2e CI legs keep headroom under the job timeout":** a main-run requirement; the PR reports the counting main
     runs available, and states that post-merge main runs are not measured by this lane.
   - **The 1200 s outcome is not guaranteed by the split.** If a counting run's slowest leg exceeds 1200 s, the PR names
     its driver: a spec (excess over median), or a leg-wide factor with that leg's runner record. A leg-wide cause is
     reported with Decision 4's evidence, not hidden by re-running.

## Risks / Trade-offs

- [The leg-wide slowdown dominates: splitting cannot lower a leg whose every file is 1.35x slow] → The split caps any
  one spec's swing at about 70-100 s; the runner record attributes the remaining slow legs; an owner-decision remedy is
  escalated with numbers.
- [Split parts share state the original relied on] → Decision 2's serial-file check; dependent tests stay together.
- [`registerHeavySweeps` refactor changes 390/768 discovery] → Decision 3 lists cover every file and the
  `HELIO_E2E_SLOW=1` set.
- [A flaky test (hel1684:427) moves into a part] → Moved verbatim (body proof), reported; no fix in scope.
- [The runner record adds load or fails a leg] → 1 Hz `/proc` reads; every step `continue-on-error`; its cost is
  visible in the measurement (setup vs test step).
- [Sibling lanes merge new specs mid-run] → Default weight until a counting main run includes them; Decision 5
  regenerates at Delivery.
- [An artifact name matching `playwright-json-shard-*` would break weight regeneration] → `e2e-runner-shard-<n>` is
  chosen to not match; the weights tool's download/validation is checked against it.

## Migration Plan

Rollback is one revert of the squash commit (parts, support modules, ci.yml steps and table revert together).

## Gate-Chain Implications Checklist

No `.husky/**` file and no script `.husky/pre-commit` invokes is planned to change (`scripts/e2e-shard.mjs` and its
selftest are reused unchanged). If the executor finds it must change one (e.g. `scripts/e2e-shard.mjs`), it fills this
checklist before committing:

- **What does it execute?** n/a unless changed.
- **What environment does it inherit, and from where?** n/a unless changed.
- **Does it write anything outside its own sandbox?** n/a unless changed.
- **Does it behave differently from a linked worktree than from a main checkout?** n/a unless changed.
- **What happens on its first run?** n/a unless changed.
