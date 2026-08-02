## Context

HEL-242 shipped a narrow fix: `PipelineDetailPage.tsx` subscribes to `usePipelineRunEvents`
(fetch+`ReadableStream` SSE, `frontend/src/features/pipelines/hooks/usePipelineRunEvents.ts`) and,
on a `succeeded` terminal event, dispatches `markDataTypeRowsStale(outputDataTypeId)`
(`frontend/src/features/panels/state/panelActions.ts`), which `panelsSlice.ts` handles by
clearing `paginationState` for bound panels so `usePanelData` refetches. This only reaches the
same tab/session that has that page open with an active SSE connection.

**Correction to the ticket's stated premise.** Design question 1 assumed `/api/types/:id/rows`
had no ACL, asymmetric with `PanelService.resolveBindingsForRead`. That gap was closed by HEL-265
(commit `300423d1`), independently of this ticket: `DataTypeService.listRows` now calls
`dataTypeRepo.findByIdOwned` and 404s for non-owners — identical strict-owner-only check to
`resolveBindingsForRead`'s `findByIdsOwned`. **Neither check is sharing-aware.** There is no
`resource_type = 'data_type'` row in `resource_permissions` (`V16__resource_permissions.sql`),
and `DataTypeRepository` has no `findByIdShared`/`helio_can_access_data_type` (unlike
`PipelineRepository`/`DashboardRepository`, which do have sharing-aware lookups, per
`V36__rls_sharing_aware_tables.sql` / `V39__pipeline_sharing_grants.sql`). Practical consequence:
today, when a dashboard is shared and a panel is bound to a DataType the viewer doesn't own,
`resolveBindingsForRead` clears the binding outright (`panel.withBindingCleared`) rather than
rendering stale data. So the "cross-user" gap is narrower than ticket.md describes: it manifests
for the *owning* user's own other sessions/tabs, not for arbitrary dashboard-sharing viewers
(who see no binding at all today, independent of this ticket).

`PipelineRunRegistry` (`backend/src/main/scala/com/helio/api/routes/PipelineRunRegistry.scala`)
is the existing SSE registry precedent: `ConcurrentHashMap[String, ActorRef]` keyed by pipeline
ID, `Source.actorRef(...).preMaterialize()` per subscriber, terminal-event-driven cleanup via
`CompletionStrategy.draining` (the PR #156 fix — `immediately` could close the stream before a
buffered terminal event flushed). It is single-subscriber-per-key today (comment: "single-active-
run assumption") — a `DataTypeRowRegistry` needs many-to-one instead.

## Goals / Non-Goals

**Goals:**
- Recommend an approach (or hybrid) to close the cross-tab and future-row-writer gaps, and the
  cross-user gap as it actually exists (see Context) — not the gap as originally described.
- Ground cost estimates in the existing codebase, not the ticket's original LOC guesses.
- Produce concrete spinoff ticket scope(s).

**Non-Goals:**
- No implementation in this ticket.
- No sharing-aware DataType ACL redesign — flagged as a prerequisite decision, not solved here.
- No generalizing beyond DataType rows (panel layouts, comments, etc.).

## Decisions

**D1 — Ship candidate B (BroadcastChannel) now; it is a strict subset of A's payload shape.**
Cross-tab is same-browser, same-user by construction — no ACL question, no new backend surface.
~30 LOC: post `{dataTypeId}` from the same dispatch site in `PipelineDetailPage.tsx` that already
calls `markDataTypeRowsStale`, and add a listener (e.g. in `panelsSlice`'s store setup or a small
hook) that re-dispatches `markDataTypeRowsStale` on receipt. Ships alongside HEL-242's pattern
with no new infra, no lifecycle risk. Recommend as its own small spinoff ticket, since it's
implementation deliverable independent of A.

**D2 — Recommend candidate A (SSE, `DataTypeRowRegistry`) for the future-row-writer gap, scoped
to owner-only subscriptions matching today's ACL, deferring the sharing-aware question.**
`overwriteRows` (`DataTypeRowRepository.scala`) is already the single chokepoint every writer
(pipeline runs today; snapshot import / batch backfill / scheduled reruns tomorrow) must call —
so a registry `publish` hooked there, rather than inside `PipelineRunService`, closes the
future-writer gap once, for every writer, present or future. This is the strongest argument for
A over C (polling): C's cost scales with visible-panels × poll-rate and doesn't collapse writers
onto one chokepoint. Reuse `PipelineRunRegistry`'s pattern but:
- Key by `dataTypeId`, many-to-one (`ConcurrentHashMap[String, Set[ActorRef]]` or an actor per
  key managing a subscriber set — `PipelineRunRegistry`'s single-`ActorRef`-per-key map does not
  fit; this is new lifecycle code, not a copy-paste).
- Subscription ACL: reuse `dataTypeRepo.findByIdOwned` — the same check `DataTypeService.listRows`
  already applies. This deliberately does **not** close the cross-user gap for sharing-aware
  viewers (there is no sharing-aware check to reuse; building one is a separate, larger decision
  — see Open Questions). It does close the gap for the owning user's other tabs/devices/sessions,
  which is the gap that actually exists today per the Context correction.
- Publish call site: `PipelineRunService.onRunSuccess`, placed **after** `rowsUpsert` completes
  (inside/after the existing `for` comprehension, not colocated with the earlier
  `publish(pidStr, RunStatusEvent("succeeded", ...))` call at line 348) — that earlier publish
  fires *before* `overwriteRows`, which is why HEL-242's client-side dispatch on `succeeded` races
  the DB write today. A's registry publish must not repeat that race.
- Client: extend `usePipelineRunEvents`'s fetch+`ReadableStream` pattern (not `EventSource` —
  cookie auth, HEL-287) into a new `useDataTypeRowEvents({ dataTypeId, active, onUpdate })` hook
  that dispatches `markDataTypeRowsStale` on receipt.
