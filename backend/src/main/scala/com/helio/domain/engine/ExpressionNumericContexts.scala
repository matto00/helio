package com.helio.domain.engine

import ExpressionEvaluator.NumericFunctions
import ExpressionParser.{BinOp, Call, Expr, FieldRef, Neg}
import ExpressionTypeInference.inferTypeOf

import scala.collection.mutable

// HEL-1403: static scan for text-typed fields used where a number is required.
private[engine] object ExpressionNumericContexts {

  /** Projected types whose run-time value is a `VStr` (`JsBoolean` evaluates as a string too). */
  private val TextTypes: Set[String]    = Set("string", "string-body", "boolean")
  private val NumericTypes: Set[String] = Set("integer", "float")

  /** Every field of `ast` whose type in `fieldTypes` is text-like and that sits in a numeric context
   *  -- an argument of a numeric function, an operand of binary `-`/`*`/`/`, or the operand of unary
   *  `-` -- directly or inside a sub-expression whose inferred type is not numeric. Field collection
   *  descends only through value-propagating positions (`+` operands, `coalesce` arguments, unary
   *  `-`), never into another function's arguments (`floor($s + length($t))` yields `s` only).
   *  Returns `(field, contexts)` in first-seen order, contexts deduped (function name or operator). */
  def textFieldsInNumericContext(ast: Expr, fieldTypes: Map[String, String]): Vector[(String, Vector[String])] = {
    val found = mutable.LinkedHashMap.empty[String, Vector[String]]

    def textRefs(e: Expr): Vector[String] = e match {
      case FieldRef(n) if fieldTypes.get(n).exists(TextTypes.contains) => Vector(n)
      case BinOp('+', l, r)        => textRefs(l) ++ textRefs(r)
      case Call("coalesce", args)  => args.flatMap(textRefs)
      case Neg(inner)              => textRefs(inner)
      case _                       => Vector.empty
    }

    def check(operand: Expr, context: String): Unit =
      inferTypeOf(operand, fieldTypes).toOption.filterNot(NumericTypes.contains).foreach { _ =>
        textRefs(operand).foreach { f =>
          val prior = found.getOrElse(f, Vector.empty)
          if (!prior.contains(context)) found(f) = prior :+ context
        }
      }

    def visit(e: Expr): Unit = e match {
      case BinOp(op, l, r) =>
        if (op == '-' || op == '*' || op == '/') { check(l, op.toString); check(r, op.toString) }
        visit(l); visit(r)
      case Neg(inner) => check(inner, "-"); visit(inner)
      case Call(name, args) =>
        if (NumericFunctions.contains(name)) args.foreach(check(_, name))
        args.foreach(visit)
      case _ => ()
    }

    visit(ast)
    found.toVector
  }
}
