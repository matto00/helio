# HEL-1174: Chart refresh intermittently misses a second run's success event after SSE reconnect

## Description

origin_kind: followup
origin_ticket: HEL-1094

**A real defect, not a flaky test** (driver diagnosis, verify it). `e2e/hel1094-sse-fan-out-panel-refresh.spec.ts:43` ("…and survives a second run") failed on `main` in **2 of the last 5** CI runs: run 35934013358 at `853fb0a2` (HEL-1094's own merge) and run 36052610260 at `f272a605`. It also failed on PR #694's first attempt and passed on re-run.

The failure is on the **second** form submit: after the first refresh succeeded, the bound table panel stays at 2 rows for the full **120s** timeout (`toHaveCount(3)` at line 209; the locator resolved to 2 elements 123x). The whole write -> debounce (5s) -> tick (<=30s) -> run -> SSE chain is <= ~35s plus the run, so a 120s miss is not tick-timing slack.

Leading hypothesis: `pipelineRunFanout.ts` reconnects after each terminal event. A second run that starts and finishes (or emits `succeeded`) during the reconnect window, or before the new subscription registers in `PipelineRunRegistry`, is never delivered, because run-status events are ephemeral (no replay). Other candidates to rule out: the backoff path, the HEL-1168 LISTEN/NOTIFY self-echo guard, and the registry's `watchTermination` cleanup racing the new subscribe.

**User impact:** a form/counter works once and then, intermittently, downstream charts silently stop refreshing until a page reload.

## Acceptance criteria

* Root cause confirmed by a probe (systematic-debugging law), not assumed.
* A subscriber connected across a reconnect never misses a run's terminal outcome. E.g. on (re)subscribe, fetch the pipeline's current/latest run status and refetch if a run completed after the last-seen one. The fix must hold across two instances (HEL-1168).
* The e2e passes reliably: a repeated-run loop (e.g. 20x locally) with zero failures, plus a deterministic unit/integration test that forces a run to complete inside the reconnect window, red before the fix.

## Why now (owner ruling)

Recorded on HEL-1174: this bug blocks the v0.8.4 release, together with HEL-1169 (merged as `78ebb3a6`). It is the LAST blocker for v0.8.4.

## Driver-supplied investigation notes (claims — verify against the tree, not ground truth)

Components in the chain: `frontend/src/features/panels/services/pipelineRunFanout.ts` (HEL-1094: one SSE connection per pipeline per page, reconnect after each terminal event, bounded backoff); `usePipelineRunEvents.ts`; backend `PipelineRunRegistry.scala` (HEL-1168: Set-of-subscribers, `watchTermination` cleanup); `PipelineRunNotifyBus.scala` (LISTEN/NOTIFY with a self-echo guard); `PipelineRunStreamRoutes`; `PipelineSchedulerService` auto-run firing (HEL-1093, V110 debounce claim/release); and the HEL-505 guard in `submit`.

Candidate causes to discriminate between with probes (don't just pick one):
(a) a run finishing or emitting `succeeded` inside the client's reconnect window, where events are ephemeral with no replay;
(b) the new subscription registering on the server after the run's events were published;
(c) `watchTermination` cleanup of the OLD connection racing and removing the NEW subscriber's ref;
(d) the self-echo guard dropping a legitimate local event (single instance in CI, so every NOTIFY is a self-echo; check that local delivery isn't ALSO being skipped in some path);
(e) the second write never producing a run at all: the debounce claim not released after the first fire (HEL-1093's compare-and-delete), the HEL-505 rate or concurrency guard rejecting it (10/60s; how many runs has the test made?), or the cost gate. Check `pipeline_runs` and the debounce table in a reproduction. **If (e), the SSE layer is innocent and the fix is elsewhere.**
(f) something else the probes reveal.

Reproduce it deterministically if possible (loop the e2e locally, cap at 3-4 parallel workers with `nice -n 19` — this is a 6-core desktop — or write a targeted integration test that forces the suspected interleaving). Record the probe evidence in design.md.

Fix requirements: a subscriber that crosses a reconnect must never miss a run's terminal outcome, e.g. on (re)subscribe, fetch the current/latest run status and refetch if a run completed after the last-seen one. Must hold across two instances (HEL-1168). Proof: a deterministic test that forces the failing interleaving and is RED before the fix, plus the e2e passing in a repeated loop (e.g. 20x) with zero failures. Don't paper over it by raising timeouts or accelerating the tick in the e2e. A test changed to make it pass is a defect symptom.

If the root cause turns out to be a product question (e.g. the guard legitimately rejecting the test's second run), ESCALATE with options and a recommendation.

## Standing constraints for this run (see workflow-state.md CONSTRAINTS / tasks.md Standing Constraints)

- [C1] Models: SONNET on all agents; no promotion.
- [C2] ONE LANE — no concurrent worktrees/lanes for this ticket.
- [C3] Migration ledger: V110 is highest (confirmed); V111 is free if a migration is needed.
- [C4] Write ALL artifacts inside the worktree or `.concertino/runs/HEL-1174/` — never the main checkout root.
- [C5] `files-modified.md` must list EVERY touched file.
- [C6] Every `git commit`: Bash `timeout: 600000`. Never re-run a commit while one is in flight. Never `git add -A`.
- [C7] Budget exhaustion (including DEBUG_ATTEMPTS) is a mandatory escalation, never a self-approval.
- [C8] `ci-complete` must be PRESENT and SUCCESS. Do NOT re-run CI to get past a failure of this test — that is evidence the fix is incomplete.
- [C9] Say "owner ruling" only for decisions the owner actually made.
- [C10] Follow-ups: `origin_kind: followup` / `origin_ticket: HEL-1174`, relatedTo, the `Follow-up` label, and the v0.8 project `28f119e2-5738-46b1-a53b-42f73e06b053`.