- Lifecycle: explicit cleanup test for "subscriber disconnects without a terminal event" —
  `PipelineRunRegistrySpec.scala` has no such case today (its terminal-event/cleanup path relies
  on eventual publish, not disconnect detection); a many-to-one registry needs disconnect-driven
  removal (e.g. via the materialized `KillSwitch` or stream completion watch) since there's no
  natural "terminal" event for a long-lived row subscription the way there is for a pipeline run.

**D3 — Do not build C (polling) or D (service-worker push) now.** C is strictly dominated by A
for the future-writer gap and adds ongoing server load; keep it noted as a fallback only if A's
timeline slips. D is out of proportion to the actual (narrowed) cross-user gap — building a
sharing-aware push-to-offline-users system before even a sharing-aware *pull* path (D2's deferred
open question) exists would be solving a problem two layers deeper than what's blocking anyone
today.

## Risks / Trade-offs

- [Many-to-one registry lifecycle is materially new code, not a copy of `PipelineRunRegistry`] →
  Mitigate with an explicit disconnect-cleanup test before merging (see D2); budget this as new
  infra, not a small extension, in the spinoff ticket's cost estimate.
- [Publish-after-write reordering changes existing `onRunSuccess` control flow] → Land as a
  small, isolated diff with a regression test asserting registry publish happens after
  `rowsUpsert`, not simultaneously with the existing `RunStatusEvent` publish.
- [Owner-only subscription ACL leaves the cross-user gap open for sharing-aware viewers] →
  Explicitly scope D2's spinoff to say so; do not let it read as "cross-user gap closed" in the
  tracking ticket. File the sharing-aware DataType ACL question as its own ticket (Open Questions).
- [Multi-instance horizon] → In-memory `ConcurrentHashMap`/actor-per-key state doesn't propagate
  across backend instances, same limitation `PipelineRunRegistry` already has today. Not solved
  here; note in the spinoff ticket as a known future migration (e.g. to a pub/sub broker) if
  Helio ever runs multiple backend instances.

## Migration Plan

Not applicable — no schema or behavior changes ship in this ticket. The spinoff ticket(s) (see
tasks.md) carry their own migration/rollout plans once scoped.

## Open Questions

1. Should DataType access ever become sharing-aware (a `findByIdShared` / `helio_can_access_data_type`
   analog to the dashboard/pipeline ones), so that a shared dashboard's panels can show live data
   instead of clearing the binding for non-owning viewers? This is bigger than HEL-266's scope but
   blocks a *complete* fix for the cross-user gap as originally imagined. Recommend a separate
   ticket to decide it, independent of D2's owner-only v1.
2. Confirm real-world DataTypes-per-active-dashboard count before committing to per-`dataTypeId`
   client-side connection sharing sizing (ticket's design question 2) — no telemetry found in this
   investigation; flag as a data-gathering task in the spinoff rather than guessing.

## Planner Notes

- Self-approved: writing this design without a live telemetry number for cross-tab usage
  (ticket's DoD allows "punt" as a valid recommendation if usage is low, but no such number was
  available in this investigation) — recommending a right-sized partial build (B now, A scoped)
  instead of a full punt, since B's cost is low enough to not need justification via traffic data.
- Self-approved: correcting the ticket's ACL-asymmetry premise in this doc via the Explore-agent
  research summarized in Context, rather than treating it as a fixed input — it materially changes
  the "cross-user" cost/benefit calculus in Decisions.
