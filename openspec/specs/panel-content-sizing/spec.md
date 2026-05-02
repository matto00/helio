# Panel Content Sizing — Spec

> Audit baseline: current padding, font sizes, and element sizing for each panel type.
> Produced by HEL-158. Consumed by follow-on implementation issues.

## Panel Types Audited

- `metric` — displays a single numeric value + label
- `text` — displays live text content or placeholder skeleton lines
- `table` — displays tabular data with header row
- `chart` — ECharts-driven visualization (container-sized, not CSS-audited for internals)

---

## Grid Layout Sizing Baseline

Source: `frontend/src/components/PanelGrid.tsx`

| Property | Value |
|---|---|
| `rowHeight` | 52px |
| `margin` | [18, 18] (horizontal, vertical gap between cells) |
| `containerPadding` | [0, 0] |
| Default panel height | 5 rows |
| Minimum panel height | 4 rows |
| Default panel height (px) | 5 × 52 + 4 × 18 = **332px** |

Card outer padding: `clamp(14px, 2vw, 22px)` on all sides (from `.panel-grid-card`).
At a typical wide viewport (≥1100px), card padding is ~22px top/bottom.

Approximate content area at default height (accounting for card padding + header + footer):
~**210–230px** available for panel content.

---

## Panel Card Container

Source: `frontend/src/components/PanelGrid.css` (`.panel-grid-card`)

| Property | Value |
|---|---|
| Padding | `clamp(14px, 2vw, 22px)` (all sides) |
| Gap (header/content/footer) | `14px` |
| Border radius | `--app-radius-lg` (10px) |
| Border | `1px solid var(--app-border-subtle)`, top `2px solid transparent` (accent on hover) |
| Background | `var(--panel-surface-override, var(--app-surface))` |

Panel title: `font-size: clamp(1rem, 1.2vw, 1.2rem)`, `font-weight: 600`, `letter-spacing: -0.01em`.

---

## Base Panel Content Container

Source: `frontend/src/components/PanelContent.css` (`.panel-content`)

| Property | Value |
|---|---|
| Display | `flex`, centered (align-items + justify-content: center) |
| Padding | `12px 16px` |
| Flex growth | `flex: 1` |
| Min-height | `0` (allows flex shrinking) |

All panel types inherit from `.panel-content` unless overridden.

---

## Metric Panel

Source: `PanelContent.css` (`.panel-content--metric`, `.panel-content__metric-value`, `.panel-content__metric-label`)

| Element | Property | Value |
|---|---|---|
| Container | `flex-direction` | `column` |
| Container | `gap` | `4px` |
| Container | `padding` | `12px 16px` (inherited) |
| Value | `font-size` | `2rem` (32px) |
| Value | `font-weight` | `700` |
| Value | `font-family` | `var(--font-mono)` (JetBrains Mono) |
| Value | `font-variant-numeric` | `tabular-nums` |
| Value | `letter-spacing` | `-0.02em` |
| Value | `line-height` | `1` |
| Value | Color | `var(--app-text)` |
| Label | `font-size` | `0.75rem` (12px) |
| Label | `text-transform` | `uppercase` |
| Label | `letter-spacing` | `0.06em` |
| Label | Color | `var(--app-text-muted)` |

**Content height at default panel**: ~44px (32px value + 4px gap + ~8px label line-height).
**Sparseness**: SPARSE — ~44px occupied of ~220px content area (~20% utilization).

---

## Text Panel

Source: `PanelContent.css` (`.panel-content--text`, `.panel-content__text-line`, `.panel-content__text-live`)

| Element | Property | Value |
|---|---|---|
| Container | `flex-direction` | `column` |
| Container | `align-items` | `flex-start` |
| Container | `gap` | `8px` |
| Container | `padding` | `12px 16px` (inherited) |
| Live text | `font-size` | `0.9rem` (14.4px) |
| Live text | Color | `var(--app-text)` |
| Live text | `white-space` | `pre-wrap` |
| Live text | `word-break` | `break-word` |
| Placeholder line | `height` | `10px` |
| Placeholder line | `border-radius` | `4px` |
| Placeholder line (long) | `width` | `85%` |
| Placeholder line (short) | `width` | `60%` |
| Placeholder line | Background | `var(--app-border-subtle)` |

