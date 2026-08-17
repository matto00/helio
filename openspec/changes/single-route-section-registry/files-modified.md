## New files

- `frontend/src/shared/chrome/sections.ts` — the single route/section registry (`SectionEntry`,
  `PickerId`, the ordered `sections` array for all 9 routes, `sectionForPathname`/
  `pickerIdForPathname`/`sectionLabel` lookup helpers, `isNavSection` type guard). The one source of
  truth every chrome surface now derives its route→label/icon/picker mapping from.
- `frontend/src/shared/chrome/usePickerSelection.ts` — one hook consolidating the four previously
  independent "what's the current item(s) for this section" call sites (breadcrumb-item-name switch,
  mobile-sheet-items switch, registry-section pipeline-prefetch effect, sr-only `<h1>` heading
  lookup) into a single implementation, keyed off `sections.ts`.
- `frontend/src/shared/chrome/sections.test.ts` — locks the registry's own contract (task 3.2): all
  9 routes resolve their expected `{label, pickerId, showInNav}`; nav-visible entries match
  `navDestinations`; the three non-picker chrome routes each get their own distinct label.
- `frontend/src/app/AppRoutes.tsx` — `App()`'s entire `<Routes>` tree, `NotFoundPage`, and the
  17 page-level imports that only the route tree needs. Split out per design.md's "App.tsx split
  boundary" for a clean routing-vs-shell-chrome boundary.
- `frontend/src/app/CommandBar.tsx` — the command bar (logo, breadcrumb via `sectionLabel`, phone
  title trigger, save-state indicator, undo/redo, appearance editor, refine button, quick-launcher
  trigger, theme toggle, user menu). Owns undo/redo entirely (state, `layoutHistorySlice`
  selectors/dispatch, `useLayoutUndoRedo`) rather than receiving it as props.
- `frontend/src/app/Sidebar.tsx` — the desktop sidebar (nav rail from `navDestinations`, collapse
  toggle, `SidebarBody`).
- `frontend/src/app/MobileShell.tsx` — `BottomNav` + the `MobileNavSheet` portal wiring, driven by
  `usePickerSelection`.

## Modified files

- `frontend/src/app/App.tsx` — split down from 750 to **251 lines** (at CONTRIBUTING.md's ~250-line
  soft budget). `AppShell` now renders `<CommandBar>`/`<Sidebar>`/`<MobileShell>`/`<AppRoutes>` and
  keeps only what's genuinely cross-cutting: shared open/collapsed state, the appearance-preview
  draft, the `document.title` effect, the `beforeunload` guard, the shell-level modal mounts
  (`CreatePipelineModal`/`RefinementChatDrawer`/`QuickLauncherOverlay`), and the
  `fetchDashboards`/`fetchPanels` hydration effects (consumed by more than one extracted piece, so
  they can't be owned by any single one). `App()` shrinks to the auth-rehydrate effect +
  `<ToastViewport />` + `<AppRoutes />`. The old `breadcrumbLabel` function and both `mobileSection`
  switches are deleted — replaced by `pickerSelection.heading`/`usePickerSelection`.
- `frontend/src/shared/chrome/navDestinations.ts` — `navDestinations` is now derived
  (`sections.filter(isNavSection).map(...)`) instead of a hand-maintained parallel list; the
  `NavDestination` export name/shape is unchanged so `BottomNav.tsx`'s existing import needed no
  changes.
- `frontend/src/shared/chrome/SidebarBody.tsx` — its own `sectionFromPathname` implementation/export
  is removed; replaced by `pickerIdForPathname` imported from `sections.ts`. Per-section
  list-rendering bodies (CRUD, badges, delete warnings) are untouched (design.md Non-Goal).
- `frontend/src/context/SaveStateContext.ts` — added `useSaveStateRegistry()`, colocating the
  `flushFnRef`/`registerFlush`/`flush` glue that used to live inline in `AppShell`. (File stays
  `.ts`, not `.tsx`, since the hook returns a plain object with no JSX — renaming risked an
  unnecessary diff for no behavioral reason.)
- `frontend/src/app/App.test.tsx` — added `fetchSources`/`fetchDataTypes` service mocks (previously
  unmocked, so `/sources`/`/registry` couldn't be exercised with real data in this file) and 4 new
  tests closing the coverage gap for the `sources`/`registry` picker sections (breadcrumb-item-name
  fallback-to-first + phone-sheet selection-dispatch), mirroring the pre-existing `/chat` and
  `/pipelines` coverage. All pre-existing tests pass unmodified against the new implementation.

## Deliberate behavior change (per proposal.md, not a defect)

`/settings`, `/proposals/review`, `/patch-sets/review` now resolve their own distinct breadcrumb/
`document.title` labels ("Settings", "Review Proposal", "Review Changes") instead of all three
silently falling through to "Dashboards" via `breadcrumbLabel`'s old default case. Locked by
`sections.test.ts`'s "gives /settings, /proposals/review, and /patch-sets/review each a distinct,
non-'Dashboards' label" test.

## Line-count note (design.md "App.tsx split boundary" / "Fallback if 250 still isn't reached")

`App.tsx` lands at **251 lines** — at/essentially-at the ~250-line soft budget, so the documented
fallback (report the shortfall) isn't needed. `CommandBar.tsx` is 257 lines (also close to budget;
it inherited the largest single JSX block — the whole command-bar header — plus fully-owned
undo/redo per design.md's explicit ownership call). `Sidebar.tsx` (56 lines), `MobileShell.tsx`
(36 lines), and `AppRoutes.tsx` (82 lines) are all comfortably under budget.
