## Evaluation Report — Cycle 1 (evaluation-2.md)

Supersedes `evaluation-1.md`, which BLOCKED on Phase 3 due to a shared dev-database
environmental issue (see below). Phases 1 and 2 are unchanged from `evaluation-1.md` (no code
changed between runs) and are re-stated here for a single authoritative cycle-1 verdict; Phase 3
is completed fresh in this report.

### Phase 1: Spec Review — PASS

Issues: none. Unchanged from `evaluation-1.md` — no code changed between the two evaluation runs
(confirmed: `git status`/`git diff` on `frontend/**` and `backend/**` show nothing beyond
`evaluation-1.md` itself and `workflow-state.md` bookkeeping). See `evaluation-1.md` for the full
per-AC/per-task breakdown: all three ACs addressed explicitly (single registry, registry-only
route additions, `App.tsx` at 251 lines vs. the ~250-line soft budget), all 15/15 `tasks.md` items
verified against the diff, no scope creep, no regressions to `mobile-bottom-nav`/other specs, the
one deliberate behavior change (distinct "other" labels) is documented and locked by a test.

### Phase 2: Code Review — PASS

Issues: none blocking. Unchanged from `evaluation-1.md` — gates were already re-run fresh in
`WORKTREE_PATH` there (`npm run lint`, `npm run format:check`, `npm test` — 2242/2242,
`npm --prefix frontend run build`, all green), the pre-commit bypass was independently confirmed
(`npm run check:openspec` is the only failing hook, for exactly the stated "not archived yet"
reason; `check:schemas`/`check:scala-quality` both clean), and the CONTRIBUTING.md/DESIGN.md
mechanical checks (file-size budgets, no `any`, no dead code, no orphaned CSS classes) all passed.
One non-blocking suggestion carried forward: `App.tsx`/`AppRoutes.tsx` have a (working,
skeptic-approved-by-design) circular import — see `evaluation-1.md` for detail.

### Phase 3: UI Review — PASS

Issues: none.

**Environmental blocker resolved.** `evaluation-1.md`'s BLOCKER was the shared dev Postgres
database's `flyway_schema_history` missing a row for V89 (`totp mfa`), unrelated to this
(frontend-only) diff. Independently re-verified the fix before re-testing:
- `psql` against the shared dev DB now shows V88/V89/V90 all present with `success = t`.
- `git diff`/`git status` on `backend/src/main/scala/com/helio/infrastructure/Database.scala`
  (and all of `backend/`) in this worktree are clean — no stray `outOfOrder` change shipped as
  part of this ticket.

**Dev servers.** `scripts/concertino/start-servers.sh "$WORKTREE_PATH" 6156 9063 HEL-724` now
returns `READY backend=http://localhost:9063/health` and `READY frontend=http://localhost:6156`.
`scripts/concertino/assert-phase.sh servers ...` returns `PASS servers`. (Both scripts also print a
harmless `emit-event.sh: No such file or directory` line — that utility script is
`scripts/concertino/`-gitignored tooling that only exists in the main checkout, not copied into
worktrees; it does not affect server health and both scripts' own health checks/exit codes are
unaffected.)

**Happy path — logged in as `matt@helio.dev`, walked all 9 registry routes end-to-end:**
- `/` — sidebar's 6 nav links render in registry order (Dashboards/Data Sources/Data
  Pipelines/Data Types/Metrics/Assistant) with correct `to`/labels; breadcrumb shows
  "Dashboards / SWEEP-pkgdash-verify"; `document.title` = "SWEEP-pkgdash-verify · Dashboards ·
  Helio"; sr-only `<h1>` = "Dashboards: SWEEP-pkgdash-verify".