**Content height at default panel**: varies with content length; a single short string is ~18px.
**Sparseness**: SPARSE for short text content.

---

## Table Panel

Source: `PanelContent.css` (`.panel-content--table`, `.panel-content__table`)

| Element | Property | Value |
|---|---|---|
| Container | `padding` | `8px 12px` (overrides base 12px 16px) |
| Container | `align-items` | `flex-start` |
| Table | `font-size` | `0.78rem` (12.48px) |
| Table | `border-collapse` | `collapse` |
| Table | `width` | `100%` |
| Cell (th + td) | `padding` | `4px 8px` |
| Cell (th + td) | `height` | `18px` |
| Cell (th + td) | `border` | `1px solid var(--app-border-subtle)` |
| Header (th) | Background | `var(--app-accent-surface)` |
| Header (th) | `width` | `50%` |

**Estimated row height (with border)**: ~26px (18px height + 4px top/bottom padding + 2px borders).
**Content height at 5 rows**: ~130px of ~220px content area (~59% utilization).
**Sparseness**: SPARSE at 1–2 rows; adequate at 5+ rows.

---

## Chart Panel

Source: `frontend/src/components/ChartPanel.tsx`

| Property | Value |
|---|---|
| ECharts container style | `height: 100%; width: 100%` |
| Resize behavior | `autoResize: true` |
| Background | `transparent` |
| Internal padding/labels | Managed by ECharts defaults and appearance overrides |

**Sparseness**: Not applicable — ECharts fills the full container at all sizes.

---

## State Overlays (Loading / Error / No-data)

Source: `PanelContent.css` (`.panel-content--state`, `.panel-content__spinner`, `.panel-content__state-label`)

| Element | Property | Value |
|---|---|---|
| Container | `flex-direction` | `column` |
| Container | `gap` | `8px` |
| State label | `font-size` | `0.78rem` (12.48px) |
| State label | Color | `var(--app-text-muted)` |
| Error label | Color | `var(--app-danger, #e05252)` (via `.panel-content--error`) |
| Spinner | `width`, `height` | `24px × 24px` |
| Spinner | `border` | `3px solid var(--app-border-subtle)` |
| Spinner top color | `border-top-color` | `var(--app-accent, #5b8dee)` |
| Spinner animation | Duration + timing | `0.7s linear infinite` |

---

## Sparseness Summary

| Panel Type | Content at Default Height | Content Area | Utilization | Classification |
|---|---|---|---|---|
| Metric | ~44px (value + label) | ~220px | ~20% | **SPARSE** |
| Text (short) | ~18px | ~220px | ~8% | **SPARSE** |
| Text (long) | varies | ~220px | variable | adequate if multi-line |
| Table (1–2 rows) | ~52–78px | ~220px | ~24–35% | **SPARSE** |
| Table (5+ rows) | ~130px | ~220px | ~59% | adequate |
| Chart | fills container | ~220px | 100% | not sparse |

**Sparseness threshold**: content utilization < 60% of available content area at default 5-row height.

---

## Design Token Alignment

Current `PanelContent.css` uses hard-coded values rather than theme tokens:
- `12px 16px` padding should map to `var(--space-3) var(--space-4)`
- `2rem` metric value aligns with `--text-2xl` (1.5rem) ≈ close but not exact
- `0.75rem` label aligns with `--text-xs`
- `0.9rem` text panel aligns approximately with `--text-sm` (0.875rem) — close but not exact
- `0.78rem` table/state label has no direct token equivalent

Token migration is a non-goal of this audit; these gaps are noted for follow-on work.
