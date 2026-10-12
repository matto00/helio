## Why

HEL-1307's tone colours (`--app-success/warning/error`), the metric delta colours and the metric unit/label mix were
tuned against the theme's default panel surface. A panel with a custom background blends that colour into its
surface, and the tone text, the delta text and the secondary text can drop below 4.5:1 (light theme on a saturated
blue or red background: about 4.1-4.5:1 on the surface, 3.5-3.9:1 on the table tone wash). The owner ruled (HEL-1490
comment): auto-adjust at runtime, no editor warning.

## What Changes

- A pure contrast picker that, given a preferred colour and the resolved backdrop(s), returns it unchanged when it
  clears 4.5:1, otherwise the nearest darker or lighter step of the same colour that does (hex output).
- A panel with a custom background gets per-panel readable variants of the three tone colours, the muted (flat) delta
  colour, and, when needed, a raised secondary-text mix, set as inline custom properties next to the existing
  `--panel-surface-override` / `--panel-text-override`. Default panels get none (renders exactly as today).
- Tone text and marks (metric/collection figure, table cell text, table tone mark) and delta colours (trend and
  comparison up/down/flat) read the per-panel variant with the theme token as fallback.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `output-conditional-formatting`: tone text stays readable (>= 4.5:1) on a panel with a custom background.
- `panel-appearance-settings`: a custom panel background keeps the metric unit/label and the delta colours readable.

## Impact

Frontend only: `theme/appearance.ts` (picker + per-panel variants), `PanelCard.getPanelCardStyle`, `PanelContent.css`,
`TableRenderer.css`, tests. No backend, schema, API or editor change.

## Non-goals

- Editor warnings (owner ruled them out).
- Item 3 (TableRenderer/DataGrid split); items 2/4/5/6 (shipped in #962).
- Other muted panel text (notes, footers) and chart series colours; listed as follow-ups if they fail.
