- `backend/src/main/scala/com/helio/domain/engine/ExpressionEvaluator.scala` — reduced to the entry point (741 -> 227 lines): EvaluationError, public API, SupportedFunctions/NumericFunctions, validate/checkRefs/inferType/compile/evaluate; named imports of the moved objects
- `backend/src/main/scala/com/helio/domain/engine/ExpressionTokenizer.scala` — new: Token ADT + tokenize (moved verbatim; ArrayBuffer import replaces one inline FQN)
- `backend/src/main/scala/com/helio/domain/engine/ExpressionParser.scala` — new: AST, DollarPrefixRequiredMsg, checkArity, StrictParser, LegacyParser, parse/parseLegacy/isDollarPrefixError (moved verbatim)
- `backend/src/main/scala/com/helio/domain/engine/ExpressionTypeInference.scala` — new: inferTypeOf + coalesceType (moved verbatim)
- `backend/src/main/scala/com/helio/domain/engine/ExpressionInterpreter.scala` — new: Val ADT, evalExpr, applyOp, applyFn and helpers, valToJs (moved verbatim)
- `backend/src/main/scala/com/helio/domain/engine/README.md` — Holds list names the four new objects

Evidence (change dir): `move-evidence.md`, `api-evidence.md`, `test-count-evidence.md`, `d4-evidence.md`, `move-check/` (checker, javap normaliser, generator, probe).

## Follow-up candidates (found while moving; NOT fixed)
- Stale citations of `PipelineAnalyzeService.inferCompute` (now `ColumnSchemaInference.inferCompute`, HEL-1385) in the entry point's object doc (base L46) and `validate`/`inferType` docs (base L424, L470); the grammar doc names it too. Comment-only fix.
- The design's `Unexpected token in expression: Ident(x)` is unreachable via the public API (strict: `$`-prefix error; legacy: `Ident` is a factor), so the `Ident` arm of the strict parser's `Left(DollarPrefixRequiredMsg)` is the only live Ident path; the "other" arm can only print `Comma/Plus/Minus/Star/Slash/RParen/Ref/FnName` (legacy) tokens.
- `inferTypeOf`'s `BinOp` yield has two identical `"float"` branches (`else if (op == '+') "float" else "float"`).
- `s"Unexpected token after expression"` in both parsers is an interpolator with nothing interpolated.
- `StrictParser` and `LegacyParser` duplicate `parseExpr/parseTerm/peek/advance/parseAll` verbatim (deliberate: the legacy copy is FROZEN).
- `ExpressionEvaluatorSpec.scala` is 852 lines (soft budget 250); `validateTolerant` still has no production caller.
