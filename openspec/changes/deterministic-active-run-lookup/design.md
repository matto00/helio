## Context

- `PipelineRunRepository.findActiveRunInternal` (PipelineRunRepository.scala:642) is
  `runsTable.filter(pipelineId === p && completedAt.isEmpty).result.headOption`, system context, no ORDER BY. Its doc
  comment says `headOption` is safe because at most one run per pipeline is open at a time.
- Only caller: `HookTriggerService.collapseIntoActiveRun` (HookTriggerService.scala:58-66), reached when
  `hasActiveRunInternal` is true. It returns `HookTriggerResponse(row.id, row.pipelineId, row.status)` to the
  `POST /api/hooks/run` caller instead of starting a run (external-run-hooks spec, "Duplicate external triggers
  collapse into the in-flight run"). `None` maps to a 409 "retry".
- Several open runs of one pipeline are reachable (owner ruled they stay allowed, HEL-1833 escalation answer
  `keep-overlap-determinism-only`):
  - `PipelineRunService.submit` (PipelineRunService.scala:175-200) checks owner/editor only, no open-run check.
  - The HEL-505 cap (`countAndInsertAction`, `ownerInFlightRealRunsQuery`) counts the OWNER's non-terminal real runs
    across all pipelines (default 3), not per pipeline.
  - The scheduler (`PipelineSchedulerService.fireIfNotOverlapping`) and the auto-run firer
    (`PipelineAutoRunDebounceFirer.processAutoRunClaim`, HEL-1504/1739) skip or keep pending while a run is open;
    the hook checks first too. All of these are check-then-act, not atomic.
  - The frontend disables Run only while this client's own run is queued/running (PipelineSpineHeader.tsx:70,
    PipelineMobileLayout.tsx:168); a second tab, an editor, a PAT or helio-mcp `run_pipeline` can start another.
  - The insight-render-triggers spec already has a scenario for "a second real run (overlapping the first ...)".
- Dry runs are inserted already terminal (`completedAt = Some(startedAt)`), so they are never "open".
- Index: V136 `pipeline_runs_pipeline_started_idx (pipeline_id, started_at DESC)` and V24 `(pipeline_id)`.

## Goals / Non-Goals

**Goals:** one documented, deterministic open-run choice; a corrected doc comment; red-first proof with mutations.

**Non-Goals:** preventing overlap (no 409, no coalesce); touching `hasActiveRunInternal`, scheduler, auto-run, cap
or frontend; changing the hook response shape.

## Decisions

### D1. Rule: newest open run, `started_at DESC, id DESC`
`findActiveRunInternal` becomes `filter(...).sortBy(r => (r.startedAt.desc, r.id.desc)).take(1).result.headOption`.
Rationale (a claim for the design skeptic to test):
- The hook's purpose is "don't start a second run for a duplicate trigger". The caller wants a run that reflects the
  data behind its trigger. A run that started later read its sources later, so the newest open run is the better
  stand-in for the run the caller would have started; the oldest may have read its sources before the triggering
  change.
- It matches HEL-1626's latest-run order (`pipeline-run-deterministic-order` spec), so `GET .../runs/latest` and the
  hook agree about which run is "current" while several are open (both newest-first; latest-run reads also include
  terminal runs, so they agree only when the newest run overall is open).
- The retry case (the external-run-hooks spec's own scenario): the hook starts a run only when none is open
  (HookTriggerService.scala:52-53), so, the check-then-act race aside, a retrying hook caller's own run is the OLDEST
  open run; any other open run was started later by a manual, editor, PAT or MCP submit. Under newest-first a retry
  may therefore get a different `runId` than the run its first attempt started. Accepted because: (1) both runs
  started at or after the caller's trigger, so either covers the data behind it; (2) a hook caller whose first
  attempt's response was lost does not know its own run id anyway (the submit is synchronous), so "its own run" is
  not something the response can promise; (3) an orphaned open run (dead server) stays open until the HEL-1511
  reaper finalizes it (`PIPELINE_RUN_STALE_AFTER_SECONDS`, default 600 s); oldest-first would report that dead run
  over a live newer one for up to that window, newest-first never reports a dead run over a live one started later.
- Alternative, oldest-first (`started_at ASC, id ASC`): the run closest to completion, so a poller sees a terminal
  status sooner. It also returns a retrying hook caller's own run. Rejected for the orphan case above, and because
  it would be the only run read in the repo ordered ascending.
- `id DESC` only breaks ties; ids are random UUIDs, so it is deterministic, not "more recent".

### D2. Doc comment
Replace the "at most one open run ... headOption is safe" sentence: several open runs can exist (overlapping manual
submits are allowed; the overlap guards are check-then-act), and the newest by `(started_at DESC, id DESC)` is
returned, deterministically.

### D3. Proof
New `PipelineRunActiveLookupSpec` (backend test, `TwoUserRlsApiFixture` + privileged inserts, pattern of
`PipelineRunOrderTiebreakSpec`): seed open runs in BOTH insertion orders, (a) distinct `started_at`, (b) tied
`started_at` with hand-picked ids, (c) three open runs plus a newer COMPLETED run and a dry run (excluded), and a
different pipeline's open run (excluded). Assert the expected id on repeated calls. Plus a hook-level case in
`HookRoutesSpec`, beside the existing collapse test (HookRoutesSpec.scala:292, which seeds via `insertRunInternal`):
two open runs seeded in BOTH insertion orders (at minimum the newer one inserted LAST, the order the unchanged code
gets wrong), asserting the `POST /api/hooks/run` response `runId`, so the caller's observable result is pinned.
`red-run.txt` must show this hook case failing on its own, not only the spec file being red.
Mutations, each recorded red: drop the `sortBy`; `startedAt.asc`; drop `id.desc`; drop the `completedAt.isEmpty`
filter. If "drop id.desc" stays green (it depends on planner tie order), record the plan instead of reshuffling seeds. Red run committed as `.txt` before the implementation.

### D4. Index
Expected no migration: open runs per pipeline are few, and V136 serves `pipeline_id` + `started_at DESC`. The
executor records `EXPLAIN (ANALYZE)` of the new query on the lane DB (`helio_hel1833`) with a realistic run count
(e.g. 300 terminal runs + 2 open) as a `.txt`; a migration (next free V148) only if the plan is a seq scan or sorts
the pipeline's whole run set in a way that is measurably slow.

## Risks / Trade-offs

- A hook caller that was (randomly) getting the older run now always gets the newer one. Observable only with
  overlapping open runs; no response shape change. In particular a RETRYING hook caller may get a manual run's
  `runId` rather than the run its first attempt started (D1); the PR's overlap answer states this.
- `docs/agent-native.md` describes the hook as returning "the in-flight run" (singular); one clause names which run
  is returned when several are open.
- `hasActiveRunInternal` and `findActiveRunInternal` remain two reads; a run finishing between them still yields the
  existing 409 retry. Unchanged.

## Planner Notes

- Self-approved: D1 ordering (ticket allows "the same order, or whatever callers need"); D3 test placement; D4.
- Owner-ruled (escalation, recorded via `concertino answer`): overlap stays allowed; PR documents it with the evidence
  above. Constraint C15 in tasks.md.
- Ticket correction: the predicate is `completed_at IS NULL`, not `status IN (queued, running)`.
