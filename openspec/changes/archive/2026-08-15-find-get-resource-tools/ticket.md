# HEL-661: find + get_resource tools for narrow workspace search

## Description

`WorkspaceContextService` (723 lines) eagerly assembles and dumps the entire workspace (every
source, DataType with columns/samples/stats, pipeline, dashboard, metric) into one prompt. HEL-659's
assistant needs to fetch only what's relevant to a given turn instead. See
`docs/superpowers/specs/2026-08-14-top-level-assistant-design.md`.

Note: this does NOT replace `WorkspaceContextService` — that continues backing the unchanged MCP
`get_workspace_context` resource for external agents (see HEL-631, which remains independently
valid). This ticket adds new, narrower methods alongside it, reading the same underlying
repositories.

## Scope

* `find(query, resourceTypes?)` — keyword/substring search across dashboards, sources, pipelines,
  DataTypes, metrics. Returns compact summaries (id, type, name, one-line description) for top-K
  matches. No embeddings/vector search for v1 — plain text matching over existing name/description
  fields.
* `get_resource(id, type)` — fetch full detail for one specific resource (pipeline steps, DataType
  columns/sample rows/stats, dashboard panels, metric definition), reusing the relevant
  per-resource assembly logic already in `WorkspaceContextService` rather than duplicating it.
* Both exposed as Claude tool schemas for HEL-659's tool-use loop (depends on the tool-use loop
  primitive ticket, HEL-660, merged).

## Acceptance Criteria

- [ ] `find` returns relevant compact summaries for a query matching an existing resource's
      name/description, and an empty result set when nothing matches (no exceptions, no
      hallucinated ids).
- [ ] `get_resource` returns the same level of per-resource detail `WorkspaceContextService` would
      include for that resource today, for each resource type (source, DataType, pipeline,
      dashboard, metric).
- [ ] `WorkspaceContextService`'s existing behavior and tests are unaffected — this is additive.

## Context / Notes

- Parent epic: HEL-659 (Top-Level Workspace Assistant). Second of 8 child tickets; delivery order
  660 (merged) → 661 (this ticket) → 662 → 663 → 664 → 665 → 666 → 667.
- Canonical reference: `docs/superpowers/specs/2026-08-14-top-level-assistant-design.md` —
  "Architecture" section describes `find`/`get_resource` as reading the same underlying
  repositories `WorkspaceContextService` already reads, returning compact summaries from `find`
  and full per-resource detail only from `get_resource`. "Tool surface & system prompt" section
  gives the exact tool signatures: `find(query, resourceTypes?)`, `get_resource(id, type)`.
- Depends on HEL-660 (`ClaudeClient.sendWithTools`, merged via PR #338) for the `ClaudeTool` schema
  shape these tools will be exposed as — this ticket defines the tool schemas + backing service
  methods; wiring them into the actual `sendWithTools` loop is HEL-662 (`AssistantService`).
- Explicitly out of scope per the design spec's Non-goals: semantic/embedding search (keyword/
  substring only for v1).
