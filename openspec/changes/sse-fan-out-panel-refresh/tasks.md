## Standing Constraints

- [C1] Migration ledger: V110 is highest on main; V111 is free if a migration is needed (not expected — this change is frontend-only). Claim explicitly before use; follow FORCE RLS conventions for any new/altered table.
- [C2] Show the red: the refetch-on-SSE assertion in the e2e/UI test must be proven to fail with the fan-out mechanism disabled before it is trusted as a real gate.
- [C3] Every `git commit` runs with Bash timeout 600000ms; never re-run a commit while one is in flight; never `git add -A` (explicit paths only).
- [C4] a11y: assert COMPUTED ARIA state for any announced update, never mere presence of an aria-live region (HEL-1084 C8).
- [C5] Never open more than one SSE connection per relevant pipelineId per dashboard page — consolidate per-pipeline subscriptions and fan out in the frontend.
- [C6] Refetch only the panels actually bound to the pipeline that just succeeded — no dashboard-wide re-render storm.

## 1. Frontend — Fan-out manager

- [x] 1.1 Add `frontend/src/features/panels/services/pipelineRunFanout.ts`: a module-scoped, ref-counted manager exposing `subscribeToPipelineSucceeded(pipelineId, onSucceeded): () => void`, opening exactly one `fetch`-based SSE connection per `pipelineId` (parsing `event: run-status` / `data: {"status": ...}` frames, minimal — status only) and reconnecting after every terminal status while at least one listener remains. Verify with a unit test asserting only one `fetch` call is made for two concurrent subscribers to the same `pipelineId`.
- [x] 1.2 Verify the manager closes its connection (no further `fetch` calls, `AbortController.abort()` invoked) when the last listener for a `pipelineId` unsubscribes — unit test.
- [x] 1.3 Verify the manager reconnects (issues a second `fetch`) after a `succeeded` event while a listener remains subscribed, and stops reconnecting once all listeners have unsubscribed — unit test.
- [x] 1.4 Add `computeRetryDelayMs(attempt)` (exported pure function, `Math.min(1000 * 2 ** attempt, 30000)`) and wire the manager to retry `connect()` after that delay on a non-terminal connection failure (non-2xx response, non-SSE content-type, network error, or an unexpected stream end/error with no terminal `run-status` ever received) — per design.md D6 (skeptic design-gate round 1, CR1). Verify with a unit test (fake timers) that a simulated connect failure is followed by exactly one retry `fetch` call after the computed delay, and that a subsequent successful connection resets the attempt counter to 0.

## 2. Frontend — Panel integration

- [x] 2.1 Add `frontend/src/features/panels/hooks/usePanelRunRefresh.ts`: resolves `pipelineId` via `useOutputMeta(outputId)` and calls `subscribeToPipelineSucceeded(pipelineId, refresh)` in a `useEffect` with cleanup on unmount/`outputId` change; no-ops when `outputId` is null. Verify with a unit test that `refresh` is invoked when the manager delivers a `succeeded` event and is NOT invoked after unmount.
- [x] 2.2 Wire `usePanelRunRefresh(getOutputId(panel), refresh)` into `PanelCardBody` (`PanelCard.tsx`), alongside the existing `usePanelPolling` call. Verify by reading the diff: both hooks receive the same `outputId`/`refresh` values.
- [x] 2.3 Add a visually-hidden `role="status"` region per output-bound panel in `PanelCardBody`, whose text updates (with a changing suffix, e.g. a counter) on each fan-out-triggered refetch completion. Verify via a component test asserting the region's accessible text changes (not merely re-renders) across two refetches.

## 3. Tests

- [x] 3.1 Add a unit test for `pipelineRunFanout.ts` proving two panels bound to Outputs of the SAME pipeline both receive the `succeeded` callback from one underlying connection (per C5) — this is the test that must first be shown RED with fan-out disabled/reverted (per C2) before being shown GREEN.
- [x] 3.2 Add a unit test proving a panel bound to a DIFFERENT pipeline's Output does not refetch when an unrelated pipeline succeeds (per C6).
- [x] 3.3 Add/extend an e2e test (Playwright) driving the REAL chain: dataset write via a form panel submit → debounce → scheduler tick (test-accelerated `SCHEDULER_TICK_INTERVAL_SECONDS`, stated explicitly in the test/PR) → run succeeds → SSE `succeeded` → bound chart panel visibly updates, with no manual refresh and no page reload. State plainly in the PR which tick-interval config the e2e ran with.
- [x] 3.4 In the same or a dedicated a11y test, assert the COMPUTED accessible name/description of the panel's status region actually changes on refresh (Playwright accessibility snapshot), never merely that an `aria-live`/`role="status"` attribute is present in markup (per C4).
