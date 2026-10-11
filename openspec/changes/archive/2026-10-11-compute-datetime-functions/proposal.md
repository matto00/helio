## Why

Compute expressions cannot do date/time arithmetic. The helio-news CI Health dashboard computes queue time (`started_at - created_at` in seconds) in Python because Helio cannot. Timestamp columns reach a compute step as strings, so no existing operator or function can do this. Also, the platform has no single answer to "what string is a timestamp": cast and datebucket each carry their own reader.

## What Changes

- Add three compute-expression functions, per the owner rulings recorded in `ticket.md`:
  - `seconds_between(end, start)` returns exact float seconds, with fractions and no rounding.
  - `date_trunc(unit, ts)` takes a string-literal unit: `second`, `minute`, `hour`, `day`, `week` (ISO Monday), `month`, `quarter` or `year`. It returns an ISO-8601 UTC instant string.
  - `add_days(ts, n)` adds exact 86400-second days, whole or fractional, and returns an ISO-8601 UTC instant string.
  - All three work in UTC throughout. A null argument gives null, and an unparseable timestamp gives null for that row. An unknown `date_trunc` unit literal, or a non-literal unit, is a parse error.
- Analyze infers `float` for `seconds_between` and `timestamp` for `date_trunc` and `add_days`. An inferred type must match the applied type.
- Fix `+` type inference: a `timestamp`-typed operand evaluates as text at run time, so `+` with one now infers `string`.
- Fix the numeric-op-on-text-field warning (HEL-1403): it now covers `timestamp` fields and the numeric `n` argument of `add_days`.
- Add one shared string-to-instant parser. It is the single definition of the accepted timestamp shapes (the datebucket step's set) and is used by:
  - the datebucket step (behaviour-preserving, except that a JSON-number epoch is now parsed, as the datebucket spec already requires);
  - cast's timestamp/date check (cast still also keeps values the schema-inference reader accepts, per HEL-1436 D3);
  - the new compute functions.
- Document the new functions in the compute step editor (a function-reference help that does not exist today), in `docs/compute-expression-grammar.md`, and in the helio-mcp tool descriptions used for authoring and validating pipeline proposals.
- **Not added:** `now()`/`today()` (owner ruling: non-deterministic runs), month/year addition, and `-` on timestamps.

## Capabilities

### New Capabilities
- `timestamp-value-parsing`: the single accepted set of timestamp input shapes, and the guarantee that the datebucket step and compute date functions parse identically (cast keeps every value they parse).

### Modified Capabilities
- `compute-expression-language`: adds the date/time function requirements and modifies output-type inference (date functions, and `+` with a `timestamp` operand).
- `pipeline-analyze-schema-warnings`: the numeric-use-of-a-text-field warning covers `timestamp` fields (suggesting `seconds_between`/`add_days`, not a cast) and `add_days`'s day count.

## Impact

- **Backend:**
  - `domain/engine` (ExpressionParser arity/registry, ExpressionInterpreter dispatch, ExpressionTypeInference, ExpressionNumericContexts, ExpressionEvaluator registry lists, TimestampParsing);
  - `domain/steps/DateBucketStep`, `domain/steps/CastStep`.
- **Frontend:** `ComputeFieldConfig.tsx` (function help).
- **helio-mcp:** tool descriptions.
- **Docs:** `docs/compute-expression-grammar.md`.
- **Unchanged:** no migration, no API shape change, and the `validate-expression` endpoint (HEL-1437 owns its type-error gap).
- **Spark path:** `SparkJobSubmitter`'s `F.expr` does not gain these functions. This is a pre-existing divergence and is documented.
