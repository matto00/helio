# HEL-1119: Dashboard appears twice in the list after create — intermittent e2e strict-mode failure blocking ci-complete

## Description

`e2e/focus-presence-guard.spec.ts:163` fails intermittently in CI with a Playwright strict-mode violation: after creating "HEL-520 Guard Dashboard" via the Add-dashboard dialog, `getByRole("button", { name: "HEL-520 Guard Dashboard", exact: true })` resolves to **2** elements, **both** `aria-pressed="true"`.

**Observed:** 4 of the last 60 `ci.yml` runs — `main` runs 34545297659, 34509386932, 34495732606, and PR #632 run 34564255396 (HEL-1074, backend-only diff). It fails `ci-complete`, so it blocks merges.

**Why this is probably a product bug, not test residue:** each e2e test registers a fresh user, so two same-named dashboards cannot come from leftover data. Two list entries that are *both* selected points to the same dashboard being inserted into the list twice — e.g. the create thunk's fulfilled reducer appending the new dashboard while a concurrent list refetch also includes it (no de-dupe by id). If so, real users can see a doubled dashboard after create on a slow network.

## Acceptance Criteria

* Root cause confirmed by a probe, not inferred: reproduce the double insert deterministically (e.g. delay the list response relative to the create response), and show that the reproduction goes red before the fix.
* Fix at the source (for example, de-dupe by id in the dashboards slice), not by loosening the test locator to `.first()`.
* A regression guard that fails when the fix is mutated out.

## Driver notes (not part of the ticket, carried forward for the executor/evaluator/skeptic)

- This is a **systematic-debugging** ticket: `.concertino/laws/systematic-debugging.md` binds — no fix without a probe-confirmed root cause. Do not guess.
- Preliminary orchestrator premise-validation (see `.concertino/runs/HEL-1119/evidence/premise-validation.md` in the main checkout) found:
  - `createDashboard.fulfilled` in `frontend/src/features/dashboards/state/dashboardsSlice.ts` does `state.items.push(action.payload)` — append, no de-dupe by id.
  - `fetchDashboards.fulfilled` does a full **replace** (`state.items = action.payload`), not a merge/append — so the ticket's exact racing-refetch narrative may not mechanically produce a duplicate the way described; it is a hypothesis to verify by probe, not a settled fact. Consider also: a genuine double-POST (two backend rows with different ids but the same name) from a double form submission.
  - `DashboardList` has exactly one mount point (`App` → `Sidebar` → `SidebarBody` → `DashboardList`) — ruled out double-rendering as an explanation; a real duplicate is most likely two entries in Redux `items` (or two backend rows).
  - `fetchDashboards` is dispatched exactly once, unconditionally, on `App.tsx` mount, guarded against re-dispatch while loading/succeeded.
- Do NOT loosen the e2e locator to `.first()`, and do not paper over with a wait.
- Check whether `panels`/`sources`/`pipelines` slices share the same append-plus-refetch shape; if they do, say so explicitly and either fix consistently or flag for a follow-up ticket (ask before widening scope materially).
- Check whether a duplicate is visible to a real user (e.g. create a dashboard on a throttled connection) or only under test timing; state this in the PR — it affects real severity.
- Check whether this is the same underlying defect as HEL-706 ("Duplicate buttons on step/dashboard/panel allow double-click double-clones") or genuinely distinct — say which, explicitly.
- No migration is expected for this ticket. If one turns out to be needed, V107 is next free — confirm with the driver before committing one.
