## 1. MCP: types

- [x] 1.1 Add to `helio-mcp/src/types.ts`: `PipelineProposalSource { sourceId?: string; type?: "csv" |
      "rest_api" | "sql" | "static"; name?: string; config?: Record<string, unknown> }`,
      `PipelineProposal { pipelineName: string; source: PipelineProposalSource; outputDataTypeName:
      string; steps: Array<{ type: string; config: unknown }> }` — mirrors the wire shape exactly
      (design.md D1: one `config` key, not four).
- [x] 1.2 Add `PipelineAnalyzeProposalResponse { sourceName: string; outputDataTypeName: string;
      sourceSchema: SchemaField[]; steps: PipelineAnalyzeResponse["steps"] }` — reuse the existing
      per-step shape (design.md D5), do not redeclare it.
- [x] 1.3 Add `PipelineProposalApplyResponse { source?: DataSourceResponse; pipeline:
      PipelineSummaryResponse; outputDataTypeId: string; run: RunResultResponse }`.

## 2. MCP: client methods

- [x] 2.1 In `helio-mcp/src/helioApi.ts`, add `analyzePipelineProposal(proposal: PipelineProposal):
      Promise<PipelineAnalyzeProposalResponse>` — `POST /api/pipelines/analyze-proposal`, thin
      pass-through (mirrors `analyzePipeline`'s existing style).
- [x] 2.2 Add `applyPipelineProposal(proposal: PipelineProposal): Promise<PipelineProposalApplyResponse>`
      — `POST /api/pipelines/apply-proposal`, thin pass-through (mirrors `applyProposal`'s existing
      style).
- [x] 2.3 `propose_pipeline` needs no new client method beyond `listDataSources` (already exists) for
      its D4 sourceId-existence warning check.

## 3. MCP: shared step schema export

- [x] 3.1 In `helio-mcp/src/tools/write.ts`, hoist `const boundPipelineStepSchema = z.object({ type:
      z.string().min(1), config: z.record(z.unknown()).default({}) })` (currently declared inside
      `registerWriteTools`'s function body, ~line 535) out to module top-level scope, declared as
      `export const boundPipelineStepSchema = ...` (design.md D3 — round-1 skeptic correction: `export`
      is not legal on a function-local `const`, so this requires an actual relocation, not just adding
      a keyword in place). The declaration closes over nothing (no reference to `server`/`api`/any other
      local), so this is behavior-preserving — `create_bound_panel`, which already references this
      binding by name inside the same function, continues to resolve it exactly as before via normal
      module-scope lookup. Reused verbatim by the new proposal tools' `steps` field instead of a
      second, drift-prone copy.

## 4. MCP: pure validation helper

- [x] 4.1 Create `helio-mcp/src/tools/pipelineProposalValidation.ts` exporting
      `computePipelineProposalWarnings(source: PipelineProposalSource, sourceIds: Set<string>):
      string[]` — pure, no I/O, mirrors `proposalValidation.ts`'s split (TS2589 avoidance, design.md
      D4). Implements, in order: (a) both `sourceId` and `type` set → warn; (b) neither set → warn;
      (c) `type` set, `name` blank/absent → warn; (d) `type` set, matching `config` absent → warn; (e)
      `sourceId` set and not in `sourceIds` → warn.

## 5. MCP: handler logic (TS2589-safe, zod-free)

- [x] 5.1 Create `helio-mcp/src/tools/pipelineProposalHandlers.ts` (design.md D4b — round-1 skeptic
      finding: this file must import NEITHER zod NOR `@modelcontextprotocol/sdk`'s `McpServer`, so a
      test can import it without pulling in the TS2589-triggering combination `pipelineProposal.ts`
      will have). Exports three plain async functions, each taking `api: HelioApi` plus plain
      TS-typed arguments (no zod types):
      - `proposePipelineHandler(api, input: { pipelineName, source: PipelineProposalSource,
        outputDataTypeName, steps })`: assembles the typed `PipelineProposal`, calls
        `api.listDataSources()` once, computes `warnings` via `computePipelineProposalWarnings`,
        returns `{ proposal, warnings, applyReady: warnings.length === 0 }`.
      - `analyzePipelineProposalHandler(api, proposal: PipelineProposal)`: returns
        `api.analyzePipelineProposal(proposal)`.
      - `applyPipelineProposalHandler(api, proposal: PipelineProposal)`: returns
        `api.applyPipelineProposal(proposal)` — no pre-validation, no retry (design.md D6).

## 6. MCP: tool registration (thin shell)

- [x] 6.1 Create `helio-mcp/src/tools/pipelineProposal.ts` exporting `registerPipelineProposalTools
      (server, api)`, following `proposal.ts`'s `jsonResult`/`guarded` pattern verbatim (duplicate the
      two small helpers locally, matching how `write.ts` already duplicates them rather than sharing —
      existing convention, not a new one). Imports `boundPipelineStepSchema` from `write.ts` (task
      3.1) and the three handlers from `pipelineProposalHandlers.ts` (task 5.1) — this file itself
      contains no business logic, only zod `inputSchema` declarations and `guarded(() =>
      xHandler(api, ...))` one-liners.
