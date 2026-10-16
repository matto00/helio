## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `604b8879d003f6d2b8a888ebd883d9cebdd280e8`. The diff base was resolved live with `resolve-review-base.sh` (exit 0): `29b39995a741fd34931e1c5b121c8539b2f7fd21`. The spawn-cwd guard printed `READY ambient=/home/matt/Development/helio branch=task/bound-workspace-context-requests/HEL-1619`. Per the orchestrator, the owner's option-B ruling (escalation.answered, events.jsonl line 7, `answer_source: human`) is not reopened here.

### What I verified (with evidence)

**Golden provenance (C1).** I did not rely on the commit narrative. I copied `helio-mcp/{src,scripts}` to `.concertino/scratch/HEL-1619/skeptic/mcp` and replaced `src/context.ts` with `git show 29b39995a:helio-mcp/src/context.ts`, which is main's pre-change code. I deleted the goldens and re-ran `scripts/captureContextGolden.ts`.
- The regenerated files differ from the committed ones only in indentation: 1-space as written by the script, 2-space as Prettier-formatted in the repo.
- An order-preserving compact re-serialization (`json.dumps(..., separators=(',',':'))`) is identical for both files: `full True 64132`, `concise True 62748`.
- The goldens are therefore exactly main's output on this fixture. The test compares `JSON.stringify` on both sides (contextRequestBudget.test.ts:111-118), so key order matters and is checked.

**339 → 84 claim.** I ran `scripts/measureContextRequests.ts` on both code versions.
- Main's `context.ts` (scratch copy): `total 339, peakInFlight 220`. The per-route split is 55 each of analyze, run-history, `/pipelines/:id` and steps, plus 110 panels.
- Head: `serve` gives `total 84, peakInFlight 6`. `404` fallback gives `194, 6`. `missing-one` gives `86, 6`, and the stderr warning fires.
- 84 = 8 fixed + 1 context-details + 55 analyze + 19 placements + 1 export.

**AC1 (within 120/60s, or a stated, measured bound).** Met.
- `contextRequestBudget.test.ts` asserts exactly 84 and ≤120.
- The README (helio-mcp/README.md "Context serializer") states the bound `8 + 1 + P + Op + D`. It honestly says the cost is still O(P) through `analyze`: past roughly 100 pipelines, or with many placed Outputs, one call goes over 120 again.
- That bound was stated, measured and owner-ruled, which is what the AC's "or a stated, measured bound" clause allows.

**AC2 (no default-payload field dropped).** Met. The payload is byte-identical to main's on the batch path, the 404 path and the missing-pipeline path, in both full and concise modes (the golden tests pass). The only payload-adjacent change is skipping `GET /api/outputs/:id/panels` when `panelCount === 0`. I checked that this skip is exact:
- `panelCount` comes from `PanelRepository.countByOutputIdsInternal`.
- The placements come from `findByOutputIdInternal`.
- Both are system-context queries with the same `output_id` filter (PanelRepository.scala:189-209). So `panelCount 0` ⇔ `[]`.
- The live probe saw `panelsReqs: 0` for 24 unplaced Outputs. That confirms the real `/api/outputs` list items carry `panelCount`.

**Tasks C1-C6.**
- **C1:** verified above.
- **C2 (additive backend change):** the diff of `backend/src/main` contains only new code:
  - a new route class mounted before `PipelineRoutes`;
  - one new trait mixed into `JsonProtocols`;
  - new methods `latestRunIdsInternalBatch`, `listAssertionsByRunsInternalBatch`, `latestAssertionsFor` and `contextStepsForOwner`;
  - a widened import.
  No existing method body changed. The schema `schemas/pipelines/pipeline-context-details-response.schema.json` lands in the same change, and `npm run check:schemas` printed "schemas in sync with JsonProtocols (133 checked across 56 protocol files)".
