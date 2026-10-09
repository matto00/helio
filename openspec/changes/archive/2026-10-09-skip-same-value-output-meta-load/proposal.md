## Why

`useOutputMeta` (frontend/src/features/panels/hooks/useOutputMeta.ts) initialises `isLoading` to
`true` on a cache-miss mount and then its effect queues a microtask that calls
`setIsLoading(true)` again. React bails out of committing a same-value update but still re-invokes
the component function once, so every cache-miss panel mount pays one wasted render of
`PanelCardBody` (and of each other hook consumer). HEL-1215 had to add a test-side absorption for
the resulting Scheduler-timed render; the waste remains in production (HEL-1380, follow-up of
HEL-1215). HEL-1365 (the PanelCard split this was sequenced after) has merged.

## What Changes

- `useOutputMeta` no longer queues a state update whose value equals the current state on mount:
  the cache-miss `setIsLoading(true)` is queued only when the hook is not already loading (it is
  still queued when `outputId` changes from a loaded/absent Output to an uncached one), and the
  `outputId === null` branch's `setOutput(null)`/`setIsLoading(false)` is skipped when both are
  already at those values.
- New render-count tests (red on the pre-fix hook, green after, exact counts): `PanelCardBody`
  on a cache-miss mount, and a null-`outputId` consumer with another pending mount-time update.
  Plus hook-level GUARD tests pinning loading-state transitions (mount, id change to uncached id,
  id change to null, resolve, reject, cache hit).
- HEL-1215's comments in `PanelCard.test.tsx` that describe the now-removed redundant update are
  corrected.
- Public shape of `useOutputMeta` (`(outputId: string | null) => { output, isLoading }`) is
  unchanged.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

(none) — no externally observable behaviour changes; this is a render-efficiency fix. The change
sets `skip_specs: true`.

## Impact

- `frontend/src/features/panels/hooks/useOutputMeta.ts`
- New test file for the hook, a render-count test near `PanelCard.test.tsx`/`PanelCardBody`
- Comment corrections in `frontend/src/features/panels/ui/PanelCard.test.tsx`
- No API, schema, backend, or dependency changes.
