## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD `137d5b407e6242e6637004ad6a0f404f5c1287b8`. Base `fef01cda9c089e90c2f93f65e1b59ee1f11d8a16` (resolved
live). The new commit since cycle 1 is `137d5b407`. It touches only `frontend/` and openspec artifacts, with no
backend, helio-mcp or fixture change (`git diff --name-only 59ae7d4a8 137d5b407`).

### Phase 1: Spec Review — PASS

Cycle-1 change requests:
- **CR1 (resolved).** `runResult` is gone from `SpineRunState` (`SpineRunStatus.tsx`). It is also gone from the
  passthroughs in `usePipelineOwnPipeline.ts`, `usePipelineDetailPage.ts`, `PipelineSpineLayout.tsx` and
  `MobilePipelineHeader.tsx`, and from the test props: the keys test, `PipelinesPage.delete`, `PipelineMobileLayout`,
  `rawElementGuardHel440` and `runCap`.
  - Outside tests, `runResult` now appears only in the Redux state and slice. That matches D5, which keeps the state
    key.
  - The `SpineRunState` comment now describes `runRowCount` without referring to the removed field.
- **CR2 (resolved).**
  - design.md D5 now records `rowsTruncated?: boolean` on `services/pipelineService.ts`, and that it is required on
    `types/output.ts`.
  - tasks.md 0.3 names `PipelineRunResponseCapSpec`.

Every cycle-1 Phase 1 finding still holds. The backend, MCP and fixture are unchanged.

### Phase 2: Code Review — PASS

Gates, run fresh by me in WORKTREE_PATH at `137d5b407`:
- `npm run lint`: exit 0.
- `npm run format:check`: exit 0.
- `npm --prefix frontend run typecheck`: exit 0.
- `npm --prefix frontend run build`: exit 0.
- `npm test` (3 workers): root 71 suites / 621 tests, and frontend 882 suites / 10394 tests, all passed.
- Backend `sbt testFull`: not re-run. The new commit has no backend change, and cycle 1's 6-shard run at `59ae7d4a8`
  (10062 passed, 0 failed) covers the same backend tree.

The diff is a pure removal of an unread field plus artifact text. It changes no behaviour and adds no new code paths.

### Phase 3: UI Review — PASS

- Servers ran through start-servers.sh on 7128/10035 against the lane DB `helio_hel1696`, with `ANTHROPIC_API_KEY`
  exported empty. `assert-phase` gave `PASS servers`.
- Wire: a 25-row apply-proposal returned `run.rows` 10, `rowCount` 25 and `rowsTruncated` true.
- Desktop pipeline page:
  - "Run pipeline" shows the chip "Snapshot replaced: 25 rows".
  - "Dry run" shows "Preview: 25 rows".
  - There is no horizontal overflow.
- At 375 the mobile header (the changed `MobilePipelineHeader`) shows "Snapshot replaced: 25 rows", with no
  horizontal overflow.
- Console: the only error is the expected 404 on `/schedule` for an unscheduled pipeline, which is unrelated.
- Cleanup:
  - The test user `bf29e413-ac2c-4de9-9832-ae5c87c90b1c` was deleted by exact id and email with `buildUserDeleteSql`
    (0 rows remain).
  - The servers were stopped with stop-servers.sh.

### Overall: PASS

### Non-blocking Suggestions
- The PR body should quote the Cloud Run quotas line (the 32 MiB HTTP/1 limit "applies if not using
  `Transfer-Encoding: chunked` or streaming"). It should say this was not probed (C8) and that HTTP/2 is undocumented.
  This is the AC1 record.
- The PR body should also state the BREAKING `rows` change and the release-time MCP redeploy.
