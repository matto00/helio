package com.helio.domain.engine

import ExpressionEvaluator.{NumericFunctions, unknownFieldMessage}
import ExpressionParser.{BinOp, Call, Expr, FieldRef, NumLit, StrLit}

// Static result-type inference over the parsed AST.
private[engine] object ExpressionTypeInference {

  private[engine] def inferTypeOf(expr: Expr, fieldTypes: Map[String, String]): Either[String, String] =
    expr match {
      case NumLit(_) => Right("float")
      case StrLit(_) => Right("string")
      case FieldRef(name) =>
        fieldTypes.get(name).toRight(unknownFieldMessage(name, fieldTypes.keySet))
      case BinOp(op, l, r) =>
        for {
          lt <- inferTypeOf(l, fieldTypes)
          rt <- inferTypeOf(r, fieldTypes)
        } yield {
          if (op == '+' && (lt == "string" || rt == "string")) "string"
          else if (op == '+') "float"
          else "float"
        }
      case Call(name, args) =>
        args
          .foldLeft[Either[String, Vector[String]]](Right(Vector.empty)) { (acc, a) =>
            acc.flatMap(ts => inferTypeOf(a, fieldTypes).map(ts :+ _))
          }
          .flatMap { ts =>
            name match {
              case "coalesce"                                         => coalesceType(ts)
              case n if n == "length" || NumericFunctions.contains(n) => Right("float")
              case _ => Right("string") // concat, substring, lower, upper
            }
          }
    }

  /** HEL-1423: `coalesce`'s result type is the arguments' common type. Numeric types are all `VNum`
   *  at run time and every other type is a `VStr`, so a numeric/text mix has no truthful type. */
  private def coalesceType(ts: Vector[String]): Either[String, String] = {
    val numeric = Set("integer", "float")
    if (ts.distinct.size == 1) Right(ts.head)
    else if (ts.forall(numeric)) Right("float")
    else if (!ts.exists(numeric)) Right("string")
    else Left(s"coalesce arguments must all be numbers or all be text; got ${ts.mkString(", ")} — wrap a number in concat() to coalesce it as text")
  }

}
