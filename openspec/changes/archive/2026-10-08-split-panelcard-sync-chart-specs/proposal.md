## Why

`PanelCard.tsx` is 844 lines, over CONTRIBUTING's ~400-line split threshold, and has absorbed the seams two closed
duplicates (HEL-1183, HEL-1201) proposed. HEL-1351 also left two specs describing behaviour the code no longer has, and
one cosmetic Inspect inconsistency.

## What Changes

- Split `PanelCard.tsx` into single-concern modules (behaviour-preserving, moved code byte-identical):
  `PanelCardBody.tsx` (data body + sort/filter/controls/cross-filter wiring + live region), `PanelCardHeader.tsx`
  (title-edit chrome + action controls), `usePanelCardInspect.ts` (Output/inspect/cross-filtered-rows wiring), a pure
  `controlResultCountText` module; `PanelCard.tsx` remains the desktop grid host.
- Update importers (MobilePanelStack, tests) to import-path-only changes; refresh prose comments that name the old
  file for moved code.
- Sync `panel-appearance-settings` (resolver order) and `chart-type-selector` (no selector in the detail modal) specs.
- Item 3 (aggregated-chart Inspect column order): investigate only. The live Inspect `headers` are the first record's
  keys, so both Inspect branches already agree; no code change, evidence recorded, owner question raised (see design D7).
- Correct the false "genuinely SETTLED baseline" comment in `PanelCard.test.tsx`.

## Capabilities

### New Capabilities

### Modified Capabilities
- `panel-appearance-settings`: absent `chartType` resolves via the panel → Output → line resolver, not "line".
- `chart-type-selector`: the panel detail modal exposes no chart type selector; chart type is chosen on the Output.

## Non-goals

- Any behaviour change in the split; any bug found becomes a follow-up (e.g. HEL-1380's redundant render — queued).
- Splitting `PanelCard.test.tsx` (801 lines) or deleting the dead `ChartAppearanceEditor` chart-type section.
- Trimming verbose comments in moved code (moved verbatim).

## Impact

Frontend only: `frontend/src/features/panels/ui/PanelCard*.tsx`, new sibling modules, `grid/MobilePanelStack.tsx`,
PanelCard/PanelCardBody test imports, comment-only touch-ups in sibling files, two spec files (+ the `chart-type-selector`
Purpose line). No API, schema, or backend change.
