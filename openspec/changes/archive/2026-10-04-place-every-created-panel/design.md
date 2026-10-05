## Context

Live repro (worktree backend :9599) against the stored `dashboards.layout`:
- `POST /api/panels` for text, markdown, image and divider leaves the layout empty.
- Every `POST /api/panels/batch` item, Output included, gets no item.
- Only a single Output create places, via `PanelService.placeDefaultLayout`. That path writes through
  `dashboardRepo.update`, which runs as the dashboard OWNER, rewrites name/appearance from a stale read, and takes no
  lock.

Code reading adds:
- `panelRepo.duplicate` writes no item; spec `panel-duplication` codified that.
- `ProposalLayoutSupport.buildLayout` omits panels with no authored `lg`. This is used by proposal apply (also first-run
  and persona templates) and by contents replace.

Orphans render through `resolveDashboardLayout`. A later stored create lands at the bottom of the STORED items and
pushes them down. A drag rewrites only the breakpoint being edited. The owner ruling `extend-owner-repair` decides
existing orphans; it is recorded as C1.

## Goals / Non-Goals

Goals:
- Every panel-create path stores a valid item per breakpoint, atomically with the panel insert.
- Concurrent CREATES never lose a placement.
- The client adopts the stored item (HEL-1230 class 3).
- Existing orphans are repaired by the owner's once-on-open repair, append-only.

Not claimed: a layout PATCH or contents replace racing a create can still overwrite a fresh item. Both replace whole
breakpoints from the caller's own view, which lacks the item, so a row lock would not help. A later owner open repairs
it.

Non-goals: a DB backfill or migration (V115 is reserved for HEL-1271); render-resolution changes; auto-layout changes.

## Decisions

**D1. One pure server placer** (e.g. `CreatePlacement` in `services/panels`). Given the current layout and an ordered
list of `(panelId, size per breakpoint)`, it appends one item per panel to each breakpoint:
- `x = 0`;
- `y` = that breakpoint's current bottom, counting items placed earlier in the same call.

Starting below every item means a placed item never overlaps anything. A valid breakpoint stays valid, and a
stored-bad one only gains a non-overlapping item (HEL-1071 "bottom of each breakpoint's own items").

Sizes:
- Output: `OutputPanelDefaultSize.forKind`, scaled per breakpoint exactly as today
  (`w = clamp(round(lgW*cols/12), 1, cols)`, same h). Byte-identical to today.
- Content and form kinds, and an Output whose output cannot be resolved (placement is never skipped): the client's
  render default PER BREAKPOINT, `w = defaultItemWidth(cols)` = lg 4, md 4, sm 3, xs 2, and `h = 5`
  (`dashboardLayout.ts`). A new content panel therefore has the size it already rendered at, at every breakpoint; xs
  stays full width on the 2-column phone grid.
- Duplicate size per breakpoint, in order: (1) the source's stored item size at that breakpoint (w clamped to cols); else (2) the source's lg item scaled to that breakpoint (w = clamp(round(lgW*cols/12), 1, cols), same h); else (3) the D1 default size for the source's kind at that breakpoint (source orphaned everywhere).

**D2. Atomic write, explicit DB context.** `DbContext` has two pools and a transaction cannot span them, so each path
keeps its CURRENT context and adds the layout write to that same transaction. The write is always
`SELECT layout FROM dashboards WHERE id = ? FOR UPDATE`, append via D1, then `UPDATE dashboards SET layout = ?,
last_updated = now() WHERE id = ?`. It updates layout and last_updated only, never name or appearance. Concurrent creates
serialize, and a failed layout write rolls back the panel.
- Single create: today `PanelRepository.insert` runs `withUserContext(caller)`, so the `panels_insert` WITH CHECK is a
  live defence. Keep it. Panel insert + lock + layout UPDATE run in ONE `withUserContext(caller)` transaction. Under
  RLS this needs `dashboards_select` + `dashboards_update` (V36: owner OR editor grantee) to admit the caller. Viewers
  never reach it (service 403).
- Batch create and panel duplicate: they already run `withSystemContext` after the service ACL check. Keep that. Add
  the lock + layout UPDATE inside the same system transaction and extend the existing bypass comment. No RLS posture
  change.
- Contents replace already writes panels + layout in one system transaction. Only D3's `buildLayout` change applies.

RLS proof: a new non-superuser/NOBYPASSRLS harness for dashboards/panels, modelled on
`testsupport/ProductTelemetryDbHarness` (embedded Postgres, full Flyway chain as a non-superuser table owner, app pool
under FORCE RLS, privileged pool `SET ROLE helio_privileged`). It drives the real repository code and asserts:
- an owner's create and an editor grantee's create each store the panel AND its four layout items;
- a non-grantee's transaction writes nothing.

Do not widen any policy. The standard route harness connects as a superuser and cannot show this.

**D3. Every panel-create path routes through D1/D2.**
- `create`: all kinds.
- `batchCreate`: placed in request order.
- `duplicate`.
- Proposal and contents replace: `ProposalLayoutSupport.buildLayout` appends every unauthored panel below the
  authored lg, in proposal order, at its D1 lg size, then reflows md/sm/xs from the full lg as today. The result is
  valid by construction.
- `DashboardProposalService.apply` creates panels one by one, and each now places. The layout PATCH that follows then
  replaces all four breakpoints with `buildLayout`'s complete layout, so the final stored layout is exactly that, with
  no orphan. Its `lg.isEmpty` skip can no longer drop a panel.
- Patch-set undo and rollback re-creates go through `create`. Rollback still restores the full prior layout
  afterwards.
