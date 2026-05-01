# HEL-156: Frontend: accumulate and debounce-flush changes via batch endpoint

## URL
https://linear.app/helioapp/issue/HEL-156/frontend-accumulate-and-debounce-flush-changes-via-batch-endpoint

## Description

Extend the frontend write flush to cover all write types through the new resource-oriented endpoints introduced in HEL-155, not just layout.

## Goal

Currently only layout changes are flushed via a debounced dispatch (`updateDashboardLayout` → `PATCH /api/dashboards/:id/update`). Panel appearance, title, and type changes still fire individual `PATCH /api/panels/:id` calls per interaction. This ticket accumulates pending panel changes in Redux and flushes them in a single `POST /api/panels/updateBatch` call on a debounce interval.

## Endpoints (from HEL-155)

| Change type | Endpoint | Thunk |
| -- | -- | -- |
| Dashboard layout | `PATCH /api/dashboards/:id/update` | `updateDashboardLayout` (already wired) |
| Panel appearance / title / type | `POST /api/panels/updateBatch` | `updatePanelsBatch` (scaffolded in HEL-155, not yet called) |
| User preferences | `PATCH /api/users/me/update` | `updateUserPreferences` (wired in HEL-157) |

## Scope

* Accumulate pending panel write operations in Redux (appearance, title, type changes)
* Flush via `updatePanelsBatch` on the same 250ms debounce used by layout, or a unified flush interval
* Optimistic UI updates apply immediately; server confirmation is async
* Dashboard-level changes (name, appearance) continue to fire immediately via `PATCH /api/dashboards/:id` — no accumulation needed since they are infrequent single-field writes

## Out of Scope

* User preference persistence (HEL-157)
* Layout accumulation (already done)

## Acceptance Criteria

* Panel appearance, title, and type changes are accumulated in Redux state (a pending-writes map keyed by panel ID)
* Changes are flushed to `POST /api/panels/updateBatch` on a 250ms debounce (matching the layout flush interval)
* Optimistic updates apply immediately to Redux state; the batch flush happens asynchronously in the background
* Individual `PATCH /api/panels/:id` calls for appearance/title/type are removed and replaced by the accumulation pattern
* The existing `updatePanelsBatch` thunk (scaffolded in HEL-155) is wired up and called
* Layout debounce behavior is unchanged
* All existing tests pass; new tests cover the accumulation and flush behavior
