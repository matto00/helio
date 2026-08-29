## MODIFIED Requirements

### Requirement: Column references require a `$` prefix
`ExpressionEvaluator` SHALL treat `$` followed by an identifier as a field reference. An identifier
SHALL match `[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*` — that is, one or more `_`/alphanumeric
segments joined by interior dots. A dot SHALL be admitted only between two identifier characters: a
reference with a leading, trailing, or doubled dot SHALL be a parse error. A bare identifier not
preceded by `$` and not immediately followed by `(` (a function call, see below) SHALL be a parse
error. Numeric constants and double-quoted string literals are unaffected by this requirement.

A dotted reference SHALL name exactly one column whose literal name contains those dots. The
evaluator SHALL resolve it by exact match against the row's keys and SHALL NOT split it into
segments, traverse it as a path into a nested value, or fall back to any shorter prefix. This is
well-defined because rows reaching the evaluator are already flat: nested JSON is flattened to
dotted column names upstream, and a literal dotted key colliding with a nested path is deduplicated
to a single column at that point, so no nested structure and no competing interpretation survives to
evaluation time.

When a reference does not match any column, the resulting error SHALL name the unresolved reference
and SHALL distinguish the dotted case, so that a caller who supplied a dotted reference is directed
to check the flattened column name rather than assume path traversal was attempted.

#### Scenario: `$`-prefixed identifier resolves to a field reference
- **WHEN** the expression `$price * $qty` is evaluated against a row `{"price": 2, "qty": 3}`
- **THEN** the result is `6`

#### Scenario: Dotted reference resolves to the flattened column of that exact name
- **WHEN** the expression `$stats.pts_ppr * 2` is evaluated against a row `{"stats.pts_ppr": 12}`
- **THEN** the result is `24`

#### Scenario: A dotted reference is not split into a prefix when only the prefix exists
- **WHEN** the expression `$stats.pts_ppr` is evaluated against a row `{"stats": 5}`
- **THEN** evaluation returns an unknown-field error naming `stats.pts_ppr`, and does not return `5`

#### Scenario: A literal dotted column and a nested path resolve to one and the same column
- **WHEN** a source row `{"a.b": 1, "a": {"b": 2}}` is flattened and the expression `$a.b` is
  evaluated against the resulting row
- **THEN** exactly one column `a.b` exists, and the expression resolves to that column's single
  deduplicated value rather than erroring on ambiguity

#### Scenario: Trailing dot in a reference is a parse error
- **WHEN** the expression `$stats.` is validated
- **THEN** validation returns a parse error

#### Scenario: Bare identifier without `$` is a parse error
- **WHEN** the expression `price * qty` is validated
- **THEN** validation returns an error indicating column references require a `$` prefix

#### Scenario: A dot does not become an operator on bare identifiers
- **WHEN** the expression `stats.pts_ppr` is validated
- **THEN** validation returns a parse error, not a successful parse — the bare-identifier scan
  is unchanged by this requirement (it does not admit dots), so tokenization fails on the `.`
  before the parser's `$`-prefix check is even reached; this is a pre-existing, untouched
  failure mode, distinct from the literal `$`-prefix-required message returned for a
  dot-free bare identifier like `price * qty`

#### Scenario: Numeric constant does not require `$`
- **WHEN** the expression `$amount * 1.05` is evaluated against a row `{"amount": 100}`
- **THEN** the result is `105`

#### Scenario: A leading-dot number literal is unaffected
- **WHEN** the expression `$amount * .5` is evaluated against a row `{"amount": 100}`
- **THEN** the result is `50`

#### Scenario: String literal does not require `$`
- **WHEN** the expression `$first_name + " " + $last_name` is evaluated against a row
  `{"first_name": "Ada", "last_name": "Lovelace"}`
- **THEN** the result is `"Ada Lovelace"`

## ADDED Requirements

### Requirement: Dotted references are usable on every expression surface
Every surface that evaluates or validates an expression SHALL accept a dotted column reference on
the same terms, because they share one grammar. This covers row evaluation for the pipeline compute
step and for source computed fields, strict validation and result-type inference for live step-card
feedback, and legacy-tolerant validation for data-type computed fields and patch-set preview.
Admitting dots SHALL NOT alter the legacy bare-identifier fallback: an expression that fails strict
parsing for any reason other than a missing `$` prefix SHALL still not be retried against the legacy
grammar.

#### Scenario: Strict validation accepts a dotted reference present in the schema
- **WHEN** `$stats.pts_ppr + 1` is validated against the field names `["stats.pts_ppr"]`
- **THEN** validation succeeds

#### Scenario: Type inference resolves a dotted reference's type from the schema
- **WHEN** the result type of `$stats.pts_ppr * 2` is inferred against the field types
  `{"stats.pts_ppr": "number"}`
- **THEN** the inferred type is `"number"`

#### Scenario: Legacy-tolerant validation accepts a dotted reference
- **WHEN** `$stats.pts_ppr` is validated tolerantly against the field names `["stats.pts_ppr"]`
- **THEN** validation succeeds

#### Scenario: Source computed fields accept a dotted reference
- **WHEN** a source computed field with expression `$stats.pts_ppr * 2` is applied to a flattened
  row `{"stats.pts_ppr": 12}`
- **THEN** the computed value is `24` and no evaluation error is reported

#### Scenario: A legacy bare-identifier expression still runs unchanged
- **WHEN** the stored expression `price * quantity` is evaluated against a row
  `{"price": 2, "quantity": 3}`
- **THEN** the result is `6`

### Requirement: Key-addressed steps continue to accept dotted column names
Steps that address columns by name through configuration rather than through the expression grammar
SHALL continue to accept dotted column names unchanged. This SHALL remain true for the filter step,
whose conditions name a column directly and resolve it by exact key match.

#### Scenario: A filter condition matches on a dotted column
- **WHEN** a filter condition on field `stats.pts_ppr` with operator `>` and value `10` is applied
  to rows `[{"stats.pts_ppr": 12}, {"stats.pts_ppr": 4}]`
- **THEN** only the row whose `stats.pts_ppr` is `12` is retained
