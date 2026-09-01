# pipeline-compute-op Specification

## Purpose
TBD - created by archiving change pipeline-op-compute-field. Update Purpose after archive.

## Requirements

### Requirement: Compute op appends a derived field to each row using a unified config shape

`ComputeStep.apply` SHALL accept config shape
`{"column":"<name>","expression":"<expr>","type":"<type>"}` and append a new field named `column`
to every row, whose value is the result of evaluating `expression` against that row's fields using
`ExpressionEvaluator.evaluate`, per the `compute-expression-language` capability ($-prefixed column
refs, function-call syntax, strict-numeric/permissive-`+` coercion). If evaluation fails for a row
because of a condition that depends on that row's data — an unknown field, division by zero, or a
type error — the field value for that row SHALL be `null`, and the run SHALL continue. Fields not
referenced in the expression SHALL pass through unchanged. The `type` key on the wire SHALL be
tolerated but ignored by the execution engine. For backward compatibility,
`ExpressionEvaluator.evaluate` SHALL retry an expression that fails to parse under the `$`-required
grammar against the frozen pre-existing bare-identifier grammar (`parseLegacy`); if that succeeds,
evaluation proceeds using the legacy parse so existing persisted compute steps continue to produce
their pre-existing output without modification, with no data rewrite. This legacy fallback applies
only to row-execution (`evaluate`) — schema-inference and live validation use the strict grammar
only (see the next requirement), so bare-identifier expressions are flagged (not silently accepted)
even while they continue to execute correctly.

A `column` that is missing or empty SHALL NOT produce an output field named with the empty string.
Such a configuration SHALL be reported as a validation failure at analyze time and SHALL fail the run,
naming the step and the missing value. Storing it remains permitted, so a compute step may be added and
its column supplied later; this governs only what happens when it is analyzed or run. The same applies
to a missing or empty `expression`.

This narrows the unconditional "SHALL append a new field named `column` to every row" above. With an
empty `column` that clause silently writes a field named `""` into the Output and into every
downstream consumer, which is indistinguishable from success — the defect class HEL-814 closed, and
the one measured on real production rows (a `compute` step with both `column` and `expression` empty).

A non-empty `expression` that cannot be parsed under either grammar SHALL NOT be evaluated per row and
SHALL NOT produce a column of `null`s. Such a failure does not depend on the row: it is identical for
every row and is knowable before any row is touched. It SHALL instead be rejected on the write path and
SHALL fail the run, per the `pipeline-step-config-rejection` and
`pipeline-step-config-runtime-completeness` capabilities. This narrows the per-row-`null` clause above,
which previously covered parse errors alongside the genuinely row-dependent failures; the row-dependent
failures are unchanged.

The expression SHALL be parsed once per step evaluation rather than once per row, since the parse result
cannot vary across rows of the same step.

#### Scenario: Simple arithmetic expression produces new column
- **WHEN** a compute step with `{"column":"revenue","expression":"$price * $qty","type":"number"}`
  is applied to rows containing `{"price": 9.99, "qty": 3}`
- **THEN** each output row contains `{"price": 9.99, "qty": 3, "revenue": 29.97}`

#### Scenario: Division by zero produces null for that row
- **WHEN** a compute step with `{"column":"rate","expression":"$a / $b","type":"number"}` is
  applied to a row where `b` is `0`
- **THEN** the output row contains `{"rate": null}` for that row (no exception thrown) and the run succeeds

#### Scenario: Unknown field reference produces null for that row
- **WHEN** a compute step with `{"column":"x","expression":"$missing_field * 2","type":"number"}`
  is applied to rows not containing `missing_field`
- **THEN** the output row contains `{"x": null}` (no exception thrown) and the run succeeds

#### Scenario: A null operand produces null for that row without failing the run
- **WHEN** a compute step with `{"column":"x","expression":"$a + $b"}` is applied to a set of rows in
  which one row has `a` set to `null` and the others have numeric `a`
- **THEN** that row's `x` is `null`, every other row's `x` is its computed value, and the run succeeds

#### Scenario: A statically unparseable expression does not produce a column of nulls
- **WHEN** a compute step with `{"column":"value_vs_adp","expression":"stats.adp_ppr - stats.pts_ppr"}`
  — which parses under neither the strict nor the legacy grammar — is run over rows
- **THEN** the run fails with the parse error, and no output row contains `value_vs_adp` set to `null`

#### Scenario: Expression with parentheses respects precedence
- **WHEN** a compute step with `{"column":"result","expression":"($a + $b) * $c","type":"number"}` is
  applied to a row `{"a":1,"b":2,"c":3}`
- **THEN** the output row contains `{"result": 9.0}`

#### Scenario: Input fields pass through unchanged
- **WHEN** a compute step appends a new field `total`
- **THEN** all original fields of the row remain present in the output row

#### Scenario: String function expression produces new column
- **WHEN** a compute step with
  `{"column":"full_name","expression":"concat($first_name, \" \", $last_name)","type":"string"}`
  is applied to a row `{"first_name": "Ada", "last_name": "Lovelace"}`
