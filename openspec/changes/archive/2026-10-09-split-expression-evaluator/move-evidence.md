# Move evidence (design D6a) - HEL-1404

Base: origin/main 0f95ec49 `ExpressionEvaluator.scala` (741 lines, saved verbatim as the checker's base via `git show HEAD:...`).
Checker: `move-check/check_move.py` (python3 -I). Forward: each member's base text, with only the listed D3 edits, appears verbatim, contiguous and in source order in its destination. Reverse: every non-blank line of the five resulting files is inside a located member span or matches an allow-listed scaffolding regex (tagged with its D3 category). Also: every base line is assigned exactly once.

```
$ python3 -I move-check/check_move.py Base.scala backend/src/main/scala/com/helio/domain/engine
PASS forward + reverse (28 members, 17 edits, 30 allow-listed lines)
```

## Member inventory (base span -> destination span)

| member | base lines | destination | dest lines |
|---|---|---|---|
| EvaluationError + object doc | 4-59 | ExpressionEvaluator.scala | 7-62 |
| fn lists SupportedFunctions/NumericFunctions | 209-216 | ExpressionEvaluator.scala | 66-73 |
| parseProblem | 373-400 | ExpressionEvaluator.scala | 75-102 |
| unknownFieldMessage | 402-417 | ExpressionEvaluator.scala | 104-119 |
| validate + validateTolerant | 420-451 | ExpressionEvaluator.scala | 121-152 |
| checkRefs | 453-463 | ExpressionEvaluator.scala | 154-164 |
| inferType | 466-475 | ExpressionEvaluator.scala | 166-175 |
| CompiledExpression | 523-530 | ExpressionEvaluator.scala | 177-184 |
| compile | 532-552 | ExpressionEvaluator.scala | 186-206 |
| evaluate | 554-572 | ExpressionEvaluator.scala | 208-226 |
| Token ADT | 63-78 | ExpressionTokenizer.scala | 8-23 |
| tokenizer header + tokenize | 86-199 | ExpressionTokenizer.scala | 25-138 |
| DollarPrefixRequiredMsg | 80-84 | ExpressionParser.scala | 9-13 |
| AST Expr + 5 cases | 202-207 | ExpressionParser.scala | 15-20 |
| checkArity | 218-231 | ExpressionParser.scala | 22-35 |
| StrictParser + LegacyParser (with header comments) | 233-360 | ExpressionParser.scala | 37-164 |
| parse/parseLegacy/isDollarPrefixError | 363-371 | ExpressionParser.scala | 166-174 |
| inferTypeOf + coalesceType | 477-515 | ExpressionTypeInference.scala | 9-47 |
| Val ADT | 517-521 | ExpressionInterpreter.scala | 10-14 |
| evalExpr | 574-607 | ExpressionInterpreter.scala | 16-49 |
| applyOp | 609-629 | ExpressionInterpreter.scala | 51-71 |
| applyFn | 631-708 | ExpressionInterpreter.scala | 73-150 |
| numericUnary | 710-713 | ExpressionInterpreter.scala | 152-155 |
| roundTo | 715-719 | ExpressionInterpreter.scala | 157-161 |
| concatStr | 721-725 | ExpressionInterpreter.scala | 163-167 |
| numStr | 727-728 | ExpressionInterpreter.scala | 169-170 |
| typeName | 730-734 | ExpressionInterpreter.scala | 172-176 |
| valToJs | 736-740 | ExpressionInterpreter.scala | 178-182 |

## Base lines that are scaffolding or blank

- base 1-3: package + `import spray.json._` (entry; interpreter re-imports spray.json._)
- base 60-60: object opener (entry)
- base 741-741: object closer (entry)
- 32 blank separator base lines (D3a): [61, 62, 79, 85, 200, 201, 208, 217, 232, 361, 362, 372, 401, 418, 419, 452, 464, 465, 476, 516, 522, 531, 553, 573, 608, 630, 709, 714, 720, 726, 729, 735]

## D3 edits applied (base line -> new text)

- base 63 [D3b] -> ExpressionTokenizer.scala: `private sealed trait Token` => `private[engine] sealed trait Token`
- base 64 [D3b] -> ExpressionTokenizer.scala: `private object Token` => `private[engine] object Token`
- base 88 [D3b] -> ExpressionTokenizer.scala: `private def tokenize` => `private[engine] def tokenize`
- base 89 [D3c] -> ExpressionTokenizer.scala: `scala.collection.mutable.ArrayBuffer.empty` => `ArrayBuffer.empty`
- base 202 [D3b] -> ExpressionParser.scala: `private sealed trait Expr` => `private[engine] sealed trait Expr`
- base 203 [D3b] -> ExpressionParser.scala: `private final case class` => `private[engine] final case class`
- base 204 [D3b] -> ExpressionParser.scala: `private final case class` => `private[engine] final case class`
- base 205 [D3b] -> ExpressionParser.scala: `private final case class` => `private[engine] final case class`
- base 206 [D3b] -> ExpressionParser.scala: `private final case class` => `private[engine] final case class`
- base 207 [D3b] -> ExpressionParser.scala: `private final case class` => `private[engine] final case class`
- base 363 [D3b] -> ExpressionParser.scala: `private def parse(` => `private[engine] def parse(`
- base 367 [D3b] -> ExpressionParser.scala: `private def parseLegacy(` => `private[engine] def parseLegacy(`
- base 371 [D3b] -> ExpressionParser.scala: `private def isDollarPrefixError(` => `private[engine] def isDollarPrefixError(`
- base 477 [D3b] -> ExpressionTypeInference.scala: `private def inferTypeOf(` => `private[engine] def inferTypeOf(`
- base 518 [D3b] -> ExpressionInterpreter.scala: `private sealed trait Val` => `private[engine] sealed trait Val`
- base 574 [D3b] -> ExpressionInterpreter.scala: `private def evalExpr(` => `private[engine] def evalExpr(`
- base 736 [D3b] -> ExpressionInterpreter.scala: `private def valToJs(` => `private[engine] def valToJs(`

## Allow-listed new lines (reverse check)

- ExpressionEvaluator.scala:1 [D3a package] `package com.helio.domain.engine`
- ExpressionEvaluator.scala:3 [D3a import] `import spray.json._`
- ExpressionEvaluator.scala:4 [D3a import (named, D1)] `import ExpressionInterpreter.{evalExpr, valToJs}`
- ExpressionEvaluator.scala:5 [D3a import (named, D1)] `import ExpressionParser.{BinOp, Call, Expr, FieldRef, NumLit, StrLit, isDollarPrefixError, parse, parseLegacy}`
- ExpressionEvaluator.scala:6 [D3a import (named, D1)] `import ExpressionTypeInference.inferTypeOf`
- ExpressionEvaluator.scala:63 [D3a object opener] `object ExpressionEvaluator {`
- ExpressionEvaluator.scala:227 [D3a object closer] `}`
- ExpressionTokenizer.scala:1 [D3a package] `package com.helio.domain.engine`
- ExpressionTokenizer.scala:3 [D3c import] `import scala.collection.mutable.ArrayBuffer`
- ExpressionTokenizer.scala:5 [D3e header comment] `// Tokenizer for the expression language, shared by the strict and legacy parsers.`
- ExpressionTokenizer.scala:6 [D3a object opener] `private[engine] object ExpressionTokenizer {`
- ExpressionTokenizer.scala:139 [D3a object closer] `}`
- ExpressionParser.scala:1 [D3a package] `package com.helio.domain.engine`
- ExpressionParser.scala:3 [D3a import (named, D1)] `import ExpressionEvaluator.SupportedFunctions`
- ExpressionParser.scala:4 [D3a import (named, D1)] `import ExpressionTokenizer.{Token, tokenize}`
- ExpressionParser.scala:6 [D3e header comment] `// Strict and legacy recursive-descent parsers and the AST they build.`
- ExpressionParser.scala:7 [D3a object opener] `private[engine] object ExpressionParser {`
- ExpressionParser.scala:175 [D3a object closer] `}`
- ExpressionInterpreter.scala:1 [D3a package] `package com.helio.domain.engine`
- ExpressionInterpreter.scala:3 [D3a import] `import spray.json._`
- ExpressionInterpreter.scala:5 [D3a import (named, D1)] `import ExpressionParser.{BinOp, Call, Expr, FieldRef, NumLit, StrLit}`
- ExpressionInterpreter.scala:7 [D3e header comment] `// Row evaluation and function dispatch over the parsed AST.`
- ExpressionInterpreter.scala:8 [D3a object opener] `private[engine] object ExpressionInterpreter {`
- ExpressionInterpreter.scala:183 [D3a object closer] `}`
- ExpressionTypeInference.scala:1 [D3a package] `package com.helio.domain.engine`
- ExpressionTypeInference.scala:3 [D3a import (named, D1)] `import ExpressionEvaluator.{NumericFunctions, unknownFieldMessage}`
- ExpressionTypeInference.scala:4 [D3a import (named, D1)] `import ExpressionParser.{BinOp, Call, Expr, FieldRef, NumLit, StrLit}`
- ExpressionTypeInference.scala:6 [D3e header comment] `// Static result-type inference over the parsed AST.`
- ExpressionTypeInference.scala:7 [D3a object opener] `private[engine] object ExpressionTypeInference {`
- ExpressionTypeInference.scala:48 [D3a object closer] `}`

## File sizes

- ExpressionEvaluator.scala: 227 lines
- ExpressionTokenizer.scala: 139 lines
- ExpressionParser.scala: 175 lines
- ExpressionInterpreter.scala: 183 lines
- ExpressionTypeInference.scala: 48 lines

## Red runs (scratch copies outside the worktree; the real files were not touched)

### Red 1 - one token changed in a moved body (forward must fail)
`ExpressionInterpreter.scala` copy: `math.max(0, math.min(startD.toInt, len))` -> `math.max(1, math.min(startD.toInt, len))` (inside `applyFn`/`substring`).
```
FAIL
  FORWARD: applyFn (base 631-708) not found verbatim, in order, in ExpressionInterpreter.scala
  REVERSE: ExpressionInterpreter.scala:73 unclaimed line: '  /** Function-call semantics (design.md Decision 3). Null-propagating like'
  REVERSE: ExpressionInterpreter.scala:74 unclaimed line: '   *  `applyOp`: if any argument evaluates to null, the result is null rather than'
...
(total failure lines incl. the unclaimed applyFn body: 72)
exit=1
```

### Red 2 - a copied existing line inserted outside any member (reverse must fail)
`ExpressionParser.scala` copy: `  private var pos: Int = 0` (an existing line from `StrictParser`) inserted right after the object opener.
```
FAIL
  REVERSE: ExpressionParser.scala:8 unclaimed line: '  private var pos: Int = 0'
exit=1
```

Both red runs failed as required; the real files PASS (top of this file).

## git diff --color-moved=plain summary

`git diff --color-moved=plain` over the five engine files (new files marked with `git add -N`): lines coloured as moved vs not. The non-moved lines are listed in full below (non-blank only); every one is a D3 category line (imports, object opener/closer, header comment, D3b widening, D3c ArrayBuffer, the entry point reduced).
```
moved +/- lines: 1005  non-moved +/- lines: 60
non-moved nonblank lines:
   +import ExpressionInterpreter.{evalExpr, valToJs}
   +import ExpressionParser.{BinOp, Call, Expr, FieldRef, NumLit, StrLit, isDollarPrefixError, parse, parseLegacy}
   +import ExpressionTypeInference.inferTypeOf
   -  private sealed trait Token
   -  private object Token {
   -  private def tokenize(input: String): Either[String, Vector[Token]] = {
   -    val buf = scala.collection.mutable.ArrayBuffer.empty[Token]
   -  private sealed trait Expr
   -  private final case class NumLit(v: Double)          extends Expr
   -  private final case class StrLit(s: String)          extends Expr
   -  private final case class FieldRef(name: String)     extends Expr
   -  private final case class BinOp(op: Char, l: Expr, r: Expr) extends Expr
   -  private final case class Call(name: String, args: Vector[Expr]) extends Expr
   -  private def parse(expr: String): Either[String, Expr] =
   -  private def parseLegacy(expr: String): Either[String, Expr] =
   -  private def isDollarPrefixError(msg: String): Boolean = msg == DollarPrefixRequiredMsg
   -  private def inferTypeOf(expr: Expr, fieldTypes: Map[String, String]): Either[String, String] =
   -  private sealed trait Val
   -  private def evalExpr(expr: Expr, row: Map[String, JsValue]): Either[EvaluationError, Val] =
   -  private def valToJs(v: Val): JsValue = v match {
   +package com.helio.domain.engine
   +import spray.json._
   +import ExpressionParser.{BinOp, Call, Expr, FieldRef, NumLit, StrLit}
   +// Row evaluation and function dispatch over the parsed AST.
   +private[engine] object ExpressionInterpreter {
   +  private[engine] sealed trait Val
   +  private[engine] def evalExpr(expr: Expr, row: Map[String, JsValue]): Either[EvaluationError, Val] =
   +  private[engine] def valToJs(v: Val): JsValue = v match {
   +}
   +package com.helio.domain.engine
   +import ExpressionEvaluator.SupportedFunctions
   +import ExpressionTokenizer.{Token, tokenize}
   +// Strict and legacy recursive-descent parsers and the AST they build.
   +private[engine] object ExpressionParser {
   +  private[engine] sealed trait Expr
   +  private[engine] final case class NumLit(v: Double)          extends Expr
   +  private[engine] final case class StrLit(s: String)          extends Expr
   +  private[engine] final case class FieldRef(name: String)     extends Expr
   +  private[engine] final case class BinOp(op: Char, l: Expr, r: Expr) extends Expr
   +  private[engine] final case class Call(name: String, args: Vector[Expr]) extends Expr
   +  private[engine] def parse(expr: String): Either[String, Expr] =
   +  private[engine] def parseLegacy(expr: String): Either[String, Expr] =
   +  private[engine] def isDollarPrefixError(msg: String): Boolean = msg == DollarPrefixRequiredMsg
   +}
   +package com.helio.domain.engine
   +import scala.collection.mutable.ArrayBuffer
   +// Tokenizer for the expression language, shared by the strict and legacy parsers.
   +private[engine] object ExpressionTokenizer {
   +  private[engine] sealed trait Token
   +  private[engine] object Token {
   +  private[engine] def tokenize(input: String): Either[String, Vector[Token]] = {
   +    val buf = ArrayBuffer.empty[Token]
   +}
   +package com.helio.domain.engine
   +import ExpressionEvaluator.{NumericFunctions, unknownFieldMessage}
   +import ExpressionParser.{BinOp, Call, Expr, FieldRef, NumLit, StrLit}
   +// Static result-type inference over the parsed AST.
   +private[engine] object ExpressionTypeInference {
   +  private[engine] def inferTypeOf(expr: Expr, fieldTypes: Map[String, String]): Either[String, String] =
   +}
```

Inline-FQN grep (`scala.`/`java.`/`spray.`/`com.helio.` qualifiers outside import/package lines) over all five files, including inside `s"${...}"`: empty (exit 1 = no match).
```
$ grep -nE "\b(scala|java|spray|com\.helio)\.[a-z]" ExpressionEvaluator.scala ExpressionTokenizer.scala ExpressionParser.scala ExpressionInterpreter.scala ExpressionTypeInference.scala | grep -vE "^\S+:[0-9]+:(import|package)"
(no output) exit=1
```

## D3 deviations from the design

- None needed: it compiled first time with exactly the design's D1 import lists and D3b widening list. No added import name, no extra widening, no D3(d) positional-comment edit (the only positional words, `parseProblem` above in `evaluate`'s doc, still hold: both stay in the entry point, in the same order).
- D3(c): the single inline FQN is replaced as designed (`import scala.collection.mutable.ArrayBuffer` + `ArrayBuffer.empty[Token]`, base L89).
