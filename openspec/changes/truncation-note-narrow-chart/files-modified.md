- `e2e/hel1398-chart-narrow-footnotes.spec.ts` — red-first e2e: legacy w=2,h=4 canvas >= 96px test; 8 containment cases (1440/1900 x with/without control bar x light/dark: canvas and both footnotes inside the content box, below header/control bar, above footer); scope test (table and footnote-less chart keep an unclamped title); phone-stack unchanged at 390/320; item 4 live "matching rows" screenshots
- `frontend/src/features/panels/ui/PanelContent.css` — narrow `@container panel-card (max-width: 260px) and (max-height: 260px)` block, no hard canvas floor: footnotes 1 line (short note form, long form visually hidden), and on cards `:has()` a footnote the title clamps to 2 lines and the footer stays one tight line; short span hidden by default
- `frontend/src/features/panels/ui/renderers/ChartRenderer.tsx` — long + short note spans, `truncationNoteShort` prop, "one-line" comment fixed (item 2)
- `frontend/src/features/panels/ui/ChartOutputPanel.tsx` — forwards `truncationNoteShort`
- `frontend/src/features/panels/ui/PanelContent.tsx` — computes both forms through one args object
- `frontend/src/features/panels/ui/chartTruncationNote.ts` — `chartTruncationNoteShortText`, `chartTruncationNoteShort`; one shared fail-closed gate
- `frontend/src/features/panels/ui/chartTruncationNote.test.ts` — new short-form helper tests
- `frontend/src/features/panels/ui/renderers/ChartRenderer.test.tsx` — both spans present, long not aria-hidden, short aria-hidden
- `frontend/src/features/panels/ui/PanelContent.chartTruncation.test.tsx` — new short-form test (existing tests unchanged; `toHaveTextContent` on the note p states the intended two-span text)
- `frontend/src/features/panels/ui/PanelContent.truncationNoteStyle.test.ts` — comment-stripping, boundary-anchored, comma-excluding guard + old-vs-new fixture cases (item 3)

Measurements (running app, w=2,h=4, 500-row chart, annotation + note; card 262px tall; light and dark identical):
- Pre-fix: 1440px viewport = 216px card, canvas 5.2px (the ticket's ~5px); 1900px = 254px card, canvas 48.4px; with a control bar the canvas is 0px.
- Cycle-1 fix (c5589f8f) overflowed at 1440 and with a control bar. Cycle-2 (75b7fb6e) fit with a 1-line title clamp (canvas 114.4px) but clamped titles on EVERY kind at this size.
- Final: title clamp is 2 lines and only on a card that has a footnote (`:has(.chart-panel__annotation, .chart-panel__truncation-note)`). 2 lines keeps the no-control-bar canvas at 102.0px at BOTH 1440 and 1900 (>= 96), so the 1-line fallback was not needed.
  - With a 57px control bar: canvas 33.0px at both, contained, no overlap (reported only; the spec promises containment, not 96px, there).
- Scope: table and footnote-less chart at w=2,h=4, 1440px: title unclamped (3 and 4 lines), red on 75b7fb6e (clamp 1), green now.
- Phone stack: unchanged (canvas 100 at 390 and 320, long sentence kept); the height clause never matches in the inline-size-only stack container.
- Known: the nowrap footer content is ~4px wider than its box at 1440 on footnote cards (spills into card padding, not clipped).
