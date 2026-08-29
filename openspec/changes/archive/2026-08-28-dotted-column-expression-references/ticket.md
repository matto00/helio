# HEL-867: Expression lexer: allow dotted column references so flattened nested columns are usable in compute/filter

## Description

Spinoff from HEL-599 (PR #462), which made nested JSON materialise as dotted columns (`stats.pts_ppr`). Those columns are now present in rows and in the DataType — but they still cannot be referenced from an expression.

`ExpressionEvaluator`'s tokenizer builds `$`-reference identifiers from letters, digits and `_` only (ExpressionEvaluator.scala:132), and treats `.` as the start of a number literal (:135). So `$stats.pts_ppr` lexes as `Ref("stats")` followed by a bare `.`, which fails as `Invalid number literal: .`.

This is the last gap between epic HEL-857 and a clean end-to-end proof: rebuilding four fantasy-football dashboards from the live Sleeper API with no CSV detour. The proof can technically be done today by inserting `rename` steps, but a real user would not know to add them. The deliverable is that an agent can write `compute` over a nested field directly.

## Premise corrections (established by tracing before planning; see evidence/premise-validation.md)

These override the original ticket text where they conflict:

1. **`filter` is NOT an affected surface.** `FilterStep` does not use `ExpressionEvaluator` at all. It is structured key-addressed config (`FilterCondition(field, operator, value)`, FilterStep.scala:15) resolved by literal map lookup (FilterStep.scala:78, `row.getOrElse(field, null)`). Dotted columns already work in `filter` today. Filter belongs in the ticket's "already works" list alongside select/lookup/sort/dedupe/rename, and needs a regression test proving it, not an implementation.
2. **There are SIX ExpressionEvaluator entry points, not two**, across five files: ComputeStep.scala:59 (`evaluate`), SourceService.scala:404 (`evaluate`, source computed fields), PipelineAnalyzeService.scala:270/275 (`validate` + `inferType`, step-card live validation), DataTypeService.scala:70/107 (`validateTolerant`, validate-expression endpoint and PATCH save path), PatchSetPreviewProjection.scala:257 (`validateTolerant`, patch-set preview — a surface the ticket never mentions). One tokenizer change covers all six, but the `validate`/`inferType`/`validateTolerant` paths need their own coverage, not just `evaluate`.
3. **The headline ambiguity is already decided upstream and must be documented, not re-invented.** At every `evaluate` site the row is a FLAT `Map[String, JsValue]` (ExpressionEvaluator.scala:419). `JsonFlattener` already collapses a literal `{"a.b": 1}` colliding with a nested `{"a": {"b": 2}}` into exactly one `a.b` column, deduplicated inside `leaves`, last-in-original-walk-order winning (JsonFlattener.scala:24-33). No nested structure survives to evaluation time, so there is no live literal-vs-nested race for the lexer to arbitrate.
4. **No frontend implementation of this grammar exists.** Despite docs/compute-expression-grammar.md:3 calling itself a "shared contract with the frontend", there is no TS tokenizer, parser, or validator. The frontend round-trips to the backend. Scope is backend-only.
5. **A separate Spark path evaluates the same stored string with a different grammar.** SparkJobSubmitter.scala:177-178 hands `s.config.expression` to Spark SQL's `F.expr`. This divergence is pre-existing and out of scope, but dotted column names interact with it (Spark SQL needs backtick quoting for a dotted name) and it must be acknowledged rather than silently ignored.

## Acceptance criteria

- [ ] A dotted column produced by nested-JSON flattening can be referenced in a `compute` expression.
- [ ] Dotted columns are proven to work in a `filter` step by regression test (already true on the base branch — see correction 1; this is a characterisation test, not new behaviour).
- [ ] The same works for source computed fields (`SourceService.applyComputedFields`).
- [ ] The remaining validation surfaces accept a dotted reference: `validate` (strict), `validateTolerant`, and `inferType` resolve a dotted column against the supplied field-name/type map.
- [ ] Ambiguity between a literal dotted column name and any other interpretation is decided, documented normatively in both `docs/compute-expression-grammar.md` and `openspec/specs/compute-expression-language/spec.md`, and tested.
- [ ] Existing expressions, including the frozen bare-identifier legacy path and number literals such as `.5`, are unaffected — regression tests prove it.
- [ ] An unresolvable dotted reference produces an error that leads the caller to the right fix (user-facing wording is behaviour).

## Added scope (folded in post-delivery, coordinator-approved)

Follow-up triage on the final gate's non-blocking note 2 returned `fold-in`. Rationale: the trailing-dot
parse error is pre-existing, but THIS ticket is what makes it likely to be hit — dotted references are now
the point, so `$stats.` is a natural mid-edit state, and `Invalid number literal: .` names a construct the
user never wrote and points them nowhere. Standing requirement 4 in its purest form.

- [x] A reference typo that leaves a trailing or doubled dot (`$stats.`, `$a..b`) produces an error that
      names it as an incomplete dotted column reference and does NOT say "number literal". Both halves are
      asserted — the negative is what pins it.
- [x] `.5`, `1.05` and `1.2.3` are unaffected: a number literal that genuinely is one, or genuinely is
      malformed on its own, keeps its existing message.

Explicitly NOT folded in: capping the available-column list (discarded — the columns are the caller's own
tenant data and no AC bounds it; a cap would invent a limit nobody asked for). The Spark divergence is
filed separately by the coordinator; `SparkJobSubmitter` is not touched on this branch.
