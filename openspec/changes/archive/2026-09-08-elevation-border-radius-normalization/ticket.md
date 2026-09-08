# HEL-442: Elevation / border / radius normalization

## Description

`DESIGN.md` fixes the radius scale (`--app-radius-sm` 6 / `md` 9 / `lg` 14 / `pill` 9999), the two shadow tokens
(`--app-shadow-card` resting, `--app-shadow-soft` overlay/hover-lift), the surface elevation ramp (`--app-bg` →
`--app-surface-soft` → `--app-surface` → `--app-surface-raised` → `--app-surface-strong`), and neutral borders
(`--app-border-subtle`/`--app-border-strong`). The opacity invariant says structural surfaces are opaque with no
`backdrop-filter` glass. The ticket asserts drift exists in older modules: wrong radius steps, literal box-shadows,
accent-tinted borders, surfaces picked off-ramp.

## Acceptance criteria

* No structural CSS module uses a literal box-shadow/border-radius where a token applies; guard test added.
* No structural border derives from `--app-accent*`; no `backdrop-filter` on structural chrome.
* Surface backgrounds match the documented elevation ramp; spot-checked visually in light and dark.
* `npm run lint` / `npm test` pass, zero new warnings.

## Out of scope

* Motion tokens and colour/type literals except where entangled in the same declaration.
* The panel transparency feature behaviour.

## Orchestrator Planning-phase audit — MEASURED; the premise is largely already satisfied

Full evidence: `.concertino/runs/HEL-442/evidence/premise-validation.md`.

| ticket claim | measured reality |
| -- | -- |
| literal box-shadows | **CORRECTED (design gate r1+r2).** 47 = 25 token/`none` + **22 using neither elevation token**: **9** zero-blur spread rings + **13** scroll-fade insets in **four distinct values**. **None carries a y-offset with a blur**, so no elevation token applies to any. An earlier audit reported "0 literal" by filtering on `var(--`, which scored declarations clean whose colour is tokenised and geometry literal. |
| wrong radius steps | 283 declarations, 17 literal — **12 are `50%`**, the circle idiom (correct). Residue: five SUB-scale values (1px x2, 3px, 4px x2), all below the 6px floor. |
| accent-tinted structural borders | **Not a violation.** `DESIGN.md:93` documents `--app-accent-mid` as the token FOR "selection borders"; line 94's "never accent-tinted" governs the DEFAULT hairlines. 26/46 sites are explicit state pseudo-classes; the rest are affordance idioms, semantic tinting, or not borders. |
| `backdrop-filter` on chrome | **TRUE — exactly two sites**: `BottomNav.css:38-39`, `Modal.css:60`. |
| translucent structural surfaces | None found. |

**Vendor check (the HEL-441 lesson), result NEGATIVE:** the two vendor stylesheets `src` imports
(`react-grid-layout/css/styles.css`, `react-resizable/css/styles.css`, at `DesktopPanelGrid.tsx:26-27`) impose no
`border-radius`, `box-shadow` or `border`. Unlike motion — where vendor CSS supplied HEL-1032's hidden 100/200ms —
elevation carries no vendor-imposed values. Recorded so it is not re-derived.

**Correction of my own first reading:** I initially recorded the 46 accent-border sites as this ticket's real
substance. That was wrong — I grepped for a rule without reading the token table three lines above it. Recorded here
because the wrong version would have sent an executor to "fix" 46 correct declarations.

**What therefore remains:** the five sub-scale radii (a judgment call, not a mechanical snap), the two
`backdrop-filter` sites (one of which belongs to HEL-1035), a running-app check of the elevation ramp and of surfaces
with NO elevation where the system says there should be one, and — the durable deliverable — **a guard that holds the
already-good state, which nothing currently protects.**
