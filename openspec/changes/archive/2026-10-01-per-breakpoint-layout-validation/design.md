## Context

`dashboards.layout` stores four independent arrays (`lg` 12 cols, `md` 10, `sm` 6, `xs` 2). `PanelGrid` uses `noCompactor` + `preventCollision`, so a saved overlap is permanent on screen. HEL-1023 (merged 8022ff73) repairs bad layouts at render and added pure geometry in `frontend/src/features/dashboards/state/breakpointLayout.ts` (`rectsOverlap`, `findOverlaps`, `isItemInBounds`, `isLayoutValid`). The server today stores any geometry (`DashboardServiceValidation.validateDashboardLayoutItems` only trims panelId).

## Verified facts that shape the design

- **The frontend layout PATCH sends all four breakpoints** (`useLayoutSave.persistLayout` -> `updateDashboardLayout({dashboardId, layout: nextLayout})`; `DesktopPanelGrid.handleLayoutChange` builds `{...layout, [bp]: items}` from the AUTHORED layout), including untouched stored-bad ones. HEL-1023's "persists only the active breakpoint" holds at the equality level (an unchanged view writes nothing), not on the wire. So "validate only breakpoints present" would lock users out; hence the identity rule below.
- User drags cannot create new overlaps (`preventCollision: true`) and edits start from the repaired (resolved) layout, so a user edit of the active breakpoint is valid and, when applied to a stored-bad breakpoint, repairs it.
- helio-mcp `dist/` is gitignored (nothing to rebuild); its tests are `helio-mcp/src/**/*.test.ts` under the root jest config.
- Overlap producers on the server today: `LayoutBreakpointScaling.scaleItemsToBreakpoint`/`scaleWidthAndX` (collapses 12-col x/w into 2 cols at the same y) used by `DashboardProposalService.applyLayout`, `DashboardContentsService.remapLayout`, `AutoLayoutService`, `PanelService.placeDefaultLayout`; `PanelPacker.clamp` (`max(minW, min(cols, w))` yields `w=4` at 2 cols); `AutoLayoutService` appends packed items to kept lg items with no collision avoidance; `placeDefaultLayout` uses lg's bottom y in every breakpoint; `DashboardProposalService.applyLayout` swallows a layout failure.

## Decisions

### D1 Validator (`LayoutValidator`, pure, Scala)
`violations(items, cols): Vector[Violation]` where `Violation = Overlap(a,b) | OutOfBounds(panelId, reason)`; semantics exactly the frontend contract (x>=0,y>=0,w>=1,h>=1,x+w<=cols; overlap predicate strict inequalities, touching edges fine). `breakpointCols` stays the single Scala source (`LayoutBreakpointScaling.breakpointCols`), asserted in tests equal to the fixture and to the frontend `dashboardGridCols`. Pair order = input order (`[earlier, later]`), like `findOverlaps`.

### D2 Identity ("identical to stored")
Two breakpoint arrays are identical iff they are equal as MULTISETS of `(panelId, x, y, w, h)` (order-insensitive; duplicates counted). The comparison is made on the NORMALIZED payload (after `validateDashboardLayoutItems` trims `panelId`) against the stored layout, so whitespace alone is never a spurious change. Order-insensitive because array order carries no meaning (mobile stack orders by y,x) and a client that re-sends reordered data must not be penalised. An identical breakpoint is neither validated nor rewritten (stored order kept). Tested with: reordered-identical passes; one coordinate differs -> validated; extra/missing item -> validated.