- **THEN** the output row contains `{"full_name": "Ada Lovelace", ...}`

#### Scenario: Legacy bare-identifier expression persisted before this change still evaluates
- **WHEN** a compute step persisted with the pre-existing config
  `{"column":"revenue","expression":"price * qty","type":"number"}` (no `$` prefixes) is applied
  to a row `{"price": 9.99, "qty": 3}`
- **THEN** the output row contains `{"revenue": 29.97}` — identical to its pre-change behavior,
  even though the same step's analyze response flags a `validationError` (see the ADDED
  requirement "Compute op schema inference validates the expression and infers its output type"
  below)
- **AND** the step remains acceptable on the write path, because it parses under the legacy grammar

#### Scenario: An empty column is reported rather than producing an empty-named field
- **WHEN** a compute step with `{"column":"","expression":"$a + $b"}` is analyzed
- **THEN** `validationError` names `column` as a missing required value
- **AND** running the pipeline fails naming that step, rather than appending a field named `""`

### Requirement: Frontend compute op renders an output-field and expression editor in the step-card
When a pipeline step has `op: "compute"` and the step card is expanded, the frontend SHALL render
a `ComputeFieldConfig` component with a text input for the output column name (`column`), a text
input for the expression (`expression`), and — when the current step's analyze result carries a
`validationError` — an inline error message rendered below the expression input. The component
SHALL display the available input field names (from the analyze endpoint's `inputSchema` for that
step) as a read-only hint, prefixed with `$` to match the required column-reference syntax. The
component SHALL save the config (patch the step) when either input changes (on blur or on
change). An empty `column` or `expression` SHALL be permitted during editing but SHALL be
persisted as-is. The config is initialized as `{"column":"","expression":"","type":"number"}` when
the step is first added.

#### Scenario: Compute step card shows column name and expression inputs
- **WHEN** a compute step card is expanded
- **THEN** a text input labelled for output column name and a text input labelled for expression
  are visible

#### Scenario: Available fields shown as hint with `$` prefix
- **WHEN** the analyze response contains `inputSchema` fields `["price","qty"]` for that step
- **THEN** the component displays `$price` and `$qty` as available field references below the
  expression input

#### Scenario: Changing column name updates step config
- **WHEN** the user types `revenue` into the column name input and the input loses focus
- **THEN** the step config is patched with `{"column":"revenue","expression":"...","type":"number"}`

#### Scenario: Changing expression updates step config
- **WHEN** the user types `$price * $qty` into the expression input and the input loses focus
- **THEN** the step config is patched with
  `{"column":"...","expression":"$price * $qty","type":"number"}`

#### Scenario: Config is hydrated from persisted step on reload
- **WHEN** a pipeline step with `op: "compute"` and persisted config
  `{"column":"total","expression":"$price * $qty","type":"number"}` is loaded
- **THEN** the column input shows `total` and the expression input shows `$price * $qty`

#### Scenario: A bad expression's validation error is shown inline
- **WHEN** the analyze response for a compute step includes
  `"validationError": "Column references require a '$' prefix"`
- **THEN** `ComputeFieldConfig` renders that message inline below the expression input

### Requirement: Compute op schema inference validates the expression and infers its output type
`PipelineAnalyzeService.inferCompute` SHALL validate `expression` against the step's `inputSchema`
field names using `ExpressionEvaluator.validate` (the strict, `$`-required grammar — no legacy
fallback). If validation fails, `AnalyzedStep.validationError` SHALL be set to the returned
message, and the output field's type SHALL fall back to the wire `type` (best-effort schema
propagation for a currently-invalid or legacy-style expression). If validation succeeds,
`validationError` SHALL be `None` and the output field's type SHALL be computed by
`ExpressionEvaluator.inferType` from the expression and the input field types, ignoring the wire
`type`. This strict validation is independent of `ExpressionEvaluator.evaluate`'s legacy-tolerant
row-execution fallback — a persisted bare-identifier expression is flagged here even though it
still executes correctly at run time.

#### Scenario: Output type is inferred from the expression, not trusted from the wire `type`
- **WHEN** a compute step with `{"column":"label","expression":"concat($a, $b)","type":"number"}`
  (a stale/incorrect `type` value) is analyzed
- **THEN** the inferred output schema field type is `"string"`, derived from the expression, and
  `validationError` is `None`

#### Scenario: A legacy bare-identifier expression is flagged at analyze time
- **WHEN** a compute step with the pre-existing config
  `{"column":"revenue","expression":"price * qty","type":"number"}` (no `$` prefixes) is analyzed
- **THEN** `AnalyzedStep.validationError` is set to a message indicating column references
  require a `$` prefix, and the output field's type falls back to the wire `type` (`"number"`)

#### Scenario: Unknown field reference is flagged at analyze time
- **WHEN** a compute step with `{"column":"x","expression":"$missing * 2","type":"number"}` is
  analyzed against an `inputSchema` that does not contain `missing`
- **THEN** `AnalyzedStep.validationError` is set to a message indicating the unknown field
