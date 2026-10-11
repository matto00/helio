# HEL-1306: Charts: threshold and reference lines (markLine / markArea)

## Description

Found while designing the CI Health dashboard in helio-news: a target line (e.g. median queue time target, pass-rate SLO) on the trend chart. Today the target is shown in a separate tile or table. HEL-1110 (event annotations) is a different feature but shares the ECharts mark plumbing.

Evidence: `frontend/src/features/panels/ui/echartsCore.ts` registers only Bar/Line/Pie/Scatter (+ Heatmap since HEL-1311) plus Grid/Legend/Tooltip (+ VisualMap) components; no `MarkLineComponent` / `MarkAreaComponent`.

What: Register the mark components and add a chart appearance/config option for one or more horizontal reference lines (value, label, colour) and optional bands.

## Acceptance criteria

- [ ] A chart with a configured threshold renders a labelled horizontal line at that value on bar and line charts.
- [ ] The option is persisted in config/appearance, schema-validated, and editable in the UI.
- [ ] Bundle-size impact of the added components is noted in the PR.

## Owner rulings

Recorded 2026-10-11 via a 7-part Planning escalation (escalation.answered, channel=chat, answer_source=human):

1. **Storage:** two new top-level chart Output config keys, `referenceLines` and `referenceBands` (validated by `OutputConfigValidation`, edited in the Output editor) — not inside `chartOptions`, not panel appearance.
2. **Chart types:** bar, line, scatter and histogram (histogram: count axis only, no bin-index mapping). Never pie or heatmap; on an unsupported type stored lines are preserved but not drawn and the editor hides the field.
3. **Values:** static values only. Computed lines (avg/median/percentile) are a separate follow-up ticket.
4. **Axis:** the value axis only (renders vertical on a horizontal-orientation bar). Not drawn on a normalized (percent) stacked bar.
5. **Label/colour:** optional label, max 60 chars, default = the formatted value. Colour is a tone, never free hex: `neutral` (default, `--app-text-muted`) | `success` | `warning` | `error`, resolved from the theme's hex tokens in both themes. Bands use the same tone at low opacity.
6. **HEL-1307:** shared vocabulary only (tone words success|warning|error, 60-char label cap); no runtime coupling.
7. **Caps:** at most 5 lines and 3 bands per chart; one more is a 400 naming the key. Bands: from < to.