### D3 Write policy (`DashboardService.update`, the single choke point for both REST routes — `PATCH /api/dashboards/:id` and the batch `PATCH /api/dashboards/:id/update` with `UpdateDashboardBatchRequest{fields,dashboard}`, which is the one the frontend actually uses — plus the MCP update tool, proposal `applyLayout`, patch-set edits)
Request payload becomes `{lg?, md?, sm?, xs?}`, at least one present (empty object -> 400 like today's empty request). Per breakpoint: absent -> keep stored; present & identical -> keep stored; present & differs -> validate. Any violation anywhere -> `ServiceError.BadRequest("Layout rejected: breakpoint 'xs': panels 'a' and 'b' overlap; panel 'c' is out of bounds (x=1,w=2 > 2 columns)")`, deterministic, capped at 10 violations ("and N more"), nothing written (validation precedes `applyUpdate`). This satisfies BOTH the owner reject ruling (no write can introduce an invalid breakpoint) and "existing dashboards stay editable". Accepted residue (owner-approved Q2): a stored-bad breakpoint remains stored-bad until someone supplies a different, valid version of it; render-time repair (HEL-1023) covers display.

### D4 System-computed layouts: valid by construction, not by rejection
A new pure `LayoutReflow.reflow(items(panelId,w,h), sourceCols, targetCols)`: scale w proportionally clamped to `[1,targetCols]`, shelf-flow left-to-right in the input order (items sorted by lg reading order y,x), wrap at `targetCols`, y = previous shelf y + max h. Used for md/sm/xs in proposal apply, contents replace. `PanelPacker.clamp` becomes `min(cols, max(minW, w))` so no item exceeds `cols`. `placeDefaultLayout` computes each breakpoint's y from THAT breakpoint's own bottom (`max(y+h)`), so a new item can never overlap existing ones in any breakpoint and needs no whole-breakpoint validation (so a stored-bad breakpoint never blocks creating a panel). These are tested with property tests (random sizes: zero violations by the validator) and still pass through the validator where they go via `DashboardService.update`.

### D5 Auto-layout
Request adds optional `breakpoint`. Omitted: lg packed at `cols` (default 12; `cols>12` or `<1` -> 400 via validator/guard); md/sm/xs packed independently at their own cols from the same sizes with `w` scaled from `cols`. Given: only that breakpoint (w in its units; `cols` must equal its count else 400). Kept (omitted) panels keep their stored per-breakpoint position and packed items start below the kept items' bottom (fixes the old no-collision-avoidance). Result validated against stored per D3 (kept stored-bad -> 400 naming breakpoint; the fix for the caller is to include those panels).

### D6 Proposal / contents paths
`DashboardProposalService.applyLayout` and `DashboardContentsService` pre-validate the proposal's lg items (bounds at 12, no overlap) BEFORE creating anything: `400` naming `lg` and the proposal panels (by index/title, ids don't exist yet), nothing created. md/sm/xs derived with `LayoutReflow`. `applyLayout` stops swallowing layout failure silently (a failure after panels exist is surfaced, not "best-effort").

### D7 Exempt paths (documented)
Patch-set rollback/undo (`PatchSetApplyRollback`, `PatchSetUndoInverse`) restore a previously stored value and go through `DashboardService.update` with an internal `LayoutWritePolicy.RestorePriorStored` (not reachable from any route/body); duplicate copies stored layout (remap ids only). Dashboard import validates every supplied breakpoint (stored = none) and 400s naming breakpoint and snapshot panel ids; a dashboard exported while holding a bad breakpoint therefore cannot be imported until fixed (accepted, called out in the PR).

### D8 Write-path enumeration (first pass; executor MUST re-derive by `grep -rn "layout" backend/src/main/scala` + every `dashboardRepo.update/insert/replaceContents`, record the final table in `execution-progress.md`)
| Path | Handling |
|---|---|
| `PATCH /api/dashboards/:id` -> `DashboardService.update` (also MCP `update_dashboard_layout`, patch-set dashboard edits) | D3 |
| `POST /api/dashboards/:id/auto-layout` (`AutoLayoutService`, MCP `auto_layout_dashboard`) | D5 + D3 policy |
| `PanelService.placeDefaultLayout` (panel create, `place_outputs`, batch) | D4 per-bp bottom |
| `DashboardProposalService.applyLayout` (apply proposal) | D6 |
| `DashboardContentsService.replaceContents` (`remapLayout`) | D6 |
| `DashboardSnapshotRepository` import | D7 validate |
| `DashboardSnapshotRepository.duplicate` | D7 faithful copy |
| `PatchSetApplyRollback` / `PatchSetUndoInverse` | D7 RestorePriorStored |
| first-run / persona templates (`FirstRunDashboardService`, `PersonaTemplates`, `FirstRunPlanner`) | audit; test asserts output passes the validator; fix if not |
| Assistant/authoring proposals (`AssistantProposalToolSchemas`, `DashboardAuthoringPrompt`) | feed D6 |

