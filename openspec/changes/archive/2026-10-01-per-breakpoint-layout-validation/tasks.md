## 1. Shared fixture and validator parity
- [x] 1.1 Create the shared layout-validity fixture (D9); verify the schema-drift script ignores its location
- [x] 1.2 Backend `LayoutValidator` (pure) + `LayoutValidatorSpec` reading the fixture; assert column constants equal fixture
- [x] 1.3 Frontend jest test over the same fixture using `isItemInBounds`/`findOverlaps`/`isLayoutValid`; assert `dashboardGridCols` equal fixture
- [x] 1.4 Demonstrate mutation (`<`->`<=` in each side) fails its test; record in execution-progress.md

## 2. Write policy (D2, D3)
- [x] 2.1 `DashboardLayoutPatchPayload` (optional breakpoints, >=1 present) + JSON protocol + schemas (`update-dashboard-request` layout, new patch-layout schema); keep response/snapshot schemas
- [x] 2.2 Multiset identity + per-breakpoint validate in `DashboardService.update`; deterministic 400 message; nothing written on reject; `LayoutWritePolicy.RestorePriorStored` internal
- [x] 2.3 Route tests: overlap xs 400 names breakpoint+ids; OOB 400; one-bad-breakpoint rejects all (lg unchanged); partial PATCH preserves others; stored-bad xs + changed lg + all four sent (xs reordered) succeeds with xs byte-identical; changed-but-still-bad xs 400; PATCH of repaired xs succeeds. Seed the stored-bad xs through the repository (not the API)
- [x] 2.4 Verified wire shape: the frontend uses `PATCH /api/dashboards/:id/update` with `{fields:["layout"], dashboard:{layout}}` (all four breakpoints, authored). Add/keep a frontend test asserting that payload (documents why identity, not presence, is the rule); route tests in 2.3 run through BOTH `PATCH /api/dashboards/:id` and `/update`; identity is compared after panelId trimming (test: whitespace-padded identical panelId is not a change)

## 3. Valid-by-construction producers (D4, D5, D6)
- [x] 3.1 `LayoutReflow` + property tests (zero violations at every breakpoint for random inputs, incl. w > cols)
- [x] 3.2 `PanelPacker.clamp` cap at cols; existing packer tests green
- [x] 3.3 `AutoLayoutService`: `breakpoint`, per-breakpoint pack, kept-panel avoidance; request protocol + schema; tests incl. three 4-wide Outputs -> xs valid, single-breakpoint leaves others untouched, `cols` mismatch 400, kept stored-bad 400
- [x] 3.4 `PanelService.placeDefaultLayout` per-breakpoint bottom; test on a dashboard whose md extends below lg and on a stored-bad xs (panel create still succeeds)
- [x] 3.5 `DashboardProposalService.applyLayout` / `DashboardContentsService`: pre-validate lg, reflow md/sm/xs, 400 before creating anything; stop swallowing; tests incl. 3-tiles proposal -> valid xs
- [x] 3.6 Import validates per D7; duplicate copies faithfully (test both, incl. import of a bad breakpoint -> 400 naming snapshot ids)
- [x] 3.7 Patch-set rollback/undo exempt path test (restoring a stored-bad prior layout still succeeds)
- [x] 3.8 Enumerate all layout write paths from code (D8), write the final table to execution-progress.md; audit first-run/persona builders with a validator assertion test

## 3b. Frontend lockout prevention (D11)
- [x] 3b.1 Create-panel response carries per-breakpoint placed items (schema + backend + `panelThunks` adopts them; delete the scale projection); test: createPanel then layout PATCH accepted (backend route test with stored layout after create == what client would send; frontend thunk test)
- [x] 3b.2 `persistLayout` substitutes the resolved breakpoint for any changed-and-invalid breakpoint; tests: undo to a stored-bad snapshot persists the resolved (valid) breakpoint, valid/unchanged breakpoints are sent untouched
- [x] 3b.3 Layout PATCH rejection is visible (existing notification mechanism) and re-syncs authored layout from the server; test with a mocked 400
- [x] 3b.4 Enumerate every `setDashboardLayoutLocally` caller (panelThunks, DesktopPanelGrid, useLayoutUndoRedo, CommandBar, dashboardsSlice) with a per-caller justification in execution-progress.md
- [x] 3b.5 Seam test (HEL-1208->1220 class): backend route test posts the exact four-breakpoint body the frontend produces for (a) create-then-drag and (b) undo-after-repair on a stored-bad xs; both accepted; frontend fixture of those bodies shared where practical

- [x] 3b.6 Design-gate round-2 notes (fold in): (i) `persistLayout` sends ONLY breakpoints that differ from the baseline (partial PATCH) and test the stale-baseline case; (ii) after a save, set the baseline from the server response/sent body, NOT the authored `nextLayout` (test: undo-to-bad, save, undo-to-bad again); (iii) only substitute the resolved breakpoint when panels are loaded for that dashboard (never wipe items from an empty panel list); (iv) a failure toast already exists (`toastListeners.ts`) but the thunk discards the server message: forward the 400 message, respect the concurrent-fetch upsert guard in `dashboardsSlice.ts`; (v) create response keeps `layout` (lg, compat) and adds authoritative `layouts`, documented in the schema

## 4. MCP (D10)
- [x] 4.1 `helioApi.updateDashboardLayout`/`autoLayoutDashboard` + tool schemas/descriptions; helio-mcp jest tests (only named breakpoints PATCHed; `breakpoint` forwarded; verbatim 400 surfaced)
- [x] 4.2 Confirm `dist/` untracked (nothing to rebuild); run helio-mcp typecheck/tests

## 5. Specs, schemas, docs
- [x] 5.1 Update `schemas/` and run the schema-drift check; update backend READMEs touched; `openspec validate per-breakpoint-layout-validation --type change`

## 6. Verification
- [x] 6.1 `cd backend && nice -n 19 sbt testFull` (never bare `sbt test`); frontend lint/typecheck/jest for touched files; root jest for helio-mcp
- [x] 6.2 Live e2e on the worktree backend (raise `RATE_LIMIT_REQUESTS_PER_WINDOW` and say so): PATCH overlap xs -> 400, valid xs -> 200 with lg intact, auto-layout per breakpoint; record exact ids of every dev DB row created and delete only those, by id

## Standing Constraints
- [C1] Reject out-of-bounds (x<0,y<0,w<1,h<1,x+w>cols) as well as overlaps, with 400 naming breakpoint and panel ids; nothing saved (owner, Q1)
- [C2] Breakpoint identical to stored passes untouched; changed breakpoint must be fully valid or whole write 400; absent breakpoints preserved (owner, Q2)
- [C3] Backend gate is `cd backend && nice -n 19 sbt testFull`, never bare `sbt test`; one full suite at a time; known flakes HEL-1228 / HEL-1215 shown passing in isolation
- [C4] Dev DB cleanup by EXACT recorded ids only; never by name/email/time pattern; never disable triggers/FKs; list anything not cleaned
- [C5] No production or mutating gcloud; stay out of `infra/`; ask 4 (production dashboard 7ad267a8) is out of scope
- [C6] Run `sbt --client shutdown` in the worktree before cleanup; run heavy work under `nice -n 19`; executor bash calls use `timeout: 600000` or background-and-poll in-turn
