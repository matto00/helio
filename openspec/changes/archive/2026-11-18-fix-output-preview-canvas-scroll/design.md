## Context

See proposal.md (Why). The editor preview renders `ChartRenderer` (frontend/src/features/panels/ui/renderers/
ChartRenderer.tsx) inside `.output-preview-pane__chart` (OutputPreviewPane.tsx:130), whose only rule is
`height: 240px` (OutputEditorSheet.css:142). `ChartRenderer` renders `.panel-content.panel-content--chart >
.chart-panel__canvas` (PanelContent.css:190-202) around the lazily loaded ECharts component (HEL-512; preload changed
by HEL-1760). The same `ChartRenderer` also renders dashboard panels and the public dashboard view.

ECharts normally sets its own inner container to `position: relative`, which would contain the absolutely
positioned `<canvas>`; so the ticket's stated cause is not self-evidently true and must be probed, not assumed.

## Goals / Non-Goals

**Goals:** fix the confirmed root cause; red-first e2e at phone widths in both themes; desktop preview unchanged.

**Non-Goals:** footer layout (HEL-1752), chunk preload (HEL-1760), preview chart height, any shared `Modal.css`
rule unless the probe shows the defect lives there.

## Decisions

1. **Probe before fixing (systematic-debugging law).** In a real browser at 375px with a chart Output open, walk
   the modal body's descendants and find every element whose bottom edge exceeds the last content element's bottom;
   for each, record `getComputedStyle(position)`, its `offsetParent`, and its containing block. Record which element
   and which ancestor are responsible, plus the before scrollHeight. The fix layer follows from this evidence.
2. **Fix at the narrowest correct layer.** If the escaping element is specific to the editor preview (e.g. the
   wrapper's sizing or a missing positioned ancestor there), fix it in `OutputEditorSheet.css` under
   `.output-preview-pane__chart`. If it originates in `ChartRenderer`'s own markup (`.chart-panel__canvas` /
   `.panel-content--chart`), fix it there and check every other host (dashboard panel, phone dashboard sheet, public
   view, panel detail modal) for the same bug and for regressions. Alternative rejected: `overflow: hidden` on the
   modal body or wrapper as a blanket clip — it masks the symptom and can clip tooltips/focus rings.
3. **Measured-geometry e2e.** New spec `e2e/hel1763-output-editor-preview-scroll.spec.ts`, modelled on
   `e2e/hel1752-output-editor-footer-fit.spec.ts` (same seed shape: a chart Output on a run pipeline). Assert the
   scrollable dialog element's `scrollHeight` is within a small tolerance of the max content bottom (computed from
   the content elements, never a hard-coded pixel value), at 375px and 390x844, light and dark; plus a desktop case
   asserting the canvas is non-empty and inside the preview card's rect. Must be red on main with the fix reverted.

## Risks / Trade-offs

- [The ticket's cause is wrong] → Decision 1 decides the fix from evidence; the fix may differ from
  `position: relative`.
- [Shared-wrapper fix regresses a panel host] → Decision 2's host sweep, and the e2e chart specs touched
  (e.g. hel1573-motion-grid-chart) are run in full.
- [Lazy chart chunk timing makes the e2e flaky] → wait for a rendered `<canvas>` with non-zero size before measuring.

## Planner Notes

- Self-approved: CSS-only fix, no new dependency, no API change. Low-priority follow-up; standalone per driver triage.

## Resolution (after the Execution probe)

The probe refuted the ticket's cause. The canvas is contained by ECharts' own `position: relative` containers; hiding
it left scrollHeight at 1490. The real cause was visually hidden `position: absolute` elements (`.sr-only` spans and
the History toggle input in the History and Ask groups) whose containing block was the fixed dialog, because neither
`.ui-modal__body` nor `.output-editor-sheet__group` was positioned. Fix: `position: relative` on
`.output-editor-sheet__group` (editor-local, per Decision 2); no shared chart CSS changed, so the host sweep did not
apply. The same latent pattern in shared `Modal.css` is a spinoff candidate, out of scope here.
