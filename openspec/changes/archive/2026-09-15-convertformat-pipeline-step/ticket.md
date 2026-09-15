# HEL-1105: `convertformat` step

## Description

Convert between content formats inside a pipeline. Operates on content fields.

**Owner scope ruling (2026-09-15, recorded as escalation.answered on the ticket-drift escalation):**
`convertformat` is a DETERMINISTIC LOCAL converter, not an AI step. No ClaudeClient, and no hooks for AI.
Supported pairs: CSV <-> JSON and text <-> Markdown. AI conversion/enhancement is deferred to HEL-1135.

Design spec: `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md` (PR #627).

## Acceptance Criteria

1. A round-trip conversion preserves the data (CSV->JSON->CSV and JSON->CSV->JSON; text->Markdown->text), with "lossless" precisely defined in design.md.
2. An unconvertible input fails the step with a named reason, never empty rows. The failure-arm tests must be failable, proven by mutation.
3. `convertformat` is registered with full op wiring: step registry, `PipelineStepKind.All`, config codec, apply/infer parity (engine + `PipelineAnalyzeService`), JSON protocols/analyze response, and schemas. `PipelineStepRepository.rowToDomain` handles a persisted `convertformat` row (analyze no longer 500s for it).
4. The HEL-1092 cost verdict classifies `convertformat` deliberately (decision justified in design.md). `AiOps` is untouched.
5. Tests that used `convertformat` as an unregistered stand-in (PipelineCostEstimatorSpec, PipelineCreateTransactionalSpec) are deliberately updated, not deleted; an unregistered-op probe keeps a different fake op.
6. Design spec §6 is corrected so it no longer groups `convertformat` with ClaudeClient steps; the AI-set comment "HEL-1105/1106" is corrected to HEL-1106/1107.
7. An openspec capability spec for the op is included.
8. No migration (V107 already admits the op). The StepCard editor is HEL-1109, out of scope unless the codebase makes one mandatory (escalate if so).
