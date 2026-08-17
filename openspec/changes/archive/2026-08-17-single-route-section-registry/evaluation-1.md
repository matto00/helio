## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

Issues: none.

Verified against `ticket.md`/`proposal.md`/`design.md`/`tasks.md`:

- All three ACs addressed explicitly, not partially:
  1. "Exactly one source of truth maps route -> {label, icon, selection state}" — `sections.ts`
     (`SectionEntry`/`sections` array/`sectionForPathname`/`pickerIdForPathname`/`sectionLabel`) is
     the single registry; `usePickerSelection.ts` is the single live-selection implementation. Every
     consumer (`CommandBar.tsx`, `Sidebar.tsx` → `navDestinations.ts`, `MobileShell.tsx`,
     `SidebarBody.tsx`) now reads from these two files instead of maintaining its own copy —
     confirmed by diff read of all five files.
  2. "Adding a new route/section requires editing the registry only" — `navDestinations` is now
     `sections.filter(isNavSection).map(...)` (derived, not hand-listed); `SidebarBody`'s own
     `sectionFromPathname` export is deleted and replaced by the imported `pickerIdForPathname`;
     `App.tsx`'s old `breadcrumbLabel` function and both `mobileSection` switches are deleted.
  3. "`App.tsx` shrinks under CONTRIBUTING.md's ~250-line soft budget" — confirmed by direct line
     count: `App.tsx` is 251 lines (750 → 251), essentially at the documented budget. `CommandBar.tsx`
     (255 lines), `Sidebar.tsx` (58), `MobileShell.tsx` (36), `AppRoutes.tsx` (82) are the four
     extraction targets design.md called for.
- No AC silently reinterpreted. The one apparent reinterpretation — the ticket's literal `selection`
  field becoming a hook (`usePickerSelection`) rather than static registry data — was explicitly
  flagged and justified in `design.md` ("Why a registry can't own `selection` as static data"),
  confirmed live-approved by the design-gate skeptic (`skeptic-design-2.md`: `CONFIRM`), not a silent
  drift.
- All 15/15 `tasks.md` items verified against the diff, not just trusted from the checkmarks:
  1.1–1.3 (`sections.ts`, `navDestinations.ts` derivation, `usePickerSelection.ts`), 2.1–2.8
  (`SidebarBody.tsx`, `AppRoutes.tsx`, `useSaveStateRegistry()`, `CommandBar.tsx`, `Sidebar.tsx`,
  `MobileShell.tsx`, `AppShell` render swap, dead-code removal), 3.1–3.4 (test updates + all four
  gates green) all match what's actually in the diff.
- No scope creep: diff touches only `frontend/src/{app,shared/chrome,context}/**` plus the
  `openspec/changes/single-route-section-registry/**` planning artifacts. No unrelated files.
- No regressions to specs covered elsewhere: `mobile-bottom-nav`'s "single shared destination
  definition" requirement is satisfied (arguably strengthened) by the new derivation, not
  contradicted. `SidebarBody`'s per-section list-rendering bodies (CRUD, badges, delete warnings)
  are untouched per design.md's explicit non-goal — confirmed by diff (only the
  `sectionFromPathname` → `pickerIdForPathname` swap touches that file). The one intentional
  behavior change (`/settings`, `/proposals/review`, `/patch-sets/review` getting distinct labels
  instead of falling through to "Dashboards") is called out explicitly in `proposal.md`,
  `design.md`, and `files-modified.md`, and locked by a dedicated `sections.test.ts` test — not an
  undocumented side effect.
- No API/schema impact (frontend-only change) — `npm run check:schemas` confirms no drift.
- Planning artifacts (`files-modified.md`) accurately reflect the final implementation: stated line
  counts (251/255/58/36/82) match `wc -l` on the actual files.

### Phase 2: Code Review — PASS

Issues: none blocking.

