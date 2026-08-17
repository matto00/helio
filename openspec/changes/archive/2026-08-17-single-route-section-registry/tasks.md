## 1. Registry

- [x] 1.1 Create `frontend/src/shared/chrome/sections.ts`: `SectionEntry` type (icon required
      whenever `showInNav: true` — a discriminated union or equivalent type-level guarantee, not a
      bare `icon?`), `PickerId` type, the ordered `sections` array (all 9 routes: `/`, `/sources`,
      `/pipelines`, `/registry`, `/metrics`, `/chat`, `/settings`, `/proposals/review`,
      `/patch-sets/review`), and `sectionForPathname`/`pickerIdForPathname`/`sectionLabel` lookup
      helpers, preserving today's most-specific-first match ordering.
- [x] 1.2 Rewrite `frontend/src/shared/chrome/navDestinations.ts` to derive `navDestinations` from
      `sections.filter(s => s.showInNav)` instead of its own hand-list; keep the `NavDestination`
      export name/shape so `BottomNav.tsx`'s existing import is unaffected.
- [x] 1.3 Create `frontend/src/shared/chrome/usePickerSelection.ts`: one hook returning
      `{ items, activeItemId, activeItemName, emptyMessage, heading, onSelect }` for the picker at
      the current pathname, consolidating today's four independent selection call sites in
      `App.tsx`: the breadcrumb-item-name switch, the mobile-sheet-items switch, the
      registry-section pipeline-prefetch effect (`App.tsx:411-415`), and the sr-only `<h1>` heading
      block's item-name lookup (`App.tsx:637-645`). Preserve the `"dashboards"` asymmetry: real
      `items`, but `activeItemName` intentionally `null` (desktop breadcrumb/phone title use
      `selectedDashboardName` directly for that route, not this hook's output).

## 2. Consumers

- [x] 2.1 Update `frontend/src/shared/chrome/SidebarBody.tsx`: replace its own `sectionFromPathname`
      implementation/export with `pickerIdForPathname` imported from `sections.ts` (keep the file's
      per-section list-rendering bodies unchanged — see design.md Non-Goals).
- [x] 2.2 Create `frontend/src/app/AppRoutes.tsx`: `App()`'s entire `<Routes>` tree plus
      `NotFoundPage`, plus the 17 page-level component imports and `ProtectedRoute`/
      `PublicOnlyRoute` that only that tree uses. `App()` in `App.tsx` shrinks to the
      auth-rehydrate effect + `<ToastViewport />` + `<AppRoutes />`.
- [x] 2.3 Create a `useSaveStateRegistry()` hook colocated with
      `frontend/src/context/SaveStateContext.tsx`, moving the `flushFnRef`/`registerFlush`/
      `flush`/`saveStateContextValue` glue out of `AppShell`. `AppShell` calls it in one line and
      keeps rendering `SaveStateContext.Provider` with its result unchanged.
- [x] 2.4 Extract `frontend/src/app/CommandBar.tsx` from `App.tsx`'s `<header
      className="app-command-bar">` block (logo, breadcrumb via `sectionLabel`, phone title trigger,
      save-state indicator, undo/redo, appearance editor, refine button, quick-launcher trigger,
      theme toggle, user menu). Reads `usePickerSelection`/`useLocation`/Redux directly. **Owns
      undo/redo entirely** (state, `layoutHistorySlice` selectors/dispatch, `handleUndo`/
      `handleRedo`, and the `useLayoutUndoRedo(selectedDashboardId)` hook call) rather than
      receiving `canUndo`/`onUndo` as props from `AppShell`. Receives only genuinely shell-owned
      props: `onOpenMobileNavSheet`, `onOpenRefinement`, `onOpenQuickLauncher`,
      `draftAppearance`/`setDraftAppearance`.
- [x] 2.5 Extract `frontend/src/app/Sidebar.tsx` from `App.tsx`'s `<aside className="app-sidebar">`
      block (nav rail built from `navDestinations`, collapse toggle, `SidebarBody`). Receives
      `isDashboardListCollapsed`/`onToggleCollapse` as props.
- [x] 2.6 Extract `frontend/src/app/MobileShell.tsx` covering `BottomNav` + the `MobileNavSheet`
      portal wiring, driven by `usePickerSelection`. Receives `isMobileNavSheetOpen`/`onClose` as
      props (state stays owned by `AppShell`, since the sheet's open trigger button lives inside
      `CommandBar`).
- [x] 2.7 Update `App.tsx`'s `AppShell` to render `<CommandBar>`/`<Sidebar>`/`<MobileShell>` in
      place of the extracted markup and `<AppRoutes>` in place of the inline route tree, keeping
      the `document.title` effect, `beforeunload` guard, `useSaveStateRegistry()` call +
      `SaveStateContext.Provider`, `CreatePipelineModal`/`RefinementChatDrawer`/
      `QuickLauncherOverlay` mounts, `shellStyle`/`effectiveDashboardAppearance`, and
      `isMobileNavSheetOpen`/`isDashboardListCollapsed`/`isRefinementOpen`/`isQuickLauncherOpen`/
      `draftAppearance` state. **Measure the resulting `App.tsx` line count.** If it's not at or
      credibly near ~250 lines (CONTRIBUTING.md's soft budget), state the actual final count and
      what's left in it in the PR description rather than silently treating the ~400-line hard
      trigger as good enough (design.md "Fallback if 250 still isn't reached").
- [x] 2.8 Remove now-dead code: the old `breadcrumbLabel` function and both `mobileSection` switches
      in `App.tsx` once all four call sites (task 1.3) have moved to `sectionLabel`/
      `usePickerSelection`.

## 3. Tests

- [x] 3.1 Update `frontend/src/shared/chrome/navDestinations.test.ts` and
      `frontend/src/shared/chrome/SidebarBody.test.tsx` for the new registry-backed
      implementations (same expected output, new source).
- [x] 3.2 Add `frontend/src/shared/chrome/sections.test.ts`: every one of the 9 routes resolves to
      its expected `{label, pickerId, showInNav}`; nav-visible entries match the current 6
      `navDestinations`; `/settings`, `/proposals/review`, `/patch-sets/review` each resolve their
      own distinct label (not a shared/default "Dashboards").
- [x] 3.3 Add/adjust tests for `usePickerSelection` (or cover it via the existing `App.tsx`
      integration tests, if one exists) confirming breadcrumb-item-name, mobile-sheet-items, the
      registry-prefetch effect, and the sr-only heading all stay consistent for every picker
      section, including the `"dashboards"` `activeItemName: null` asymmetry.
- [x] 3.4 Full frontend verification: `npm run lint`, `npm test`, `npm run build` all green from a
      clean run after the split.
