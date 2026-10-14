## Context

See proposal.md - Why. Today `App.tsx` renders `CommandBar` (shared by every width) above `.app-body`, which holds the
desktop `Sidebar` (`app/Sidebar.tsx`: a `NavLink` rail from `useNavDestinations` + `SidebarBody`) and `<main>`;
`MobileShell` (glass `BottomNav` + `MobileNavSheet`) serves phones and does not use `SidebarBody`. Collapse already keeps
an icon rail (F-018) and persists `localStorage["helio.sidebarCollapsed"]`. `SidebarBody` renders `DashboardList` on
dashboard routes and a full `SidebarItemList` of every source/pipeline/conversation elsewhere. `UserMenu` (Settings,
Help, Sign out) is mounted in `CommandBar`. Usage is appended to nav for owners by `useNavDestinations`, which
`BottomNav` also reads. Schedules are owner-only (`V62` RLS, `GET /api/pipelines/:id/schedule`). Dashboard ids are
`TEXT`. A per-user preferences store already exists: `users.preferences` (TEXT holding JSON, V18; today only
`accentColor`), read by `UserPreferenceRepository.getPreferences`, returned only by `GET /api/auth/me`
(`UserResponse.preferences`), written by `PATCH /api/users/me/update` via `upsertGlobalPrefs`, which **overwrites** the
whole JSON. Today 768px is a phone width: the shell, `BottomNav.css` and ~35 stylesheets use `max-width: 768px`. No OpenAPI document exists in the tree
(searched): the API contract is `schemas/**` JSON Schema (checked by `npm run check:schemas`) plus openspec specs.

## Goals / Non-Goals

**Goals:** DESIGN.md §9 rail + context list above the 768 breakpoint (D1); per-user folders end to end; no duplicated full lists.
**Non-Goals:** tabs, meta row, `⌘K` box, Home page, glass nav v2, sliding indicator, nested folders, folder reorder.

## Decisions

**D1 Shell grid and the 768 boundary.** The rail grid is the default (unqueried) shell layout and is overridden under the
existing `(max-width: 768px)` query (DESIGN.md §4 allows only 1440/1100/768/430, so no `769` query is introduced), so exactly 768px stays a phone layout, as every page stylesheet already
assumes. Moving ~36 stylesheets' boundary by 1px is out of scope and would split the shell from the page layouts at
768. The ticket's ">=768px" is read as "the canonical 768 breakpoint" (DESIGN.md §4), recorded in §9. Any JS gate
for the shell (D6) uses a new `useIsPhoneShell()` hook built on `matchMedia("(max-width: 768px)")`, the same query
the CSS uses; `useIsNarrowerThan(768)` (`max-width: 767px`) is not used for the shell. Layout above 768: `.app-shell`
becomes a grid of the rail column (56px, full height, OrbitMark at its top), the context-list column
(`var(--context-list-width)`, full height, 0 when collapsed or when the section has no list), then `CommandBar` over
`<main>`. New components under `frontend/src/app/shell/`: `AppRail.tsx`, `ContextList.tsx`,
`ContextListSeparator.tsx`, `useContextListLayout.ts`, and the per-section bodies. `app/Sidebar.tsx` and the desktop
branches of `SidebarBody` are deleted (the "old sidebar code paths"). At 768px and below the grid does not apply and
the rail and list do not render. `MobileShell` and `MobileNavSheet` are untouched; `BottomNav` only gains Home (D5).
Rejected: putting the rail inside `.app-body` under the header, because it does not match the approved B2 board.

**D2 Persistence (owner ruling: server-side per user), in the existing store.** No new table. `users.preferences`
gains two keys, `contextListWidth` (an integer in 200..400) and `contextListCollapsed` (a boolean). A missing key means
"never set" and the client uses its defaults (248, expanded). HEL-1572 adds its keys to the same JSON. Writes:
- New `PATCH /api/users/me/preferences` takes `{contextListWidth?, contextListCollapsed?}`. It validates the fields,
  merges only those present in one statement
  (`preferences = (COALESCE(preferences,'{}')::jsonb || :patch::jsonb)::text`) and returns the merged preferences.
- `upsertGlobalPrefs` (the accent write) is changed to the same merge, so changing the accent no longer erases the
  shell keys. A regression test covers both write orders.

Delivery: `UserPreferences` gains `contextListWidth: Option[Int]` and `contextListCollapsed: Option[Boolean]`, and
**every** user-returning auth response carries preferences, not just `/me`:
- `GET /api/auth/me`;
- `AuthService.authResultOf` (login, register, OAuth);
- `AuthResult.of` (MFA verify, `MfaService`);
- `BetaAccessRoutes` redeem.

These go through one helper that loads the preferences and builds the `UserResponse` (exactly four `fromDomain`
callers today: `ApiRoutes` /me, `AuthService` `AuthResult.of` and `authResultOf`, `BetaAccessRoutes`), so the
preferences repository is injected into `AuthService`, `MfaService` and `BetaAccessRoutes`, with wiring in `Main.scala`
and the test harnesses. `getPreferences` parses the new keys and drops invalid values. The executor enumerates every
`UserResponse.fromDomain` caller with grep and covers each one. On the client, `setAuth` keeps the existing
`preferences` when an incoming user has none, as a defensive fallback.

