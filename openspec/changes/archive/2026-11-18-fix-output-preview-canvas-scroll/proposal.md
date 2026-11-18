## Why

On a phone the Output editor dialog scrolls ~760px past its last control into blank space (scrollHeight ~1490 vs
~729 of content) whenever a chart Output's preview is shown. A follow-up found by HEL-1752's lane; it predates
HEL-1752. Blank scroll on the primary mobile editing surface reads as broken layout.

## What Changes

- Probe, in a real browser at 375px/390x844, which element actually extends the dialog's scrollable overflow and
  which ancestor it resolves its containing block to. The ticket's claim (the ECharts `<canvas>` escaping an
  unpositioned `.output-preview-pane__chart`) is a hypothesis until the probe confirms it.
- Fix the confirmed root cause at the narrowest correct layer: the editor's preview wrapper if the defect is local
  to it, or the shared chart renderer wrapper if every host of that wrapper has the same defect (then every host is
  checked for the bug and for regressions).
- A red-first e2e at 375px and 390x844, light and dark, asserting the dialog's scroll extent matches its content.

## Non-goals

- Any change to the editor's footer (HEL-1752), the chart chunk preload (HEL-1760), or popover fit (HEL-1762).
- Redesigning the preview card or changing the preview chart height.

## Capabilities

### New Capabilities

### Modified Capabilities
- `pipeline-output-sheet`: adds a requirement that the editor dialog's scroll extent is bounded by its content on a
  narrow viewport when a chart preview is shown.

## Impact

Frontend CSS only (expected one rule in `OutputEditorSheet.css` or the shared chart CSS), plus one new e2e spec.
No API, schema, or backend change.
