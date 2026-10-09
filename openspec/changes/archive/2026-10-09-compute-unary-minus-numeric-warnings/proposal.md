## Why

HEL-1315 added `floor`/`ceil`/`round`/`mod`/`abs`, but the compute grammar still has no unary minus, so
negatives must be spelled `0 - x` (`mod(0 - 7, 3)`, `round($x, 0 - 2)`). Separately, `floor($s)` or `$s - 1`
over a string-typed field (every uncast CSV column is `string`, HEL-893 D1) passes analyze cleanly, infers
`float`, and then nulls every row at run time with a per-row type error — a silent wrong result analyze could
have flagged.

## What Changes

- The strict compute expression grammar gains a prefix unary minus (so negative literals `-5`, `-$x`,
  `mod(-7, 3)`, `2 - -3`, `-floor($x)` all parse), with type inference (`float`) and row-evaluation parity
  (strict numeric operand, null propagates, non-numeric is a per-row type error yielding `null`). The legacy
  bare-identifier parser is frozen and is NOT changed.
- `docs/compute-expression-grammar.md` documents the binding (unary `-` binds tighter than `*`/`/`, applies
  to the following factor including a function call or parenthesised group, repeatable: `--x` = `x`) and
  drops "no unary minus" from Known limitations; the Spark `F.expr` note is extended.
- Analyze gains a new NON-BLOCKING schema warning code `numeric-op-on-text-field`: a compute step whose
  expression uses a field whose trusted projected type is `string`/`string-body`/`boolean` as a numeric-function
  argument or as a `-`/`*`/`/`/unary-`-` operand gets one warning per such field, suggesting a cast step. It
  rides the existing HEL-1235 `warnings` plumbing (full, concise per-node, proposal analyze) and never sets
  `validationError`, never changes `costVerdict`, never gates auto-run.
- Contract sync for the new code: both analyze response JSON schemas, the frontend `AnalyzeWarningCode` union,
  helio-mcp `AnalyzeWarning` type and tool descriptions.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `compute-expression-language`: adds the unary minus / negative literal requirement.
- `pipeline-analyze-schema-warnings`: adds the `numeric-op-on-text-field` code and its warning requirement.

## Impact

- Backend: `backend/src/main/scala/com/helio/domain/engine/ExpressionParser.scala` (StrictParser + AST),
  `ExpressionTypeInference.scala`, `ExpressionInterpreter.scala`, `ExpressionEvaluator.scala` (facade),
  `AnalyzeSchemaWarnings.scala`, `api/protocols/pipelines/PipelineAnalyzeProtocol.scala` (doc comment).
- Schemas: `schemas/pipelines/pipeline-analyze-response.schema.json`,
  `schemas/pipelines/pipeline-analyze-proposal-response.schema.json`.
- Frontend: `frontend/src/features/pipelines/types/pipelineStep.ts` (type union only; no UI renders warnings).
- helio-mcp: `src/types.ts`, `src/tools/read.ts`, `src/tools/pipelineProposal.ts` (descriptions).
- Docs: `docs/compute-expression-grammar.md`.
- No migration, no new endpoint, no new dependency.
