# HEL-1107: `generatetext` step

## Description

Synthesize source data into a text Output — the narrative case. Emits a `string-body` field.

`generatetext` is the last of the three AI/file steps in epic HEL-1103 (after HEL-1105 `convertformat` and
HEL-1106 `analyzewithai`) and the last genuinely-unregistered pipeline op. V107 already admits the op string
and `PipelineCostEstimator.AiOps` already classifies it as `ai-step`, but it has no `PipelineStep.Registry`
entry, so a persisted `generatetext` row makes `rowToDomain` throw and `analyze` 500.

Design spec: `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md` (PR #627), section 6:
"`generatetext` — synthesize source data into a text Output." Treat that line as intent, not specification.

## Acceptance Criteria

**AC1 (RESTATED by owner ruling, 2026-09-15).** The step emits a `string-body` column; `analyze` reports that
column in the step's output schema without calling the model; and the column is thereby offered as a bindable
column at the node.

The ticket's original AC1 wording — "output binds to a markdown Output end to end" — is **dropped**. Premise
validation established it is not achievable today: `OutputBindingSpec.Markdown` declares both `requiredSlots`
and `optionalSlots` empty, so `OutputService.validateFieldMapping` rejects a `{content: <column>}` mapping with
400 on create and on merged PATCH, and `PanelContent.tsx:176` renders only literal `cfg.content`, never
`fieldMapping` or rows (HEL-909 retired bound mode entirely). See `premise-validation.md`.

**AC2.** The token budget is enforced by the existing `ClaudeClient` clamps (`CLAUDE_MAX_TOKENS`,
`CLAUDE_MAX_INPUT_TOKENS`), never re-implemented in this step.

**AC3.** An openspec spec is included.

## Owner rulings (2026-09-15), answering the premise escalation

1. **Scope: `proceed-with-restated-scope`.** Build the step, emit a `string-body` column, have analyze report
   it, make that column bindable at the node. The markdown-Output render path is OUT of scope: do **not** add a
   `content` slot to `OutputBindingSpec.Markdown`, do **not** touch `PanelContent`. Narrative rendering stays
   with HEL-921 (`insight` Output kind).
2. **Output shape: per-row.** One model call per row, adding a text column, mirroring `analyzewithai`. No N-to-1
   collapse and **no mode toggle** for one. Justify in `design.md` on the accepted grounds: consistency with
   every existing non-aggregate step, and cost that scales visibly with row count. Note the collapse variant as
   deferred.
3. **The markdown-binding defect** (the UI offers a bound Content mode the backend 400s and the renderer
   ignores) is filed separately by the driver. Do **not** fix it here; cross-reference it in `design.md` as
   pre-existing and out of scope.

## Out of scope

- Tier gating / `HELIO_BETA_DAILY_MESSAGE_LIMIT` and never-auto-run enforcement — HEL-1108. Keep
  `AiStepClient.complete` the single model call point and name HEL-1108 there. `AiStepRequest.ownerUserId`
  exists but is always `None` (no engine call site populates it); do not thread run ownership here.
- Step card / editor UI — HEL-1109. Op palette — HEL-1136.
- Any change to `PipelineCostEstimator.AiOps` (it already contains `generatetext`), and any migration
  (V107 already admits the op; V108 would be next if one were somehow needed).
- The markdown Output binding contract and `PanelContent` rendering (ruling 1/3 above).
