# HEL-1615 probe evidence

Lane backend (DB `helio_hel1615`, `ANTHROPIC_API_KEY` empty), dev server on 7047, backend on 9954. Probe =
`e2e/hel1615-panel-modal-appearance-save.spec.ts` (raw output: `probe-run-red.txt`). Seed: Output `config.chartType`
`bar`; each panel stores `appearance.chart.chartType = "pie"` (distinct from `bar` and the `line` fallback), background
`#112233`, color `#aabbcc`, transparency `0.555`. Client state is read from the react-redux store (fiber walk); rendered
type from the live ECharts option.

## (a) API probe: the modal's exact batch body (title + {background,color,transparency 0.56})

Before: `{"background":"#112233","chart":{... "chartType":"pie" ...},"color":"#aabbcc","transparency":0.555}`
Body: `{"fields":["title","appearance"],"panels":[{"id":..,"title":"HEL-1615 A api renamed","appearance":{"background":"#112233","color":"#aabbcc","transparency":0.56}}]}`
After: same background, color, FULL `chart` (pie) retained; `transparency` **0.56** (0.555 lost); title updated.

=> Server merge keeps `appearance.chart`/background. No server-side chart loss.

## (b) Real modal (Panel actions -> Customize), read AFTER save and BEFORE any flush

- B title-only: pending = `{appearance:{background:"#112233",color:"#aabbcc",transparency:0.56},title}`. Redux
  `panel.appearance` has NO `chart` key; transparency 0.56. **Rendered chart type: `bar`** (stored `pie` lost).
- C background-only: same: chart dropped from client state, transparency 0.56, rendered `bar`.
- D two saves (background then color): pending carries both only because every save re-sends all three scalar keys; this
  is the shallow-replace hazard once only changed fields are sent (design Decision 2/2a).
- OutputControlsEditor / subtype editors: in these runs no subtype was dirty and the batch body contains no `config`;
  subtype saves use their own typed thunks (code reading, `PanelDetailModal.handleEditSubmit`).

After the flush (`Save now`, updateBatch 200; batch body `[{B title+appearance},{C appearance},{D appearance}]`):
server and client both hold `chart.chartType "pie"`, rendered `pie` (the `updatePanelsBatch.fulfilled` merged copy heals
the client). Server transparency is **0.56** for B, C, D (permanently changed from 0.555).

## Verdict

- Server: chart/background/color NOT lost (merge works). Transparency IS silently mutated 0.555 -> 0.56 (modal rounds to
  a whole percent and always re-sends it) -- persisted data change, a real bug.
- Client: stored `appearance.chart` IS dropped from Redux and the panel renders the Output's `bar` instead of the stored
  `pie` from the modal save until the batch flush (up to 30 s auto-save), then heals.
- Fix per design: accumulator merges appearance over stored and over prior pending; modal sends only changed keys.

## After the fix (green) and mutation checks

- Red (committed, `red-jest-unit.txt`): 8 failing jest tests on unchanged code (slice merge x3, modal changed-only x5).
- Green: `panelsSlice.test.ts` + `PanelDetailModal.appearanceSave.test.tsx` and the whole `src/features/panels` + `src/app`
  suites pass (3369 tests). Playwright `e2e/hel1615-panel-modal-appearance-save.spec.ts` passes: before the flush the
  Redux panel keeps `chart.chartType "pie"` and transparency 0.555, rendered type `pie`; after the flush the server holds
  pie / 0.555 and the new background/color (B title-only, C background-only, D two partial saves both persisted).
- Mutation: restoring the old `panelsSlice.ts` (replace-style accumulator) turns the 3 slice tests and the modal
  background-only test red (4 failed); the old modal handler is the committed red run (5 modal tests red).
- Backend guard (not red, the server already merges): `ApiRoutesSpec` "updateBatch with a title and a chart-less
  appearance keeps the stored chart and an omitted transparency (HEL-1615 guard)" passes; the mutation that fails it is
  making `PanelAppearance.applyPatchJson` replace instead of merge.
- Intended changes to existing tests (old full-appearance pending shape): `PanelDetailModal.appearanceSentinel`,
  `.panelSwitch`, `.aggregateChart`, `.chartTypeDefault` -- each carries an inline HEL-1615 rationale comment.
- Reducer merge is shallow and does not mirror server `null` handling (`null` top-level reset, `chart: null`, field-level
  chart merge); see the comment in `accumulatePanelUpdate`.
