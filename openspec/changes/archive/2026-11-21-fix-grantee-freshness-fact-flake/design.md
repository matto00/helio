## Context

See proposal.md - Why. Relevant current state (read on main 9c2b5ba8e):

- `expectFact` (spec.ts:132-143) polls for 15 s; each iteration recomputes `expectedFactPrefix()` from the OWNER's
  `GET /api/pipelines/:id` for both pipelines (latest `lastRunAt`, its `lastRunStatus`) and compares it with the grantee's
  `.dashboard-meta-row__refresh` text. On mismatch it returns `${expected}<> ${actual}`.
- The grantee's fact comes from `deriveDashboardMetaFromStatus` (`frontend/src/features/panels/state/dashboardMeta.ts`):
  latest item by `lastRunAt`, `runStatus` -> intent. `panelStatusStore` re-reads `GET /api/dashboards/:id/panel-status`
  every 15 s while visible. The backend (`DashboardPanelStatusService.scala`) reports `pipeline.lastRunAt` and
  `pipeline.lastRunStatus` filtered to `ReportedRunStatuses` (succeeded/failed; anything else -> `null`).
- beforeAll appends a violating row to the checked source and runs the checked pipeline (blocked -> failed); the dataset
  write arms a HEL-1093 auto-run that a blocked manual run does not cancel (HEL-1739). It fires on the 30 s scheduler tick
  after a 5 s debounce, i.e. at an unfixed time that can fall inside the viewer or editor test. The viewer test also
  writes a row and runs pipeline 1 (its auto-run may also fire later).

## Goals / Non-Goals

**Goals:** a probe-confirmed root cause; a fix at the layer the probe implicates; 20/20 consecutive local passes.
**Non-Goals:** changing poll cadence, auto-run semantics or the backend; touching sibling lanes' files.

## Decisions

### D1. Probe before any fix (systematic-debugging law)

Hypotheses, each with the probe that confirms or refutes it:

- **H1 (test race):** a late checked-pipeline (or pipeline-1) auto-run finishes during `expectFact`; the owner read flips at
  once, the grantee only sees it at its next 15 s status poll plus render, which can exceed the 15 s poll window. Probe:
  instrument a repro run (scratch copy or temporary logging, not committed as the fix) to log, per `expectFact` iteration,
  wall time, the owner's two `lastRunAt`/`lastRunStatus`, every `panel-status` response body the grantee page receives
  (`page.on("response")`) with its time, and the rendered text. Confirmed if the failing iteration shows the owner's latest
  run newer than the grantee's last panel-status response, and the grantee converges after its next poll.
- **H2 (UI derivation bug):** for the SAME panel-status body the grantee's fact differs from what the owner's rule yields
  (e.g. a `null` runStatus from a running/queued pipeline rendered as "refreshed", a tie/ordering difference, or the store
  keeping a stale snapshot past a newer response). Probe: the same log; confirmed if a panel-status body already reporting
  the failed run as latest is followed by a rendered "refreshed" that persists past the next response; plus a unit-level
  repro in `dashboardMeta`/`panelStatusStore`.
- **H3 (other):** anything else the log shows; re-plan before fixing.

Reproduce under load: the whole spec file with `--repeat-each` (2 workers, `nice -n 19`), plus, if it will not reproduce,
an induced timing of the REAL mechanism (in the scratch probe copy: a dataset write to the checked source followed by a
blocked manual run, timed so the armed auto-run fires inside `expectFact`) to show it deterministically - not a manual run
triggered right before the assertion, which is a different mechanism. The probe log records each run's trigger source. Probe log and conclusion go in `.concertino/runs/HEL-1812/evidence/root-cause.md` (main
checkout) and the scratch dir.

### D2. Fix at the implicated layer

- **If H1:** the test must wait on a settled state, not more time. No API exposes the HEL-1093 debounce state
  (`pipeline_auto_run_debounce` has no route), and "`lastRunStatus` not running/queued" is NOT a settle signal on its own: it
  is already true while a debounce is armed and has not fired. The settle condition is therefore observable run history:
  - **Checked pipeline (beforeAll):** record the checked pipeline's run count (`GET /api/pipelines/:id/run-history`, or the
    run list the owner can read) right after the blocked manual run; then wait until one MORE run exists - the auto-run the
    violating-row write armed (identified by its auto-run trigger source if the history exposes it; the executor confirms
    how it appears, since `schemas/pipelines/pipeline-run-record.schema.json` enumerates only `manual|scheduled|external`)
    - and that run is terminal. Bound: 5 s debounce + 30 s scheduler tick + margin (about 50 s), with an explicit failure
    message. Only then does beforeAll continue; no further auto-run of the checked pipeline is armed after that.
  - **Pipeline 1 (viewer's write + manual run):** expected to be cancelled by its succeeded manual run (HEL-1739). The D1
    probe log MUST confirm this (no extra auto-run in pipeline 1's history after the viewer test, across the repeat runs).
    If the probe shows it is not cancelled, apply the same "wait for the armed run to land and be terminal" settle after
    the viewer test's run-finish step, before the editor test's `expectFact`.
  - `expectFact` keeps comparing the grantee's rendered fact with the OWNER's live view (C15: never with the grantee's own
    panel-status body). Once the settle above holds, the owner's view cannot change during `expectFact` unless the test
    itself runs a pipeline, so a single live owner read per iteration is no longer racing an unscheduled run. The
    "compare at the time of the grantee's latest panel-status response" idea from the first draft is dropped. The 15 s
    `expectFact` window is left as is; if the probe shows the grantee's first render after `page.goto` itself can lag the
    owner's settled view (e.g. a late first panel-status read), that is analysed as its own finding, not papered over.
  - Rejected: raising the timeout or accepting both strings (C15); removing the row writes (the invalid-badge premise needs
    the violating row).
- **If H2:** fix the derivation/store so the grantee's fact equals the owner's rule for the same data; red-first unit test
  (`dashboardMeta.fromStatus.test.ts` or `panelStatusStore.test.ts`) committed before the fix, mutation-checked; add a
  `dashboard-grantee-access` spec delta for the corrected behavior and drop `skip_specs`. If the HEL-1786 spec does not say
  which fact should win, escalate (do not decide).

### D3. Evidence of stability

20 consecutive passes of the full spec file (`--repeat-each=20` acceptable for that one test, but the whole file is run at
least once after the change), Playwright 2 workers, `nice -n 19`, lane DB `helio_hel1812`, servers on 7244/10151 with
`ANTHROPIC_API_KEY` exported empty. Transcript persisted as evidence.

## Risks / Trade-offs

- [Cannot reproduce locally] -> induce the timing deterministically in a scratch probe and argue from the CI log + trace.
- [Settle-wait itself flaky or slow] -> bounded polls with explicit messages; total stays inside the 90 s test timeout.
- [Fixing the test masks a UI bug] -> H2's probe (same body, different fact) is run regardless of H1 being confirmed.

## Planner Notes

- Self-approved: `skip_specs: true` provisionally (H1 changes no behavior); flipped if H2.
- Premise correction recorded in ticket.md: the UI never showed two facts; `<>` is the test's separator.
