## Context

See proposal.md. File at origin/main 0f95ec49: `backend/src/main/scala/com/helio/domain/engine/ExpressionEvaluator.scala`,
741 lines, Scala 2.13.15. Layout (base line numbers, doc comments included with the member they precede):

- 1-22 top-level `sealed trait EvaluationError` + companion (four case classes).
- 24-59 the object's grammar/strict-vs-legacy doc; 60 `object ExpressionEvaluator {`.
- 63-78 `Token` ADT; 80-84 `DollarPrefixRequiredMsg`; 86 tokenizer header comment; 88-200 `tokenize`.
- 202-207 `Expr` AST; 209-216 `SupportedFunctions`, `NumericFunctions`; 218-231 `checkArity`; 233-312 `StrictParser`
  (with header comment); 314-361 `LegacyParser` (with its FROZEN header comment); 363-371 `parse`, `parseLegacy`,
  `isDollarPrefixError`.
- 373-395 `parseProblem`; 397-419 `unknownFieldMessage`; 421-450 `validate`, `validateTolerant`; 453-463 `checkRefs`.
- 465-475 `inferType`; 477-506 `inferTypeOf`; 508-515 `coalesceType` (HEL-1423).
- 517-521 `Val`; 523-530 `CompiledExpression`; 532-572 `compile`, `evaluate`; 574-740 `evalExpr`, `applyOp`, `applyFn`,
  `numericUnary`, `roundTo`, `concatStr`, `numStr`, `typeName`, `valToJs`; 741 `}`.