Because `ProtectedRoute` waits for `/me` on reload, and the login, register, OAuth and MFA responses now carry
preferences before the shell mounts, the first paint already has the saved width. There is no flash and no extra
request.

Writes from the client:
- one write on pointerup;
- keyboard resizes debounced at 400ms;
- collapse toggles written immediately;
- on failure, keep the local value and do not show a toast.

**Legacy key:** migrated once. On the first authenticated load where `contextListCollapsed` is absent and
`localStorage["helio.sidebarCollapsed"] === "true"`, PATCH `{contextListCollapsed: true}`. The key is removed on every
load either way. Isolation: `users` has **no** RLS (V88 says why: sessions are resolved before any user context exists) and
`UserPreferenceRepository` runs on the plain app handle. Isolation is therefore enforced in the app, exactly like the
existing `PATCH /api/users/me/update`: the endpoint takes no user id and the merge is keyed only on the authenticated
session's user id. A route test proves that user B's PATCH leaves A's stored preferences byte-identical. No RLS change
to `users` (enabling it would break login).

**D3 Separator.** WAI-ARIA window-splitter: `role="separator"`, `aria-orientation="vertical"`, `aria-valuenow/min/max`,
`aria-controls` the list, `aria-label="Resize dashboard list"` (section-named), `tabIndex=0`. Arrow Left/Right step
16px (Shift 64px), Home/End = min/max, Enter or double-click toggles collapse. Pointer drag uses pointer capture and
writes the CSS variable per animation frame, committing to state/storage on pointerup. The hit area is >=8px wide over a
1px hairline; focus uses the shared focus-ring tokens. A collapse button sits in the list header; when collapsed, a
rail-foot "Expand list" button (aria-expanded) restores it.

**D4 Surfaces and accent.** Rail paints `--app-bg`, the list `--app-surface-soft` (both themes have it), separated by
the existing hairline border token: chrome darker than cards (`--app-surface`, unchanged at #1a1816). The active rail
item alone uses `--app-accent-dim` + `--app-accent` (static; HEL-1573 adds the slide). No literal colours, fonts or
durations (motion guard); counts and times use `--font-mono`.

**D5 Rail items.** Home (`House`, `to="/home"`) + the five registry destinations (`navDestinations`, not
`useNavDestinations`, so Usage never enters the rail) + foot: Settings link, collapse/expand control, avatar
`UserMenu`. Home renders `aria-current` never (it aliases `/home` until HEL-1578), so exactly one item is active. The same
`homeAlias` destination (one exported constant beside `navDestinations`) is prepended by `BottomNav` (owner ruling
2026-10-13): 6 tabs, 7 for owners; the 44px floor holds at 375px (7x44=308 <= ~333px usable); its active class is
suppressed the same way. The HEL-774 contrast floors are unaffected (same material, same per-tab styling). Labels
come from `sections.ts` (tooltips + aria-label).

**D6 Avatar menu and Usage.** `UserMenu` gains an owner-only "Usage" item (`/admin/usage`). Above 768px (`useIsPhoneShell()` false) the avatar
renders in the rail foot and `CommandBar` does not render its own; on phones `CommandBar` keeps it. Exactly one
`UserMenu` trigger is in the accessibility tree at any width (conditional render via `useIsPhoneShell()`, not
CSS-only hiding). `BottomNav` keeps reading `useNavDestinations` (owner keeps Usage there on phones).

**D7 Folder schema (V134, re-check number before merge).** `dashboard_folders(id UUID PK, owner_id UUID NOT NULL FK
users ON DELETE CASCADE, name TEXT NOT NULL CHECK trimmed length 1..80, collapsed BOOLEAN NOT NULL DEFAULT FALSE,
created_at, updated_at, UNIQUE(id, owner_id))` + unique index `(owner_id, lower(name))`;
`dashboard_folder_assignments(owner_id UUID FK users ON DELETE CASCADE, dashboard_id TEXT FK dashboards ON DELETE
CASCADE, folder_id UUID, PK(owner_id, dashboard_id), FK(folder_id, owner_id) -> dashboard_folders(id, owner_id) ON
DELETE CASCADE)`. The composite FK makes filing into another user's folder impossible at the schema level. Both tables:
`ENABLE` + `FORCE ROW LEVEL SECURITY`, one policy each `USING` and `WITH CHECK` `owner_id = app.current_user_id`
following the newest owner-scoped precedent in the tree (V131's policy shape; it has no GRANTs, and none are added
unless the executor proves the app role lacks table privileges in a NOBYPASSRLS session).

**D8 Folder API.** Routes per the `dashboard-folders` spec, in `api/routes/dashboards/`, through a
`DashboardFolderService` over a Slick repository on the RLS-scoped (non-privileged) pool. `PUT
/api/dashboards/:id/folder` checks dashboard access with the existing dashboard ACL path (viewer suffices) before
writing; `GET` returns assignments joined to dashboards visible to the caller under RLS, so a revoked grant simply
stops appearing (stale rows are harmless and cascade on dashboard delete). Errors use existing `ServiceResponse`
shapes. JSON Schemas: `schemas/dashboards/dashboard-folder*.schema.json`, request/response files per endpoint.

**D9 Schedule list.** `GET /api/pipeline-schedules`, in `api/routes/pipelines/`, on the RLS-scoped pool. One Slick
query for `items` (`pipeline_schedules` JOIN `pipelines` ON owner = caller AND `enabled`, ordered `next_run_at ASC
NULLS LAST, name`) and one for `sources`: `SELECT DISTINCT ON (ds.id) ...` over `pipeline_roots` JOIN those schedules
JOIN `data_sources` (visible to the caller under RLS) ordered `ds.id, next_run_at ASC NULLS LAST, p.name`, then
re-sorted like `items`. Two queries total, independent of pipeline/source counts. Schema
`schemas/pipelines/pipeline-schedule-list-response.schema.json`. No migration.

**D10 Section bodies.** Dashboards: `DashboardList` grows folder groups (disclosure button with `aria-expanded`, name,
mono count), an "Unfiled" group, "New folder", inline rename (reusing the existing inline-rename pattern), delete with
confirm, and a "Move to..." row action listing folders + Unfiled; the filter spans groups; folder counts count only
assignments returned by `GET` that match a dashboard in the loaded (RLS-filtered) list, so revoked grants never count; the active dashboard's
folder auto-expands without persisting. Folder state lives in a new `dashboardFoldersSlice` (thunks; optimistic
collapse with rollback). One shared `scheduledItems` slice fetches `GET /api/pipeline-schedules` once when either the
Pipelines or Sources list first mounts (refetched on revisit if older than 60s). Pipelines: Recent (from
`recentHistoryStore`, filtered by kind, up to 8; the store keeps 10 across kinds, so fewer may show) + Scheduled (`items`, max 8, next run via the existing date formatting helpers, mono).
Sources: Recent + Scheduled (`sources`, max 8, "next <time> · <pipeline>"). Each has "View all" and the existing add
action. Assistant: existing conversation list moved as-is. Connectors/Settings/review: no list (owner ruling).

**D12 Delete moves to the detail pages.** `SidebarBody` is today the only UI that deletes a pipeline and, apart from
`EmptySchemaAffordance`, the only one that deletes a source. Removing the full lists would remove those controls, so
delete moves to an `ActionsMenu` on each detail page's header (`PipelineDetailHeader`, the `SourceDetailPanel.tsx`'s
`.source-detail-panel__header`), with the same confirm dialog and visibility as the sidebar rows had (no new
gating; the server already enforces ownership). The pipeline confirm keeps the sidebar's "Any panels bound to this
pipeline's Outputs will stop working." text. Sources keep the HEL-1258 reference warning (`sourceDeleteWarning` over
`sources.references`) and the HEL-989 conflict notice (`SourceDeleteConflictNotice` on a 409). The source page dispatches `fetchSourceReferences` on mount (the thunk's
`condition` dedupes it), so the warning survives a deep link or reload. After a successful
delete the page navigates to the section overview, and after a refused delete it stays put.

