## Skeptic Report — final gate (round 1, skeptic-final-1.md)
Reviewed HEAD 364f7e29feddeae4844dad0bcf028a6fa0fba80c.

### What I verified (with evidence)
- Diff vs live base 9194c98d read (75 files). Core: LayoutPolicy (identity multiset / absent preserved / changed must be valid), LayoutValidator (predicates identical to frontend), DashboardService.applyUpdate resolves+validates before the rename write (nothing saved on reject).
- Gates run myself: `cd backend && nice -n 19 sbt testFull` -> Tests succeeded 5191, failed 0. Frontend jest 408 suites/4252 tests pass. Root jest helio-mcp 31 suites/315 tests pass. sbt client shut down after.
- Fixture bites: I flipped `a.x + a.w > b.x` to `>=` in frontend breakpointLayout.ts -> breakpointLayout.fixture.test 5 failed/23 passed (file restored via git checkout). Matches executor/evaluator figures; backend mirror mutation not re-run by me (relied on evaluator's pasted counts, consistent).
- AC1/AC2: MCP update_dashboard_layout takes breakpoint/layouts, handler PATCHes only named breakpoints; auto_layout takes breakpoint; descriptions match the code (BREAKING note truthful; "listed items are the COMPLETE layout" matches PATCH semantics).
- AC3: every layout write path enumerated independently (grep of dashboardRepo.update/insert/replaceContents, placeDefaultLayout, DashboardLayoutItem( constructors): REST PATCH both routes, MCP, auto-layout, panel create (per-bp bottom, cannot overlap), proposal apply, contents replace, import (validated), duplicate (faithful copy, exempt, documented), patch-set rollback/undo (RestorePriorStored is private[services]), patch-set preview (found beyond design). batch create writes no layout. No path found that stores an invalid newly-written breakpoint.
- AC6/lockout: frontend sends only breakpoints differing from baseline (layoutPatch.ts), substitutes the resolved breakpoint when a changed one is invalid and panels are loaded, baseline taken from server response, createPanel adopts server `layouts` (client scale projection deleted), 400 message forwarded + store resync via dashboardUpserted. Server identity rule is order-insensitive and trim-normalized. Panel create on a stored-bad breakpoint appends below that breakpoint's own bottom, so the client's mirrored array stays identical to stored.
- AC5: shared fixture shared-test-fixtures/layout-validity.json loaded by both sides, column constants asserted. AC7: schemas + openspec + helio-mcp tests updated; dist untracked.
- Deviations: coordinate normalization removal is required by reject-never-clamp (non-int already fails JSON parse); cols>12 400 per D5; credential-scan script edit is a one-line ACKNOWLEDGED_UNSCANNED entry for a data-only dir (legit, requirement of that gate's own rule); preview projection now shares LayoutPolicy (correct, consistent).

### Verdict: CONFIRM

### Non-blocking notes
- Residual lockout by design (D5): MCP auto_layout_dashboard that omits panels whose stored breakpoint is stored-bad 400s (caller must list all panels). Documented in design/execution-progress; not a user-edit path.
- Import of a dashboard exported while holding a bad breakpoint now 400s (accepted D7; mention in PR).
- DashboardService.scala 431 lines (>400 split-proposal line); executor's split proposal belongs in the PR.
- Live literal UI drag was not performed by evaluator or me; wire-shape + jest coverage is the evidence.