(Exact spans are re-derived by the executor's inventory, D6a; these are orientation only.)

Callers outside the file use only: `validate`, `inferType`, `compile`, `CompiledExpression.eval`, `parseProblem`,
`evaluate`, `validateTolerant` (spec only), `EvaluationError.*`, and the `private[engine]` `SupportedFunctions`,
`NumericFunctions` (spec only, `ExpressionEvaluatorSpec` ~L718-773: the NumericFunctions classification test and the
SupportedFunctions-vs-dispatcher probe) and `unknownFieldMessage` (`EvaluationError.UnknownField.message`).
No caller is edited.

## Goals / Non-Goals

Goals: concern-focused files near the ~250-line budget; identical behaviour; zero test-source diff; reviewers can tell
moves from edits. Non-goals: see proposal.md (notably HEL-1403 / HEL-1070, and any defect fix).

## Decisions

**D1 - Entry point keeps name, package, public API, and the two function lists.** `ExpressionEvaluator.scala` keeps
verbatim: `EvaluationError` (top-level, unchanged), the object doc comment, `SupportedFunctions`, `NumericFunctions`,
`parseProblem`, `unknownFieldMessage`, `validate`, `validateTolerant`, `checkRefs`, `inferType`, `CompiledExpression`,
`compile`, `evaluate`, each with its comment. Bodies keep their unqualified text; the names they use from moved code
(`parse`, `parseLegacy`, `isDollarPrefixError`, `Expr` and its five cases, `inferTypeOf`, `evalExpr`, `valToJs`) come
in through top-of-file named imports of the destination objects (no same-named member remains in the entry point, so
no ambiguity). `inferType` keeps its body `parse(expr).flatMap(ast => inferTypeOf(ast, fieldTypes))` and stays the
public entry for inference.

Named imports per file (the executor adds a name only if compilation requires it, and lists any addition):
- `ExpressionEvaluator.scala`: `spray.json._` (as today); `ExpressionParser.{BinOp, Call, Expr, FieldRef, NumLit, StrLit,
  isDollarPrefixError, parse, parseLegacy}`; `ExpressionTypeInference.inferTypeOf`;
  `ExpressionInterpreter.{evalExpr, valToJs}`.
- `ExpressionTokenizer.scala`: `scala.collection.mutable.ArrayBuffer` (D3(c)).
- `ExpressionParser.scala`: `ExpressionEvaluator.SupportedFunctions` (read by `checkArity`);
  `ExpressionTokenizer.{Token, tokenize}`.
- `ExpressionTypeInference.scala`: `ExpressionEvaluator.{NumericFunctions, unknownFieldMessage}` (`inferTypeOf` calls
  `unknownFieldMessage` at base L482); `ExpressionParser.{BinOp, Call, Expr, FieldRef, NumLit, StrLit}`.
- `ExpressionInterpreter.scala`: `spray.json._`; `ExpressionParser.{BinOp, Call, Expr, FieldRef, NumLit, StrLit}`.

`SupportedFunctions` and `NumericFunctions` are NOT moved and NOT duplicated: they stay single-sourced in
`ExpressionEvaluator`, exactly where `ExpressionEvaluatorSpec` reads them. The moved readers (`checkArity` in the
parser for `SupportedFunctions`; `inferTypeOf` in type inference for `NumericFunctions`) reach them through a named
import `import ExpressionEvaluator.{...}`. This is the ticket's "keep the NumericFunctions list shared by inference and
the parity test", and it keeps both vals' bytecode accessors on `ExpressionEvaluator$` (D6b).

**D2 - Destinations (same package, each a `private[engine] object`).** Base spans per Context:
- `ExpressionTokenizer.scala` - `Token` ADT (63-78), tokenizer header comment + `tokenize` (86-200).
- `ExpressionParser.scala` - the AST (`Expr` + `NumLit`/`StrLit`/`FieldRef`/`BinOp`/`Call`, 202-207),
  `DollarPrefixRequiredMsg` (80-84, it is the strict parser's own message and the legacy-retry key), `checkArity`
  (218-231), `StrictParser` (233-312), `LegacyParser` (314-361), `parse`/`parseLegacy`/`isDollarPrefixError`
  (363-371). The ticket groups "strict and legacy parsers plus the AST"; this follows it.
- `ExpressionTypeInference.scala` - `inferTypeOf` and `coalesceType` (477-515).
- `ExpressionInterpreter.scala` - "evaluation and function dispatch": `Val` (517-521) and `evalExpr` through
  `valToJs` (574-740).
Lines no member claims (package/imports, the object opener/closer, blank separator lines) are allow-listed scaffolding
in the inventory. Names are self-approved. The executor may move a member elsewhere only if compilation forces it,
recorded in evidence.

**D3 - Bodies move byte-identical.** Members keep their 2-space object-body indentation and their relative order
within each destination (source order). Allowed non-move lines only:
(a) package line, imports, object opener/closer, blank lines between moved blocks;
(b) `private` -> `private[engine]` on exactly the members now referenced across objects: `Token` (trait + its
    companion object), `tokenize`, `Expr` + the five case classes, `parse`, `parseLegacy`, `isDollarPrefixError`,
    `inferTypeOf`, `Val` (trait only: the widened `evalExpr`/`valToJs` name it in their signatures), `evalExpr`,
    `valToJs`. Everything else keeps `private` (`VNum`/`VStr`/`VNull`, used only inside the interpreter; `checkArity`, both parser classes, `DollarPrefixRequiredMsg`, `coalesceType`, `applyOp`, `applyFn`,
    `numericUnary`, `roundTo`, `concatStr`, `numStr`, `typeName`). If the compiler forces another widening, it is
    listed in evidence with the error that forced it;
(c) one inline FQN in moved code, `scala.collection.mutable.ArrayBuffer.empty[Token]` in `tokenize` (base L89),
    becomes a top-of-file `import scala.collection.mutable.ArrayBuffer` plus `ArrayBuffer.empty[Token]` (CONTRIBUTING
    "no inline FQNs"; `check:scala-quality` does not scan `scala.*` per HEL-1446, so this is eyeballed). The executor
    greps every new and touched file for other inline `scala.`/`java.`/`spray.`/`com.helio.` qualifiers, including
    inside `s"${...}"`, and records the (expected empty) result;
(d) positional words in comments that the move made false (e.g. "`parseProblem` above"), each listed;
(e) a one-line header comment per new object saying which concern it holds (allow-listed "scaffolding comment").
No other edit. Defects or oddities noticed while moving are listed as follow-up candidates in `files-modified.md`,
not fixed.

**D4 - User-visible text that depends on class names stays identical.** Two messages embed case-class `toString`:
`applyOp`'s `DivisionByZero(expr.toString)` (e.g. `BinOp(/,FieldRef(a),NumLit(0.0))`) and both parsers'
`Unexpected token in expression: $other` (e.g. `Ident(x)`). Case-class `toString` uses the simple class name only,
not the enclosing object, so moving the classes to another object does not change these strings as long as no ADT
class is renamed. No ADT class or case object is renamed. Evidence: the executor shows (from the spec or a scratch
probe outside `backend/src/test`) one before/after pair of each message, identical.

**D5 - Initialisation.** The new objects hold only `def`s, classes, and the `DollarPrefixRequiredMsg` string constant.
The only cross-object val reads are `checkArity`/`inferTypeOf` reading `ExpressionEvaluator`'s two `Vector` vals at
call time (not at object init), and `ExpressionEvaluator`'s init reads nothing from the new objects. No init cycle can
observe a null.

**D6 - Evidence (in this change dir; scripts may live in `move-check/` here or the scratchpad).**
(a) `move-evidence.md`: inventory assigning every line of the base file to exactly one destination member span or one
allow-listed D3 category; a checker that is forward (each member's base text byte-equals its new text, modulo the D3
edits, each listed) and positional reverse (every line of the five resulting files is claimed by exactly one member
span or one allow-listed line tagged with its D3 category). Red runs on scratch copies: one token changed in a moved
body (forward fails); a copied existing line inserted outside any member (reverse fails). Plus a
`git diff --color-moved=plain` summary.
(b) `api-evidence.md`: `javap -public` (from the sbt-built classes) of `ExpressionEvaluator`, `ExpressionEvaluator$`,
`ExpressionEvaluator$CompiledExpression`, `EvaluationError`, `EvaluationError$`, and each `EvaluationError$X` /
`EvaluationError$X$` for X in DivisionByZero, UnknownField, ParseError, TypeError, before vs after.
**Predicted deltas, stated up front (everything else must be byte-identical):**
  1. `Compiled from "..."` lines: unchanged for all of these classes, because every one of them stays in
     `ExpressionEvaluator.scala`. Any change there is a failure.
  2. Public synthetic lambda methods `$anonfun$<name>$N` (public in Scala 2.13). scalac numbers lambdas with a
     per-compilation-unit counter, so lambdas of members that stay may renumber when lambdas of moved members leave the
     unit (HEL-1376 hit exactly this: an N -> N-k bijection). Normalisation: rewrite only the numeric suffix of
     `$anonfun$<name>$N` (and its `$adapted` bridge) to a placeholder; after that the dumps must be identical in
     original line order, with no other filtering. Lambdas whose enclosing member moved out disappear from
     `ExpressionEvaluator$` entirely; each disappearing `$anonfun$<name>` is listed and every `<name>` must be a moved
     member.
  3. Scalac expanded-name accessors (names containing `$$`, e.g. `com$helio$domain$engine$ExpressionEvaluator$$evalExpr`)
     that exist only because a `private` member was reached from a nested class. They may disappear because the member
     moved; each is listed and must name a moved member. None may appear.
  4. `ExpressionEvaluator$CompiledExpression`'s constructor parameter type changes from
     `ExpressionEvaluator$Expr` to `ExpressionParser$Expr`. In Scala the constructor is `private[engine]` and `Expr`
     was `private`, so neither was reachable outside the package; this is the one non-synthetic delta, and it is the
     direct consequence of the ticket's "parsers plus the AST" grouping.
  5. Lambda descriptors that name a moved private type. Seven lambdas of members that STAY take a moved type as a
     parameter (verified against the baseline build by the design-gate skeptic): in `ExpressionEvaluator$`,
     `$anonfun$validate$1`, `$anonfun$validateTolerant$1`, `$anonfun$checkRefs$1/2/3`, `$anonfun$inferType$1` take
     `com.helio.domain.engine.ExpressionEvaluator$Expr`; in `ExpressionEvaluator$CompiledExpression`, `$anonfun$eval$1`
     takes `ExpressionEvaluator$Val`. After the split these name `ExpressionParser$Expr` / `ExpressionInterpreter$Val`.
     Normalisation for this delta: on `$anonfun$` lines only, rewrite exactly the two strings
     `ExpressionEvaluator$Expr` -> `ExpressionParser$Expr` and `ExpressionEvaluator$Val` -> `ExpressionInterpreter$Val`
     (applied to the BEFORE dump), and list every line it touched; the count must be exactly 7 unless renumbering
     (delta 2) explains a difference, which is then itemised. Non-`$anonfun$` lines get no type rewriting.
  The normalised diff is computed in this fixed order, each step's touched lines listed in api-evidence.md:
    (i) delta-2 suffix normalisation on every `$anonfun$` line, both dumps;
    (ii) remove from the BEFORE dump every `$anonfun$<name>` / `$$` line (deltas 2-3) whose `<name>` is a moved member,
         each listed and checked against D2's member list (at baseline this includes the lambdas of `inferTypeOf`,
         `evalExpr` and `applyFn`; none may be removed for a kept member);
    (iii) delta-5 type rewriting on the REMAINING `$anonfun$` lines of the BEFORE dump; it must touch exactly the 7
          lines named in delta 5, no more and no fewer;
    (iv) delta-4 rewrite of the single `CompiledExpression` constructor line;
    (v) the BEFORE and AFTER dumps must then be identical in original line order. The result must be empty.
  The red run: temporarily change a parameter type or default on a kept public member (e.g. `evaluate`), rebuild, show
  a non-empty normalised diff, revert. Also list the class-file set under `com/helio/domain/engine/` whose names start
  `ExpressionEvaluator$` before vs after: the removed ones must all be either the moved private nested types
  (`Token*`, `NumLit*`, ..., `StrictParser`, `LegacyParser`, `V*`) or synthetic anonymous-function classes whose
  enclosing member moved. At baseline the latter is exactly one:
  `ExpressionEvaluator$$anonfun$com$helio$domain$engine$ExpressionEvaluator$$evalExpr$1` (the partial function of
  `evalExpr`'s `collectFirst`, base L598); it is expected to reappear under the interpreter's name. No non-private type,
  and no anonymous class of a kept member, may be among the removed ones, and none may be added.
(c) `test-count-evidence.md`: baseline `nice -n 19 sbt -J-Xmx3g testFull` on the unmodified worktree (total, plus
per-suite counts for `ExpressionEvaluatorSpec`, `ComputeCoalesceCsvSpec`, `PipelineAnalyzeServiceSpec`,
`AnalyzeSchemaWarningsSpec`, and every spec whose name contains `Compute`); the after run matches and passes. Known
flakes (HEL-1439, HEL-1445): re-run once and note; twice red means investigate. The suite outlives one Bash call: run
it backgrounded to a scratchpad log and poll with `scripts/concertino/await-sentinel.sh` or bounded waits.
`git diff <base>...HEAD -- backend/src/test` must be empty.
(d) D4's message pairs.

## Risks / Trade-offs

- [CompiledExpression ctor + 7 lambda descriptors change type] -> predicted deltas D6b.4/D6b.5, all Scala-unreachable
  outside the package. Keeping the AST (and `Val`) in the entry point WOULD avoid them: Scala-private nested types are
  already public classes in bytecode, so widening them to `private[engine]` changes nothing in `javap -public`. It is
  rejected for one reason only: the ticket (AC1) groups the AST with the parsers, and evaluation's `Val` with the
  evaluator. Accepted.
- [Lambda renumbering] -> predicted and normalised, D6b.2 (stated now, not discovered after a PASS).
- [Error text depends on case-class names] -> D4, no renames.
- [Entry point still ~250 lines] -> mostly doc comments of the public API; accepted.
- [Widened `private[engine]` members] -> package-only, inside `private[engine]` objects; as in earlier splits.
- [HEL-1403 queued next] -> it will land in `ExpressionParser.scala`/`ExpressionTokenizer.scala`; this change adds no
  grammar.

## Planner Notes

- Self-approved: four destination files matching the ticket's four seams; `checkRefs` stays with `validate` in the
  entry point (validation is part of the public surface, not a seam the ticket names).
- Self-approved: `EvaluationError` stays in `ExpressionEvaluator.scala` (public top-level type, not a named seam).
- Driver claim corrected: `coalesce`'s type rule lives here (`coalesceType`), not in `ColumnSchemaInference.inferCompute`.
