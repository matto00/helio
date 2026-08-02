# HEL-266: Cross-session panel cache invalidation — design dataTypeId-keyed SSE broadcast (or alternative)

## Description

Follow-up from HEL-242. The narrow fix shipped under HEL-242 closes the P0 trust failure for the dominant flow (user runs a pipeline from PipelineDetailPage; their dashboard panels in the same tab refresh). Three gaps remain:

1. **Cross-tab** — two tabs in the same browser, one running the pipeline, the other showing the dashboard. The dashboard tab stays stale until reload.
2. **Cross-user** — user A runs a pipeline whose output is bound to user B's panels (via dashboard sharing). User B's panels stay stale.
3. **Future row writers** — only `PipelineRunService.onRunSuccess` calls `dataTypeRowRepo.overwriteRows` today. Any future writer (snapshot import, batch backfill, external Spark job that lands rows here, scheduled pipeline reruns) would need to wire in the same client-side invalidation, easy to miss.

## Goal

Investigate and design a unified solution. Don't ship anything in this ticket — the goal is a design proposal so the implementation ticket can scope cleanly.

## Candidate approaches to evaluate

### A — `dataTypeId`-keyed SSE broadcast channel (server-pushed)

* New `DataTypeRowRegistry` (analog to `PipelineRunRegistry`) keyed by `dataTypeId`, many-to-one (multiple subscribers per dataTypeId)
* New `GET /api/types/:id/rows/stream` SSE route
* `PipelineRunService.onRunSuccess` publishes `RowsUpdatedEvent(dataTypeId, rowCount)` after `overwriteRows`
* Frontend: hook subscribes; on event, dispatches `markDataTypeRowsStale`
* Closes all three gaps; single backend chokepoint at `overwriteRows`
* **Costs**: ~150–300 LOC; new SSE infrastructure pattern; connection scaling concern (per-`dataTypeId` ref-counted connection sharing needed); Pekko Stream lifecycle tests required (this is the class of bug that produced #156 — `CompletionStrategy.draining` lesson applies)

### B — BroadcastChannel API (frontend-only, in-browser only)

* Frontend tab-A dispatches `markDataTypeRowsStale` AND posts it to a `BroadcastChannel`; other tabs listen and re-dispatch
* Closes the cross-tab gap only; doesn't help cross-user or future writers
* ~30 LOC; very low risk; could land alongside the narrow fix

### C — Polling fallback (frontend)

* `usePanelData` polls `/api/types/:id/rows` on a configurable interval when the panel is visible
* Simple, no infra changes; not real-time
* Costs server load proportional to visible-panels × poll-rate

### D — Server-Sent Push + Service Worker

* Heavier-weight; closes cross-user even when target user has the tab closed (push notification → page reload on visit)
* Probably overkill for the use case; flagged for completeness

## Design questions to resolve before implementation

1. **ACL on the subscription endpoint** — `/api/types/:id/rows` is currently NOT user-scoped (asymmetric with `PanelService.resolveBindingsForRead` which IS user-scoped). The new SSE endpoint should pick a consistent stance. Probably: same rule as panel rendering (any user who can see a panel bound to this DataType can subscribe). This may require closing the asymmetry first.
2. **Connection scaling** — how many open SSE connections per typical user? Per-`dataTypeId` ref-counted sharing on the client side reduces 1-connection-per-panel to 1-per-dataTypeId. Need a number-of-DataTypes-per-active-dashboard estimate.
3. **Server lifecycle** — when the last subscriber unsubscribes, the registry actor should clean up. PR #156 lesson (`CompletionStrategy.draining`) applies. Lifecycle test required.
4. **Multi-process / multi-instance** — single-server today, but if Helio ever runs multiple backend instances, in-memory registry doesn't propagate. Need to design with that horizon in mind even if not solving it today.
5. **Backwards compatibility** — should panels without subscription support degrade gracefully (work but stay stale)? Yes — narrow fix from HEL-242 covers same-tab same-user.

## Definition of done (this investigation ticket)

* Design proposal as an OpenSpec change folder with proposal.md + design.md
* Cost estimates: LOC, infra, test surface
* Recommendation: which approach (or hybrid), or "punt — narrow fix is sufficient given low cross-tab usage telemetry"
* Spinoff implementation ticket(s) created with concrete scope

## Out of scope

* Implementation (this ticket is design only)
* HEL-242 work (already shipped)
* Generalizing beyond DataType rows (e.g. live-updating panel layouts, comments, etc. — those have their own use cases)

## Related

* HEL-242 — narrow fix already shipped (closed P0 for same-tab single-user flow)
* HEL-239 (parent epic) — Panel System v2
* PR #156 — `PipelineRunRegistry` `CompletionStrategy.draining` fix (same class of Pekko Stream lifecycle bug to watch for)
