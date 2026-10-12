# HEL-1457: Dashboard layout writes are last-write-wins and can drop concurrent placements

## Description

These two paths read the whole dashboard row, modify it, and write it back through `DashboardRepository.update`
(`:164-175`). Neither checks a version or an `updatedAt` precondition, and neither takes a row lock:

* `PATCH /api/dashboards/:id` (`DashboardService.update` :183, write body in `DashboardWrites.applyUpdate`/`writeUpdate`)
* AutoLayout (`AutoLayoutService.applyAutoLayout`)

That write sets name, appearance and layout together, so a concurrent rename or appearance change can be reverted.

* Only the owner repair uses compare-and-set (`updateLayoutIfUnchanged`, `:190`).
* Panel creation does lock (`PanelLayoutPlacement.scala:47`), but a PATCH from a stale tab ignores that lock.
* The frontend sends whole breakpoints (only the changed ones, HEL-1071), built from that tab's own panel list.

## Repro

1. Open the dashboard in tab A.
2. Have an agent (via MCP) create panels or run auto-layout.
3. In tab A, drag any panel. Then wait for the 30s autosave, or click Save now.
4. The agent's lg positions are lost, and the new panel's lg entry is dropped. It is re-appended at the bottom later,
   but only by the owner repair.

## Acceptance criteria

* Layout PATCH and AutoLayout carry a precondition (dashboard `lastUpdated` or a layout version) and return 409 on
  mismatch. On a 409, the client refetches and either reapplies or informs the user.
* Layout writes no longer rewrite name or appearance.
* Tests cover: a concurrent agent placement plus a stale-tab PATCH loses nothing, and a concurrent rename survives a
  layout save.

Priority: raise to High if simultaneous agent (MCP) and UI editing is a supported flow.

## Driver constraints (overnight run)

* Reproduce first with real concurrent transactions on embedded Postgres (`VerifiedEmbeddedPostgres.start`) as a
  non-superuser NOBYPASSRLS role; `[hel1468-guard]` must appear in sbt runs. Red first.
* Never edit V122/V123; take the next free migration number (V126 unless HEL-1511 claimed it) and re-check before
  committing. Do not widen the HEL-1485 lock order (panel rows first, then the dashboard).
* A client-contract change is a product call: take the recommendation if reversible, flag OWNER REVIEW in the PR body,
  and the auditor parks the PR unmerged (PARKED-FOR-OWNER).
