# HEL-581: Assertions MCP/agent surface — proposals + results in context

## Description

The agent builds and refreshes pipelines; it should be able to ADD assertions when authoring and READ assertion outcomes when reasoning about whether a dashboard's data is trustworthy. This ticket adds the MCP/agent surface for the `assert` step (419-A) and per-run results (419-B).

The pipeline step is added via `add_pipeline_step` (see `helio-mcp/src/tools/write.ts`); grounding is `helio-mcp/src/context.ts` (`buildWorkspaceContext`), which already lists each pipeline's steps.

## Scope

* Authoring: ensure the `assert` op is expressible via the MCP `add_pipeline_step` tool — extend its input schema / op enum + description (`helio-mcp/src/tools/write.ts`, `helioApi.ts` as needed) so an agent can add an assert step with the v1 rule set (notNull/unique/range/rowCountMin/rowCountMax/regex, severity warn|error).
* Grounding — results: extend `WorkspaceContext.pipelines[]` (`context.ts`) with a compact `lastRunAssertions` summary (passed/failed-by-severity, failing messages) sourced from the 419-B run-history summary, and update the `get_workspace_context` tool description in `read.ts` so the agent reads data trustworthiness alongside last-run status.
* Types: `helio-mcp/src/types.ts` additions; keep additive.

## Acceptance criteria

- [ ] An agent can add an `assert` step (all six v1 rule kinds, both severities) to a pipeline via the MCP tool; invalid rule shapes are rejected by the Zod schema before the server call.
- [ ] `get_workspace_context` reports each pipeline's latest-run assertion summary (passed/failed by severity + failing messages), absent/empty when the pipeline has no assert step or no runs.
- [ ] Tool descriptions explain assertions as the trustworthiness mechanism for alive dashboards.
- [ ] helio-mcp build + tests pass; additive to existing context consumers.

## Out of scope

* Backend evaluation/persistence (419-B), blocking policy (419-C), in-app UI (419-A editor / 419-D).

## Dependencies

* Blocked by 419-B (HEL-509) for the results summary; the authoring half depends on 419-A (HEL-454, already a transitive dependency of HEL-509). Both merged.