### D9 Parity fixture
One JSON file at a path not scanned by the schema-drift script (executor verifies; e.g. `shared-test-fixtures/layout-validity.json`) with `{cols:{lg:12,md:10,sm:6,xs:2}, cases:[{name, breakpoint, items, valid, violations:[{kind, panelIds}]}]}`, including touching edges, same cell, partial overlap, containment, x+w=cols+1, x<0, y<0, w=0, h=0, the roadmap xs case, and per-breakpoint boundary cases. Frontend jest and backend ScalaTest both load it (backend cwd `backend/` -> `../shared-test-fixtures/...`). A fixture-schema self-check fails if a case's `cols` disagree with either side's constants. Mutation check (executor demonstrates): flipping `<` to `<=` in either side's overlap predicate fails its fixture test.

### D10 MCP
`update_dashboard_layout` gets `breakpoint` (default `lg`) and `layouts` (per-breakpoint map); `helioApi.updateDashboardLayout` PATCHes only the named breakpoints; descriptions stop claiming "same placement to all" and "unlisted panels keep position" (the listed items are that breakpoint's full layout). `auto_layout_dashboard` gets `breakpoint`. Tests in the existing helio-mcp jest files assert the PATCH/POST bodies (only named breakpoints; no copy-to-all).

### D11 Frontend: the client must never send an invalid CHANGED breakpoint (design-gate round 1, change requests 1-2)
The lockout class: the client's local authored layout can diverge from what the server stored and be invalid, then ride along in the next four-breakpoint PATCH as a "changed" breakpoint and 400 (swallowed by `useLayoutSave`). Two known sources, both verified: (a) `panelThunks.createPanel` optimistically appends `scaleLayoutItem(lgItem, ...)` to md/sm/xs (the collapse projection) and nothing refetches the dashboard; (b) layout undo/redo (`useLayoutUndoRedo`, `CommandBar`) restores a pre-interaction authored snapshot that may hold a stored-bad breakpoint which the user had since repaired. Decisions:
1. **Adopt the server's placement on panel create.** The create response gains an additive optional per-breakpoint field (`layouts: {lg,md,sm,xs}`, the item the server stored in each breakpoint, from D4); `panelThunks` merges THOSE into the local layout and the client-side scale projection is deleted. (Fallback if the field proves unworkable: mirror D4 exactly in the thunk. Either way a test: createPanel then a layout PATCH is accepted.)
2. **Persist what is displayed (safety net).** `persistLayout` builds the PATCH body so that every breakpoint differing from the last server-acknowledged layout AND failing `isLayoutValid` is replaced by that breakpoint's `resolveDashboardLayout` (HEL-1023) result — exactly what the user sees. Valid changed breakpoints are sent as is; unchanged ones as is. This makes undo-to-a-bad-snapshot persist the repaired breakpoint (WYSIWYG) instead of a 400, and bounds any future client/server divergence. The local store layout is left as authored (HEL-1023 invariant: never write derived layout on view).
3. **No silent failure.** A rejected layout PATCH (any non-2xx) now surfaces the server message through the app's existing error/notification mechanism (executor finds it; if none fits, the pending-save indicator shows an error state) and re-syncs the dashboard's authored layout from the server (refetch dashboards) so view and store converge. Test: a mocked 400 produces the visible error and the re-sync.
4. Task enumerates every `setDashboardLayoutLocally` caller (panelThunks, DesktopPanelGrid, useLayoutUndoRedo x2, CommandBar x2, dashboardsSlice reducer) and records, per caller, why it cannot persist an invalid changed breakpoint (or the fix).

## Risks / trade-offs
- BREAKING for MCP callers relying on the flattened behaviour (called out in tool text and PR).
- The grandfather rule leaves stored-bad data until edited (owner-approved). Follow-up candidate: a one-off repair tool for stored-bad breakpoints (not in scope).
- Race: validate-then-write reads stored layout before writing; a concurrent PATCH could slip a stale "identical" through. Same last-write-wins exposure the endpoint already has; not widened materially.
- Ask 4 (roadmap dashboard `7ad267a8…` xs) is OUT of scope: with this change an agent can fix it with `update_dashboard_layout breakpoint=xs` (3 tiles in 2 columns: pair per row, or stack full-width, y offsets so no cell is shared), executed by the driver with owner confirmation against production.

## Migration
None.
