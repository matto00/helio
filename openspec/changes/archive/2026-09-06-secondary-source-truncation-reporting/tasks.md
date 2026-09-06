## 1. Backend

- [x] 1.1 Sharpen the `truncatedReads` scaladoc on `RunResultResponse` (`PipelineProtocol.scala`) to state that the vector includes the primary source when the primary was truncated, and is empty when nothing was truncated.
- [x] 1.2 Confirm by reading `PipelineRunService.truncationFields` that no production-code change is needed; record that confirmation in the commit body rather than changing behaviour.

## 2. MCP client

- [x] 2.1 Declare `truncatedReads?: { dataSourceName: string; rowsRead: number; availableRowCount?: number }[]` on `RunResultResponse` in `helio-mcp/src/types.ts`, with a doc comment naming its scope.
- [x] 2.2 Add an exported `TruncatedRead` interface to `helio-mcp/src/helioApi.ts` for the `RunOutcome` shape.
- [x] 2.3 Rename `RunOutcome.availableRowCount` → `primaryAvailableRowCount` and `RunOutcome.sourceRowCount` → `primarySourceRowCount`; add required `truncatedReads: TruncatedRead[]`; update `RunOutcome`'s doc comment to state that `truncated` is run-wide and the scalars are primary-only.
- [x] 2.4 Map the new fields in `helioApi.ts` `runPipeline`, defaulting `truncatedReads` to `[]` (never `undefined`).
- [x] 2.5 Update every in-repo reader of the renamed fields. Evidence: `npm run check:helio-mcp-types` clean (gate selection does NOT cover `helio-mcp/**` — see 3.6 — so this command must be run and its output recorded explicitly).
- [x] 2.6 Rewrite `run_pipeline`'s tool description in `helio-mcp/src/tools/write.ts`: list the returned fields, state that `truncated` is run-wide, that `primarySourceRowCount`/`primaryAvailableRowCount` describe the primary source only, and that `truncatedReads` names each truncated source — **primary included, so a one-entry array is not necessarily a secondary** — with its rows read and available total.

## 3. Tests

- [x] 3.1 Add (do NOT replace) a `PipelineRunServiceSpec` case: primary under cap, `lookup` secondary over cap, seeded via the existing `seedRestDsNamed` with DISTINCT names (`seedRestDs` hardcodes `"ds-rest"`, and `truncationFields` dedupes by name, which would make "names the secondary" vacuous). Assert `sourceTruncated`, `sourceRowCount`, `sourceAvailableRowCount`, and the secondary entry's `dataSourceName`, `rowsRead` and `availableRowCount` as literals.
- [x] 3.2 In 3.1, assert the secondary entry's `availableRowCount` strictly exceeds its `rowsRead` — the per-entry proof that rows were lost. Do NOT assert "no equal unqualified pair" here: the proposal's non-goals keep the backend names `sourceRowCount`/`sourceAvailableRowCount`, which are legitimately `100`/`Some(100)` in this case.
- [x] 3.3 Extend `helio-mcp/src/runPipelineTruncation.test.ts` with a secondary-source fixture (primary under cap, secondary over it) asserting the exact emitted `RunOutcome`: `truncated: true`, `primarySourceRowCount`, `primaryAvailableRowCount`, and `truncatedReads` deep-equal to the expected single entry — all as fixture literals.
- [x] 3.4 In 3.3, assert the emitted result carries no field named `availableRowCount` or `sourceRowCount` (the "no unqualified same-scope pair" assertion belongs on this surface, where the rename actually removes it). Also assert `truncatedReads` is `[]` — present, not `undefined` — on the existing complete-run case.
- [x] 3.5 Verify the red arm for 3.1 and 3.3 under the two mutations in design.md D4 — (i) `truncatedReads: []` mapped unconditionally in `runPipeline`; (ii) secondary `TruncatedRead.availableRowCount = None`. For each, record the mutation, the exact failing assertion, that the failure is an assertion failure (not TS2741 / lint / compile), and that no PRE-EXISTING test reddens. Attach the transcript to the change directory.
- [x] 3.6 Run and record the commands the configured gates do NOT select for `helio-mcp/**` (gates match only `frontend/**` and `backend/**`): `npx jest helio-mcp/src/runPipelineTruncation.test.ts` and `npm run check:helio-mcp-types`. Green output from these is required evidence for 2.5, 3.3, 3.4 and 3.5 — gate PASS alone does not cover them.
