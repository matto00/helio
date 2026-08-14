## ADDED Requirements

### Requirement: propose_patch_set SHALL assemble and return a patch set without writing anything
The MCP `propose_patch_set` tool SHALL call `POST /api/refinements` and return its `PatchSet` verbatim
as the tool result, and SHALL NOT itself call any write endpoint.

#### Scenario: propose_patch_set returns a patch set for review
- **WHEN** an agent calls `propose_patch_set` with a target dashboard/pipeline id and a message
- **THEN** the tool returns the resulting `PatchSet` as JSON, and no resource referenced by it has
  been modified

### Requirement: apply_patch_set SHALL post to the existing patch-set apply endpoint, not raw PATCH calls
The MCP `apply_patch_set` tool SHALL call `POST /api/patch-sets/apply` (HEL-406) with the supplied
patch set, and SHALL NOT decompose it into individual per-resource PATCH tool calls.

#### Scenario: apply_patch_set applies an accepted patch set atomically
- **WHEN** an agent calls `apply_patch_set` with a `PatchSet` (e.g. one returned by `propose_patch_set`)
- **THEN** the tool posts that patch set to `POST /api/patch-sets/apply` and returns its
  `PatchSetApplyResponse` verbatim, applying all edits atomically per HEL-406's existing semantics

### Requirement: Tool descriptions SHALL be consistent with the existing MCP proposal tools' prose
`propose_patch_set`/`apply_patch_set`'s descriptions SHALL follow the same tone and structure as
`propose_dashboard`/`apply_proposal` (`helio-mcp/src/tools/proposal.ts`) — a read-only assembler
paired with a write-path wrapper.

#### Scenario: Tool descriptions name what they write and don't write
- **WHEN** an agent inspects the MCP tool list
- **THEN** `propose_patch_set`'s description states it writes nothing, and `apply_patch_set`'s
  description states which existing endpoint it posts to
