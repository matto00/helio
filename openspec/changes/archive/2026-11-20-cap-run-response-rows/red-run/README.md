# Red run (tasks group 0), before any implementation code

Run on `fef01cda9` plus only the new test files (and the hand-written `shared-test-fixtures/pipeline-run/run-capped-response.json`).

- Backend: `sbt -J-Xmx3g "testOnly *PipelineRunResponseCapSpec *PipelineApplyProposalRunCapSpec *CombinedApplyProposalRunCapSpec"`
  -> 10 tests run, 0 succeeded, 10 failed (see `backend.txt`). Failures: rows has 25 entries instead of 10 (run, dry run,
  GET /runs/:runId), `key not found: rowsTruncated` (10-row run, both previews, both apply bodies).
- Frontend: `SpineRunStatus.runCap.test.tsx` does not compile: `runRowCount` missing from `SpineRunState`/`PipelinesState`,
  `rowsTruncated` missing from `RunResult` (TS2353/TS2339), so 0 tests run.
- helio-mcp: `runCapSeam.test.ts` -> 2 failed (both apply tool descriptions lack "at most 10"), 2 passed (the two
  pass-through tests; the handlers already pass the body through, so those two are guards, not reds).
- Mutations (remove cap, flip flag, count from rows.length, drop the field from the RunStatusResponse writer) are
  recorded after implementation in `mutations.md`.
