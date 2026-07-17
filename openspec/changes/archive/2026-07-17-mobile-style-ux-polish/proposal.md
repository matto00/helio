# Proposal — mobile-style-ux-polish (HEL-303)

## Why

The Mobile PWA (HEL-300/301/302) shipped with deliberately deferred polish items, and the v1.5 panel
surfaces (HEL-245/255/248/247) plus HEL-304's width-independent edit persistence landed afterwards.
This is the closing style/UX pass: make the whole <768px mobile shell — including the new v1.5
surfaces and the new collection panel kind — meet the touch-target, token, and sizing bar set by
`notes/mobile-pwa-handoff.md` (binding) and DESIGN.md.

## What Changes

- Bring all MobileNavSheet rows (dashboard + section rows) to a ≥44px touch target at phone width
  (rows currently sit at `--control-lg`, under 44px), using the established ≥44px `@media` pattern +
  CSS-lock tests from HEL-245/255/248.
- Edit-affordance audit at <768px per the updated criterion: no broken or misleading edit
  affordance. Content-edit paths that are reachable must work end-to-end with ≥44px targets
  (HEL-304 made edits persist width-independently); desktop-only layout actions (drag/resize) must
  be neither reachable nor implied.
- Audit and tune per-kind constants in `frontend/src/features/panels/ui/mobilePanelHeights.ts` at
  ~390×844 for every panel kind, including the new `collection` kind (HEL-247) with real multi-row
  data. Adjust constants only where the audit shows a real problem.
- Sweep every panel kind (Metric, Text, Markdown, Image, Table, Chart×4 types, Collection) in
  MobilePanelStack at 390×844: no horizontal overflow, readable type scale, sane heights — in both
  light and dark themes.
- Token-compliance sweep of BottomNav, MobileNavSheet, PanelDetailModal (no hard-coded
  colors/spacing; canonical breakpoints 1440/1100/768/430 only).
- Preserve the HEL-301/304 regression guard: mobile browsing never PATCHes dashboard layout.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `mobile-dashboard-sheet`: adds a requirement that every tappable sheet row meets a ≥44px touch
  target at phone width.
- `mobile-viewer-stack`: adds a requirement that phone-width edit affordances are honest — every
  reachable edit path works end-to-end with ≥44px targets; desktop-only layout actions are
  unreachable and unimplied.
- `mobile-panel-sizing`: only if the 390×844 audit moves a per-kind constant outside the bands the
  spec currently states — in that case the delta updates the stated bands to the tuned values. If
  tuning stays within the spec's stated bands (which it frames as "starting values, expected to be
  tuned"), no delta is required.

## Non-goals

- No behavior or backend changes; no schema/API changes. Behavioral mobile-edit work shipped in
  HEL-304; the residual layout edge is HEL-306 (out of scope).
- No mobile editors for panel creation / pipelines / sources (handoff §2 keeps phone a viewer for
  those surfaces).
- No new tokens, no new breakpoints, no new overlay mechanisms.
- Non-trivial bugs found by the audit are reported as spinoff candidates, not fixed inline.

## Impact

- Frontend only: `shared/chrome/{BottomNav,MobileNavSheet}.{tsx,css}`,
  `features/panels/ui/{MobilePanelStack,PanelDetailModal}.{tsx,css}`,
  `features/panels/ui/mobilePanelHeights.ts`, plus CSS-lock tests
  (`*.css.test.ts`) and `mobilePanelHeights.test.ts`.
- Existing regression tests (mobile layout byte-identity, MobilePanelStack) must keep passing.