**Gates re-run fresh in `WORKTREE_PATH`** (frontend-only diff; `EVALUATOR_CLEAN_WORKTREE=false`, so
no clean-worktree re-run required):
- `npm run lint` — clean, zero warnings.
- `npm run format:check` — clean.
- `npm test` — 2242/2242 frontend tests pass (plus 186/186 `helio-mcp` tests, unaffected by this
  change), 210 suites, 0 failures.
- `npm --prefix frontend run build` — succeeds (`vite build`, pre-existing >500kB chunk-size
  warning only, unrelated to this diff).

**Canonical standards check** (`CONTRIBUTING.md`, `DESIGN.md`):
- File-size soft budget (~250 lines/source, CONTRIBUTING.md:24): `App.tsx` (251) and
  `CommandBar.tsx` (255) are both essentially at, not over, the soft budget — nowhere near the
  ~400-line "propose a split" hard trigger. `files-modified.md` transparently states both counts;
  this matches the design.md-documented fallback expectation and isn't a violation.
- No inline FQNs / import-at-top violations (N/A pattern for TS, but no equivalent lint escape
  hatches found either).
- No `any`/untyped escape hatches: `grep` across the full diff for `: any`, `<any>`, `as any` —
  zero hits. `SectionEntry`'s discriminated union (`sections.ts:34-36`) is the type-safe mechanism
  design.md's "Two implementation clarifications" called for (`icon` required iff `showInNav: true`)
  — `isNavSection` type guard (`sections.ts:99-104`) lets `navDestinations.ts` derive `icon:
  LucideIcon` without a non-null assertion, confirmed by reading `navDestinations.ts`'s diff.
- DESIGN.md tokens/spacing: no CSS files changed in this diff at all (`git diff --stat -- '*.css'`
  is empty) — this is a pure structural move of existing JSX into new files. Cross-checked every
  `className` literal used in the four new files (`CommandBar.tsx`, `Sidebar.tsx`,
  `MobileShell.tsx`, `AppRoutes.tsx`) against `App.css` — all resolve to existing rules, none
  orphaned.
- DRY: `navDestinations.ts` and `SidebarBody.tsx` no longer hand-maintain independent route tables;
  both derive from `sections.ts`. `usePickerSelection` replaces what were four independent
  selection switches with one implementation.
- No dead code: old `breadcrumbLabel`, both `mobileSection` switches, and `SidebarBody`'s
  `sectionFromPathname` are all deleted (confirmed removed from the diff, not just superseded and
  left behind). No leftover TODO/FIXME in the new files.
- Error handling / security: no new user input surfaces or API boundaries introduced by this
  change — N/A.
- Tests meaningful: `sections.test.ts` locks the registry's own contract (all 9 routes, nav-visible
  subset, the three distinct "other" labels, `end: true` exact-match behavior). `App.test.tsx`'s 4
  new tests close a real coverage gap (`sources`/`registry` breadcrumb-fallback + phone-sheet
  selection-dispatch parity), mirroring pre-existing `/chat`/`/pipelines` coverage — these would
  catch a real regression if `usePickerSelection`'s switch and the phone sheet's dispatch ever
  drifted apart again, which is the exact bug class this ticket exists to prevent.
- No over-engineering: registry is plain data + three lookup functions; the hook is one switch
  keyed on `PickerId`. No premature abstraction beyond what design.md called for.
- Behavior-preserving where expected: confirmed the one deliberate behavior change (distinct
  "other" labels) is the only intentional change; `navDestinations.test.ts`/`SidebarBody.test.tsx`
  needed **no edits** because their black-box expected output (labels/paths/`end`/icons) is
  byte-identical under the new derivation — itself evidence the split didn't silently change
  output.

