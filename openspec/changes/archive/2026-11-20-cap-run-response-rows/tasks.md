## Standing Constraints

- [C1] Never read/cat/grep/source/print or copy any .env file (backend/.env, frontend/.env, infra/.env.deploy...); no env-dumping commands (env, printenv, set, export -p, /proc/*/environ). Only scripts may read scripts/concertino/.concertino.env, never print it.
- [C2] Quoted heredocs only (<<'EOF').
- [C3] No pkill/pgrep/killall; exact PIDs only; stop servers with scripts/concertino/stop-servers.sh; test residue deleted by exact id (buildUserDeleteSql); plain emails.
- [C4] jest 3 workers, Playwright 2 workers, sbt -J-Xmx3g, nice -n 19.
- [C5] Bash timeout 600000; `sbt testFull` (sharded to fit the timeout), never a background run past the tool timeout.
- [C6] Budget exhausted means escalate.
- [C7] Auditor merges only with `gh pr merge --squash --match-head-commit <sha>`, never --auto.
- [C8] No prod, no release, no concertino sync, no MCP deploy.
- [C9] No claude.ai session link in PR bodies or commits.
- [C11] Known flakes (by test title) per the driver brief; an unlisted unrelated CI failure gets ONE `gh run rerun --job <id>`, named in the PR. A refused command is never retried or worked around.
- [C12] Red first, with mutations; run full spec files; record and COMMIT the red run before implementation code.
- [C13] Scratch in .concertino/scratch/HEL-1696/; anything a follow-up must reference goes in .concertino/runs/HEL-1696/evidence/.
- [C14] Lane-private DB `helio_hel1696` (DATABASE_URL for start-servers.sh AND Playwright; DB_USER if the URL has no credentials); drop it at Delivery. Start any backend with ANTHROPIC_API_KEY exported empty.
- [C15] Owner rulings: cap 10 rows; MCP apply tools pass the capped run through; GET /runs/:runId capped too; flag named `rowsTruncated`.
- [C16] Never weaken an existing assertion that read >10 rows from a run response without moving it to persisted Output rows or rowCount; list every such test in files-modified.md.

## 0. Tests (red first, committed before implementation)

- [x] 0.1 Backend route spec: real POST /run (real and dry) with 25 terminal rows asserts rows=10, rowCount=25, rowsTruncated=true, and Output rows hold 25
- [x] 0.2 Backend specs: apply-proposal and /proposals/apply embed the capped run; POST /preview and GET /steps/:stepId/preview report rowsTruncated; 10-row run reports false
- [x] 0.3 Backend route spec (PipelineRunResponseCapSpec): real GET /api/pipelines/:id/runs/:runId body for a 25-row cached run has rows 10, rowCount 25, rowsTruncated true
- [x] 0.4 Seam: backend spec holds the real /run body to shared-test-fixtures/pipeline-run/run-capped-response.json
- [x] 0.5 Frontend: fixture through submitPipelineRun.fulfilled + SpineRunStatus shows "Snapshot replaced: 25 rows" (and dry "Preview: 25 rows")
- [x] 0.6 MCP: fixture as an apply response's run passes rowCount/rowsTruncated through; descriptions mention the 10-row preview
- [x] 0.7 Record the red run (with mutations noted) under openspec/changes/cap-run-response-rows/red-run/ and commit it

### Backend

- [x] 1.1 Add `rowsTruncated: Boolean = false` to RunResultResponse (jsonFormat12) and the single preview helper (PreviewRows = 10)
- [x] 1.2 Executor response (PipelineRunExecutor) uses the helper; the terminal writes keep the full jsRows
- [x] 1.3 Both PipelineRunPreview sites use the helper instead of the literal take(10)
- [x] 1.4 CachedRunStatus and RunStatusResponse (custom write+read) gain `rowsTruncated: Option[Boolean]`; route copies it; runStatus renders only the first 10 rows
- [x] 1.5 Update existing backend tests that read more than 10 rows from a run response (per C16)

### Frontend

- [x] 2.1 Add rowsTruncated to both RunResult TS types; add runRowCount to PipelinesState, set on fulfilled, cleared with runResult
- [x] 2.2 SpineRunState uses runRowCount; thread it through usePipelineOwnPipeline/usePipelineDetailPage/PipelineSpineLayout/MobilePipelineHeader
- [x] 2.3 Rewrite the stale runResult comment in pipelinesState.ts; frontend RunStatusResponse type gains optional rowCount/rowsTruncated

### MCP

- [x] 3.1 helio-mcp RunResultResponse type gains rowsTruncated + doc; apply_pipeline_proposal and apply_combined_proposal descriptions updated

### Tests

- [x] 4.1 All red tests green; mutation checks re-run (remove cap, flip flag, count from rows.length, drop the field from the RunStatusResponse writer) and each turns red
- [x] 4.2 Full affected spec files, sbt testFull (sharded), frontend jest, helio-mcp tests, lint, typecheck green
