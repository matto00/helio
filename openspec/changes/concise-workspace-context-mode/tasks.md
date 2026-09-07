## 1. Implementation

### Backend

- [x] 1.1 No backend change. The analyze concise endpoint already exists (HEL-914,
      `PipelineRoutes.scala:47-60`) and no persisted state is added, so no migration is authored.

### MCP — analyze passthrough

- [x] 2.1 Add an optional `concise` boolean to `analyzePipeline` in `helio-mcp/src/helioApi.ts:290-292`,
      forwarded as a query param, following `runPipeline`'s existing `{ dry: "true" }` pattern at `:622-626`.
- [x] 2.2 Add the concise response type. Note the top-level shape DIFFERS: the endpoint returns
      `{ nodes: ConciseAnalyzeNode[] }` where each node is `{path, op, validationError?}`, whereas the full
      response is `{id, name, sourceSchemas, steps}`. `analyzePipeline`'s return type therefore becomes
      mode-dependent (overload or union), not merely a widened parameter. `validationError` is optional — the
      endpoint omits it rather than sending null.
- [x] 2.2a The existing call site `context.ts:477` calls `api.analyzePipeline(summary.id)` and consumes
      `analyzed.steps`; it MUST keep compiling and behaving identically (it requests the full mode).
- [x] 2.3 Add `concise` to the `analyze_pipeline` tool input schema (`helio-mcp/src/tools/read.ts:159-171`) and
      forward it in the handler.

### MCP — concise workspace context

- [x] 3.1 Extend the truncation shape in `helio-mcp/src/context.ts` with an omitted-detail enumeration that is
      always present and defaults to empty, never `undefined` (HEL-890 convention, `helioApi.ts:104-137`).
- [x] 3.2 Add a concise projection that replaces each per-step projected column list with its element count and
      each data-source `inferredSchema` with its field count, retaining every entity.
- [x] 3.3 Retain each Output's `schema` in full in concise mode (design D2 — it is the field-mapping grounding
      source; omitting it would make the tool a trap).
- [x] 3.4 Set `truncation.applied` genuinely `true` when concise omits anything, replacing the hardcoded
      `false` at `context.ts:241` and `:290`; a full response keeps `applied: false` with an empty enumeration.
- [x] 3.5 Thread a `concise` option through `buildWorkspaceContext` (`context.ts:445-448`), defaulting to the
      existing full behaviour, so the default response is identical to the explicit full-mode response.
- [x] 3.6 Add `concise` to the `get_workspace_context` tool input schema (currently `read.ts:270`
      `inputSchema: {}`) and forward it.

### MCP — descriptions

- [x] 4.1 State size behaviour and the concise omission rule in both tools' descriptions (`read.ts`), so an
      agent can predict which mode it needs. Name the fallback explicitly: per-step columns omitted by concise
      mode remain obtainable per-pipeline via `analyze_pipeline` (`read.ts:163-166`), which turns the omission
      into a documented redirect rather than a dead end.

### Contract

- [x] 5.1 **No `schemas/` change is warranted for the workspace-context half, and this is deliberate.** The
      only workspace-context schema is `schemas/workspace/workspace-context.schema.json`, whose own title
      scopes it to `GET /api/workspace/context` — the backend route D6 proves this change never touches. The
      MCP snapshot is assembled client-side and is not a REST response, so it has no schema file to update.
      `schemas/workspace/workspace-context.schema.json` MUST remain byte-unchanged; verify with `git diff`.
- [x] 5.2 No `schemas/` change is needed for the analyze half either: the endpoint is unchanged and
      `schemas/pipelines/pipeline-analyze-concise-response.schema.json` already describes its concise response.
- [x] 5.3 Do NOT fix `schemas/workspace/workspace-context.schema.json`'s pre-existing staleness (it still
      `require`s `dataTypes` and `joinHints`, retired by HEL-904/907). Out of scope for a LOW ticket; leave it.

### Tests

- [x] 6.1 Promote the probe fixture (`helio-mcp/src/hel865Fidelity.probe.test.ts`) into a permanent
      realistic-fidelity 25/43 fixture: ~60 columns per source, ~7 steps per pipeline, populated `laneTree`,
      Output schemas and placements, and 36-char UUID ids.
- [x] 6.2 Assert the red arm: the FULL response on that fixture exceeds the budget. This converts, and must not
      silently delete, the existing under-budget assertion at `context.test.ts:559`. Its sibling assertion at
      `:558` (`structuralFloorExceedsBudget` is `false`) must flip to `true` in the same edit — converting one
      without the other leaves a misleading or failing assertion.
- [x] 6.3 Assert concise mode on the same fixture is under budget — both directions proven on one fixture.
- [x] 6.4 Assert concise retains all 25 sources and all 43 pipelines (breadth preserved, design D2).
- [x] 6.5 Assert content, not just size: a step whose full entry lists N columns carries a count of N and no
      column list, and every Output `schema` survives concise mode intact.
- [x] 6.6 Assert the default response with `concise` absent is identical to the explicit full-mode response.
      (Not identity with the pre-change output — it additively gains `omittedDetailKinds: []`; see D3/D4.)
- [x] 6.7 Assert `truncation.applied` is true with a populated omission enumeration in concise mode, and false
      with an empty (present, not `undefined`) enumeration in full mode.
- [x] 6.8 Assert `analyze_pipeline` forwards `concise` as a query param, and omits it when not requested.
- [x] 6.9 Confirm the existing `context.test.ts` fixture's `laneTree` gap is understood: its fake API lacks
      `getPipeline`, so `context.ts:501-522` swallows the failure — the new fixture must populate it.
- [x] 6.10 Run `npm test -- --testPathPatterns=context`, `npm test -- --testPathPatterns=hel865`, and
      `npm run check:helio-mcp-types` from the worktree root; record the output. NOTE: this repo's Jest
      replaced `--testPathPattern` with `--testPathPatterns` (plural) — the singular form exits reporting
      `Tests: 0 total`, which reads as green while running nothing.
- [x] 6.11 Confirm the concise arm's measured size is recorded in the test, not just asserted under budget, so
      future work can see the headroom (design D8).
