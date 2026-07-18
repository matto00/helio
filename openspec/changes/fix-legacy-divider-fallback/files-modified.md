# Files Modified: fix-legacy-divider-fallback (HEL-298)

- `frontend/src/features/panels/ui/DividerPanel.tsx` — changed the colorless-divider fallback from the dead token `var(--color-border)` to the live DESIGN.md hairline token `var(--app-border-subtle)` so legacy dividers with no explicit color render a visible neutral line.
- `frontend/src/features/panels/ui/DividerPanel.test.tsx` — updated the default-color assertion to `var(--app-border-subtle)`; the explicit-color no-regression case (`#ff0000` → `rgb(255, 0, 0)`) was already present.
- `openspec/changes/fix-legacy-divider-fallback/specs/divider-panel-type/spec.md` — spec delta: default rule color when `dividerColor` is absent is now the live token `--app-border-subtle` (planning artifact).

## Root-cause evidence (Iron Law: systematic-debugging)

- **Root cause (UI/CSS token layer):** `DividerPanel.tsx` fell back to `var(--color-border)`, which has no definition anywhere in the theme system (`frontend/src/theme/theme.css` defines `--app-border-subtle`/`--app-border-strong`, not `--color-border`). An unset custom property makes `background-color: var(--color-border)` invalid at computed-value time, so the rule paints transparent → invisible.
- **Probe:** live DOM `getComputedStyle` of an element styled `background-color: var(--color-border)` on the running app, in all four theme/viewport combinations.
- **Probe output:** `deadTokenComputed: "rgba(0, 0, 0, 0)"` (fully transparent — invisible) in light, dark, desktop, and mobile.
- **Fix verified:** colorless divider now computes to `rgba(33, 29, 25, 0.11)` in light theme (dark hairline on the `rgb(253, 252, 250)` panel surface) and `rgba(242, 239, 233, 0.09)` in dark theme (light hairline on the `rgb(26, 24, 22)` panel surface) — visible in both. Explicit-color divider unchanged (`rgb(255, 0, 0)`). Evidence screenshots in the session scratchpad: `final-light-desktop-panel1.png`, `final-dark-desktop-panel1.png`, `final-light-mobile.png`, `final-dark-mobile.png`.
