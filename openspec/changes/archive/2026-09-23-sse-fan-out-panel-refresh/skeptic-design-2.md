## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

1. **CR1 resolution (connection-failure recovery) — soundly resolved, not word-shuffled.**
   `design.md` D6 (lines 88-109) adds a genuine, testable mechanism: a bounded exponential-backoff
   retry (`computeRetryDelayMs(attempt) = Math.min(1000 * 2 ** attempt, 30000)`, unbounded in attempt
   *count*, bounded in *delay*, resets to 0 on the next successful connection) triggered on any
   connection failure that never reaches a terminal `run-status` event — distinct from D3's
   reconnect-after-terminal-status path. This is option (a) from my round-1 report (an actual retry
   with a test proving recovery), not the weaker disclosed-risk option (b). `tasks.md` 1.4 adds the
   implementation task with a concrete fake-timer unit test asserting exactly one retry `fetch` after
   the computed delay and attempt-counter reset on a subsequent success. `specs/panel-run-refresh/spec.md`
   adds a corresponding "The subscription recovers from a transient connection failure" requirement
   (lines 56-67) with a scenario, worded consistently with D6 (same 30s cap, same "at least one panel
   remains bound" condition). The Risks/Trade-offs section's prior open risk entry is updated to point
   at D6 as the mitigation, matching the existing precedent for the other four risk entries.
   This closes the exact gap from round 1: a page-lifetime singleton whose only resubscribe trigger was
   a 0→1 listener transition no longer has a connect-failure path with zero further retry triggers.

2. **D6 grounds in the same evidence already re-confirmed in round 1.** Read
   `frontend/src/features/pipelines/hooks/usePipelineRunEvents.ts:22-55`: `connectionError` is a real,
   already-shipped state field, and the hook's own doc comment says "connectionError is set if the
   fetch fails, returns a non-SSE response, or the stream drops unexpectedly" — the exact failure class
   D6 now handles for the new manager. Confirms D6 is not inventing a hypothetical risk.

3. **D5's non-blocking fix (round 1) is genuine, not asserted.** `design.md` D5 now cites
   `frontend/src/shared/ui/Toast.tsx` and `theme.css`'s `.sr-only` recipe. Read
   `frontend/src/shared/ui/Toast.tsx:130-175`: the existing pattern is exactly
   `<div className="sr-only" role="status" aria-live="polite" aria-atomic="false">`. Read
   `frontend/src/theme/theme.css:505`: `.sr-only` is defined there (several other feature CSS files
   also reference it as "canonical," e.g. `PipelineListTable.css:9`, `DashboardList.css:248`). The
   convention D5 now points to is real and matches.

4. **Spot-re-verified the round-1 core-premise claims still hold against current source** (cold review
   does not inherit round 1's trust, so I re-read rather than assumed):
   - `backend/src/main/scala/com/helio/api/routes/pipelines/PipelineRunRegistry.scala:76-105`:
     `subscribe` does `refs.put(pipelineId, ref)` unconditionally (line 89) — single-subscriber,
     silent-overwrite behavior confirmed.
   - `backend/.../PipelineRunStreamRoutes.scala:29` + `PipelineRunService.scala:916`:
     `pipelineExistsShared` is the (unmodified) sharing-aware access check, confirmed present.
   - `frontend/src/features/panels/ui/PanelCard.tsx:60-127` (`PanelCardBody`): still wires
     `usePanelPolling(refresh, panel.refreshInterval ?? null, getOutputId(panel))` right next to
     `usePanelData`'s `refresh` — the natural D4 call site design.md claims is confirmed unchanged.

5. **No placeholders/hand-waving.** `grep -rniE "TODO|TBD|figure out|to be determined|placeholder"` across
   the whole change directory returned nothing.

6. **No new internal contradictions or scope drift.** The round-2 diff is scoped exactly to CR1 (D6 +
   task 1.4 + one new spec requirement) and the two round-1 non-blocking notes (D5's citation). Nothing
   else in proposal.md, the Non-Goals, or the task list changed. AC-to-task tracing from round 1 (tasks
   1.1-1.3 → C5, 3.1/3.2 → spec Requirements 2/3, 3.3 → the real e2e AC path, 2.3/3.4 → C4) still holds
   unchanged; task 1.4 is the new, correctly-scoped addition for the new requirement.

### Verdict: CONFIRM

CR1 is resolved with a concrete, testable mechanism (not a rewording) — a real retry algorithm, a unit
test that would catch its absence, and a matching spec requirement/scenario — and the two round-1
non-blocking notes were also incorporated with a verified, real existing convention. No new gaps found
on a fresh, independent read against the live worktree.

### Non-blocking notes

- D6 doesn't fully specify whether a mid-stream drop *after* an initial successful connection (but
  still without ever reaching a terminal `run-status`) counts as "the next successful connection" for
  attempt-counter reset purposes, versus treating the whole episode as one failure for backoff-growth
  purposes. This is a minor implementation-level ambiguity (either reading still produces working
  retry/recovery behavior satisfying the AC and the new spec requirement) — flagging for the executor's
  awareness, not blocking.
