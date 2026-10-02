## Context

See proposal.md. Premise validated on main 8b0e9e05: `buildOutputConfig.ts:107-117` persists `fieldMapping.content`; `OutputBindingSpec.Markdown` has `Vector.empty` slots (OutputBindingSpec.scala:103); `OutputService.validateFieldMapping` (create :141, merged PATCH :252) and `PipelineService` (mirror, :654-680) reject unknown slot keys; `PanelContent` renders literal `cfg.content` only.

## Goals / Non-Goals

**Goals:** UI never offers/saves what the backend rejects; agent surfaces fail clearly; failable test.
**Non-Goals:** making markdown bindable (owner ruling; HEL-921 `insight`); changing `OutputBindingSpec.Markdown`; any migration.

## Decisions

**D1. Frontend: literal-only Content.** `MarkdownKindFields` renders a plain literal multiline editor (reuse the literal half of `BoundOrLiteralField`'s styling/component, whichever avoids duplication). `OutputEditorSheet` stops deriving mode from `markdownConfig.fieldMapping.content`; `markdownContentState` is literal-only. `buildOutputConfig` markdown returns `{content: literal, fieldMapping: {}}`. The `markdownContentState: BoundOrLiteralState` param type is narrowed to what it actually needs. Alternative (keep toggle, disable field option) rejected: still visible dead UI.

**D2. Legacy persisted rows.** Dev DB query (read-only) `select count(*), count(*) filter (where config->'fieldMapping' ? 'content') from outputs where kind='markdown'` returned total=0, with_content_mapping=0. Because create and PATCH have both rejected this key since HEL-892, no such row can have been written through the API; none need migrating, and none are touched. Defensive behaviour for a hypothetical row: opens literal, next save writes `fieldMapping: {}` (PATCH replaces `fieldMapping` as a whole key; the executor MUST verify with a test that a stored `{content: ...}` is not re-validated into a 400 after the sheet's PATCH). No production access.

**D3. Agent surfaces: reject with a clear message, not schema removal.** Every agent path (MCP `add_output`/`update_output`/`add_outputs_from_shape`, proposal apply, assistant tools, analyze-proposal) funnels `config.fieldMapping` through `OutputBindingSpec.validateFieldMapping` (OutputService + the PipelineService mirror), so each already rejects with 400. The schemas carry `config` as free-form JSON, so there is no `content` slot enumerated to remove. The only defect is the message "Valid slots: " (empty). Change `validateFieldMapping` so a slotless kind says "'markdown' has no fieldMapping slots (its content is the literal `config.content`)". Add one sentence to `helio-mcp/src/tools/outputs.ts` description (table/markdown take no fieldMapping). The executor MUST enumerate each surface (MCP outputs/pipelines/proposal tools, `AssistantProposalToolSchemas`, `DashboardProposalProtocol`, `ProposalPanelSupport`, `PipelineAnalyzeProposalProtocol`) and report, per surface, "already rejected via X" or "fixed", backed by an actual request, not grep alone. If any surface is found that does NOT hit validation (a real persist path), STOP and escalate; do not decide.

**D4. Tests.** (a) Frontend: component test on `OutputEditorSheet`/`MarkdownKindFields` asserting no mode toggle exists for Content and a save sends `fieldMapping: {}`; `buildOutputConfig` unit test. Must be red on main (toggle exists / field mode persists mapping), green after. Mutation: restore the toggle -> fails. (b) Backend: spec for the message on slotless kind. (c) Live: reproduce 400 on main in a real browser, verify after in both themes against the running worktree dev server (`readlink /proc/<pid>/cwd`).

## Risks / Trade-offs

[Existing tests encode field mode for markdown] -> they are the symptom; update, and say so (not a fixture-to-pass edit: the contract changed by ruling).
[Backend touch triggers full sbt gate] -> `sbt testFull` once, under nice, known flakes HEL-1228/HEL-1215 reported by name.