- Dashboard duplicate and import (`DashboardSnapshotRepository.duplicate` / `importSnapshot`) are COPY paths. Their
  specs require faithful copies, and import must store valid breakpoints exactly as supplied. An orphan they carry is
  a pre-existing orphan, which C1 assigns to the owner repair. The caller is always the new dashboard's owner, so the
  repair fires on first open. They are unchanged. A route test pins it: duplicate and import an orphan-bearing
  dashboard, then call the repair endpoint with the orphan appended; it stores 200 and every prior item is unchanged.

**D4. Wire.** `PanelResponse.layouts` (an existing optional field) is filled for single create of every kind, each
batch item, and duplicate. Update `schemas/panels/panel.schema.json` (`layouts` is described as output-only today), and
`helio-mcp/src/types.ts` only if it models these responses. Client:
- One shared helper adopts `layouts` (append to each breakpoint), used by the `createPanel` and `duplicatePanel` thunks.
- No frontend caller uses batch.

**D5. Owner repair widened (C1).**
- Client (`repairPatch.ts`): `hasRepairableBreakpoint(panels, layout)` is stored-bad OR incomplete (valid, but some
  live panel id has no item; an empty breakpoint with live panels counts). `buildRepairPatch` sends `resolved[bp]` for
  each repairable breakpoint. `resolveDashboardLayout` keeps a valid breakpoint's live entries verbatim (`anchorsFor`
  is identity when valid; orphans are placed without moving an anchor), so the patch is append-only by construction,
  minus entries for deleted panels.
- `useStoredLayoutRepair` keeps its owner check, its panels-loaded check and its once-per-mount guard.
- Server (`DashboardLayoutRepair.plan`): act on a supplied breakpoint when the stored one is stored-bad OR incomplete
  against the live panel ids.
  - Precedence: stored-bad wins. A breakpoint that is both stored-bad and missing a panel gets only today's stored-bad
    checks; fixing an overlap must move items, so append-only cannot apply.
  - An incomplete-only breakpoint additionally needs append-only: each live panel id in the stored breakpoint must
    appear with an item equal to its FIRST stored entry; otherwise `400` naming the breakpoint. Entries for deleted
    panels may be dropped.
  - `409`/`updateLayoutIfUnchanged` are unchanged.
- Classification (`useLayoutSave.ts`). The repair reducer adopts a response only while the store still equals
  `expectedLayout`, so a response arriving during a pending local edit is never adopted. When adopted:
  - An append-only response for a panel orphaned in EVERY breakpoint satisfies `detectPlacementExtension` (class 3).
    Every other repair response is class 4.
  - Both outcomes are identical. Class 3 extends a baseline equal to the old store layout by exactly the appended
    items, which yields the new layout. Pending stays false, no history entry is added (history comes only from
    drag/resize/undo), and the baseline becomes the repaired layout.
  - Rewrite the header's class 4 paragraph, which claims a repair can never be a prefix extension, to say this. Also
    widen class 3's wording to "create or duplicate".
  - Unit tests pin both shapes, plus the pending-local-edit case (local kept, still pending, response not adopted).

**D6. Red first.** Before any production edit, tests must FAIL on main:
- route specs for every create kind, batch, and duplicate;
- inverting `PanelServiceDefaultLayoutSpec` "return None for a non-Output panel and never write the dashboard layout"
  (it encodes the bug; changing it is expected, and the PR says so);
- the proposal with an unauthored panel;
- the client incomplete-repair test;
- the repair route append case.

Record the failing runs in `red-evidence.md`. New route specs extend `com.helio.testkit.HelioRouteTest`.

**D7. Seam (HEL-1071, C2).** One shared fixture covers the layouts after creates of every kind, a batch, a duplicate,
a proposal with an unauthored panel, and a create made while the client holds a pending local drag:
- Server: each stored breakpoint is re-sent through the real layout-PATCH validator and returns 200.
- Client: `isLayoutValid`/`buildLayoutPatch` agree.
- The HEL-1233 repair seam fixture gains an incomplete case. The client output must equal the fixture, and the server
  stores it with 200.

## Risks / Trade-offs

- **`e2e/hel1023` A_lg_only/B_partial** are valid partial layouts on a test-owned dashboard. The widened repair now
  fires on open, so add `stubOwnerRepair` for them to keep asserting render-time derivation. Confirm the seeding still
  yields lg-only/partial now that creates place all four breakpoints, re-PATCHing to the state if needed.
- **Existing tests** asserting no layout after a non-Output create or duplicate will go red. Update each one
  deliberately. Grep backend, `frontend/src`, `e2e/` and `frontend/e2e`.
- **Visible position.** A new content panel now lands bottom-left instead of in the first free gap. The HEL-1071 spec
  already mandates bottom placement for server-placed creates.
- **Write on view** widens to owner-opened incomplete dashboards. It is bounded by owner-only, once-per-mount and
  append-only.

## Planner Notes

- Self-approved: the content default per breakpoint (4/4/3/2 x 5) mirrors the existing client render default.
- Self-approved: duplicate keeps the source size.
- Self-approved: an empty breakpoint with live panels counts as incomplete (the ruling's literal text).
- Self-approved: append-only compares against the first stored entry per id, matching `liveEntries`.
- Self-approved: dashboard duplicate/import stay faithful copies; C1 repairs their orphans.
- Untouched: `ApiRoutes.scala`, `Main.scala`, `PipelineRunService`, `NodeSnapshotRepository`, analyze.
  `PanelRoutes.scala` is in scope.
