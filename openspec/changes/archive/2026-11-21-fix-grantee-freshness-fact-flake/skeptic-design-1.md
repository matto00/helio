## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 9c2b5ba8ea1749c1db1b4e61b53ea4ebab09b134 (change dir untracked).

### What I verified (with evidence)

- Spawn-cwd guard: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=bug/freshness-fact-flake/HEL-1812`.
- I read ticket.md, proposal.md, design.md, tasks.md, .openspec.yaml (`skip_specs: true`), and the premise evidence.
- The premise correction holds. `e2e/hel1786-shared-dashboard-freshness.spec.ts:132-143` (`expectFact`) returns
  `${expected}<> ${await text()}` on a mismatch, so `<>` is the test's own separator, not UI text. The window is
  `timeout: 15_000`.
- The design's description of the current state matches the code:
  - `expectedFactPrefix` (spec.ts:118-128) reads the owner's live `GET /api/pipelines/:id` for both pipelines.
  - `deriveDashboardMetaFromStatus` (`frontend/src/features/panels/state/dashboardMeta.ts:112-134`) picks the item with
    the latest `lastRunAt` and maps `runStatus` to an intent.
  - `DashboardPanelStatusService.scala:46,67-68` filters to `ReportedRunStatuses = Set("succeeded","failed")`.
  - beforeAll (spec.ts:186-201) writes a violating row and then runs a manual run that is blocked, so it fails.
- The direction of the symptom fits H1. The owner said "failed" and the grantee said "refreshed 17 s ago". A blocked
  manual run does not cancel the HEL-1093 auto-run that the checked source's write armed (HEL-1739). That auto-run
  fires late, is blocked again by the same violating row, and fails. When it lands inside the editor's window, the
  owner's live read flips to "failed" at once. The grantee only sees it on its next 15 s poll, and the poll window is
  also 15 s. The viewer's pipeline-1 write is different: per HEL-1739, the succeeded manual run that reads it should
  cancel its auto-run. So the one late run that is expected is the checked pipeline's. H1 is plausible, and the
  probe-first plan (D1) is the right shape.
- The HEL-1786 spec (`openspec/specs/dashboard-grantee-access/spec.md:295-306`) requires the same fact "the owner
  sees", with a status re-read done "periodically". A lag of up to one poll is documented behaviour. A test whose
  window equals the poll cadence is racy by construction. This supports D2's H1 branch.
- I checked whether the settle signal named in D2 exists:
  - `grep` for a pending/debounce field in the API (`ApiRoutes.scala`, routes, protocols) finds no route that exposes
    `pipeline_auto_run_debounce` state.
  - Run history does carry the auto-run: `PipelineAutoRunDebounceFirer.scala:122` submits with
    `triggerSource = TriggerSource.AutoRun`.
  - But `schemas/pipelines/pipeline-run-record.schema.json:117-120` enumerates only `manual|scheduled|external`. How an
    auto-run appears in `GET /api/pipelines/:id/run-history` therefore has to be confirmed.

### Verdict: REFUTE

The diagnosis plan is sound. The H1 fix in D2 names a settle signal that does not exist, plus one that cannot prove the
state is settled. A competent implementer could take either and ship a fix that passes 20/20 by luck while the race
stays. Both need fixing in the artifacts before execution.

### Change Requests

1. **design.md D2 "If H1", the settle signal.** Remove "the debounce state if an API exposes it". No API exposes it
   (verified above). Also say that "`lastRunStatus` not running/queued" is not enough on its own, because it is true
   while a debounce is armed and has not fired yet. Replace both with one concrete, observable condition. For example:
   in beforeAll, after the checked-source write and the blocked manual run, wait until the checked pipeline's run
   history shows the auto-run that write armed (one more run with its auto-run trigger source, or one more run if the
   trigger source is not exposed; the executor confirms how it appears, given the schema enum above) and that run is
   terminal. Bound the wait by the debounce of about 5 s plus a 30 s tick, with a margin.
   - State what happens to the viewer test's pipeline-1 write: it is expected to be cancelled by its succeeded manual
     run (HEL-1739). Have the D1 probe log confirm this, rather than assume it.
   - Mirror the chosen condition in tasks.md 3.1 so its acceptance signal is concrete.
2. **design.md D2, the "compare against the owner's view at the time of the grantee's latest panel-status response"
   option.** Define it precisely, or drop it. As written, it has two failure modes:
   - It can be read as comparing the grantee's rendered fact with the grantee's own panel-status body. That would no
     longer test agreement with the owner, which weakens the assertion and is forbidden by C15.
   - It can be read as a single owner read taken near that response. A run can finish between the two, so that reading
     keeps a race.

   If it stays, specify it. For example: two owner reads that bracket the grantee's response and agree with each other,
   and the grantee's fact must equal them. Or the convergence form: the grantee's fact matches the owner's settled view
   within one poll cadence plus a stated margin, justified by the spec's "periodically". In each case, also state why
   it is not a bare timeout increase.

### Non-blocking notes

- D1's H1 confirm criterion is good: the owner's latest run is newer than the grantee's last panel-status body, and the
  grantee converges on its next poll. Have the probe log record the run's trigger source too, so "late checked-pipeline
  auto-run" is shown by the log rather than inferred.
- The "induce the timing" fallback in D1 should induce the real mechanism: a write followed by a blocked run, with the
  auto-run firing inside `expectFact`. A manual run triggered right before the assertion is a different mechanism.
- `skip_specs: true` is fine for the H1 path. The plan to flip it on H2 is correctly conditioned.
