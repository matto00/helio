## Context

`dashboards.layout` (JSONB `{lg,md,sm,xs}`, each an array of `{panelId,x,y,w,h}`) is written on create by
`PanelLayoutPlacement.insertAndAppend` (locks the dashboard row `FOR UPDATE`, then inserts the panel, then appends) and
on PATCH by `DashboardService.update` (last-write-wins, HEL-1457). Nothing removes a panel's items when the panel row
goes. Panel rows are removed by:
- `PanelRepository.delete` (via `PanelLifecycleWrites.deleteRow`) — REST `DELETE /api/panels/:id`, MCP `delete_panel`
  (calls REST), patch-set apply forward (`PatchSetApplyForward`), rollback of a create (`PatchSetApplyRollback`),
  undo of a create (`PatchSetUndoService`);
- `PanelRepository.deleteByOutputIdInternal` — `OutputService` Output delete;
- `DashboardContentsOps.replaceContents` (PUT contents) — deletes every panel of a dashboard, then writes its own final
  layout (skeptic CR4);
- FK cascade `panels.output_id REFERENCES outputs ON DELETE CASCADE` (V94), reached from pipeline-step, pipeline,
  pipeline-root and data-source deletes (`outputs.node_step_id/pipeline_id/root_id` cascades) with no app code;
- FK cascade `panels.dashboard_id` on dashboard delete / workspace teardown (layout goes with the row — harmless).
`dashboards` is ENABLE + FORCE RLS (V36); the migration role (prod `helio`) is not BYPASSRLS. The client already
ignores ghosts when rendering (`liveEntries` in `dashboardLayout.ts`) but `buildLayoutPatch` sends authored breakpoints
as-is, layout undo history can hold pre-delete layouts, and `LayoutPolicy` stores any `panelId` it is sent.

## Goals / Non-Goals

**Goals:** no path that removes a panel row leaves its items in any breakpoint; existing ghosts are stripped once;
the client cannot write a ghost back.
**Non-Goals:** HEL-1457 (PATCH LWW); repointing a patch-set-recreated panel; frontend changes; patch-set changes beyond D7
(HEL-1482 lane).

## Decisions

**D1 — One DB trigger is the mechanism, not per-caller code.** `V122`: a statement-level
`AFTER DELETE ON panels REFERENCING OLD TABLE AS deleted_panels FOR EACH STATEMENT` trigger. For each distinct
`dashboard_id` in `deleted_panels`, in `ORDER BY id`, it locks the dashboard row (`SELECT ... FOR UPDATE`) and rewrites
each breakpoint array without the items whose `panelId` is in that dashboard's deleted set, preserving element order
(`jsonb_array_elements ... WITH ORDINALITY`) and leaving non-array/missing keys as they are. Rows with nothing to strip
are not updated. `last_updated` is NOT bumped: the strip changes nothing a user sees (ghosts never render) and it would
reorder dashboard lists on unrelated cascades (e.g. a pipeline delete).
Alternative rejected: app-level strip in `PanelRepository` only. It cannot reach the FK-cascade paths without
enumerating every pipeline/step/root/source delete (and every future one); a trigger fires for all of them, inside the
same transaction, by construction. Statement-level (not row-level) so a bulk delete locks each dashboard once, in a
deterministic order.

