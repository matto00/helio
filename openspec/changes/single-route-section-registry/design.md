## Context

`frontend/src/app/App.tsx` (750 lines, well over CONTRIBUTING.md's ~250-line soft budget and past
its ~400-line "propose a split" trigger) hosts `AppShell`, which derives "what section/item is the
user currently on" three separate times: `breadcrumbLabel()` (desktop breadcrumb + phone sheet
title + `document.title`), a `mobileSection` switch feeding `breadcrumbItemName`, and a second
`mobileSection` switch building `mobileSheetItems`. `navDestinations.ts` (nav-link list) and
`SidebarBody.tsx`'s exported `sectionFromPathname` are two more independent route-matchers. Six
implementations of "what section is `/x`" have already drifted apart in production (PR #382's
tactical fixes).

## Goals / Non-Goals

**Goals:**
- One registry (`frontend/src/shared/chrome/sections.ts`) mapping route → `{label, shortLabel,
  icon, showInNav, pickerId}`, replacing `navDestinations.ts`'s hand-list, `breadcrumbLabel`'s
  if-ladder, and `SidebarBody.sectionFromPathname`'s if-ladder.
- One hook (`usePickerSelection`) replacing **all four** current call sites that derive
  per-section "current item(s)" from a `mobileSection`/pathname switch: the breadcrumb-item-name
  switch, the mobile-sheet-items switch, the registry-section pipeline-prefetch effect
  (`App.tsx:411-415`), and the sr-only `<h1>` heading block (`App.tsx:637-645`) — all four must
  already agree and have no structural reason not to share one implementation.
- `App.tsx` at or credibly near CONTRIBUTING.md's ~250-line soft budget (not merely under the
  ~400-line "propose a split" trigger — see the split boundary decision below for the concrete
  extractions this requires, and the explicit fallback if reality still lands short).
- Zero **unintended** behavior change: identical routes, icons, active states, and mobile-sheet
  contents before and after. The one **deliberate** exception, called out here rather than left
  implicit: `/settings`, `/proposals/review`, `/patch-sets/review` currently mislabel themselves
  "Dashboards" via `breadcrumbLabel`'s default case, and this change intentionally fixes that (see
  `specs/nav-section-registry/spec.md`'s "Non-picker chrome routes get their own distinct label" —
  this is the direct fix for the "review routes had no section" bug the ticket names, not an
  incidental side effect).

**Non-Goals:**
- No change to `SidebarBody`'s per-section list bodies (CRUD, delete-warnings, badges,
  rename) — only its route→picker matching moves to the shared registry. Rewriting those bodies
  onto `usePickerSelection` is a reasonable future follow-up, not required by this ticket's
  acceptance criteria ("route -> {label, icon, selection state}"), and touching them risks
  regressing already-tested CRUD behavior for no acceptance-criteria benefit.
- No change to `MobileNavSheet.tsx` itself (stays a dumb, fully-controlled picker component).
- No new/changed routes, no visual changes.

## Decisions

**Registry shape — data-only, keyed by route, not by picker.** `SectionEntry = { path, end?,
pickerId, label, shortLabel?, icon?, showInNav }`. `pickerId` is the same narrow union
`sectionFromPathname` already returns (`"dashboards"|"sources"|"pipelines"|"registry"|"metrics"
|"chat"|"other"`) — it says *which* picker/list a route belongs to, not the full per-picker
behavior. Multiple registry entries share `pickerId: "other"` (`/settings`, `/proposals/review`,
`/patch-sets/review`) while each keeps its own distinct `label` — this is the direct fix for
`breadcrumbLabel`'s current default-case bug (unmatched paths silently render "Dashboards"; these
three routes never had their own label branch). Alternative considered: key the registry by
`pickerId` instead of `path` (one entry per section, not per route) — rejected because it can't
express "same picker, different route, different label" (there is no picker for these three
routes) without a second lookup table, defeating "exactly one source of truth."

**Why a registry can't own `selection` as static data.** The ticket's literal `{path, label,
shortLabel, icon, selection}` shape names `selection` as a field, but the actual "what's selected"
logic is inherently live (reads five different Redux slices, differs between Redux-driven
selection and route-param-driven selection per section) — it cannot be serialized into a plain
data array without turning the registry into a bag of closures keyed by string, which is harder to
read than naming the one function directly. `usePickerSelection(pathname)` is that one function:
given the current pathname, returns `{ items, activeItemId, activeItemName, emptyMessage, heading,
onSelect }`, keyed internally off `pickerIdForPathname`. It is the literal `selection` the ticket
names — centralized to one implementation instead of two independent switches — just expressed as
a hook rather than a data field, since only a hook can depend on live store state.

**`App.tsx` split boundary — four extractions, not one.** Reconstructing what a
`CommandBar`/`Sidebar`/`MobileShell`-only split leaves behind (shell state + effects + `App()`'s
own `<Routes>` tree + 17 page-level imports + `NotFoundPage`) lands in the 370-400 line range per
round-1 skeptic review — clearing the 400-line hard trigger only narrowly, nowhere near the named
250-line soft budget. To credibly target 250, the split adds two more extractions beyond
`CommandBar`/`Sidebar`/`MobileShell`:
- `frontend/src/app/AppRoutes.tsx` — `App()`'s entire `<Routes>` tree plus `NotFoundPage`, plus the
  17 page-level component imports and `ProtectedRoute`/`PublicOnlyRoute` that only that tree uses.
  `App.tsx`'s exported `App()` shrinks to the auth-rehydrate effect + `<ToastViewport />` +
  `<AppRoutes />`. This is a clean boundary (routing vs. shell chrome), not line-shaving for its
  own sake.
