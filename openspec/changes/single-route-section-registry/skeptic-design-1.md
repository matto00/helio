## Skeptic Report — design gate (round N, skeptic-design-1.md)

### What I verified (with evidence)

- Read all planning artifacts: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/nav-section-registry/spec.md`.
- Read the real, current source of every file the change touches: `frontend/src/app/App.tsx`
  (750 lines, full read), `frontend/src/shared/chrome/navDestinations.ts`,
  `frontend/src/shared/chrome/SidebarBody.tsx`, `frontend/src/shared/chrome/MobileNavSheet.tsx`,
  `frontend/src/shared/chrome/BottomNav.tsx`.
- Confirmed CONTRIBUTING.md's actual file-size language (`grep -n "soft budget\|propose a split"
  CONTRIBUTING.md`): "Soft budgets: **~250 lines per source file**... If a file you're editing
  crosses ~400 lines, propose a split" (CONTRIBUTING.md:24) — two distinct thresholds, 250 (the
  named "soft budget") and 400 (the harder "must propose a split" trigger).
- Ran `npm run check:openspec` equivalent (`node scripts/check-openspec-hygiene.mjs`) →
  `openspec/ is clean`. Delta/capability structure is hygienic.
- Cross-checked every claim in design.md's "Decisions" section against the real
  `sectionFromPathname`/`breadcrumbLabel`/`navDestinations`/`MobileNavSheet` implementations —
  the `PickerId` union, the "other" fallback bug, the registry-shape rationale, and the
  `usePickerSelection` scope are all accurately grounded in the real code (design.md is not
  hand-waving here; it's specific and correct about what exists today).

### Verdict: REFUTE

The registry/hook architecture itself (Decisions section) is sound and well-grounded — this isn't
a "start over" REFUTE. But two of the three literal acceptance criteria have real, specific gaps
in the plan as written, and the tasks/design docs contain an internal contradiction. All three are
fixable without redesigning the core approach.

### Change Requests

1. **AC3 ("App.tsx shrinks under CONTRIBUTING.md's file-size soft budget") is not credibly
   satisfiable by the plan as scoped, and `tasks.md` quietly downgrades the bar instead of fixing
   this.** `tasks.md:38-39` reads: "Confirm the file is back under the ~250-line soft budget **(or
   at least clearly under the ~400-line 'propose a split' trigger)**." That parenthetical silently
   substitutes the 400-line hard trigger for the 250-line soft budget the ticket's AC3 actually
   names (`ticket.md:27`: "shrinks under CONTRIBUTING.md's file-size soft budget") — CONTRIBUTING.md
   distinguishes these as two different numbers, not one fuzzy target.
   Reconstructing what `design.md:87-92`'s own "AppShell keeps" list retains post-split — shell-
   level state (~27 lines), `SaveStateContext` wiring (~14), the effects design.md explicitly says
   stay (`document.title`, `beforeunload`, localStorage-persist, quick-launcher keydown,
   `fetchDashboards`/`fetchPanels`, the registry-prefetch effect: ~61 total), undo/redo
   dispatch+selectors (~23), `shellStyle`/`effectiveDashboardAppearance` (~14), plus the remaining
   shell JSX and the three new component-call sites (~80), plus `App()`'s own unchanged 52-line
   `<Routes>` tree, `NotFoundPage` (~18 lines, not scoped for extraction), and the imports both
   still need (~45-55, since `App()` alone imports 17 page/route components) — lands the
   reconstructed file in roughly the 370-400 line range, not under 250. That's clearing the
   400-line hard trigger only by a slim, implementation-detail-dependent margin, and nowhere near
   the 250-line "soft budget" the AC names.
   **Required revision:** either (a) design.md/tasks.md add enough additional extraction — e.g.
   pulling `App()`'s `<Routes>` tree + `NotFoundPage` into a dedicated `AppRoutes.tsx`, and/or
   extracting the `SaveStateContext`/undo-redo wiring into its own hook — so the plan can credibly
   land `App.tsx` under ~250 lines; or (b) explicitly negotiate and document in `design.md` (not
   bury in a task-list parenthetical) that AC3 is being satisfied at the 400-line hard-trigger bar
   instead of the literal "soft budget," so that redefinition is visible and reviewable rather than
   quietly assumed.

2. **Internal contradiction: "Zero behavior change" is stated as an unqualified goal, but the plan
   also explicitly, correctly changes 3 routes' visible labels.** `design.md:22` states as a Goal:
   "Zero behavior change: identical routes, labels, icons, active states, `document.title` strings,
   and mobile-sheet contents before and after." `proposal.md:31` similarly lists as a Non-goal: "no
   visual/behavioral changes to any page." But `proposal.md:28` (What Changes) and `design.md`'s own
   Decisions section explicitly plan to give `/settings`, `/proposals/review`, `/patch-sets/review`
   "their own distinct registry labels instead of silently falling through `breadcrumbLabel`'s
   default case" — and `spec.md`'s "Non-picker chrome routes get their own distinct label"
   requirement makes this a testable, mandatory contract. This is the right fix (it's the exact bug
   the ticket names), but it is unambiguously a **visible behavior change** — the breadcrumb text,
   `document.title`, and sr-only `<h1>` heading for those 3 routes will change from "Dashboards" to
   their correct label. The Goals/Non-goals sections should not claim "zero"/"no" behavior change
   without carving out this one, deliberate, already-specified exception.
   **Required revision:** amend `design.md:22` and `proposal.md:31` to read something like "Zero
   *unintended* behavior change — the sole deliberate exception is the `/settings`,
   `/proposals/review`, `/patch-sets/review` label fix specified in `spec.md`."

3. **Two existing `mobileSection`/`breadcrumbLabel`-dependent call sites in `App.tsx` are never
   named as migration targets in `tasks.md`, creating real risk they're silently dropped or left as
   dangling references once task 2.6 deletes `breadcrumbLabel` and the two switches.** Task 1.3
   names exactly two switches for `usePickerSelection` to replace (breadcrumb-item-name,
   mobile-sheet-items), and task 2.6 says to delete `breadcrumbLabel` "once their callers have
   moved" — but two more real call sites exist and are never enumerated:
   - `App.tsx:411-415` — the registry-section pipeline-prefetch effect
     (`if (mobileSection === "registry" && pipelines.status === "idle") ...`), which keeps the phone
     sheet's provenance subtitle populated without the desktop `SidebarBody` mounted. This isn't
     part of either named switch, so it's easy to overlook and silently regress (design.md's own
     stated goal is "zero unintended behavior change" — dropping this effect would be exactly that
     kind of regression).
   - `App.tsx:637-645` — the `<h1 className="app-content__sr-heading">` block, which reads both
     `breadcrumbLabel(...)` and `breadcrumbItemName` directly and isn't covered by the
     CommandBar/Sidebar/MobileShell extraction (it stays in `AppShell`'s `<main>` per the split
     boundary), so it needs its own migration to `sectionLabel`/`usePickerSelection(...).activeItemName`.
   **Required revision:** add these two call sites explicitly to `tasks.md` (2.5 or 2.6) so the
   migration accounts for every current reader of the soon-to-be-deleted functions, rather than
   relying on "once their callers have moved" to implicitly cover call sites the task list never
   names — which is exactly the kind of per-call-site drift this ticket exists to eliminate.

### Non-blocking notes

- `usePickerSelection`'s handling of the `"dashboards"` `pickerId` isn't spelled out. Today
  `mobileSheetItems`'s `"dashboards"` case builds real items, but `breadcrumbItemName`'s switch has
  no `"dashboards"` case (implicitly falls through to `null`, since the desktop breadcrumb/phone
  title use `selectedDashboardName` directly for that route instead, per `App.tsx:256-259`). Worth
  a one-line clarification in `design.md`/`tasks.md` that the consolidated hook must preserve that
  asymmetry (items populated, `activeItemName` intentionally `null` for `"dashboards"`) rather than
  leaving it to be inferred during implementation.
- `SectionEntry.icon` is optional (`icon?`) in the planned registry shape, while the existing
  `NavDestination.icon` (`navDestinations.ts:17`) is required/non-optional — `BottomNav` and the
  sidebar nav rail always render an icon for every entry. Task 1.2's derivation
  (`sections.filter(s => s.showInNav).map(...)`) will need either a type guard/assertion or a more
  precise `SectionEntry` type (e.g. requiring `icon` whenever `showInNav: true`) to satisfy
  `NavDestination`'s type without an unsound cast. Worth a one-line callout in `design.md` so the
  executor doesn't reach for a bare `icon!` non-null assertion as a first instinct without recording
  why it's actually safe.
