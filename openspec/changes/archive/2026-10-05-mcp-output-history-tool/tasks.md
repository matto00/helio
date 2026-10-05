## Standing Constraints

## 1. Backend / Schemas

### Backend
- [x] 1.1 No backend code change. Confirm `git diff main -- backend/` is empty at the end.
- [x] 1.2 Add the `compare` property (description + pattern copied verbatim from `schemas/outputs/create-output-request.schema.json`) to `schemas/pipelines/create-pipeline-transactional-output-request.schema.json` `config`; verify `npm run check:schemas` passes.

## 2. helio-mcp implementation

### Frontend
- [x] 2.1 Add `OutputHistoryResponse` + point/sparkline/resolved types to `helio-mcp/src/types.ts` mirroring `schemas/outputs/output-history-response.schema.json`; verify `npm run check:helio-mcp-types`.
- [x] 2.2 Add `HelioApi.getOutputHistory(outputId, {limit?, since?})` (one GET, params only when defined); verify via the helioApi test in 4.1.
- [x] 2.3 Add `getOutputHistoryHandler` (pass-through; drops `points[].summary` unless `includeSummaries === true`) to `outputsHandlers.ts`; verify via 4.2.
- [x] 2.4 Register `get_output_history` in `outputs.ts` with the design D3 schema and D4 description (no "previous run" phrase); verify via 4.3.
- [x] 2.5 Add exported `COMPARE_CONFIG_DOC` and append it to the `add_output`, `update_output` (replace-not-merge, null clears), `create_pipeline` and `propose_pipeline` descriptions; `place_outputs` untouched; verify via 4.3.
- [x] 2.6 Add `buildAddMetricOutputCall` + `buildGetOutputHistoryCall` to `scripts/verifyPayloads.ts` and wire them into `scripts/verify.ts` (30 real runs, bounded 429 wait, one history call, assert 30 numeric values); verify via 4.4 + 4.5.
- [x] 2.7 Update `helio-mcp/README.md` tool list/notes for `get_output_history` and `compare`; verify by reading the rendered section.
- [x] 2.8 Add a `get_output_history` row (and a `compare` note) to the tool-mapping table in `docs/agent-native.md` (~line 154, next to `get_output_provenance`); verify by grep.

## 3. Constraints check
- [x] 3.1 Confirm `package.json`/`package-lock.json` (root and helio-mcp) and `.github/workflows/ci.yml` are unchanged, with no migration file added (`git diff --stat main`).

## 4. Tests

### Tests
- [x] 4.1 helioApi test: `getOutputHistory` URL with/without `limit`/`since` (injected-fetch harness as in `hel865ConciseModes.test.ts`).
- [x] 4.2 Handler unit test in `outputsHandlers.test.ts`: pass-through, summary trimmed by default, kept with `includeSummaries`, other fields identical, errors propagate.
- [x] 4.3 `server.test.ts`: add `get_output_history` to `EXPECTED_TOOL_NAMES`; assert its description mentions null for non-metric and thinning and lacks "previous run"; assert compare is documented on the four write tools and absent from `place_outputs`.
- [x] 4.4 `verifyPayloads.test.ts`: drift guard covers both new builders (stub API gains `getOutputHistory`).
- [x] 4.5 Live: fresh `npm run build` in worktree `helio-mcp`, then `npm run verify` against the worktree backend (port 9613, purge interval raised); capture the 30-value output, the exact backend env, and the history point count observed immediately before the read to evidence.
- [x] 4.6 Full helio-mcp test suite + pre-commit gates pass.