**D2 — RLS: re-own to `helio_privileged`, V40/V100 bracket.** The function is `SECURITY DEFINER`,
`SET search_path = pg_catalog, public`, `SET row_security = off`, created then re-owned to `helio_privileged` with the
exact transient `GRANT CREATE`/`ALTER FUNCTION ... OWNER TO`/`REVOKE CREATE` bracket V100 uses, plus explicit
idempotent `GRANT SELECT, UPDATE ON dashboards TO helio_privileged`. Without it, a cascade run on the app pool under a
user context that cannot `dashboards_update` the affected dashboard (e.g. a shared-pipeline owner deleting a pipeline
bound on someone else's dashboard) would silently update 0 rows. `row_security = off` turns a lost re-own into a loud
42501 instead of a silent no-op (V100's tripwire rationale).

**D3 — No app-level pre-lock; the trigger's lock is the "same locking as `PanelLayoutPlacement`".** The trigger takes
the dashboard row lock (`FOR UPDATE`, in id order) inside the delete's transaction, the same row lock create takes.
Creates never wait on existing panel rows, so delete (panel rows -> dashboard) vs create (dashboard -> new panel row)
has no lock-order inversion. A first draft pre-locked the dashboard in `PanelRepository.delete`/
`deleteByOutputIdInternal`; the design-gate skeptic reproduced a deadlock between that pre-locked path and the
trigger-only paths (FK cascades, `replaceContents`), which lock panel rows first (skeptic-design-1.md CR1). Every delete
path therefore uses ONE order: panel rows, then dashboards by id. `PanelRepository` is unchanged.

**D4 — One-off repair of stored ghosts: `V123` (owner ruling `approve-v123`, 2026-10-11).** Strips, per dashboard,
every item whose `panelId` is not a panel with that `dashboard_id`, reusing D1's array rewrite (incl. the `[]` coalesce).
It runs ONLY through a `helio_privileged`-owned `SECURITY DEFINER` helper with `SET row_security = off` and pinned
search_path (same bracket as D2), created, called and dropped inside the migration — never the V114 per-owner
`set_config` pattern, whose RLS-filtered panel read could see zero panels and wipe every item (skeptic-design-2 CR2).
`last_updated` is NOT touched (same reason as D1). Idempotent; a second run changes nothing. Kept separate from V122.
Prod counts were NOT measured (owner did not run the query); the V123 header and the PR body say so and carry the
read-only count query (`.concertino/runs/HEL-1456/evidence/prod-ghost-count-query.md`) for the owner to run.

**D5 — Server filter on every dashboard layout update (owner ruling `server-filter`, 2026-10-11).** In
`DashboardWrites.applyUpdate` (the single merge point of `DashboardService.update`), before the layout policy runs,
BOTH the stored layout it read (`existing.layout`, all four breakpoints) AND each supplied breakpoint of the patch are
filtered to items whose `panelId` is a panel of that dashboard, via `DashboardRepository.panelIdsInternal` (unpaged,
privileged pool — not the 500-capped `findAllByDashboardId`). Filtering the stored side too means the full-layout write
(`DashboardRepository.scala:164-175` writes all four breakpoints) cannot carry back a ghost in a breakpoint the client
did not send (skeptic-design-3 CR1), and removes the stored-bad + ghost edge without depending on V123. Applies to BOTH `LayoutWritePolicy.Validate` (PATCH
`/api/dashboards/:id`, any client: web, MCP, stale tabs) and `RestorePriorStored` (patch-set undo/rollback restoring a
pre-delete layout) — that second path is how a prior stored layout can resurrect a ghost, and is now covered. The filter
keeps stored order and removes nothing else (no dedupe — out of scope). A filtered breakpoint equal to stored passes
through as identical (`sameItems`); a subset of a valid breakpoint stays valid, so no new 400 is possible for a
previously-valid write. Edge: a stored-bad breakpoint that still holds ghosts and is sent back unchanged would, after
filtering, differ from stored and be validated — no longer possible, since the stored side is filtered identically.
A layout naming an id not on the dashboard is now silently dropped instead of stored (stated in the spec). The web client is unchanged: the design-gate rounds showed client-side stripping cannot reach every path (undo/redo,
stale baselines, `idle` panels after a delete); the server filter makes the client's ghost harmless — the PATCH response
is ghost-free and the client adopts it. Rejected alternative: `client-deleted-ids` (owner chose server-filter).

**D7 — Patch-set undo conflict check ignores ghost items (minimal patch-set edit).** V122 strips a deleted panel from
its dashboard's layout. `PatchSetUndoConflictCheck.checkDashboard` (line ~123) compares the live layout to the journaled
one exactly, so a patch set [update D, delete P on D] — or any later delete of a panel on D — would make undo report D
as "changed" and refuse, which succeeds today (skeptic-design-3 CR2). Fix: compare the two layouts after restricting
both to the dashboard's current panel ids (`panelIdsInternal`), i.e. ghost-insensitive; name/appearance and live
items still compare exactly. This is the only patch-set file touched, a few lines; the driver brief permits minimal
patch-set changes with a re-sync against HEL-1482 before the PR. Alternative (accept the regression + follow-up)
rejected: it would break undo of a common refinement shape.

**D6 — Interaction with HEL-1457.** D1/D3 add a dashboard-row lock to deletes, which only serializes deletes with
creates/other deletes (previously unordered). A layout PATCH (`DashboardService.update`) still takes no lock, so the
LWW window is unchanged, not widened: a PATCH computed before a delete and written after it can still carry the ghost
back — exactly the HEL-1457 class. Correction (skeptic note): `DashboardWrites` merges a patch into an unlocked earlier
read and writes the FULL layout, so a stale PATCH can restore a ghost even into breakpoints the client did not send.
With D5 the merged layout is filtered to live panels before the write, so a stale PATCH can no longer restore a ghost;
the remaining window is a panel deleted between D5's (unlocked) panel read and the write — narrower than today, not
wider. D5 takes no new lock, so PATCH vs PATCH LWW (HEL-1457) is unchanged.

## Risks / Trade-offs

- **Cascade deadlock window (pre-existing class).** A cascade delete (no D3 pre-lock) locks panels then the dashboard; a concurrent
  `duplicate` of a panel bound to the Output being deleted locks the dashboard then waits on the Output's FK KEY SHARE.
  Postgres detects it and aborts one; today the duplicate already fails (FK) in that race. Accepted; no corruption.
- Empty result: deleting a dashboard's only panel must leave `[]`, not JSON null (`jsonb_agg` over zero rows is NULL —
  `COALESCE(..., '[]'::jsonb)`).
- V123: if its read of live panels were ever RLS-filtered to empty it would wipe every item; the repair must read
  panels with RLS off (helio_privileged) and be tested on a dashboard with several live panels.
- Shared dev DB: once V122 boots against it, it fires for every lane's deletes. Never edit V122 after first boot.
- Trigger cost: one dashboard UPDATE per affected dashboard per delete statement; negligible.
- RLS is bypassed in dev/CI (superuser). The D2/D4 proofs must run as a non-superuser, non-BYPASSRLS role, else they
  prove nothing (MISTAKES.md / v0.7.x incident).
- Flyway: never edit V122/V123 once applied.

## Planner Notes

- Self-approved: trigger over app-level (D1); no `last_updated` bump (D1/D4); no pre-lock (D3, skeptic CR1); D7
  ghost-insensitive undo conflict check (within the driver's 'minimal patch-set change' allowance).
- Auto-layout bypasses `DashboardWrites` and has the same unlocked stale-read window as a PATCH (HEL-1457 class);
  recorded, not changed.
- Owner rulings 2026-10-11 (escalation.answered, chat): Q1 `approve-v123` (D4), Q2 `server-filter` (D5). The earlier
  client-side D5 (history strip + PATCH filter) is withdrawn.
- Premise: ticket line numbers are pre-split; repro step 3's `GET /api/dashboards/:id` does not exist (use the list or
  `/export`). Cascade paths are added scope within the ticket's intent.

## Implementation Notes (executor)

- **1.7 recorded.** Panel duplicate and batch create go through `PanelLayoutPlacement.insertAndAppend`, which appends only the new
  panel's own item; dashboard `replaceContents` / apply-proposal build their layout from the panels they just created
  (`ProposalLayoutSupport.buildLayout`); import regenerates panel ids and layout from the snapshot; the HEL-1233 repair filters
  against `panelIdsInternal`. None can store an id that is not a panel of the dashboard. Auto-layout still bypasses
  `DashboardWrites` and reads panels/layout unlocked (HEL-1457 class, unchanged).
- **Rename-only PATCH.** `DashboardWrites.writeUpdate` writes only the name when neither appearance nor layout is supplied, so a
  rename-only update neither stores nor strips a ghost; the response still carries whatever the row holds. V122/V123 make a stored
  ghost unreachable, so this branch needs no filter. A rename combined with an appearance or layout change writes the full layout
  and IS filtered (`renamed.layout`).
- **Existing specs changed because the contract changed.** `DashboardLayoutValidationSpec`, `ApiRoutesSpec` ("update dashboard
  layout") and `DashboardServiceLayoutPolicySpec` wrote layouts for panel ids that never existed on the dashboard (`p1`, `panel-a`);
  D5 now drops such items, so those fixtures name real panel rows (`seedPanelWithId`, a created panel, a stubbed
  `panelIdsInternal`). Assertions are unchanged.
- **Test classification.** RED-then-green: V122 trigger cases, V123 repair cases, create-no-gap, auto-layout-no-offset, Output/pipeline/step
  cascades, D5 ghost-write cases, seam, D7 undo cases, rollback and undo ghost cases. Guards (green on unfixed code, labelled in
  their names or here): `replaceContents` (writes its own final layout), dashboard delete, "genuinely overlapping live write still
  400s", "write over a ghost's cells is accepted" (validation only ever looked at supplied items), and "still refuses when a live item
  moved". Mutations run: V122+V123 without the re-own and without `row_security = off` (silent wipe / no-op, RLS cases red);
  D5 filtering only the supplied breakpoints (unsent-breakpoint, editor-panel, appearance cases red); (cycle 2) a panel lookup scoped to the dashboard owner's own panels instead of every panel on the dashboard (the "panel created by another user" case red, 2 failures; log `cycle2-mutation-3-user-scoped-panel-lookup.log`).

