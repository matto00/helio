## Standing Constraints

- [C1] Owner ruling extend-owner-repair (HEL-1260 escalation 1791170898260): existing orphans are fixed by widening the HEL-1233 once-on-open OWNER repair to valid-but-incomplete breakpoints, append-only (every stored live-panel item unchanged or 400); non-owners keep render-time placement; stored-layout-repair spec updated citing the ruling.
- [C2] Every created item at every create path must pass the HEL-1071 validator, proven by a client/server seam test; red test before fix, mutation after.

## 0. Repro (red first, before any production edit — design D6)

### Tests

- [x] 0.1 Route spec (extends `HelioRouteTest`): create of each kind (output/text/markdown/image/divider/form) stores an item in lg/md/sm/xs
- [x] 0.2 Route spec: batch create (text + output) stores and returns `layouts` per item; rejected batch leaves layout unchanged
- [x] 0.3 Route spec: panel duplicate stores and returns `layouts`; source size kept
- [x] 0.4 Invert `PanelServiceDefaultLayoutSpec` "never write the dashboard layout" (it encodes the bug)
- [x] 0.5 Proposal apply with one unauthored panel: every panel has an item in every breakpoint
- [x] 0.6 Client `repairPatch` test: valid breakpoint missing a live panel is repairable and append-only
- [x] 0.7 Run them on the unfixed tree; record the failing output in `red-evidence.md` in this change dir

## 1. Server placement

### Backend

- [x] 1.1 Pure placer (D1): ordered `(panelId, per-breakpoint size)` appended below each breakpoint's bottom; Output scaled as today, content/form 4/4/3/2 x 5
- [x] 1.2 Atomic append (D2): lock dashboard row FOR UPDATE + layout/last_updated-only UPDATE in the SAME tx as the insert; single create in `withUserContext(caller)`, batch/duplicate in their existing system tx
- [x] 1.3 `PanelService.create` places every kind via 1.1/1.2; return `PlacedLayouts` for all kinds
- [x] 1.4 `PanelService.batchCreate` places all items in request order in the insert transaction; route returns `layouts` per item
- [x] 1.5 `PanelService.duplicate` places the copy; route returns `layouts`. Duplicate size per breakpoint, in order: (1) the source's stored item size at that breakpoint (w clamped to cols); else (2) the source's lg item scaled to that breakpoint (w = clamp(round(lgW*cols/12), 1, cols), same h); else (3) the D1 default size for the source's kind at that breakpoint (source orphaned everywhere).
- [x] 1.6 `ProposalLayoutSupport.buildLayout` appends unauthored panels below authored lg before reflow (proposal apply + contents replace)
- [x] 1.7 `DashboardLayoutRepair.plan`: act on stored-bad OR incomplete; stored-bad precedence; append-only (first stored entry per live id) for incomplete-only
- [x] 1.8 Update `schemas/panels/panel.schema.json` `layouts` description (no longer output-only; batch/duplicate) and `helio-mcp/src/types.ts` if it models these

## 2. Client

### Frontend

- [x] 2.1 `repairPatch.ts`: `hasRepairableBreakpoint(panels, layout)` and `buildRepairPatch` include incomplete breakpoints
- [x] 2.2 `useStoredLayoutRepair`: use 2.1; owner check, panels-loaded check and once-per-mount guard unchanged
- [x] 2.3 Shared helper adopting server `layouts`; use it in `createPanel` and `duplicatePanel` thunks
- [x] 2.4 `useLayoutSave.ts` header: class 3 covers create or duplicate; rewrite class 4 repair paragraph (all-orphan append repair may be class 3, same outcome); `repairPatch.ts` header

## 3. Verification

### Tests

- [x] 3.1 Seam test (D7): stored layout after every create path re-sent through the real layout PATCH returns 200; client `isLayoutValid` agrees
- [x] 3.2 Extend the HEL-1233 repair seam fixture with an incomplete-breakpoint case (client output == fixture; server stores 200)
- [x] 3.3 Repair route spec: incomplete append accepted; moving a stored item 400; stored-bad+missing precedence; non-owner 403; second call no-op
- [x] 3.4 Concurrency test: two concurrent creates on one dashboard both stored, no overlap
- [x] 3.5 Non-superuser NOBYPASSRLS dashboards/panels harness: owner + editor-grantee create store panel and items; non-grantee writes nothing. Done in `PanelCreatePlacementSpec` on the `ApplyProposalSpecBase` pool (`SET ROLE helio_app_test`, NOSUPERUSER, no BYPASSRLS, FORCE RLS on dashboards and panels), with a first test asserting that posture through the app pool (`appPoolRlsPosture`) so the RLS cases cannot pass vacuously. No new `ProductTelemetryDbHarness`-style harness was built.
- [x] 3.5a useLayoutSave unit tests: repair response as class 3 (all-orphan) and class 4 — pending false, no history, baseline = repaired; pending local edit kept
- [x] 3.5b Dashboard duplicate + import of an orphan-bearing dashboard: copy faithful, repair endpoint stores the appended orphan 200
- [x] 3.6 Grep and update every test asserting no layout after a non-Output create / duplicate (backend, `frontend/src`, `e2e/`, `frontend/e2e`)
- [x] 3.7 `e2e/hel1023`: apply `stubOwnerRepair` to A_lg_only/B_partial; confirm seeding still yields the intended states
- [x] 3.8 New e2e: owner opens a dashboard with an orphaned text panel → one repair POST, stored in every breakpoint, no dirty, light + dark
- [x] 3.9 Mutation: revert the placer to Output-only and the repair to stored-bad-only; confirm 0.x/3.x go red; record in `red-evidence.md`
- [x] 3.10 Gates: frontend lint/typecheck/jest; `nice -n 19 sbt testFull` (timeout 600000, ≤2 workers); targeted e2e
- [x] 3.11 Live check on this worktree's servers in light and dark: create text panel → stored layout JSON has all four items; reload stable
