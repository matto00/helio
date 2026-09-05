## Why

`nodePath()` (frontend/src/features/pipelines/state/nodePath.ts) is thoroughly unit-tested as a pure function but
nothing asserts that the app calls it. HEL-968 shipped exactly this shape of defect: a correct, unit-tested
`nodePath()` with zero call sites, so no lane path rendered anywhere. Every gate was green — lint, typecheck, and
2636 Jest tests — because deleting a call site is perfectly well-typed. Only a cold skeptic checking the live DOM
caught it. The call site now exists, but the suite would not notice if a refactor dropped it again.

## What Changes

- Add a component-level Jest regression guard that renders `PipelineRiverView` with a two-root, multi-step fixture
  and asserts on **rendered output** — a step element's `title` attribute matching the R5 format
  `root:<rootId> > <stepId>` — rather than on the function's return value.
- Cover both the root-level base case (a step directly on a root) and a multi-level lane chain, and cover every
  rendered `title` site the wiring flows through: the direct one in `PipelineRiverView.tsx` and the `LaneColumn.tsx`
  ones reached via `nodePathByStepId` threaded through `RootColumn.tsx`.
- Prove the guard is real by two independent mutations, each with a recorded red transcript: (a) deleting the
  `nodePath()` call in `PipelineRiverView.tsx`, and (b) breaking `nodePath()`'s own logic. Both are then reverted.

## Non-goals

- No product behavior change. Any non-test edit is confined to a genuine testability seam and justified in design.md.
- No E2E/Playwright test — a component-level Jest test is the cheaper check with the same load-bearing property.
- No change to `nodePath()`'s semantics, the R5 format, or the existing pure-function unit tests.
- No new migration (the dev Postgres is shared with concurrent runs), no backend change, no dependency addition.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This is a test-only change: it adds a regression guard over already-specified rendering behavior and changes
no requirement. `.openspec.yaml` sets `skip_specs: true` accordingly rather than inventing a requirement to satisfy
validation.

## Impact

- `frontend/src/features/pipelines/ui/PipelineRiverView.test.tsx` (new assertions, and the two-root fixture they need).
- Read-only reference: `PipelineRiverView.tsx`, `LaneColumn.tsx`, `RootColumn.tsx`, `state/nodePath.ts`.
- No API, schema, dependency, or backend impact.
