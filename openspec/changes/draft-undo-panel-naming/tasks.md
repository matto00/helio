## Standing Constraints

- [C1] Never read/cat/grep/source/print/copy any .env file; no env-dumping commands; scripts/concertino/.concertino.env may be read by scripts, never printed.
- [C2] Quoted heredocs only (<<'EOF').
- [C3] No pkill/pgrep/killall; exact PIDs only; stop servers with stop-servers.sh; delete residue by exact id.
- [C4] jest 3 workers, Playwright 2 workers, sbt -J-Xmx3g, nice -n 19.
- [C5] Bash timeout 600000; sbt testFull in shards that fit; never a background run past the tool timeout.
- [C12] Red first with mutations; run full spec files; commit the red run before implementation code.
- [C13] Scratch in .concertino/scratch/HEL-1792/; follow-up evidence in .concertino/runs/HEL-1792/evidence/.
- [C14] Lane-private DB helio_hel1792 for every server, jest/hook and e2e run touching a DB.
- [C15] Any lane backend starts with ANTHROPIC_API_KEY exported empty; no live model call.
- [C16] Do not touch HEL-1697 (frontend features/pipelines draft evaluator) or HEL-1793 (CI workflows/scripts) files; keep PatchSetUndoService untouched or minimal.

### Tests (red first)

- [x] 1.1 New two-user spec on helio_app_test (assert rolbypassrls = false): created-Output refusal names readable panels by title, counts the unreadable one, no panel id
- [x] 1.2 Same spec: removed-Outputs refusal is count-only, no panel or alert rule id
- [x] 1.3 Same spec: a bind after the pre-check (DraftSaveHooks Begin hook, second connection commits) gives 409 PATCH_SET_STALE, no panel id, nothing changed
- [x] 1.2a Same spec: alert rule on a created Output named when the undoer owns it (no id); counted with no id/name when owned by another user (editor-saver undo)
- [x] 1.3a Same spec: both-refusals case (removed + created) follows D2a, no ids
- [x] 1.4 Run the spec on main code, record and commit the red run (scratch log + evidence)

### Backend

- [x] 2.1 Extract describeBlocking(ids, user, panelRepo, dashboardRepo) in PatchSetUndoBoundPanels; blocker uses it, text unchanged
- [x] 2.2 DraftRestore created-Outputs refusal uses describeBlocking; alert rules named only via outputRepo.findVisibleAlertRuleIds, else counted
- [x] 2.3 DraftRestore removed-Outputs refusal count-only
- [x] 2.4 DraftSaveTransaction.cascadeGate Restore refusal count-only (defence in depth, no test claimed)
- [x] 2.4a Combined message per D2a when both refusals apply
- [x] 2.5 DraftRestore constructor gains dashboardRepo only; ApiRoutes:668 passes it
- [x] 2.6 Verify no log line carries panel ids for a draft-undo refusal

### Tests (green)

- [x] 3.1 Update DraftSaveUndoSpec message assertions (late-panel by title, cascade case by count)
- [x] 3.2 Mutations: revert 2.2 to id list (spec red); name all alert rules regardless of owner (1.2a counted leg red); drop pre-check (409 PATCH_SET_STALE, no id)
- [x] 3.3 Gates actually run: targeted `sbt testOnly` of DraftUndoPanelNamingSpec + DraftSaveUndoSpec (16 tests green), then `testOnly com.helio.services.patchsets.* com.helio.services.pipelines.draft.* com.helio.api.routes.pipelines.*` (1486 tests green; includes DraftSaveRootsUndoSpec and PatchSetUndoBoundOutputPanelsSpec). The full `sbt testFull` was run by the evaluator in 8 shards at 6d74aeaf4 (all green, logs eval-shard{0..7}of8.log); the executor did not run it.
