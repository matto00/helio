package com.helio.domain.engine

import ExpressionEvaluator.NumericFunctions
import ExpressionParser.{And, BinOp, Call, Cmp, Expr, FieldRef, Neg, Not, Or}
import ExpressionTypeInference.inferTypeOf

import scala.collection.mutable

// HEL-1403: static scan for text-typed fields used where a number is required.
private[engine] object ExpressionNumericContexts {

  /** Projected types whose run-time value is not a number: a `VStr`, or a `VBool` for a boolean (HEL-1070; a
   *  JsBoolean used to be read as a `VStr`) -- either one nulls the row in a numeric context. */
  private val TextTypes: Set[String]    = Set("string", "string-body", "boolean", "timestamp")
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
      case Call("if", args)        => args.drop(1).flatMap(textRefs) // the two branches propagate a value; the condition does not
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
        else if (name == "add_days") args.lift(1).foreach(check(_, name))
        args.foreach(visit)
      // HEL-1070: no numeric context of their own, but numeric contexts nested inside them still count.
      case Cmp(_, l, r) => visit(l); visit(r)
      case And(l, r)    => visit(l); visit(r)
      case Or(l, r)     => visit(l); visit(r)
      case Not(inner)   => visit(inner)
      case _ => ()
    }

    visit(ast)
    found.toVector
  }
}
