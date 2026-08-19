## Why

The top-level assistant proposes REST/SQL data sources with zero connection verification. A
live example: it proposed a pipeline against a hostname that doesn't resolve in DNS at all, and
the user only found out after accepting the proposal. A complete `Connector[Config].testConnection`
capability already exists server-side and is wired only to the pre-creation HTTP test route — the
assistant's tool loop never calls it.

## What Changes

- Add a `test_connection` tool to the assistant's bounded tool set (`AssistantProtocol.assistantTools`),
  dispatching to the existing `SourceService.testSql`/`testRest` (backed by `Connector.testConnection`
  / `ConnectionTest.run`) for an inline `rest_api`/`sql` config.
- `AssistantToolExecutor` structurally requires a matching, successful `test_connection` call before a
  `propose_pipeline`/`propose_combined` call finalizes for any inline (non-`sourceId`) `rest_api`/`sql`
  source — an untested or since-changed config is rejected back to Claude as a tool error (self-correct
  within the hop budget), mirroring the "Hard Boundary" structural-enforcement style this class already
  uses for the no-apply-tool guarantee. A `sourceId` (existing, already-tested) source is unaffected.
- Raise `AssistantService.MaxHops` from 3 to 4 — verifying a config now costs a dedicated hop ahead of
  the `propose_*` call that uses it, and 3 no longer leaves enough headroom for a `find` + verify +
  propose sequence, the assistant's most common data-creation flow.
- Update `AssistantSystemPrompt` to describe the new tool and instruct calling it, in its own hop,
  before finalizing a `propose_pipeline`/`propose_combined` call for an inline REST/SQL source.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `assistant-conversation-loop`: the tool set grows from 6 to 7 tools; a new requirement gates
  `propose_pipeline`/`propose_combined` finalization for an inline REST/SQL source on a prior
  successful `test_connection` call against the identical config; the hop cap changes from 3 to 4.

## Impact

Backend only: `AssistantProtocol.scala`, `AssistantProposalToolSchemas.scala`,
`AssistantToolExecutor.scala`, `AssistantService.scala`, `AssistantSystemPrompt.scala`, and their
existing test files. `ApiRoutes.scala`'s `AssistantService` construction gains a `sourceService`
argument (already constructed there for other services). No schema/migration/route changes — no new
HTTP surface, no DB changes. No frontend changes: the assistant's tool loop is entirely backend-side.

## Non-goals

Does not address the assistant's judgment about what a genuinely correct endpoint even is (sibling
ticket, real external research capability) — only that a proposed inline REST/SQL source is
mechanically verified reachable before being finalized.
