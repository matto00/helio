## Why

Three of this ticket's four acceptance criteria are already satisfied with zero live defects (token parity 30/30 both
directions; 20/20 text-on-surface pairs clear AA; 8/8 accent presets clear AA on ink). What is genuinely undone is the
running-app walk — and doing the analytic half of it first surfaced a defect the ticket did not anticipate:
**the app renders `#f97316` as the accent in BOTH themes, and in light it measures 2.38-2.80 against every surface,
failing 3:1 as well as 4.5:1.** (An earlier draft of this Why claimed a per-theme asymmetry read from `theme.css`;
that was wrong — `ThemeProvider` writes the accent INLINE on `<html>`, so `theme.css`'s light default never renders.
See design D5.)

## What Changes

- **A per-theme token-coverage guard** — the thing AC1 actually asks for. Nothing currently checks it: HEL-1037's
  `check-tokens.mjs` validates that a `var(--*)` resolves *anywhere*, so a dark-only token passes today.
- **The running-app parity walk** across every top-level surface in both themes, which has never been done.
- **The accent contrast finding is investigated and reported**, not silently "fixed". CORRECTED at the design gate:
  there is no per-theme asymmetry — `ThemeProvider` writes `--app-accent` INLINE on `<html>`, overriding both theme
  blocks, so `theme.css`'s light `#ea580c` never renders. The app ships `#f97316` in both themes, measuring
  **2.38-2.80** in light, which fails **3:1 as well as 4.5:1** — so the 63 accent borders/outlines are implicated too,
  not just text. Four of the eight presets fail 3:1 in light, including the shipped default.

## The AC2 multiplier — restated, not collapsed

AC2 demands every surface x both themes x **all 8 presets**. AC4's theme-independence proof covers **ink selection
only** (`buildAccentTokens` picks the higher-contrast fixed ink against the accent; theme is not an input). It says
nothing about the accent used *against a surface* — and surface IS theme-dependent. So the enumeration splits:

| relationship | covered analytically? | how it is discharged |
| -- | -- | -- |
| `--app-accent-ink` as text on an `--app-accent` fill (35 uses) | **YES** — cite the derivation | asserted once, for all 8 |
| `color: var(--app-accent)` as text on a surface (41 sites) | **NO** — accent x surface | measured |
| accent borders / outlines / rings (63 uses) | **NO** | measured — light accent is 2.38-2.80, so these FAIL 3:1 too |
| `-surface` / `-dim` / `-mid` alpha washes over a surface (61 uses) | **NO** — composites onto the surface | measured |

The 8x therefore applies only to the second group, and the accent x surface matrix is computed **analytically for all
8 presets x 2 themes** rather than walked eight times. The running-app walk then runs **two presets end-to-end, chosen
adversarially**: **Purple** (thinnest ink margin, 4.60) and **Yellow** (worst accent-on-surface, 1.63:1 on light
`--app-surface-soft`).

## Capabilities

### New Capabilities
None.

### Modified Capabilities
None — a guard, documentation, and any contrast correction the walk justifies. `skip_specs: true` is set.

## Non-goals

- **Retuning the accent scale.** If the light accent needs to clear 4.5:1 as text, that is a visual-identity decision
  with an 8-preset blast radius — report it, do not decide it inside a parity audit.
- **Retuning the accent — owned by HEL-1046 (filed, High).** Four of eight presets fail 3:1 against every light
  surface, including the shipped default. **AC2 is therefore declared REPORTED-NOT-SATISFIED against HEL-1046**: it
  requires legibility across all 8 presets and that cannot honestly be ticked. This ticket reports and routes it.
- **HEL-866 / HEL-1044.** Testing whether HEL-866's reach extends past modals is in scope; *fixing* it is not.
- HEL-1037 (merged, complementary), HEL-1045, HEL-830, HEL-443, HEL-1006, HEL-1023, HEL-350, HEL-538, HEL-1033.

## Impact

- One new guard test, `DESIGN.md`, and any narrowly-justified contrast fix. No backend, no migration.