**D11 DESIGN.md.** Edit §9 to record D2, D4, D5 (Home alias), the per-section content and the separator contract;
relabel §10's two "driver default" provenance items as owner rulings (2026-10-13); §9's "persist per user" now
states server-side; §9 records the 768 boundary (D1); §12's "five tabs" notes the Home tab (HEL-1583 decides).

## Risks / Trade-offs

- [Phone regression from the grid change] -> grid applies only outside the `(max-width: 768px)` override; evaluator compares
  390px screenshots with main in both themes.
- [RLS never exercised in dev/CI (superuser)] -> a backend test runs the folder queries as a NOBYPASSRLS role with
  `app.current_user_id` set, proving cross-user read/insert are blocked (MISTAKES.md).
- [V134 taken by another lane] -> re-check origin/main before merge; renumber if needed.
- [Prefs write storm] -> one write per drag and debounced key presses; a test asserts the request count.
- [Accent write erases shell keys or the reverse] -> both writes merge; regression test in both orders.
- [Login responses get one extra PK read] -> it is the same read `/me` already does.
- [Owner with 7 phone tabs at 320px] -> 7 x 44 = 308 > ~278px usable, so the tabs overflow. Accepted
  (keep-six-1583-decides); stated in the PR body and handed to HEL-1583.

## Migration Plan

V134 is additive (two new tables). Rollback: drop both tables, and ignore the unknown preference keys; frontend tolerates a failed folder fetch by showing
dashboards ungrouped with an inline error.

## Planner Notes

Self-approved: no nested folders; folder order = creation time; names unique per user case-insensitively; existing
section labels; D4 surface tokens; D2 legacy-key one-time migration. Owner rulings 2026-10-13: per-user folders,
user folders only (+ Unfiled), Home alias to `/home`, Usage in avatar menu, non-dashboard lists = recent + scheduled; sources show sources feeding a scheduled pipeline
(soonest run); Assistant keeps its list, Connectors none; width/collapsed persist server-side per user; phone BottomNav gets Home (keep-six-1583-decides).
