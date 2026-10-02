## 1. Backend reporting

- [x] 1.1 Red tests first: `rejectIfReparents=true` => 422 naming moved ids, nothing written, for parentStepId anchor, rootId anchor and no-anchor trunk-last-with-tails, and attachAsTail:true without parentStepId on that same shape; flag absent => unchanged splice; attachAsTail never rejected; create response `reparentedStepIds` populated on splice, `[]` on tail attach/childless; GET/PATCH/duplicate responses do not carry the field (protocol round-trip test).
- [x] 1.2 `spliceInsertAtInternal` returns moved ids and supports abort-before-write; new `addStepReporting` service method wrapped by `addStep`; thread through the five call sites (duplicateStep discards); create route merges `reparentedStepIds` into the create response only; `CreatePipelineStepRequest` + request schema (`create-pipeline-step-request.schema.json`) updated.

## 2. MCP add_pipeline_step

- [x] 2.1 Red tests: omitted attachAsTail sends `rejectIfReparents:true` and surfaces the 422 (anchor with children, rootId, no-anchor); true => sibling, no parent changes; false => splice and `reparentedStepIds` surfaced; attachAsTail:true without parentStepId (rootId and no-anchor) errors before any request; childless anchor unchanged; invalid anchor still fails loudly; `add_outputs_from_shape` with a childed `stepId` sends attachAsTail:true on the first step and re-parents nothing, absent stepId sends the guard.
- [x] 2.2 Implement `attachAsTail` input, handler pre-read guard, rootId handling, tool description + `helio-mcp/README.md` + `docs/agent-native.md`.

- [x] 2.3 `add_outputs_from_shape` with a childless `stepId` also sends `rejectIfReparents:true` (free race protection).

## 3. MCP run_pipeline step counts

- [x] 3.1 Red tests: `runId`, `stepRowCounts`, `warnings[]` (zero-row join from non-empty input incl. lane input; healthy run empty; disabled parent walks to counted ancestor; non-primary-root root-level step skipped; malformed config skipped; empty stepRowCounts => `stepCountsAvailable:false` with no warnings key).
- [x] 3.2 Implement in `helioApi.runPipeline`/`RunOutcome`/handler + tool description + types.

## 4. Follow-ups

- [x] 4.0 File follow-up tickets (origin_kind: followup, origin_ticket: HEL-1069, relatedTo, Follow-up label): analyze_pipeline warnings (missing referenced field / join key type mismatch / output column collision); join `leftRow ++ rightRow` silent column overwrite.

## 5. Verification

- [x] 5.1 Local end-to-end through helio-mcp handlers against a local backend: probe scenarios A/B/D/E now error loudly, C/F succeed, G yields a warning. Record every created id; delete exact ids only.
- [x] 5.2 `cd backend && nice -n 19 sbt testFull`; helio-mcp tests/typecheck; lint/format; `openspec validate`.
