## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: 11bd02285b20650208bcdccfdc777f3f10108b3c (base f09ba92f, resolved live).

### Phase 1: Spec Review — PASS
Issues: none. ACs covered (every create path writes four-breakpoint items; red tests recorded in red-evidence.md; orphans handled per C1 by the widened owner repair, append-only, non-owners keep render-time placement). C2 seam present (PanelCreateSeamSpec + layoutCreateSeam.test.ts + shared fixture). Out-of-scope files (ApiRoutes.scala, Main.scala, PipelineRunService, NodeSnapshotRepository, analyze, Flyway) are untouched by the diff (grepped).

### Phase 2: Code Review — PASS
Own gate runs in WORKTREE_PATH (fresh):
- npm run lint, format:check, typecheck, `npm --prefix frontend run build`: exit 0.
- npm test: 424 suites / 4398 tests passed (known flakes did not fire).
- `nice -n 19 sbt testFull`: 5740 passed, 0 failed, 398 suites; FirstRunRoutesSpec ran without timeout. sbt --client shutdown run separately.

Scrutiny points:
1. Task 3.5 deviation: verified acceptable. ApplyProposalSpecBase's app pool is `SET ROLE helio_app_test` (NOSUPERUSER, no BYPASSRLS); the first test asserts `appPoolRlsPosture() == (false,true,true)` read through that same pool, so it cannot pass vacuously. The editor-grantee single/batch/duplicate tests run through withUserContext and only pass if V36 select+update policies admit the FOR UPDATE read. Caveat (non-blocking): the stranger/viewer tests short-circuit at the service ACL check (403/404) and do not themselves exercise RLS; the editor case is the load-bearing RLS proof.
2. Transient e2e: could not reproduce. Trigger reviewed (`useStoredLayoutRepair`): the once-per-mount guard is consumed only after panelsLoaded, currentUser, ownerId===currentUser and hasRepairableBreakpoint all hold, and all of them are effect deps, so any arrival order re-evaluates; there is no premature-guard race. I additionally ran a randomized-latency harness (every /api/** response delayed 0-2.5 s randomly, 14 fresh page loads of an orphaned dashboard): 14/14 sent exactly one repair POST. Plus 6 more runs of the e2e spec (24/24 tests green). Conclusion: test artefact / cold-backend latency, not a trigger race. Recorded as non-blocking.
3. hel1023 V_valid_with_gaps: that state is complete and valid, so neither repair nor placement paths run for it; hel1023 + hel1230 e2e (6 tests) passed twice in a row here. The only hel1023 diff is stubOwnerRepair for A/B. No causal link found.
4. Deadlock fix: PanelLayoutPlacement.insertAndAppend does `SELECT layout ... FOR UPDATE` first and `insert.andThen(update)` inside the flatMap, in the caller's transaction; used by insertPlaced, duplicate and insertBatchPlaced. PanelCreatePlacementSpec "two panels created concurrently" fires 4 parallel creates and asserts 4 items per breakpoint, all valid (red-evidence documents the 500 deadlock found by it with insert-first order).
5. C2 seam: PanelCreateSeamSpec runs fixture operations through the real routes, asserts stored == fixture and re-sends every breakpoint through the real layout PATCH (HEL-1071 validator, 200). Red/mutation evidence is recorded with real failing output (16 red backend, 13 red frontend under mutation); passing-on-unfixed guards are honestly labelled.
6. useLayoutSave.ts: header-only change; class-3/class-4 contract text consistent with the code and repair guard unchanged (owner, panelsLoaded, once-per-mount).
No unused imports/TODO/FIXME found in changed sources.

### Phase 3: UI Review — PASS
Servers verified: port 6692 vite cwd = this worktree/frontend, 9599 backend cwd = this worktree/backend.
- Own headless context, light and dark, widths 1440/1100/768/400: dashboard with 3 created panels (text/markdown/divider) stores 3/3/3/3 items; no "Unsaved changes"; 0 console/page errors in all 8 combinations; at 1440/1100 three grid items render; at <=768 the stacked mobile layout renders (no react-grid-item, as before).
- e2e hel1260 (orphan repair + UI create, light+dark): 24/24 across 6 runs; hel1023/hel1230: green x2.
- Data created: throwaway users hel1260-race-*/hel1260-live-*/hel1260-* @example.test (users not deletable via API); every dashboard created by me deleted by exact id.

### Overall: PASS

### Non-blocking Suggestions
- e2e hel1260 first test: on a cold backend the 15 s poll for the repair POST could be latency-bound; consider widening to 30 s to remove the unexplained transient.
- Stranger/viewer RLS tests are service-ACL tests, not RLS tests; the comment in PanelCreatePlacementSpec could say so.
