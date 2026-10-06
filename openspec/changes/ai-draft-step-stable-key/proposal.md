## Why

An AI draft step (`analyzewithai`, `generatetext`) is created only when its config first becomes complete (HEL-1109).
When that create resolves, the draft's temp id (`step-N`) is swapped in place for the server id. Step cards and lanes
are React-keyed by step id, so the card the user is actively editing remounts collapsed mid-edit. Code reading also
indicates that an edit typed while the create is in flight is kept locally but never saved to the server, because a
temp-id step's config PATCH is skipped and the create already sent the older config. HEL-1294 fixed the same remount
for the create-immediately paths by disabling expand while in flight; that cannot work here because the draft is
necessarily already open when its create fires.

## What Changes

- A step created from a draft keeps a stable client-side render identity across the temp-id → server-id swap, so its
  card (and, if it heads a lane, its lane) is not remounted: it stays expanded and keeps its in-progress editor state.
- That render identity survives later full-list resyncs for the same persisted step.
- If the draft's local config changed while its create was in flight, the latest config is saved to the created step
  once the create resolves (conditional on the probe confirming the drop).
- HEL-1294's create-immediately paths (append, insert-between, lane add) are unchanged.

## Capabilities

### New Capabilities

### Modified Capabilities
- `pipeline-ai-step-authoring`: adds a requirement that creating a completed draft neither collapses its open card nor
  loses an edit made while the create is in flight.

## Impact

Frontend only: `usePipelineDetailPage.ts` (draft create swap, `syncStepsFromServer`), the `Step` type, and the render
key sites in `PipelineRiverView.tsx` / `LaneColumn.tsx` (and `RootColumn.tsx` if it keys lanes). New RTL test. No
backend, schema, or API change.

## Non-goals

- Changing HEL-1294's in-flight tracking or the disabled-expand behaviour on create-immediately paths.
- Converting the HEL-1294 paths to the stable-key mechanism (noted as a possible follow-up only).
- The draft path's lack of a full resync after a positional insert (pre-existing; out of scope, note only).
