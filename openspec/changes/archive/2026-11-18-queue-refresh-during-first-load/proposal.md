## Why

Pressing "Refresh dashboard" (or pulling to refresh) while a panel's first rows load is still running sends no request:
the panel's in-flight guard drops the call and the round ends when the first load lands. The press has no effect the
user can see or rely on. The owner ruled (2026-11-17) that it must do something; this change picks **Queue**.

## What Changes

- A dashboard refresh round (button or pull) that reaches a panel whose rows load is in flight queues exactly one
  refresh for that panel, sent once the in-flight load settles.
- The round's busy cue (button spinner, `aria-disabled`, "Refreshing"/"Refreshed" announcement) stays on until the
  queued refresh settles, so the press visibly owns a refresh of its own.
- Repeated presses never multiply requests: the round's existing busy rule ignores presses while it runs, and a panel
  holds at most one queued refresh.
- The per-panel Refresh control, interval polling and the SSE run fan-out keep today's drop-while-in-flight behaviour.

## Capabilities

### New Capabilities

### Modified Capabilities
- `mobile-dashboard-pull-refresh`: a round started while a panel's load is in flight queues one refresh for that panel
  and stays busy until it settles.

## Non-goals

- Cancelling or restarting the in-flight load.
- A "Refresh dashboard" control at widths above 768px (the existing spec forbids it).
- Changing poll, SSE or per-panel Refresh semantics, or insight panels' stored-render refetch.

## Impact

- `frontend/src/features/panels/hooks/usePanelData.ts` (opt-in queued refresh, `isRefreshing` covers the queued gap).
- `frontend/src/features/panels/ui/grid/MobilePanelStack.tsx` (registry calls the queued variant).
- `frontend/src/features/panels/ui/grid/pullRefreshRegistry.ts` (doc comments only, if the round logic holds as-is).
- New e2e `e2e/hel1738-refresh-during-first-load.spec.ts`; unit tests for the hook and registry.
