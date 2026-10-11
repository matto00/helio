## Why

`usePipelineDetailPage.ts` is still 816 lines after HEL-1465, and an existing hooks-lint suppression on its debounced
re-analyze effect hides 7 `react-hooks/refs` errors (render-time ref reads/writes) from the React Compiler lint. Those
errors block moving that effect out, and the rest of the host can't shrink until they are fixed.

## What Changes

- Fix the 7 render-time ref accesses in the host so the compiler lint passes on it with no suppression masking it.
  This is a declared behaviour-adjacent change, proven equivalent by characterization tests committed green on base.
- Move the debounced re-analyze effect out of the host into a sub-hook (byte-proven move).
- Extract the host's remaining contiguous clusters (run-stream terminal handling, page load, outputs/output-sheet/
  search-param, source edit + schedule toggle, run/dry-run/save/cancel) into in-place sub-hooks (byte-proven moves).
- Fold-ins: correct the stale "debounce effect below" comment in `usePipelineAnalyzeDeferWatchdog.ts`; retitle the
  lookup scenario in `pipeline-analyze-schema-warnings` to the editor's labels.

## Non-goals

- `useStepCardState.ts` (602 lines) and trimming `usePipelineStepStructure.ts` (271): filed as a follow-up ticket.
- Bringing the host itself under ~250 lines. What remains is state declarations and the return object; shrinking them
  needs a non-verbatim restructuring.
- Any change to analyze/run/save behaviour, request counts, render counts or DOM.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

(none) No requirement text changes. The `pipeline-analyze-schema-warnings` scenario retitle is a direct canonical-spec edit,
because an OpenSpec MODIFIED delta cannot rename a scenario (validate rejects the dropped old title). The change sets
`skip_specs: true`.

## Impact

- Frontend only: `frontend/src/features/pipelines/hooks/usePipelineDetailPage.ts`, new sibling sub-hooks,
  `usePipelineAnalyzeDeferWatchdog.ts` (comment), possibly `usePipelineStepCreation.ts` (draft-id mirror, design D1c).
- No API, schema or migration change.