- Undo/redo ownership (state, `layoutHistorySlice` selectors/dispatch, `handleUndo`/`handleRedo`,
  and the `useLayoutUndoRedo(selectedDashboardId)` keyboard-shortcut hook call) moves entirely into
  `CommandBar.tsx` rather than staying in `AppShell` and being drilled down as `canUndo`/`onUndo`
  props — `CommandBar` is unconditionally mounted for exactly `AppShell`'s lifetime, so this is a
  real ownership move, not a relocation that still needs wiring back.
- The `flushFnRef`/`registerFlush`/`flush`/`saveStateContextValue` glue (today ~15 lines inline in
  `AppShell`) moves into a small `useSaveStateRegistry()` hook colocated with
  `frontend/src/context/SaveStateContext.tsx`; `AppShell` calls it in one line and keeps rendering
  `SaveStateContext.Provider` with its result (the Provider itself, and its wrapping scope, stay in
  `AppShell` unchanged — only the value construction moves).

`AppShell` (still in `App.tsx`) keeps only what's genuinely cross-cutting between the extracted
pieces and can't be owned by one of them: `isMobileNavSheetOpen`, `isDashboardListCollapsed`,
`isRefinementOpen`, `isQuickLauncherOpen`, `draftAppearance` (read by both `shellStyle` and the
`DashboardAppearancePreviewContext.Provider` wrapping `<Outlet />`, so it can't move into
`CommandBar` alone), the `document.title` effect, the `beforeunload` guard, and
`shellStyle`/`effectiveDashboardAppearance`. It renders `<CommandBar>`/`<Sidebar>`/`<MobileShell>`
passing only the few values each genuinely needs from shell state (e.g. `onOpenMobileNavSheet`,
`draftAppearance`/`setDraftAppearance`). Each extracted component calls
`usePickerSelection`/`useLocation`/`useAppSelector` itself rather than receiving a hand-drilled
prop bag — this is what the ticket means by "consumers of the registry" (each surface independently
derives from the one source of truth, rather than being spoon-fed by `AppShell`, which is exactly
the pattern that let the four copies of selection logic diverge in the first place: one central
place computing all four, with no structural pressure keeping them in sync).

**Fallback if 250 still isn't reached.** These four extractions are a genuine best-effort at the
literal soft budget — exact line count depends on implementation details not knowable before code
is written. If `App.tsx` still lands above ~250 after all four, the executor MUST state the actual
final line count and what's left in it, in the PR description — visible and reviewable, not
silently treated as "close enough." This is the explicit, documented renegotiation round-1 asked
for, made only if the best effort still falls short, not in place of attempting it.

**One new capability, no modified ones.** Every requirement on `openspec/specs/{mobile-bottom-nav,
mobile-dashboard-sheet, assistant-chat-nav, data-pipelines-nav}` describes route/label/behavior
contracts this change preserves byte-for-byte (verified against current output for every existing
route) — none need a MODIFIED delta. But "exactly one source of truth"/"distinct label per chrome
route" are themselves a testable contract, so this adds one new capability, `nav-section-registry`.
This also satisfies this repo's openspec tooling, which requires every change to have at least one
delta (`openspec validate` errors on zero deltas even non-strict) — confirmed live, not assumed.

**Two implementation clarifications (round-1 skeptic non-blocking notes).** `usePickerSelection`
must preserve today's `"dashboards"` asymmetry: `mobileSheetItems` builds real items for it, but
`breadcrumbItemName` has no `"dashboards"` case (desktop breadcrumb/phone title use
`selectedDashboardName` directly instead, per `App.tsx:256-259`) — the hook returns populated
`items` but an intentionally `null` `activeItemName` for `pickerId: "dashboards"`, not an inferred
value. Separately, `SectionEntry.icon` is typed required-when-`showInNav` (e.g. a discriminated
`{ showInNav: true; icon: LucideIcon } | { showInNav: false; icon?: never }` union, or an
equivalent type-level guarantee) rather than a bare `icon?: LucideIcon` — `navDestinations.ts`'s
derivation must satisfy `NavDestination.icon`'s existing required type without a bare `icon!`
non-null assertion.

## Risks / Trade-offs

- [Risk] Extracting `CommandBar` changes its prop/hook surface enough to introduce a subtle
  re-render or stale-closure bug (e.g. `flush` via `SaveStateContext` vs. a prop) → Mitigation:
  keep `SaveStateContext.Provider` in `AppShell` unchanged; `CommandBar` consumes it via the
  existing `useContext`, not a new prop.
- [Risk] Collapsing `breadcrumbItemName` and `mobileSheetItems` into one hook could accidentally
  change desktop breadcrumb text if the two switches had ever silently diverged → Mitigation:
  executor snapshots current behavior (manual walk of all six sections + three "other" routes)
  before refactoring, evaluator/skeptic re-verify via Playwright against that same route list.
- [Risk] `pickerIdForPathname`'s matching order matters (e.g. `/` must not swallow `/settings`) →
  Mitigation: keep the existing most-specific-first ordering `sectionFromPathname` already uses;
  add a unit test asserting every current route resolves to its current picker/label pair.

## Planner Notes

Self-approved: scoping `usePickerSelection` to replace `AppShell`'s four selection call sites
(breadcrumb item name, mobile-sheet items, registry-prefetch effect, sr-only heading), not
`SidebarBody`'s desktop list bodies — see Non-Goals. Keeps the change to the files the ticket
names, avoids CRUD-behavior regression risk, and still satisfies "adding a new route/section
requires editing the registry only" for the chrome/nav concerns the acceptance criteria describe.
