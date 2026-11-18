# HEL-1756: Viewport fit for the other popovers (UserMenu, DashboardAppearanceEditor, provenance) and a stronger rail hover guard

## Description

origin_kind: followup
origin_ticket: HEL-1750 (PR matto00/helio#1149, merged as 96ed5156b)

HEL-1750 made the shared `ActionsMenu` fit the window: it opens below if it fits, flips above, or caps its height and
scrolls. It uses the new `frontend/src/shared/ui/panelFit.ts` and the measured `place` option of `usePortalPopover`.
Three other popovers still use their own placement and were not checked:

1. **UserMenu**
2. **DashboardAppearanceEditor**
3. **The provenance popover**

Each may run past the bottom or edge of a short window, just as the ⋮ menu did.

Also from review: the HEL-1750 page-height guard hovers a middle row with the page unscrolled. Hovering the **last**
row with the page scrolled to its end would also catch the 34px row shift by itself.

## Acceptance Criteria

- For each of the three popovers, probe at short windows on desktop (for example 1280x400) and on phone, in light and
  dark. Any that can clip move to the shared `panelFit` helper, or the PR states why not. Each fix has an e2e that
  fails first, using an `elementFromPoint` check on the last item.
- The hel1750 guard also covers hovering the last row with the page scrolled to its end. Record the mutation that
  turns it red.

## Agent notes

Design reference: `openspec/changes/archive/2026-11-17-fix-actions-menu-clipping/design.md` D10.

Driver context (claims, verified at Setup premise validation): frontend-only, no Flyway migration, no model calls.
Concurrent lanes HEL-1734 (pipeline draft roots) and HEL-1742 (insight L2) may touch shared frontend files; the
provenance popover and the shared `usePortalPopover` are the likely contention points, so shared-file edits are kept
minimal and named in the PR.
