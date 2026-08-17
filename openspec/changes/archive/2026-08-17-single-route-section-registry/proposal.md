## Why

Route/section metadata is hand-duplicated across three implementations (`navDestinations.ts`,
`App.tsx`'s `breadcrumbLabel`, `SidebarBody.tsx`'s `sectionFromPathname`) plus four copies of
per-section "which item is selected" logic. These have already diverged in production (`/settings`
briefly showed the Dashboards sidebar, the phone title showed a dashboard switcher on Settings,
review routes fell through to no section) — patched tactically in PR #382, but the structural
cause (no single source of truth) remains, so the same class of bug recurs at the next new route.

## What Changes

- Add `frontend/src/shared/chrome/sections.ts`: one ordered registry
  (`{path, end?, pickerId, label, shortLabel?, icon?, showInNav}`) plus lookup helpers
  (`sectionForPathname`, `pickerIdForPathname`, `sectionLabel`) — the single source of truth for
  route → label/icon/active-nav-state.
- Add `frontend/src/shared/chrome/usePickerSelection.ts`: one hook centralizing per-section
  "current item(s)" derivation, replacing four duplicated call sites in `App.tsx`.
- `navDestinations.ts` becomes a derivation (`sections.filter(s => s.showInNav)`), not a
  hand-maintained parallel list. `SidebarBody.tsx`'s `sectionFromPathname` is replaced by
  `pickerIdForPathname`.
- Split `App.tsx`'s `AppShell` into `frontend/src/app/{CommandBar,Sidebar,MobileShell,
  AppRoutes}.tsx`, each reading the shared registry/hook directly, bringing `App.tsx` credibly back
  under the file-size soft budget (see design.md for the concrete extractions and the fallback if
  it still falls short).
- Give the three non-picker chrome routes (`/settings`, `/proposals/review`, `/patch-sets/review`)
  their own distinct registry labels instead of silently falling through `breadcrumbLabel`'s
  default case (currently mislabels them "Dashboards") — **a deliberate, intended label change**.

**Non-goals**: no route/URL changes; no unintended visual/behavioral changes (the one deliberate
exception is the label fix above); no change to `SidebarBody`'s per-section list rendering (CRUD,
badges, delete warnings) beyond its route-matching call; no change to `MobileNavSheet` itself.

## Capabilities

### New Capabilities

- `nav-section-registry`: the `{path, label, shortLabel, icon, pickerId}` registry the acceptance
  criteria call for — a testable contract, not just an implementation detail, since "one source of
  truth" and "distinct labels per route" are themselves the required behavior.

### Modified Capabilities

(none — existing nav/mobile-sheet/breadcrumb behavior is preserved; `mobile-bottom-nav`'s "single
shared destination definition" requirement is satisfied by, not contradicted by, the new registry)

## Impact

Affected: `frontend/src/shared/chrome/{sections.ts, usePickerSelection.ts}` (new),
`navDestinations.ts`, `SidebarBody.tsx`, `BottomNav.tsx` (import path only), `frontend/src/app/
App.tsx` (split), `frontend/src/app/{CommandBar,Sidebar,MobileShell,AppRoutes}.tsx` (new), plus
existing test files. No backend, schema, or API impact.
