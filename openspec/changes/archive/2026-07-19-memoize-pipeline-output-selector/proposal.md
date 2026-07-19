## Why

`selectPipelineOutputDataTypes` derives a filtered array with `.filter(...)` on every call, so it
returns a fresh reference each render even when its input state is unchanged. React-Redux detects the
new reference and logs "Selector returned a different result when called with the same parameters"
(seen at `MarkdownEditor.tsx:33`), defeating render bailout and spamming the console across every
bound editor (Metric/Text/Markdown/Collection) plus the Type Registry, sidebar, and panel-creation
flow.

## What Changes

- Memoize `selectPipelineOutputDataTypes` with reselect's `createSelector` so it returns a
  referentially stable array while `state.dataTypes.items` is unchanged.
- The selector's derivation (filter `sourceId === null`) and public signature stay identical — all
  existing consumers keep working with no call-site changes.
- Add a unit test proving reference stability across unrelated state changes.

## Capabilities

### New Capabilities

- `pipeline-output-type-selector`: the memoized derived-state selector that surfaces pipeline-output
  DataTypes with a stable reference for unchanged input.

### Modified Capabilities

<!-- None — no existing spec-level requirement changes; this documents a new derived-state contract. -->

## Impact

- `frontend/src/features/dataTypes/state/dataTypesSlice.ts` (selector definition).
- `frontend/src/features/dataTypes/state/dataTypesSlice.test.ts` (stability test).
- No API, schema, or backend impact. `reselect` is already a transitive dependency of
  `@reduxjs/toolkit`; no new dependency.
- All consuming call sites are read-only via `useAppSelector` and unaffected.

## Non-goals

- No change to which DataTypes are returned or their ordering.
- No refactor of consuming editors or of other selectors in the slice.
