## Why

HEL-599 made nested JSON materialise as dotted columns (`stats.pts_ppr`) in both rows and the inferred
DataType schema. The expression lexer was not extended to match, so the platform now produces columns
that its own expression language cannot address: `$stats.pts_ppr` fails with `Invalid number literal: .`.

This is the last gap between epic HEL-857 and its exit criterion — rebuilding four fantasy-football
dashboards from the live Sleeper API with no CSV detour. The criterion is technically reachable today by
inserting `rename` steps, but a real user would not know to add them, so the proof would be weaker than
intended. The deliverable is that an agent can write `compute` over a nested field directly.

## What Changes

- Admit `.` into `$`-prefixed column references in the tokenizer, so `$stats.pts_ppr` lexes as a single
  `Ref("stats.pts_ppr")`. A dotted reference names ONE opaque literal column, matched exactly against the
  row/schema key — never split, never traversed as a path.
- Constrain the new form: a dot must be interior (preceded and followed by an identifier character), so
  `$a.` and `$.a` stay parse errors rather than becoming silently-empty segments.
- Leave the bare-identifier legacy grammar and the number-literal path byte-for-byte unchanged. The
  `$`-reference branch is lexically disjoint from both, so `.5`, `1.05` and legacy `price * quantity`
  cannot be affected.
- Improve the unresolvable-reference error so a caller who mistypes or under-qualifies a dotted column is
  led to the fix, rather than told only "Unknown field".
- Document the resolution rule normatively in `docs/compute-expression-grammar.md` and the
  `compute-expression-language` spec, including why no literal-vs-nested race exists at evaluation time.
- Add regression coverage for `filter` with dotted columns, which already works and must stay working.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `compute-expression-language`: the field-reference requirement currently pins identifiers to
  `[A-Za-z_][A-Za-z0-9_]*`. It is extended to admit interior dots, with a normative exact-match
  resolution rule and explicit non-affectation of number literals and the legacy bare-identifier path.

## Impact

- `backend/.../domain/engine/ExpressionEvaluator.scala` — tokenizer, and the reference-resolution error text.
- All six existing entry points inherit the change with no call-site edits: `ComputeStep` and
  `SourceService.applyComputedFields` (`evaluate`), `PipelineAnalyzeService` (`validate`, `inferType`),
  `DataTypeService` and `PatchSetPreviewProjection` (`validateTolerant`).
- `docs/compute-expression-grammar.md`, `openspec/specs/compute-expression-language/spec.md`.
- No frontend change: no TS implementation of this grammar exists; the UI round-trips to the backend.
- No schema change: no JSON Schema constrains expression strings with a pattern.

## Non-goals

- Member access / property traversal. A dot is part of a name, not an operator; no nested value is
  reachable at evaluation time because rows are already flattened.
- Quoted or bracketed reference syntax (`$["odd name"]`) for columns containing spaces or operators.
- Reconciling the Spark execution path (`SparkJobSubmitter` hands the same string to Spark SQL `F.expr`,
  a different grammar). Pre-existing divergence, acknowledged in design.md, tracked separately.
- Reconciling the Unicode-vs-ASCII drift between the tokenizer (`isLetter`) and the documented ASCII
  charset. Pre-existing, tracked separately.
