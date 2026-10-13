## Why

HEL-1403 added the `numeric-op-on-text-field` analyze warning, but several shapes that null every row at run time
still pass silently (HEL-1455). A long `-`/`not`/bracket chain can also overflow the parser stack. The owner ruled
on each gap on 2026-10-12: warn for items 1, 2 and 4a, and give wrong-type literals a non-blocking warning.

## What Changes

- `+` with a `string-body` operand infers `"string"`, as `string` does, so `floor($sb + 1)` warns. The boolean
  half of item 1 is already fixed on main by HEL-1070.
- Analyze tracks type trust per column after a `compute` step. Columns a compute passes through keep their trusted
  type, and only the column it writes becomes untrusted. A later compute on an uncast CSV column then warns.
- `numeric-op-on-text-field` also covers a text field used as `substring`'s start or end.
- New non-blocking warning `text-function-on-numeric-field`: a trusted `integer`/`float` field given to `length`,
  `lower`, `upper`, or `substring`'s first argument.
- New non-blocking warning `literal-type-mismatch`: a string literal in a numeric context, or a number literal given
  to a text function. It does not depend on input trust. It is never an analyze error (owner ruling).
- The expression parsers (strict, and the legacy fallback) reject bracket, call, unary `-` or `not` nesting deeper
  than 100 levels, and any parsed tree deeper than 200 levels (for example a long flat operator chain), with a clear
  parse error instead of a stack overflow.
- The HEL-1436 cast -> compute warning path gets a regression test only.
- The new codes are added to the analyze response schema, the frontend `AnalyzeWarningCode` union and the helio-mcp
  types and tool descriptions.

## Capabilities

### New Capabilities

### Modified Capabilities
- `pipeline-analyze-schema-warnings`: the warning code list, the per-column trust rule, the substring start/end
  context, and two new warnings.
- `compute-expression-language`: `+` typing for `string-body`, and the nesting depth limit.

## Non-goals

- Per-column trust for ops other than `compute` (`fillnull`, `aggregate`, `window`, and others stay per-step).
- Any change to `TimestampParsing` or compute's date handling, which HEL-1502 owns.
- Turning any warning into an error.

## Impact

- Backend: `ExpressionTypeInference`, `ExpressionNumericContexts`, `ExpressionParser`, `ExpressionEvaluator`,
  `AnalyzeSchemaWarnings`, `PipelineAnalyzeProtocol` (doc).
- Contracts: `schemas/pipelines/pipeline-analyze-response.schema.json`, frontend `pipelineStep.ts`,
  `helio-mcp/src/types.ts` and the tool descriptions.
- Dev DB housekeeping: delete the HEL-1301 residue user by exact (id, email).
