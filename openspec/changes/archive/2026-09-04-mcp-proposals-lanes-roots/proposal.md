## Why

HEL-911/912/913 built the multi-root, multi-lane pipeline graph in the engine, the editor, and the
`POST /api/pipelines` create path. The **agent-facing** half of that graph was deliberately left behind:
`PipelineProposal` still carries a singular `source`, so an agent cannot propose a branching, multi-root
pipeline at all; patch sets have no add/remove-lane or add/remove-root inverse; `analyze_pipeline` returns a
full per-node projection with no concise mode, so a 12-node graph does not fit an agent's result budget; and
`get_workspace_context` lists a pipeline's roots but not its lane shape. HEL-913's planning drafted two spec
deltas for the proposal contract and then correctly declined to merge them, because nothing implemented them —
a permanently-false merged SHALL. Those deltas were reassigned here, so this change is what makes them true.

## What Changes

- **BREAKING** `PipelineProposal` carries a non-empty `roots` array in place of the singular `source`. The
  singular field is removed outright — not accepted as an alias, matching the "no deprecation" ruling
  `POST /api/pipelines` already shipped under. `schemas/pipelines/pipeline-proposal.schema.json`, the backend
  protocol, `AssistantProposalToolSchemas`, and `helio-mcp`'s `pipelineProposalValidation.ts` change together,
  as `check:schemas` strict parity requires.
- Applying a proposal resolves and creates **every** root before any step, binds each root-level step to its
  named root via `rootClientId`, and rolls the whole apply back if any root fails to resolve.
- Proposals may express **lanes**: sibling `parentStepId`s and `lane`-kind secondary inputs on
  `join`/`union`/`lookup`, reusing the create path's existing request-scoped `clientId` resolution rather than
  a second mechanism.
- **Grounding** evaluates each proposed Output against the projected schema at its own node, including a
  rejoin node whose schema derives from both incoming lanes.
- **Patch sets** gain add/remove-lane edits with correct inverses; undoing "add lane" removes the lane, its
  Outputs, and those Outputs' placements. This requires extending `EditTarget` with a parent id — the gap that
  blocked a `create` op on every child resource, which HEL-904 and HEL-907 each met and each deferred. Patch-set
  **root** ops are deliberately out of scope (product ruling, 2026-09-04): roots already have first-class
  `add_root`/`remove_root` MCP tools and REST routes, so a patch-set path to them is a second route to an
  existing capability, filed as a follow-up.
- `analyze_pipeline` gains a **concise mode** returning per-node `{ path, op, validationError }` using the
  runtime graph path, closing the analyze half of HEL-865.
- `get_workspace_context` adds a **compact lane tree with Outputs per node** per pipeline, inside the
  existing budget/truncation machinery.
- Proposal review pages render lanes by reusing HEL-912's `LaneLayout`.
- `docs/agent-native.md` gains a worked, runnable multi-root example.

## Capabilities

### New Capabilities

- `mcp-pipeline-lane-tools`: lane-kind secondary inputs and sibling lanes expressible through the MCP
  pipeline tools, and the concise `analyze_pipeline` mode with per-node runtime graph paths.
- `patch-set-lane-edits`: adding and removing a lane as a patch-set edit, and the inverse that undoes it.

### Modified Capabilities

- `pipeline-proposal-contract`: the proposal carries `roots[]`, not a singular `source`; the schema-shape
  requirement's required-field list changes with it.
- `pipeline-proposal-apply`: atomic apply resolves and creates every root before any step; any unresolvable
  root rolls back the whole apply.
- `pipeline-analyze-api`: analyze offers a concise per-node mode addressed by runtime graph path.
- `pipeline-proposal-analyze-api`: the dry-analyze contract for an unapplied proposal projects per
  root and across lanes. A **different route** from `pipeline-analyze-api`, despite the similar name.
- `workspace-context-assembly`: each pipeline entry carries a compact lane tree with Outputs per node.
- `mcp-pipeline-proposal-tools`: the proposal tools accept and validate multi-root, multi-lane proposals.
- `pipeline-proposal-review-ui`: proposal review renders every root and the lane structure.
- `assistant-conversation-loop`: the inline-source connection-test gate applies per root, so a
  verified first root cannot exempt an unverified second.
- `patch-set-contract`: `EditTarget` carries an optional parent id, so a `create` op can name a
  not-yet-existing resource's parent; `pipelineStep` gains `create`.
- `patch-set-apply`: `pipelineStep` leaves the create-rejection list, because the reason it was there
  is the gap this change closes.

## Impact

Backend, for the proposal lift: `PipelineProposalProtocol`, `PipelineProposalService`, `PipelineService`'s
proposal-analyze path, `AssistantToolExecutor`, `PipelineAnalyzeProposalProtocol`, `CombinedProposalProtocol`,
`AssistantProposalToolSchemas`. Backend, for the separate lane-edit patch-set work: `PatchSetProtocol`,
`PatchSetApplyRollback`, `PatchSetUndoInverse`, `PatchSetPreviewProjection`, `RefinementEditShape`. Backend,
for the read surfaces: `WorkspaceContextService`, pipeline analyze. (These are two distinct lists for two
distinct reasons — see design.md D1.) Schemas: `pipeline-proposal.schema.json` and the workspace-context/analyze response schemas.
`helio-mcp`: proposal validation, pipeline tools, tool-name set test. Frontend: proposal review lane rendering.
Docs: `docs/agent-native.md`.

## Non-goals

Templates (HEL-551 / R1), interactive panels, cross-filtering, the multi-root editor (HEL-968), connector root
kinds, the `get_workspace_context` concise mode (HEL-865's other half stays open), and patch-set add/remove-root
edits (follow-up). A `create` op for the `output` kind is likewise not claimed here: the `EditTarget` extension
unblocks it, but nothing in this ticket exercises it, and shipping an untested op would be worse than the
documented absence it replaces.
