## Standing Constraints

- [C1] Grant re-check only on root add/remove, draft save (incl. undo restore), step writes; placed right after the existing lockPipelines; plain read of resource_permissions (no FOR SHARE). Output create, insight refresh, dashboard-editor writes are HEL-1882, out of scope.
- [C2] Fix in this PR: DELETE /api/outputs/:id and patch-set undo of an Output create refuse a creator who is no longer owner/editor of the pipeline (404, nothing deleted); R2: the caller must be the Output creator AND currently pipeline owner or editor; red first with mutation; owner and current editor deleting their own Output guarded; no new delete rights, output-routes-api 404 scenario and PATCH unchanged; state the visible change in the PR body.
- [C3] Item 1: PipelineRootRepository.add maps both the missing pipeline name read and a false lockPipelines(RootAdd) result to the unknown-pipeline 404.

## Run constraints (driver; restate to every sub-agent)

Never read/print any .env file or run env-dumping commands; quoted heredocs only; no pkill/pgrep/killall; jest 3 / Playwright 2 workers, sbt -J-Xmx3g, nice -n 19; Bash timeout 600000 and sbt testFull in shards that finish under it; red first with mutations, red run committed as .txt before implementation; scratch only in the main checkout's .concertino/scratch/HEL-1707/ (TMPDIR exception for hook runs: /tmp/claude-1000/-home-matt-Development-helio/178232e2-92a2-44f9-8fb7-656468a7b746/scratchpad/HEL-1707); lane DB helio_hel1707 exported as DATABASE_URL in the same command as start-servers.sh; ANTHROPIC_API_KEY empty; no prod, release, concertino sync or MCP deploy; avoid HEL-1248 (PublicRouteScanner / PublicRouteOwnerIdLeakApiSpec) and HEL-1541 (pipeline-run write paths) files.

## 1. Red first (commit the red run as .txt before any implementation)

- [x] 1.1 Item 1 race spec: pipeline deleted (a) before the name read and (b) after the name read, before `lockPipelines(RootAdd)`, via the D6 locks subclass; asserts 404 unknown-pipeline body and no root row. Red on main (500 / failed Future).
- [x] 1.2 Item 2 race specs, one per path: root add, root remove, draft save, draft-save undo restore, and each production-reachable step write (create via attachTailInternal and spliceInsertReportingInternal, update, delete, reorderTrunk, duplicate): grant revoked AND, in a separate case per route, downgraded to viewer (one 403 test per route in the D2 table) between the service check and the lock; asserts the exact D2 mapping-table body (403 for viewer) and nothing written. Service-level with injected locks (D6). Red on main (write lands).
- [x] 1.3 Output delete R2 spec: creator downgraded to viewer deletes -> 404, Output and panels remain (red on main: 200). Undo of an Output create by a downgraded creator -> NotFound "Output not found", Output remains (red on main).
- [x] 1.4 Commit the red run output as `.txt` under the change directory (pre-commit may refuse; if so keep the .txt and note it in the PR).

## 2. Implementation

- [x] 2.1 D1 shared in-transaction access predicate.
- [x] 2.2 D4 item 1 in `PipelineRootRepository.add` + mapping in `PipelineRootWrites`.
- [x] 2.3 D2/D3 re-check in root add/remove, draft save, and the production-reachable step writers only (NOT insertInternal/insertAtInternal/reorderInternal); required acting-user parameter; typed refusal recovered before generic handlers per the D2 table (deleteStep and OutputService.delete gain a recover for the typed refusal only).
- [x] 2.4 D5 Output delete and undo re-check.

## 3. Guards (labelled GUARD, each with a recorded failing mutation)

- [x] 3.1 NOBYPASSRLS: editor attaches another user's source as a root -> data-source 404, nothing written.
- [x] 3.2 NOBYPASSRLS: editor names another pipeline's root id on remove -> 404 Root not found, nothing changed.
- [x] 3.3 Owner and current editor still delete their own Output (200); a non-creator editor still gets 404.
- [x] 3.4 `PipelineRootWriteGrantsSpec`: UPDATE on `panels`, EXECUTE on `hel1629_lock_pipelines`.

## 4. Verification

- [x] 4.1 Mutation runs for every red test and every guard, outputs saved under `.concertino/scratch/HEL-1707/`.
- [x] 4.2 Full spec files for every touched spec, plus the existing root/draft/step/Output/patch-set-undo specs (DraftSaveRlsSpec, DraftSaveRaceSpec, PipelineRootRemoveAtomicitySpec, PipelineRootRoutesSpec, step and Output route specs, patch-set undo specs) in shards under the timeout.
- [x] 4.3 D4 1(b) dual-detector mutation evidence recorded (Boolean-only removal green; Boolean + predicate removal red).
- [x] 4.4 `files-modified.md` listing every changed file and every production call site of a re-checked writer.
