# HEL-1106: `analyzewithai` step

## Description

Structured extraction and classification over content fields via `ClaudeClient`. Output shape is declared in config so downstream steps have a real schema rather than an inferred-from-row-0 one (HEL-891).

Design spec: `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md` (PR #627), section 6.

## Acceptance Criteria

- The declared output schema is enforced on the model's response; a non-conforming response fails the step (named reason) rather than silently producing partial columns.
- Openspec spec included.

## Driver brief (verified in premise-validation.md)

- Route through the existing `com.helio.ai.ClaudeClient`; client-injection seam (DI/config/no-ANTHROPIC_API_KEY degrade) decided in design.md and reusable by HEL-1107 `generatetext` (not implemented here).
- V107 already admits the op; no migration. `PipelineCostEstimator.AiOps` already contains it (`ai-step`); do not move it.
- `PipelineStepRepository.rowToDomain` must decode a persisted step; analyze must not 500 (HEL-1105 `PipelineAnalyzeConvertFormatSpec` pattern).
- Tier gating (HELIO_BETA_DAILY_MESSAGE_LIMIT) is HEL-1108: not implemented, but leave one clear call point. ClaudeClient already enforces CLAUDE_MAX_TOKENS / CLAUDE_MAX_INPUT_TOKENS.
- Failable tests with a fake ClaudeTransport (no network): conforming, missing field, wrong type, extra fields (policy decided), malformed JSON; each failure arm proven by mutation.
- Hazards: spray-json JsObject sorts keys (preserve declared column order); Jackson readTree ignores trailing content (require end-of-input); spray-json omits None (normalize at boundary, test field absent).
- StepCard UI is HEL-1109; frontend changes only if the backend contract forces them.
