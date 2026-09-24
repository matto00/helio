# HEL-1095: Optimistic pending state on the writing panel

## Description

The writing panel shows its new value immediately with a pending affordance, reconciling on refresh. A counter must never feel laggy.

## Acceptance Criteria

- The optimistic value is replaced by the authoritative one on run success.
- The optimistic value is rolled back with a visible error on failure.

## Design spec

`docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md`, epic 4 "Write → run → refresh loop", bullet "Optimistic state" (PR #627).

## Context gathered during premise validation (Setup)

See `premise-validation.md` (persisted via `persist-evidence.sh`) for the full detail. Summary:

- HEL-1093/1094/1168/505 (write→debounce→tick→submit, run guards, SSE fan-out, cross-instance broadcast) are all merged and confirmed accurate. The HTTP submit response returns well before any downstream run exists (worst case ~35s, HEL-1167 tracks reducing it).
- The backend cheapness verdict (`PipelineCostEstimator`) is **already wired into HEL-1093's trigger path** — a denial is already computed and logged per-write. HEL-1096 (still Backlog) owns only the UI surface for *why* a denied pipeline didn't run, not the gate itself.
- `FormPanelView.tsx`'s `handleImmediateStep` (HEL-1087, already shipped) already implements an optimistic local tally that reverts on submit-request rejection/network failure — this is half of this ticket's AC, already done. What's missing: a pending affordance beyond the submit button's own `aria-disabled` (no `aria-busy` on the counter control itself), any reconciliation against a server-fetched authoritative value, and any rollback path for a downstream-run failure/denial arriving asynchronously.
- There is no "authoritative value" for a counter/dataset field anywhere in the system today — no aggregate-sum endpoint, no current-value field on `DatasetFieldResponse`. `usePanelRunRefresh` (HEL-1094) resolves a pipeline via `useOutputMeta(outputId)` — it applies to Output-bound panels, not to a form panel bound to a `dataSourceId`. There is no authenticated route exposing "which pipeline(s) read this data source" to the frontend today.

## Open product questions raised for Planning's design gate

1. What is "the authoritative value" for a counter? The dataset's own aggregate (sum of `delta` across rows for `sourceField`, computed independent of any downstream pipeline), a downstream Output's value, or both depending on binding? What happens when the dataset has no downstream pipeline, or only pipelines the cheapness gate denies — the pending state must never spin forever.
2. What counts as "failure" for rollback purposes, given the async chain: submit-request failure (400/network) vs. a downstream run `failed` event vs. a guard rejection/gate denial that produces no run at all? A write that persisted (the row exists) must not be silently rolled back just because a downstream run failed or never happened — that would misrepresent state that is actually true.
3. Rapid-click accumulation: ten increments during one pending window must accumulate optimistically and reconcile correctly with no flicker back to a stale value when an intermediate refresh lands.