- `/sources` — `document.title` = "SWEEP-verify2-static-1786950783032 · Data Sources · Helio"
  (fallback-to-first-item selection, as `usePickerSelection`'s `sources` case implements).
- `/pipelines` — breadcrumb shows "Data Pipelines" alone (no item selected); undo/redo/appearance
  editor correctly absent (gated to `onDashboardView`).
- `/pipelines/:id` (clicked "Profit (migrated)") — `document.title` = "Profit (migrated) · Data
  Pipelines · Helio" (route-param-driven selection resolves correctly).
- `/registry` — auto-resolves to `/registry/:id` with the first data type selected;
  `document.title` = "SweepPerfType21786987144197 · Data Types · Helio".
- `/metrics` — `document.title` = "Metrics · Helio" (no metric selected).
- `/chat` — `document.title` = "Test skeptic verification message · Assistant · Helio".
- `/settings` — `document.title` = "Settings · Helio"; breadcrumb shows "Settings" alone; the
  phone mobile-title switcher button is correctly absent at both desktop and phone widths
  (`pickerId: "other"` → `mobileTitleVisible: false`).
- `/proposals/review` — `document.title` = "Review Proposal · Helio".
- `/patch-sets/review` — `document.title` = "Review Changes · Helio".

  All three "other" routes resolve their own distinct label as the ticket's core AC requires — no
  fallthrough to "Dashboards" observed anywhere.

**Unhappy path.** Navigated to a nonexistent path (`/this-route-does-not-exist`): renders
`NotFoundPage` ("Page not found" / "That page doesn't exist or may have moved." / "Back to
dashboards" CTA) with no shell chrome (by design — outside `AppShell`, doesn't depend on
auth/registry context) and no console errors; clicking "Back to dashboards" correctly returns to
`/` with full chrome restored.

**Loading/empty states.** No blank screens observed on any route transition; pages render their
existing empty/loading states unaffected by this refactor (this diff touches no page-level
components, only shell chrome).

**Console errors.** Zero console errors or warnings across the entire walk: initial unauthenticated
load (2 expected `401` on `/api/auth/me`, standard pre-login rehydrate probe, not a regression),
login, all 9 routes (both hard-navigation and in-app link clicks), the 404 fallback, phone nav-sheet
open/select, and both theme toggles.

**Entry points.** Verified the same registry-driven label/selection resolves consistently from
three independent triggers: (1) desktop sidebar nav-rail clicks, (2) direct URL navigation
(hard reload), and (3) the phone bottom-nav tabs / mobile-title switcher (see below) — exactly the
"one source of truth, multiple consumers" property this ticket exists to guarantee.

**Accessible names / keyboard support.** Every interactive chrome element exposes a descriptive
accessible name via the accessibility tree (`"Undo layout change"`, `"Redo layout change"`,
`"Customize dashboard appearance"`, `"Refine this dashboard with AI"`, `"Open assistant"`,
`"Switch to light/dark theme"`, `"User menu"`, `"Switch {section} (current: {item})"` for the phone
title trigger, `"Collapse/Expand sidebar"`). All are native `<button>`/`<a>` elements (no custom
non-semantic click targets introduced by this diff), so standard keyboard operability (Tab focus +
Enter/Space activation) is preserved structurally; no new focus traps introduced — confirmed the
404 page and mobile nav sheet both expose a working, focusable close/CTA path.

**Breakpoints (1440 / 1100 / 768 / phone-375):**
- 1440px and 1100px — desktop layout (breadcrumb, sidebar, undo/redo, appearance editor all
  visible); screenshot at 1440px shows no layout breakage in light or dark theme.
- 768px — mobile layout (bottom tab bar + phone title switcher, sidebar hidden). This matches the
  existing (untouched by this diff) `max-width: 768px` CSS breakpoint in `BottomNav.css`/`App.css`
  — `git diff --stat -- '*.css'` for this change is empty, so this is pre-existing behavior, not a
  regression introduced here.
- 375px (phone) — bottom tab bar renders all 6 destinations with their `shortLabel`s ("Home",
  "Sources", "Pipelines", "Types"; Metrics/Assistant have no `shortLabel` in the registry, matching
  pre-existing `navDestinations` data, so their accessible name is the full label); the phone
  title/switcher button opens `MobileNavSheet` correctly (dashboards list, "Current" badge on the
  active item); selecting a different dashboard closes the sheet, dispatches
  `setSelectedDashboardId`, and updates `document.title`/breadcrumb immediately — confirming the
  phone sheet and desktop breadcrumb share the exact same `usePickerSelection` state, not two
  independent implementations that could drift.

No layout breakage, no missing chrome, no orphaned styling observed at any tested width.

### Overall: PASS

Phase 1, Phase 2, and Phase 3 all pass on fresh evidence. The cycle-1 BLOCKER from `evaluation-1.md`
was an environmental shared-dev-database issue, independently confirmed resolved (not a code
change, and no stray code shipped as part of the fix), and Phase 3 is now fully verified end-to-end
with zero console errors and no layout breakage across all tested breakpoints and entry points.

### Non-blocking Suggestions

- `App.tsx`/`AppRoutes.tsx`'s circular import (each imports from the other) works correctly today
  and was an explicit, skeptic-approved design.md decision, but a future cleanup could extract
  `AppShell` to its own file to remove the cycle structurally.
