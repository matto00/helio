# HEL-865: Concise modes for `analyze_pipeline` and `get_workspace_context`

## Description

Both MCP tools become unusable at exactly the scale where they matter most — a real
workspace rather than a demo one. `get_workspace_context` was reported at 220,197
characters on a workspace of 25 sources / 43 pipelines, against a 200,000-byte budget;
`analyze_pipeline` at 76,339 characters for a 7-step pipeline over a ~60-column source.
`get_workspace_context`'s own description tells agents to call it first to avoid fanning
out — advice that becomes impossible to follow precisely when the workspace is large
enough for the advice to pay off.

Parent epic HEL-857. Delivering this closes the epic alongside HEL-955.

## Premise validation (2026-09-06, measured before planning)

The ticket's own re-scope note (2026-09-04) is **stale in one respect** and the
field-report number was **verified by probe** rather than taken on trust.

1. **The re-scope note claims HEL-914 "shipped the `analyze_pipeline` half." It shipped
   only the REST half.** `PipelineRoutes.scala:52-56` parses `?concise=true` and
   `PipelineAnalyzeProtocol.scala:205-206` defines `ConciseAnalyzeNode {path, op,
   validationError}` — but `grep -rin concise helio-mcp/` returns **zero hits**
   (instrument verified: the same grep for `analyze` hits 10+ files). The MCP tool
   `analyze_pipeline` (`helio-mcp/src/tools/read.ts:159-171`) declares
   `inputSchema: { pipelineId }` only, and `helioApi.ts:290-292` issues
   `GET /api/pipelines/:id/analyze` with no query params. The client was always capable
   of sending them — `runPipeline` at `helioApi.ts:622-626` passes `{ dry: "true" }` —
   the passthrough was simply never wired. **The backend capability is unreachable from
   the surface this ticket names.** The analyze passthrough is therefore folded back in.

2. **The 220,197-character claim is correct, and if anything conservative — but the
   repository currently asserts the opposite.** `context.test.ts:443-560` already holds
   a 25-source/43-pipeline fixture asserting `estimatedSizeBytes < DEFAULT_BUDGET_BYTES`,
   and it passes. A realistic-fidelity probe resolved the contradiction:

   | Case | `estimatedSizeBytes` | Budget | over? |
   |---|---|---|---|
   | Existing thin fixture (replica) | 50,870 | 200,000 | no |
   | Realistic 25/43 fidelity | **465,036** | 200,000 | **yes, 2.3x** |
   | Oversized negative control | 52,471,869 | 200,000 | yes |

   **Explanation (A): the existing fixture is too thin per entity.** It uses 10 columns
   per source (vs ~60), 1 step per pipeline (vs ~7), empty `placements`, 5-6 char ids
   instead of 36-char UUIDs, and — most importantly — **`laneTree` is `[]` for all 43
   pipelines**, because its fake API has no `getPipeline` method and `context.ts:501-522`'s
   try/catch silently swallows the failure. The fixture measures a shape no live
   workspace returns. Explanation (B) (the figure predating HEL-907's slimming) is
   refuted: the post-slimming shape at honest fidelity still lands at 465K.

3. **`get_workspace_context` never caps anything.** `applyBudget` (`context.ts:280-297`)
   measures only; `applied` is hardcoded `false` at both `context.ts:241` and `:290` and
   is never set true anywhere. An over-budget workspace returns the entire payload with
   `structuralFloorExceedsBudget: true`. The overflow is detected and then ignored.

4. **Neither tool's description states its size behaviour**, and
   `get_workspace_context` declares `inputSchema: {}` — no caller-side lever at all, not
   even the `budgetBytes` knob the backend route already accepts.

## Explicitly NOT in scope: HEL-979

HEL-979 concerns `WorkspaceContextService.assemble`'s unbounded
`pipelineService.listSummaries` (`WorkspaceContextService.scala:141`) on the backend
route `GET /api/workspace/context`. **The MCP `get_workspace_context` tool never calls
that endpoint** — it builds its own snapshot client-side by fanning out across ~8 REST
endpoints (`context.ts:16-24`, `read.ts:272`). The two are different code paths.

Nothing in this change improves HEL-979. This change bounds *response size* on the MCP
path; HEL-979 bounds *work performed* on the backend path. **This PR must not be read as
having addressed HEL-979.**

## Acceptance criteria

- [ ] `analyze_pipeline` exposes the already-shipped backend concise mode through MCP: an
      opt-in `concise` parameter on the tool's input schema, forwarded as a query param.
- [ ] `get_workspace_context` has an opt-in concise/bounded mode that brings the
      realistic 25-source/43-pipeline workspace (including populated lane trees) under
      the 200,000-byte budget.
- [ ] Full/verbose output remains the default, matching the precedent HEL-914 set for the analyze half.
      **Deviation from a literal reading of this AC, argued in design.md D3/D4:** the full response is not
      strictly byte-identical — it additively gains one key, `truncation.omittedDetailKinds: []`, because D4
      requires that field always be present rather than `undefined`. Every pre-existing field keeps its
      previous value; nothing existing changes.
- [ ] Whatever concise mode omits is **detectable by the caller**: `truncation.applied`
      becomes genuinely `true`, and what was omitted is enumerated — following the
      HEL-861/HEL-890 convention that these fields are always present and never
      `undefined` (`helioApi.ts:104-137`, `:634-639`).
- [ ] Both tools' descriptions state their size behaviour accurately, so an agent can
      predict which mode it needs.
- [ ] Verified against a realistic-fidelity workspace, not the existing thin fixture —
      with the red arm proven to fire (the full mode exceeds the budget on the same
      fixture where concise fits).
