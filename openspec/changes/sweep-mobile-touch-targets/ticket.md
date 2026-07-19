# HEL-314 — Sweep remaining sub-44px mobile touch targets (ui-select/actions-menu triggers)

## Context

Trailing touch-target cleanup from the HEL-308 audit. HEL-245/255/248/303/308
brought most interactive controls to ≥44px on mobile, but the audit found
remaining sub-44px triggers not yet covered:

- `.actions-menu__trigger` — 28px kebab button (resizing affects layout, so needs care)
- Bare `.ui-select__trigger` outside the `.panel-detail-modal` scope — still sub-44px on mobile at some call sites

## What

One consolidated pass applying the established `@media (max-width: 768px)` ≥44px
pattern (with CSS-lock tests, per the PanelDetailModal.css.test.ts precedent) to
the remaining sub-44px trigger controls, keeping desktop density unchanged.
Re-audit shared interactive controls once more so this closes out the touch-target
class app-wide rather than leaving another remainder.

## Acceptance criteria

- [ ] `.actions-menu__trigger` and bare `.ui-select__trigger` measure ≥44px at 390px (getBoundingClientRect, both themes); desktop unchanged
- [ ] Layout not visually broken by the taller kebab trigger (verify at 390×844 and desktop)
- [ ] Final audit note asserting no remaining sub-44px interactive controls in the mobile shell / shared components
- [ ] CSS-lock tests for each rule

## Reference

- Precedent CSS-lock test: `frontend/src/**/PanelDetailModal.css.test.ts`
- Prior tickets: HEL-245, HEL-255, HEL-248, HEL-303, HEL-308
- Binding design standard: `DESIGN.md`
