# HEL-773: Mobile nav sheet should descend from the top, with a quick-create action

## Description

Product-owner feedback from the installed PWA on iOS (2026-08-20). The picker that
lists dashboards (and the equivalent lists on the other mobile pages) currently rises
from the bottom of the screen as a bottom sheet, while the control that opens it — the
title dropdown — sits in the top bar. The motion runs away from its trigger, and the
sheet covers the content it is navigating between.

Tapping the dashboard title in the top bar opens `MobileNavSheet` from the bottom edge.
The list itself is correct (dashboards enumerated, active one marked), but the direction
is wrong relative to the affordance that summoned it, and there is no way to create a new
item from within the list — the user must dismiss the sheet and find a separate control.

## Scope

* Invert the sheet so it descends from the top edge, originating from the control that
  opens it, across **all** mobile pages that use this pattern — not just Dashboards.
* Offset the sheet's top edge by the app's claimed top safe-area inset so its content
  never collides with the OS clock and battery. **Superseded detail:** the ticket as
  filed said no `env(safe-area-inset-top)` exists in the codebase and that this ticket
  must introduce it. HEL-772 has since merged and introduced exactly that seam
  (`--app-safe-top` / `--app-top-chrome-height` in `theme.css`). This ticket therefore
  *consumes* that seam and must not re-derive the inset.
* Add a create action to the sheet appropriate to the current section: **Add dashboard**,
  **Add source**, **Add pipeline**. It should read as a distinct action rather than
  another list row, and must meet the >=44px touch-target floor.
* Preserve the existing dismissal affordances (backdrop tap, drag handle) and keep focus
  management and `aria` semantics correct for a top-anchored sheet.

## Out of scope

* Bottom-nav styling (HEL-774, merged).
* Command-bar height and anchoring (HEL-772, merged) — but see the shared-inset note.
* Swipe-between-dashboards (HEL-556) and back-gesture behaviour (HEL-574).
* Gesture/interaction polish beyond direction inversion (HEL-565 — must not be pulled
  forward).
* Any change to the HEL-548 create-action hooks themselves. They are consumed read-only;
  a concurrent run (HEL-554) depends on them.
* Any create action for Metrics or Assistant, neither of which has a shared
  create-action hook. Those sheets get the direction change only. **Corrected during
  planning:** the ticket's premise that Type Registry likewise has no create path is
  factually wrong — the desktop sidebar already gives that section the create-pipeline
  CTA in its empty state (types are produced by pipelines). Omitting it on phone would
  leave the registry a dead end, so registry gets that CTA in its empty branch only,
  with no header action, mirroring the desktop treatment. This needs no new hook and no
  new modal mount (see design.md D7).

## Acceptance criteria

- [ ] AC1. The sheet enters from the top edge and is visually anchored to the control
      that opened it, on every mobile page using this pattern.
- [ ] AC2. Sheet content clears the OS status bar at every supported notch/dynamic-island
      size; no row is ever occluded by the clock or battery.
- [ ] AC3. Each section's sheet offers the correct create action (dashboard / source /
      pipeline), it performs the operation exposed by that section's shared create-action
      hook, and it is >=44px in its tap dimension. **Refined during planning:** the label
      and glyph come from the hook's own `cta`, so the rendered strings are "New dashboard"
      / "Add source" / "New pipeline" rather than the ticket's uniform "Add ..." phrasing —
      phone/desktop parity is worth more than uniform verbs. The dashboards action is the
      hook's immediate quick-create, which its docstring documents as deliberately distinct
      from `DashboardList`'s named-create form; matching that form would require editing a
      fenced file (see design.md D7).
- [ ] AC4. Backdrop tap and drag-to-dismiss still work; focus is trapped while open and
      restored to the trigger on close.
- [ ] AC5. Motion respects `prefers-reduced-motion` (entrance genuinely disabled, not
      merely shortened).
- [ ] AC6. Verified on correctly-configured emulation at 430px and 375px, in both themes.
- [ ] AC7. `npm run lint` / `npm test` pass with zero new warnings.

### Folded-in scope (HEL-782)

Absorbed into this ticket at Planning: HEL-782 ("`MobileNavSheet`'s empty branch renders
a bare `<p>` instead of `EmptyState`") edits the same empty branch of the same component
that AC3's create action lands in. A bounded subset is folded in; the unbounded remainder
is explicitly NOT.

- [ ] AC8. The sheet's empty branch renders the shared `EmptyState` primitive
      (`variant="sidebar"`) instead of a bare `<p>`, carrying the same section-appropriate
      create action as AC3 where one exists, and rendering message-only (no CTA) for the
      sections that have none.
- [ ] AC9. The folded-in scope introduces **no** new create-action hook and **no** new
      modal mount. HEL-782's D4b mount constraint is satisfied structurally: the sheet is
      section-scoped, so a section's own page — which mounts that section's modal — is
      already mounted whenever that section's create action is reachable. This must be
      demonstrated, not assumed.
