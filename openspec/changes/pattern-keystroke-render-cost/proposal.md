## Why

HEL-1808 attributed every long task in the HEL-1683 regex probe's control window to the Pattern field's own synchronous
input handler (41-97 ms of script at 4x-6x CPU throttle, dev build). That handler re-renders the pipeline page, re-walks
the saved step, and the draft preview table's scroll-edge hook adds 13-18 ms per update on large frames. This work is the
probe's remaining margin against its 100 ms bound, and it is felt by every user editing a draft.

## What Changes

- Profile one Pattern keystroke on a dev build and a production build: which components re-render and why, how many
  client walks run (saved vs draft), and the scroll-edge hook's cost on a 1,000-row frame. Commit these "before" profiles.
- Narrow the re-render to what the keystroke actually changes (memoisation, state colocation or selector fixes, whichever
  the profile supports).
- Saved-pipeline walk: the profile found no repeated saved walk to stop (one walk on the first edit of a pipeline with no Output, none later); met by evidence under the owner ruling `proceed-without-claim-2`, and guarded by a test. No code change.
- Make the scroll-edge cost lower: no state update (and no re-render) when the edges did not change, and keep the preview
  grid mounted across the first edit so the mount-time forced layout disappears. Observer-burst coalescing was not done: the
  profile showed no bursts (design.md D4).
- Add a non-flaky regression test (render/walk counts, not wall-clock) for each fix.
- Commit "after" profiles under the same method, including the HEL-1683 probe's control-window input-handler cost under
  HEL-1808's attribution logging, before vs after.

No user-visible behaviour changes: draft preview results, counts, flashes, scroll shadows and request timing stay the same.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This is a behaviour-preserving performance change; `.openspec.yaml` sets `skip_specs: true`.

## Impact

- Frontend only: `frontend/src/features/pipelines/**` (draft frames/page hooks, step config UI), `frontend/src/shared/ui/
  useScrollEdges.ts` (also used by `DataGrid`, `SortableTable`, `EditFormScrollArea`).
- Evidence under this change directory (`*.txt`, `*.md`). No backend, schema, migration or API change.

## Non-goals

- Running the probes on a production build in CI (HEL-1816).
- Changing the HEL-1683 probe's windows, frame or 100 ms bound.
- Moving work out of the input event without reducing it (see design.md D2).