- [x] 6.2 Register `propose_pipeline`: zod `inputSchema` mirrors `PipelineProposal`'s wire shape
      (`source` per design.md D1, `steps` reusing the imported `boundPipelineStepSchema`). Handler:
      `guarded(() => proposePipelineHandler(api, { pipelineName, source, outputDataTypeName, steps }))`.
      Tool description documents the canonical Source → Pipeline → DataType → Panel path, the
      read-only SQL rule, and (design.md D2) that inline `csv` is accepted here but rejected by
      `apply_pipeline_proposal`.
- [x] 6.3 Register `analyze_pipeline_proposal`: same `inputSchema` as `propose_pipeline` (the proposal
      shape, not the `{proposal,warnings,applyReady}` envelope — takes the same arguments
      `propose_pipeline` returns under `.proposal`, mirroring `apply_proposal`'s existing
      argument-compatibility with `propose_dashboard`'s output). Handler: `guarded(() =>
      analyzePipelineProposalHandler(api, proposal))`.
- [x] 6.4 Register `apply_pipeline_proposal`: same `inputSchema` as the above two. Handler: `guarded(()
      => applyPipelineProposalHandler(api, proposal))`.
- [x] 6.5 Register `registerPipelineProposalTools(server, api)` in `helio-mcp/src/index.ts`, alongside
      the existing `registerProposalTools`/`registerWriteTools` calls.

## 7. Tests

- [x] 7.1 Create `helio-mcp/src/tools/pipelineProposalValidation.test.ts` (imports ONLY from
      `pipelineProposalValidation.ts`, per design.md D4's TS2589 avoidance — mirrors
      `proposal.test.ts`'s own documented import discipline): unit tests for
      `computePipelineProposalWarnings` covering all five warning cases from task 4.1, plus the
      no-warning valid-sourceId and valid-inline cases.
- [x] 7.2 Create `helio-mcp/src/tools/pipelineProposalHandlers.test.ts` (imports ONLY from
      `pipelineProposalHandlers.ts`, per design.md D4b — never `pipelineProposal.ts`): a call-routing
      test per handler, using a minimal hand-rolled `HelioApi`-shaped mock (mirrors this ticket's own
      only available precedent for mocking a dependency — no existing tool-handler test to mirror, per
      round-1 skeptic finding 2): `analyzePipelineProposalHandler` calls `api.analyzePipelineProposal`
      with the given proposal and returns its result; `applyPipelineProposalHandler` calls
      `api.applyPipelineProposal` and returns its result; `proposePipelineHandler` calls
      `api.listDataSources` and returns `applyReady: false` with a warning when the mock rejects (via
      `computePipelineProposalWarnings`'s existing logic, not re-implemented here). A rejected mock
      call (thrown `HelioApiError`) propagates as a rejected promise from each handler — `guarded`'s
      `isError: true`/message-formatting behavior itself is `proposal.ts`/`write.ts`'s existing,
      already-covered-by-convention logic and is NOT re-tested here (these tests stop at the handler
      boundary, consistent with the handlers containing no zod/registerTool surface to exercise).
- [x] 7.3 Add a zod-schema-shape assertion test in `pipelineProposal.test.ts` (this one file MAY import
      `pipelineProposal.ts` directly since it only needs the exported zod schemas, not a live
      `McpServer` — if this still trips TS2589 in practice, fall back to asserting shape via the same
      zod schema object re-exported for testing, noting the deviation in the PR) confirming the tool's
      `inputSchema` accepts a minimal existing-sourceId proposal and a minimal inline-static proposal,
      and rejects a proposal missing `pipelineName`/`outputDataTypeName`. **DEVIATION (per this task's
      own documented fallback + 7.5): a first attempt at this file, importing `pipelineProposal.ts`
      directly, DID trip TS2589 in practice** (`jest --testPathPatterns=pipelineProposal` confirmed:
      `helio-mcp/src/tools/pipelineProposal.ts:80:3 - error TS2589: Type instantiation is excessively
      deep and possibly infinite`, cascading into further `TS2322`/`TS7031` errors on every
      `registerTool` call in that file) — the exact TS2589-triggering combination design.md D4b
      predicted (zod object type + `server.registerTool(...)` in the same compiled module). Removed
      per 7.5's explicit instruction; the schema-shape-only export
      (`pipelineProposalInputSchema`/`pipelineProposalSourceSchema`) was reverted from `pipelineProposal.ts`
      since nothing consumes it anymore. 7.1/7.2's required coverage (warnings + call-routing) is
      unaffected and green.
- [x] 7.4 Run `npm --prefix helio-mcp run build` (tsc) and `npm --prefix helio-mcp run typecheck` —
      both clean.
- [x] 7.5 Run `npm test` (root — covers `helio-mcp/src/tools/*.test.ts` via the root Jest config) and
      confirm the full suite, including the new tests, is green. If task 7.3 does in practice hit
      TS2589, remove it and note the removal explicitly (schema-shape coverage is a nice-to-have on top
      of 7.1/7.2's required coverage, not a substitute for either).
