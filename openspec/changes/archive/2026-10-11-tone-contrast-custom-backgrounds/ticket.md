# HEL-1490: Tone contrast on custom panel backgrounds (item 1 of the HEL-1490 follow-ups)

## Description

Follow-up from HEL-1307 (conditional formatting). This run delivers **item 1 only**; items 2, 4, 5 and 6 shipped in
#962 (9e51550f1) and item 3 (`TableRenderer`/`DataGrid` split) stays out of scope.

Item 1: tone text on a panel with a custom background colour isn't contrast-checked. The existing delta colours have
the same gap.

**Owner ruling (settled, recorded as a comment on HEL-1490): runtime fallback (auto-adjust).** On a panel with a custom
background colour, if a conditional-format tone colour, or the metric unit or label, would fail 4.5:1 contrast against
that background, switch automatically to a readable variant. No editor warning.

Context: #962 added `--panel-secondary-text-mix` (62% light / 60% dark, currentColor-relative) so the metric unit and
label pass on default backgrounds; on a light-theme custom background the HEL-1490 lane measured 4.24:1. Tones come from
HEL-1307 (`--app-success`/`--app-warning`/`--app-error` and their `-surface` washes). Delta colours (HEL-918 L5) have
the same gap; include them if the same mechanism covers them cleanly.

## Acceptance Criteria

1. On a panel with a custom background, conditional-format tone text (metric/collection figure, table cell text, table
   tone mark) measures >= 4.5:1 against what it sits on (the panel surface, and the tone wash where one is painted), in
   both themes, at 1440 and 375; otherwise it automatically uses a readable variant.
2. The readable variant keeps the tone recognisable (same hue family, darker or lighter step); the glyph and the
   accessible (sr-only) label keep carrying the meaning unchanged.
3. The metric unit and label measure >= 4.5:1 on a custom background in both themes (they still follow a custom panel
   text colour).
4. Delta colours (metric trend / comparison up, down, flat) get the same treatment, or design.md states why not.
5. Default (no custom background) panels render exactly as today (no inline override emitted, token values unchanged).
6. No editor warning is added. Any colour that reaches ECharts resolves to hex (no `color-mix()`).
7. Red-first tests, including a unit test of the contrast picker with known colour pairs; no new `eslint-disable`.
8. Verified in the running app: several custom backgrounds (light, dark, saturated), both themes, 1440 and 375, with
   contrast measured from computed styles, not eyeballed.
