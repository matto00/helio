## Why

The installed iOS PWA's bottom nav is a flat opaque strip pinned to the screen edge. The product owner has
asked for Apple's Liquid Glass navigation language — a floating, translucent, material capsule — naming
Instagram's iOS tab bar as the specific reference.

Doing that requires deliberately amending a binding `DESIGN.md` invariant ("Surfaces are opaque"), which
exists because Helio dashboards carry user-set background images and colours. The amendment is part of the
work, not a side effect: the invariant is replaced, for this one element, by a **measured contrast floor**
that must hold against any user background.

## What Changes

- **`DESIGN.md`**: a narrow, explicit mobile-bottom-nav carve-out from the opacity invariant (§0.2 principle
  and the `[mechanical]` clause), stating the permitted translucency and the contrast floor that replaces the
  invariant for it. Every other surface stays opaque. `BottomNav.css`'s comment stops citing a rule that no
  longer binds it.
- **`BottomNav.css`/`BottomNav.tsx`**: inset floating capsule with semicircular ends; a small-radius
  `backdrop-filter` blur; a **tint layer between the blur and the icons** carrying legibility; layered shadow;
  an inner material lozenge for the active item instead of a bare accent colour change.
- **BREAKING (spec-level)**: tab ink moves from `--app-text-muted` to full-contrast `--app-text`. Measurement
  shows `--app-text-muted` cannot clear even 3:1 over a translucent tint at any usable alpha — it is
  incompatible with the carve-out. This also matches the reference's solid, high-contrast glyphs.
- **BREAKING (spec-level)**: the active tab is indicated by a bordered material lozenge, with `--app-accent`
  on the active *icon* only. Accent-on-surface measures 1.87-3.86:1 across all eight
  shipped presets in light theme, so a 10px accent label could never clear the floor this ticket is adding —
  the rule would have been born contradicting the code. The lozenge's *border* is what carries its
  visibility: any fill drawn from the neutral ramp converges with the capsule once composited.
- **Geometry token**: `--bottom-nav-height` (introduced by HEL-535) is redefined as *total clearance from the
  viewport bottom to the top of the capsule*. HEL-535 added the token but left the same expression inlined at
  `BottomNav.css:27` and `App.css:424`; this change finishes that migration, so the geometry has exactly one
  definition and three consumers. `toast.css` stays correct unedited.
- **Labels are dropped — the bar becomes icon-only**, decided by the product owner once the cost was
  quantified: 10px labels are WCAG small text and bind the bar to a 4.5:1 floor, where an icon-only bar is
  governed by 3:1. That difference sets the tint alpha, and so the transmissivity the ticket calls the
  reference's defining property (0.65/35% with labels vs 0.55/45% without). Consequences: each tab's
  `aria-label` becomes its entire accessible name and is verified against the computed accessibility tree;
  Data Types' `BookOpen` icon becomes `Shapes`, since an open book reads as documentation and only worked
  while a label sat beside it; and the discoverability risk is accepted on record with HEL-554 (guided
  first-run onboarding) as the named mitigation.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `mobile-bottom-nav`: the "Tab bar visual and ergonomic constraints" requirement changes from mandating an
  opaque `--app-surface` bar with `--app-text-muted` inactive tabs to mandating a translucent floating capsule
  governed by a measured contrast floor, with geometry derived from a single shared token.

## Impact

- `DESIGN.md` (§0.2 principle, "Surfaces & the opacity invariant" `[mechanical]` clause).
- `frontend/src/shared/chrome/BottomNav.css`, `BottomNav.tsx`, plus a new CSS regression test.
- `frontend/src/theme/theme.css` — `--bottom-nav-height` semantics and its new geometry primitives.
- `frontend/src/app/App.css:424` — content clearance recomputed off the token (this rule only; the
  `.app-shell`/`.app-command-bar` rules in the same file belong to HEL-772 and are not touched).
- `frontend/src/features/panels/ui/PanelList.css` — the zoom widget is retargeted to clear the capsule
  between 431px and 768px, where it would otherwise land on top of it.
- `frontend/src/shared/chrome/sections.ts` — Data Types' icon (also reaches the desktop sidebar, deliberately).
- `openspec/specs/mobile-bottom-nav/spec.md` via a delta.
- **Not touched:** `toast.css` / `toast.css.test.ts` (HEL-535's) — the change reaches the toast viewport
  through the token alone.

## Non-goals

- Extending translucency to any other chrome: top bar, sidebar, popovers, modals, menus all stay opaque.
- Top-bar (HEL-772) and nav-sheet (HEL-773) work.
- Changing which six destinations the bar shows. (`sections.ts` is edited for one icon — see the Impact list.)
