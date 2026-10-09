# HEL-1399: Split PanelContent.tsx (~531 lines) and PanelDetailModal.tsx (~587 lines) behaviour-preserving

## Description

origin_kind: followup
origin_ticket: HEL-1358

Both files are over CONTRIBUTING.md's split threshold after HEL-1358. Proposed seams (the implementer decides): move
`OutputPanelContent` out of `PanelContent.tsx` into its own module, and pull `PanelDetailModal`'s data/inspect wiring
into a hook. Follow HEL-1365's precedent: moved code byte-identical, hook order unchanged, tests import-only, and the
RUNNING app compared in light and dark. Check overlap with HEL-1378 (buildInitialChart) and HEL-1395 (dead chart-type
selector code) first.

## Folded-in scope (ticket comment; HEL-1378 test nits)

From HEL-1378's evaluation-1.md and skeptic-final-1.md, for `PanelDetailModal.chartTypeDefault.test.tsx`:
- Mock `listOutputPanels` and `getDistinctValues` in its `outputService` mock. Today they are real, and they log
  ECONNREFUSED console errors.
- Render the wrapped `AppearanceEditor` as JSX (`<actual.AppearanceEditor {...props} />`) instead of calling
  `actual.AppearanceEditor(props)` as a function.

## Acceptance criteria

- `PanelContent.tsx` and `PanelDetailModal.tsx` (and every new module) are each under 400 lines.
- Behaviour-preserving: moved code is byte-identical modulo whitespace, proven by a byte-move check. Hook call order
  is unchanged. DOM output is unchanged.
- Existing tests change only in import paths. The one exception is the folded-in HEL-1378 test nits above.
- The RUNNING app is compared before and after in light and dark. Cover a narrow chart panel showing the HEL-1398
  truncation footnote, and the panel detail modal in view and edit mode.
- Overlap with HEL-1378 and HEL-1395 is checked and noted. HEL-1395 is not absorbed.

## Context (re-derived at origin/main bcde936d)

- PanelContent.tsx is 536 lines. `OutputPanelContent` is at L139-398.
- PanelDetailModal.tsx is 589 lines. It has data wiring at L157-217 (it has no Inspect wiring; Inspect lives in
  usePanelCardInspect).
- HEL-1394 did not touch either file. HEL-1398 changed PanelContent's truncation note. HEL-1378 changed
  buildInitialChart.
