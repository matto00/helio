## Why

The desktop sidebar mixes section nav with a second copy of each page's list (Data Pipelines repeats its own table),
cannot be resized, and offers only a coarse collapse. DESIGN.md v3 §9 (HEL-1571, merged) fixes the target: a 56px
icon rail plus a resizable, collapsible context list, with dashboard folders. HEL-1575/1576/1578/1579 build on it.

## What Changes

- Replace the desktop/tablet (above 768px) `Sidebar` with an **icon rail** (Home, Dashboards, Data Sources, Data
  Pipelines, Connectors, Assistant; Settings and the avatar menu at the foot) and a **context list** beside it.
- Home is a rail item that opens the dashboards view (`/`) until HEL-1578 repoints it (owner ruling 2026-10-13).
- Context list: pointer- and keyboard-resizable (separator; 200/248/400px min/default/max, owner ruling), collapsible to
  rail-only (button, double-click, Enter on the separator); width and collapsed state persist **server-side per user**
  (owner ruling), with no layout flash on load and no request per drag frame.
- Per-section content: Dashboards = filter + per-user **folders** (create, rename, delete, collapse, move a dashboard
  between folders, counts) + an "Unfiled" group; Data Pipelines = Recent + Scheduled (next run); Data Sources = Recent +
  Scheduled (sources feeding a scheduled pipeline, soonest run); Assistant = its existing conversation list;
  Connectors and other routes = no list (rail only). Owner rulings 2026-10-13.
- The full-table copies for Sources and Pipelines are removed from the sidebar.
- Usage leaves the desktop primary nav and becomes an owner-only item in the avatar menu.
- Backend: Flyway V134 adds per-user `dashboard_folders` + `dashboard_folder_assignments` (RLS ENABLE/FORCE, proven in
  a non-BYPASSRLS session) with folder CRUD/move endpoints; shell width/collapsed join the existing `users.preferences`
  record via `PATCH /api/users/me/preferences`, returned on every user-returning auth response; `GET
  /api/pipeline-schedules` returns scheduled pipelines and the sources feeding them in one request.
- Pipeline and source **delete** move from the sidebar rows to a row action on the Data Pipelines and Data Sources overview tables (owner ruling 2026-10-14; not in the detail pages).
- API contract: the repo has no OpenAPI document; the AC's "schema, OpenAPI" is met by JSON Schemas under
  `schemas/dashboards/`, `schemas/pipelines/` and `schemas/auth/` (checked by `npm run check:schemas`) plus these specs.
- Phone (768px and below): the glass `BottomNav` gains the same Home alias as its first tab (owner ruling 2026-10-13); otherwise
  unchanged, and the mobile sheet is untouched.

## Capabilities

### New Capabilities
- `app-shell-rail`: desktop/tablet icon rail and resizable, collapsible context list with per-section content.
- `dashboard-folders`: per-user dashboard folders, persisted server-side, with API, RLS and list UI.
- `pipeline-schedule-list-api`: one-call list of the caller's scheduled pipelines and the sources feeding them.
- `user-ui-preferences`: shell width/collapsed in the existing per-user preferences record (HEL-1572 extends it).

### Modified Capabilities
- `nav-section-registry`: the rail and the phone bottom nav add a Home alias outside the five-entry registry list.
- `data-pipelines-nav`: the Pipelines link lives in the icon rail rather than a labelled sidebar.
- `owner-usage-admin`: on desktop, Usage is reached from the avatar menu, not primary nav.

## Non-goals

- Dashboard tabs, meta row, `⌘K` box (HEL-1575/1576); the Home page (HEL-1578); glass nav v2 (HEL-1583).
- The sliding active indicator (waits for HEL-1573); it is static here.
- Nested folders, folder reordering, shared/owner-defined folders, server-side pinning of sources/pipelines.

## Impact

Frontend `app/` shell, `shared/chrome/` sidebar and `BottomNav`, `features/dashboards` list, pipeline/source detail
headers, `features/auth` (`UserMenu`, `setAuth`); backend migration V134, folder and schedule-list routes,
`UserPreferenceRepository` merge writes, auth responses, `JsonProtocols`, `schemas/`; DESIGN.md §9/§10/§12; HEL-726 closed.
