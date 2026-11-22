## Standing Constraints

- [C1] Never read/cat/grep/source/print/copy any .env file or run env-dumping commands; only scripts may read scripts/concertino/.concertino.env.
- [C2] Quoted heredocs only (<<'EOF').
- [C3] No pkill/pgrep/killall; exact PIDs only; stop servers with stop-servers.sh; delete residue by exact id.
- [C4] jest 3 workers, Playwright 2 workers total, sbt -J-Xmx3g, nice -n 19.
- [C5] Bash timeout 600000; sbt testFull in shards that finish under it; no background run past the tool timeout.
- [C12] Red first with mutations: write the 4.x tests, run full spec files, COMMIT the red output as .txt before implementation code.
- [C13] Scratch/tool output only in the main checkout's .concertino/scratch/HEL-1625/ (TMPDIR exception for hooks/isolation gate).
- [C14] Lane-private DB helio_hel1625 for servers, hooks and every DB-touching test; backend started with ANTHROPIC_API_KEY empty.
- [C15] Goldens are never regenerated; /analyze behaviour and existing analyze specs are unchanged.

### Backend

## 1. Backend batch read

- [x] 1.1 Extract the steps/warnings projection from `PipelineAnalyzeReads.analyze` (design D3); existing analyze specs pass unmodified
- [x] 1.2 Add the resolver overload of `UpsertTargetAnalysis.problems` and make the repo variant delegate; unit-verified by existing upsert specs
- [x] 1.3 Add `DataSourceRepository.findByIdsOwned` / `findByIdsInternal` with filters copied from the single reads (D4)
- [x] 1.4 Add the batch service method (D4-D6: owner assert, per-pipeline recover + WARN) and `PipelineContextAnalyzeProtocol`
- [x] 1.5 Add `PipelineContextAnalyzeRoutes`, mounted before `PipelineRoutes` beside context-details; verified by 4.1
- [x] 1.6 Add `schemas/pipelines/pipeline-context-analyze-response.schema.json` ($ref analyze step/warning defs); verified by 4.1/4.5

### helio-mcp

## 2. MCP client

- [x] 2.1 `types.ts` response type + `HelioApi.getPipelineContextAnalyze()`; helioApi test for path
- [x] 2.2 `fetchContextAnalyze` + single step/warning mapping fed by batch item or analyze body (D7); goldens unchanged
- [x] 2.3 Fixture: `pipelineCount` param, fixed-placement option, `contextAnalyze` modes (serve/404/500/missing-one/malformed) built from the fake `/analyze` bodies (D8/D9)
- [x] 2.4 Update context.ts header, README "Context serializer" budget text (8 + 2 + Op + D + A) and the live probe

### Tests

## 4. Tests (written and committed red before groups 1-2, per C12)

- [x] 4.1 `PipelineContextAnalyzeRoutesSpec` (TwoUserRlsApiFixture, non-BYPASSRLS): item set/order = `/api/pipelines`, zero-step, 401, body validates against schema
- [x] 4.2 Parity: every item's steps/warnings deep-equal `/analyze` on a rich fixture (multi-root, branch, disabled, invalid config, join/lookup secondary, upsert target missing/foreign/non-dataset, warnings); mutation-red recorded
- [x] 4.3b Guard (passes pre-change, write before 1.1): A's shared pipeline has an `upsertsource` step targeting an A-owned dataset; B (editor) and C (viewer) `/analyze` show no `validationError` on it; record the mutation (upsert resolver wired to caller) that turns it red
- [x] 4.3 Isolation: owner A + editor B + viewer C; no A id/step id in B/C; B/C items equal their own analyze; `/analyze` for B/C on A's pipeline unchanged
- [x] 4.4 Statement count: CountingDataSource, 10 vs 200 pipelines equal; fault-isolation item omission
- [x] 4.5 MCP: request budget constant in P (55 vs 200, same Op/D/A), 200-pipeline < 120, fallback counts, golden equality in every mode, per-mode stderr exactly as design D7 lists, seam schema test
- [x] 4.6 Live probe against the lane backend with 200 seeded pipelines; measurements.md records requests, statements, wall time, body bytes