**Non-blocking suggestion**: `App.tsx` and `AppRoutes.tsx` have a circular import (`App.tsx` imports
`AppRoutes` from `./AppRoutes`; `AppRoutes.tsx` imports `AppShell` from `./App`). This works
correctly today (confirmed by clean lint/build/test — `AppShell` is only referenced inside JSX at
render time, not at module-evaluation time, so the cycle never actually deadlocks), and this
particular split boundary (routing tree needs the shell as a layout route; the shell owns the
top-level `<AppRoutes />` mount) was the explicit, skeptic-approved design.md decision, not an
executor oversight. Still worth a future cleanup: extracting `AppShell` to its own file (or moving
`App()`'s mount point) would remove the cycle entirely. Not a violation of any mechanical
CONTRIBUTING.md/DESIGN.md rule and not blocking.

**Pre-commit bypass confirmed as reported.** Re-ran all five hook checks fresh in `WORKTREE_PATH`:
`npm run check:openspec` is the **only** one that fails, with exactly the reason the executor
stated:
```
- change "single-route-section-registry" is complete (15/15) but not archived — run `openspec archive single-route-section-registry`
```
`npm run check:schemas` and `npm run check:scala-quality` both pass clean (the latter emits 122
pre-existing informational file-size warnings, all in `backend/src/test/**`, none touched by this
diff, and CONTRIBUTING.md states these warnings are informational-only, not gating). `npm run lint`,
`npm run format:check`, and `npm test` were already independently re-verified above. Archiving is a
Phase-3 orchestrator step per the ticket-delivery workflow, not a cycle-1 executor step, so this
`git commit -n` bypass is expected at this point and not a corners-cut shortcut — confirmed, no other
gate was skipped.

### Phase 3: UI Review — BLOCKER

Triggers matched (`frontend/**` changed) — Phase 3 is mandatory.

`scripts/concertino/start-servers.sh "$WORKTREE_PATH" 6156 9063 HEL-724` printed:
```
FAIL backend did not become healthy at http://localhost:9063/health within 300s (log: .../.concertino-backend.log)
```
Backend log root cause (`.concertino-backend.log`):
```
org.flywaydb.core.api.exception.FlywayValidateException: Validate failed: Migrations have failed validation
Detected resolved migration not applied to database: 89.
To ignore this migration, set -ignoreMigrationPatterns='*:ignored'. To allow executing this migration, set -outOfOrder=true.
```
Confirmed independently via `psql` against the shared dev Postgres instance: `flyway_schema_history`
has V88 and V90 recorded as applied, but **no row for V89** (`V89__totp_mfa.sql`, present on disk in
this worktree) — a "V89 hole" in the shared dev database's migration history. This is the same class
of issue as the previously-diagnosed shared-dev-DB Flyway collision hazard (all worktrees share one
Postgres instance; recent main-branch history includes HEL-715's temporary `outOfOrder` toggle to
reconcile prod's own V89 hole). This diff is **frontend-only** — `git diff --stat main...HEAD`
contains zero `backend/**` files, so this failure cannot originate from this ticket's code. No
orphaned backend/frontend process was left behind (`ss -ltnp` confirms nothing listening on 6156/9063
after the script exited).

Tagging **BLOCKER**, not a code Change Request, per this role's guardrails — this is a shared dev
database state issue requiring human intervention (repair `flyway_schema_history` for the shared dev
DB, or run once with `-outOfOrder=true` against it), not something fixable in this ticket's code. No
UI checks (happy path, breakpoints, console errors, accessible names, etc.) could be exercised
because the backend never became healthy.

### Overall: BLOCKER

Phase 1 and Phase 2 both independently PASS on fresh evidence. Phase 3 could not be completed due to
an environmental failure unrelated to this ticket's diff — the shared dev Postgres database's
`flyway_schema_history` is missing a row for V89, causing every backend boot against it to fail
Flyway validation regardless of which worktree/branch is running. **Required: human intervention** to
repair the shared dev database (e.g. insert the missing V89 `flyway_schema_history` row as applied,
matching how prod's identical V89 hole was reconciled per HEL-715, or run the backend once with
`-outOfOrder=true` against the shared dev DB) before Phase 3 can be attempted. No code changes are
requested from the executor at this time — Phases 1 and 2 are clean.
