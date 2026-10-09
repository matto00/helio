#!/usr/bin/env bash
# usage: gen.sh <outdir>   (generates the 4 new files + the reduced entry point from Base.scala)
set -euo pipefail
S=/tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad
B=$S/Base.scala; O=$1
r() { sed -n "$1,$2p" "$B"; }
{
echo 'package com.helio.domain.engine'
echo
echo 'import scala.collection.mutable.ArrayBuffer'
echo
echo '// Tokenizer for the expression language, shared by the strict and legacy parsers.'
echo 'private[engine] object ExpressionTokenizer {'
echo
r 63 78 | sed -e '1s/^  private sealed trait Token$/  private[engine] sealed trait Token/' -e '2s/^  private object Token {$/  private[engine] object Token {/'
echo
r 86 199 | sed -e 's/^  private def tokenize(/  private[engine] def tokenize(/' -e 's/val buf = scala\.collection\.mutable\.ArrayBuffer\.empty\[Token\]/val buf = ArrayBuffer.empty[Token]/'
echo '}'
} > $O/ExpressionTokenizer.scala
{
echo 'package com.helio.domain.engine'
echo
echo 'import ExpressionEvaluator.SupportedFunctions'
echo 'import ExpressionTokenizer.{Token, tokenize}'
echo
echo '// Strict and legacy recursive-descent parsers and the AST they build.'
echo 'private[engine] object ExpressionParser {'
echo
r 80 84
echo
r 202 207 | sed -e 's/^  private sealed trait Expr$/  private[engine] sealed trait Expr/' -e 's/^  private final case class /  private[engine] final case class /'
echo
r 218 231
echo
r 233 360
echo
r 363 371 | sed -e 's/^  private def /  private[engine] def /'
echo '}'
} > $O/ExpressionParser.scala
{
echo 'package com.helio.domain.engine'
echo
echo 'import ExpressionEvaluator.{NumericFunctions, unknownFieldMessage}'
echo 'import ExpressionParser.{BinOp, Call, Expr, FieldRef, NumLit, StrLit}'
echo
echo '// Static result-type inference over the parsed AST.'
echo 'private[engine] object ExpressionTypeInference {'
echo
r 477 515 | sed -e 's/^  private def inferTypeOf(/  private[engine] def inferTypeOf(/'
echo '}'
} > $O/ExpressionTypeInference.scala
{
echo 'package com.helio.domain.engine'
echo
echo 'import spray.json._'
echo
echo 'import ExpressionParser.{BinOp, Call, Expr, FieldRef, NumLit, StrLit}'
echo
echo '// Row evaluation and function dispatch over the parsed AST.'
echo 'private[engine] object ExpressionInterpreter {'
echo
r 517 521 | sed -e 's/^  private sealed trait Val$/  private[engine] sealed trait Val/'
echo
r 574 740 | sed -e 's/^  private def evalExpr(/  private[engine] def evalExpr(/' -e 's/^  private def valToJs(/  private[engine] def valToJs(/'
echo '}'
} > $O/ExpressionInterpreter.scala
{
r 1 3
echo 'import ExpressionInterpreter.{evalExpr, valToJs}'
echo 'import ExpressionParser.{BinOp, Call, Expr, FieldRef, NumLit, StrLit, isDollarPrefixError, parse, parseLegacy}'
echo 'import ExpressionTypeInference.inferTypeOf'
r 4 61
echo
r 209 216
echo
r 373 417
echo
r 420 463
echo
r 466 475
echo
r 523 572
echo '}'
} > $O/ExpressionEvaluator.scala
