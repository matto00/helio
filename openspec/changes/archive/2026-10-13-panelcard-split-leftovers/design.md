## Context

See proposal.md - Why. Ground truth at origin/main 290ab8a22:

- `frontend/src/features/panels/ui/PanelCard.test.tsx`: 807 lines, 9 `describe` blocks, 36 tests (26 `it` plus `it.each` tables at :458 (4 rows), :700 (4) and :718 (2)), one shared
  preamble (lines 1-114: module mocks for `usePanelData`, `usePanelPolling`, `usePanelRunRefresh`, `outputService`,
  `panelService`, plus `noopProps`). Sibling split files already exist (`PanelCard.<topic>.test.tsx`,
  `PanelCardBody.<topic>.test.tsx`), so the naming convention is set.
- `editors/AppearanceEditor.tsx` takes `showChartSection`; its only render site is `PanelDetailModal.tsx:270-284`,
  which passes `false`. So `editors/ChartAppearanceEditor.tsx` (series colours, legend, axes, chart-type radios) is
  never rendered. `usePanelDetailEditState.ts`'s `chartAppearance` state and `panelDetailChartState.ts`'s
  `buildInitialChart` (HEL-1378's fix) feed only that prop; `handleEditSubmit` never reads `chartAppearance`.
- `PanelDetailModal.chartTypeDefault.test.tsx` (HEL-1378) wraps `AppearanceEditor` to capture `props.chartAppearance`
  (tests 1-2) and separately asserts a title-only save writes no `appearance.chart` (test 3).
- The chart Display section lives in the Output editor (`OutputKindFields.tsx` renders `ChartDisplayFields` under its
  own `Chart type` `Select`), not the panel modal.

## Goals / Non-Goals

**Goals:** behaviour-preserving split, dead-code removal, pointer fixes, each with grep or test-count evidence.

**Non-Goals:** see proposal.md - Non-goals. No change to what the panel modal renders or saves.

## Decisions

**D1 - Split by the module each block exercises, preamble duplicated per file.** Proposed mapping (executor confirms
by reading each block; moving a block between files is fine if its subject says otherwise, but every test lands in
exactly one file):
- `PanelCardHeader.test.tsx`: F-128 header actions (6), F-099 drag handle (1), HEL-706 duplicate guard (3) - header
  menu/handle controls (source lines 166-269, 335-427).
- `PanelCardHeader.refreshFullscreen.test.tsx`: HEL-579 refresh placement (1 + `it.each` x4), HEL-579 refresh
  activation (3), HEL-584 fullscreen (4 + `it.each` x4 + `it.each` x2) - header view controls (428-574, 662-807).
- `PanelCardBody.test.tsx`: HEL-576 invalid-data badge (4), HEL-539 error retry (2), HEL-579 prop reference stability
  (2) - body rendering and memo behaviour (115-165, 270-334, 575-661).
Totals 10 + 18 + 8 = 36. Each file stays under 500 lines with its copied preamble.
- `PanelCard.test.tsx` deleted if empty, or kept only for blocks that genuinely exercise the composition.
Each new file carries only the mocks/fixtures its own blocks use; a mock is dropped from a file only when no test in
that file can reach the mocked module (otherwise keep it verbatim - an unmocked `usePanelRunRefresh` changes timing,
per the preamble's own comment). Test names, `describe` titles and bodies byte-identical. Alternative (a shared
`PanelCard.testSupport.tsx` for the preamble) rejected: `jest.mock` hoisting is per-file, so a shared module cannot
carry the mocks, and a half-shared preamble obscures which file mocks what.

**D2 - Remove the whole unrendered chart-appearance path, not only its radio group.** Removing `showChartSection`
while preserving behaviour means never rendering `ChartAppearanceEditor`, which makes all of it dead, not only the
chart-type radios. Delete `ChartAppearanceEditor.tsx`; drop `showChartSection`/`chartAppearance`/`setChartAppearance`
from `AppearanceEditor`; drop `chartAppearance` state, its reset line and its return fields from
`usePanelDetailEditState`; delete `panelDetailChartState.ts`. CSS: delete a rule from `PanelDetailModal.appearance.css`
(or any sibling) only when a repo-wide grep of its class finds no other user; a class pinned by a CSS-lock test (e.g.
`panel-detail-modal__chart-label` in `PanelDetailModal.css.test.ts`) or used by `ChartDisplayFields`/the Output editor
stays. Alternative (delete only the radio section, keep the prop) rejected: leaves the ticket's named dead prop and a
dead editor in place.

**D3 - HEL-1378 overlap.** HEL-1378 is Done; its fix is in `buildInitialChart`, deleted by D2. Its tests 1-2 assert the
value handed to the deleted editor and have no remaining subject: delete them, with the reason in the commit and
files-modified. Test 3 (title-only save writes no `appearance.chart` / `chartType`) still guards a live path and stays
byte-identical; only the now-dead `AppearanceEditor` capture wrapper and unused imports are removed from that file. This
is the one deliberate exception to "tests unchanged except moves and imports": tests of deleted code go with it.

**D4 - Pointer fixes are comment/spec-only.** `PanelCard.crossFilter.test.tsx:162` -> `OutputPanelContent.tsx`'s
`filteredPaginationRows`; `usePanelSortFilter.ts:79` -> `PanelCardBody`'s `useOutputMeta(outputId)`;
`ChartDisplayFields.tsx` header -> the Output editor's chart type selector (`OutputKindFields.tsx`), dropping the
`BindingEditor`/Appearance-section claims after confirming them false by grep. Spec: MODIFIED delta in
`specs/chart-type-config-editor/spec.md`. Same-class pointers found by the grep sweep in tasks 4.x are fixed too;
anything else stale is reported, not fixed.

## Risks / Trade-offs

- [A split file drops a mock a test silently depended on, passing for a different reason] -> per-file counts and names
  compared before/after from `jest --listTests`/`--verbose` output; every test run in the new file, and the original
  file's run recorded on the base commit for comparison.
- [CSS class removal breaks a CSS-lock or token-audit test] -> grep-before-delete per class; full frontend jest
  sharded in the foreground.
- [Deleting HEL-1378 tests reads as weakening coverage] -> D3 states the reason; test 3 keeps the live guarantee.

## Planner Notes

- Self-approved: D2's wider removal (ticket names the section and the prop; removing the prop forces the rest).
- Self-approved: D3 (removing tests whose subject is deleted). Flagged to the driver in the run report.
- Follow-up candidate: re-audit `chart-type-config-editor` requirements 2-3, which still name the panel edit pane.
