## Context

HEL-56 introduced `usePanelData` (`frontend/src/hooks/usePanelData.ts`), which fetches the panel's bound source data on mount and whenever `typeId` or `fieldMapping` changes. It uses a `prevFetchKey` ref to deduplicate re-renders. `refreshInterval` is stored on the `Panel` model but is not read by any hook or component.

The polling behaviour must re-trigger the same fetch that `usePanelData` already performs, without duplicating fetch logic or introducing a second async path.

## Goals / Non-Goals

**Goals:**
- Add a `usePanelPolling` hook that drives repeated data refreshes based on `panel.refreshInterval`
- Pause polling when the tab is hidden; resume on `visibilitychange`
- Clear the interval when `typeId` is removed or the component unmounts
- No polling when `refreshInterval` is null

**Non-Goals:**
- Changing the fetch mechanism inside `usePanelData`
- Websocket / SSE
- Live interval reconfiguration without remount

## Decisions

**D1: Separate hook, not inlining into `usePanelData`**

`usePanelData` already has fetch-deduplication logic tied to `prevFetchKey`. Injecting a polling timer would require resetting `prevFetchKey` on each tick — coupling timer concerns into the fetch layer. A dedicated `usePanelPolling` hook is a cleaner separation.
Alternative: extend `usePanelData` with a `poll` parameter. Rejected because it couples state management and timer management in one hook.

**D2: Polling triggers a `prevFetchKey` reset, not a direct fetch call**

`usePanelData` guards refetches via `prevFetchKey.current === fetchKey`. The polling hook will reset `prevFetchKey` (exposed via a `refresh` callback) so that the existing `useEffect` in `usePanelData` re-runs on the next render cycle. This avoids duplicating fetch logic.
Alternative: expose a `refetch()` function from `usePanelData` directly. This is equivalent but requires more API surface. Instead, we expose a `refresh` callback (a `() => void` from `usePanelData`) that `usePanelPolling` calls on each tick.

**D3: `visibilitychange` pauses/resumes without stacking intervals**

On `visibilitychange` to visible: do not start a new interval if one is already running. Pause by clearing the interval on hidden, restart on visible. This matches the ticket's explicit "stacked intervals" concern.

**D4: Place `usePanelPolling` call in the same component that calls `usePanelData`**

Currently `PanelGrid.tsx` renders each panel card inline. After HEL-56, a `PanelCard` sub-component or `PanelContent` receives the panel; the hook is called in whichever component owns the `usePanelData` call. Lifecycle is tied to that component's mount/unmount, satisfying the "clears on unmount" requirement.

## Risks / Trade-offs

- **Race on visibilitychange + interval fire**: if both fire simultaneously, two fetches may be enqueued. Mitigation: `usePanelData`'s `prevFetchKey` prevents duplicate in-flight requests for the same key, and the refresh callback resets the key atomically.
- **Tab-hidden resume delay**: after returning to the tab, the next poll fires on the next interval tick (up to `refreshInterval` seconds late). Acceptable per spec; an immediate fetch-on-resume is out of scope.

## Planner Notes

Self-approved: no new deps, no API changes, no architectural ambiguity. Hook placement follows existing pattern from HEL-56.
