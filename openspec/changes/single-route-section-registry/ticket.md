# HEL-724: Single route/section registry driving all shell chrome (App.tsx split)

## Description

From the beta UI/UX polish sweep (PR #382), majorProposal.

**Scope**
Three parallel route tables and four copies of per-section selection logic
have already diverged (`/settings` showed the Dashboards sidebar, phone title
showed a dashboard switcher on Settings, review routes had no section) — the
direct root cause of several bugs already fixed tactically this sweep. Build
a single `{path, label, shortLabel, icon, selection}` registry driving nav,
breadcrumb, sidebar body, phone title/sheet, `document.title`, and active
states.

* `frontend/src/shared/chrome/navDestinations.ts` (+ a new sections registry).
* Split `App.tsx` into `CommandBar`/`Sidebar`/`MobileShell` consumers of the
  registry.
* `SidebarBody.sectionFromPathname`, `breadcrumbLabel`, `MobileNavSheet`
  wiring all read from the single registry instead of their own copies.

## Acceptance Criteria

* Exactly one source of truth maps route -> {label, icon, selection state}.
* Adding a new route/section requires editing the registry only, not 3-4
  separate files.
* `App.tsx` shrinks under CONTRIBUTING.md's file-size soft budget as a result
  of the split.

## Metadata

* Linear: https://linear.app/helioapp/issue/HEL-724/single-routesection-registry-driving-all-shell-chrome-apptsx-split
* Parent: HEL-346
* Project: Helio v1.7 — UI/UX Cohesion & Authoring