- **C3 (RLS):** `TwoUserRlsApiFixture` creates `helio_app_test NOSUPERUSER NOBYPASSRLS` (lines 89-90, 112). I ran the spec myself with `sbt testOnly com.helio.api.routes.pipelines.PipelineContextDetailsRoutesSpec`: 6/6 passed. The spec covers:
  - user B's body excludes A's pipeline id, step id and assertion message;
  - A still sees its own data, so the absence is not an empty database;
  - user C gets `[]`.
  The ACL-bypassing batch reads only receive ids from the owner-scoped `listSummaries(user, None)`, the same call `GET /api/pipelines` makes (PipelineRoutes.scala:29). The fixture change defaults `pipelineRunRepoFor` to `null`, the prior wiring, so other specs are untouched.
- **C4:** no migration in the diff (`git diff --stat` shows no `db/migration` file), so this is not applicable.
- **C5:** my own scratch writes went only to `.concertino/scratch/HEL-1619/skeptic/`. I ran the backend and live probe against `helio_hel1619` and confirmed it from `/proc/<pid>/environ`: `DATABASE_URL=jdbc:postgresql://localhost:5432/helio_hel1619`. Servers were stopped with `stop-servers.sh`, which printed `STOPPED ports=7051,9958`.
- **C6 (seam guards):**
  - **MCP half:** `contextDetailsSeam.test.ts` validates the fixture body with ajv against the committed schema. It also proves the schema rejects renamed keys at the envelope, item and step levels, and that a mutated body really triggers a full fallback.
  - **Backend half:** the spec validates the real route response against the same schema and shows that two key renames are rejected. The schema uses `additionalProperties: false` at every level, so both halves are pinned to it.
  - **Live probe (D10b), re-run by me on HEAD:** `npx tsx scripts/contextDetailsLiveProbe.ts http://localhost:9958 12` gave `stepsReqs 0, historyReqs 0, summaryReqs 0, panelsReqs 0, contextDetailsReqs 2, stderrWarnings [], payloadEqualsPerPipelineFallback true`, then `PROBE PASS`, then `PAT 9257897f-… revoked and no longer authenticates (HTTP 401)`. The output (PAT id only) is saved at `.concertino/scratch/HEL-1619/skeptic/live-probe.txt`.

**Backend parity.** The `/steps` service path (PipelineService.scala:208-222) and `contextStepsForOwner` both use `PipelineStepResponse.fromDomain` with the same root-id map. The spec checks that `steps` deep-equals `GET /:id/steps` on a branched, multi-root pipeline. It also checks that `latestRunAssertions` equals `run-history[0].assertions`, with a newer dry run carrying two failures, and that the key is omitted for a never-run pipeline.

**MCP gates (re-run on HEAD):**
- Root `npx jest --maxWorkers=2 helio-mcp/src` under nice: 53 suites, 478 tests passed.
- `npm --prefix helio-mcp run typecheck`: exit 0.
- Targeted `eslint --max-warnings=0` on the changed MCP sources and scripts: exit 0.
- `prettier --check` on helio-mcp/src, helio-mcp/scripts and schemas/pipelines: clean.

I did not re-run full `sbt testFull`. The merge since evaluation-1's full run (8156 passed) brought in HEL-1613, which is frontend e2e only. My targeted backend spec run is fresh.

**Limiter.** `requestLimiter.ts` hands a finished slot straight to the next waiter, so the cap is never exceeded. Only leaf `HelioApi` methods are wrapped, so the deduped snapshot await in `contextControls` never holds a slot. Every `api.*` call in `context.ts` and `contextControls.ts` is an async HTTP method; I found no sync method that the Proxy would turn into a Promise. Measured peak in flight is 6 on every path.

**UI.** The diff has no `frontend/**` change, so the design-judgment step does not apply.

### Verdict: CONFIRM

### Non-blocking notes
- Latest-run selection (`startedAt desc`) and assertion-row order have no tie-break, either in the batched reads or in the pre-existing per-pipeline reads. The behavior is the same on both paths. An `id` tie-break plus `ORDER BY` on both, together, would make this deterministic. The evaluator flagged this too.
- The live probe's runs have no `assert` steps, so its live `latestRunAssertions` are all zero-summaries. Non-empty failure parity is proven only in the backend spec, which is sufficient.
- The probe restores `process.stderr.write` only on the success path (evaluator's note, cosmetic).
- `helio-mcp/dist` must be rebuilt by the consumer to get this. The README says so.
