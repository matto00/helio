package com.helio.domain.engine

import ExpressionEvaluator.NumericFunctions
import ExpressionParser.{And, BinOp, Call, Cmp, Expr, FieldRef, Neg, Not, NumLit, Or, StrLit}
import ExpressionTypeInference.inferTypeOf

import scala.collection.mutable

// HEL-1403 / HEL-1455: static scans for operands of the wrong type: text fields used where a number is required,
// numeric fields given to a text function, and literals of the wrong type in either position.
private[engine] object ExpressionNumericContexts {

  /** Projected types whose run-time value is not a number: a `VStr`, or a `VBool` for a boolean (HEL-1070; a
   *  JsBoolean used to be read as a `VStr`) -- either one nulls the row in a numeric context. */
  private val TextTypes: Set[String]    = Set("string", "string-body", "boolean", "timestamp")
  private val NumericTypes: Set[String] = Set("integer", "float")

  /** Functions whose first argument must be text (a `VNum` raises a TypeError, which nulls the row). */
  private val TextFunctions: Set[String] = Set("length", "lower", "upper", "substring")

  /** Every node of `ast` (pre-order), walked with an explicit stack. */
  private def nodes(ast: Expr): Vector[Expr] = {
    val out   = Vector.newBuilder[Expr]
    val stack = mutable.Stack[Expr](ast)
    while (stack.nonEmpty) {
      val e = stack.pop()
      out += e
      e match {
        case BinOp(_, l, r) => stack.push(r); stack.push(l)
        case Cmp(_, l, r)   => stack.push(r); stack.push(l)
        case And(l, r)      => stack.push(r); stack.push(l)
        case Or(l, r)       => stack.push(r); stack.push(l)
        case Neg(x)         => stack.push(x)
        case Not(x)         => stack.push(x)
        case Call(_, args)  => args.reverseIterator.foreach(stack.push)
        case _              => ()
      }
    }
    out.result()
  }

  /** The operands of `e` that must be numbers, each with its context (function name or operator): arguments of a
   *  numeric function, the day count of `add_days`, the start and end of `substring`, the operands of binary
   *  `-`/`*`/`/` and the operand of unary `-`. */
  private def numericOperands(e: Expr): Vector[(Expr, String)] = e match {
    case BinOp(op, l, r) if op == '-' || op == '*' || op == '/' => Vector(l -> op.toString, r -> op.toString)
    case Neg(inner)                                           => Vector(inner -> "-")
    case Call(name, args) if NumericFunctions.contains(name)  => args.map(_ -> name)
    case Call("add_days", args)                               => args.lift(1).map(_ -> "add_days").toVector
    case Call("substring", args)                              => args.drop(1).map(_ -> "substring")
    case _                                                    => Vector.empty
  }

  /** The text argument (always the first) of each text function, with the function name. */
  private def textOperands(e: Expr): Vector[(Expr, String)] = e match {
    case Call(name, args) if TextFunctions.contains(name) => args.headOption.map(_ -> name).toVector
    case _                                                => Vector.empty
  }

  /** Collects `refs` per field in first-seen order, deduping the contexts. */
  private def collect(hits: Iterator[(String, String)]): Vector[(String, Vector[String])] = {
    val found = mutable.LinkedHashMap.empty[String, Vector[String]]
    hits.foreach { case (f, context) =>
      val prior = found.getOrElse(f, Vector.empty)
      if (!prior.contains(context)) found(f) = prior :+ context
    }
    found.toVector
  }

  /** Every field of `ast` whose type in `fieldTypes` is text-like and that sits in a numeric context
   *  -- an argument of a numeric function, an operand of binary `-`/`*`/`/`, the operand of unary
   *  `-`, or `add_days`' day count or `substring`'s start/end -- directly or inside a sub-expression whose inferred type is not numeric. Field collection
   *  descends only through value-propagating positions (`+` operands, `coalesce` arguments, unary
   *  `-`), never into another function's arguments (`floor($s + length($t))` yields `s` only).
   *  Returns `(field, contexts)` in first-seen order, contexts deduped (function name or operator). */
  def textFieldsInNumericContext(ast: Expr, fieldTypes: Map[String, String]): Vector[(String, Vector[String])] = {
    def textRefs(e: Expr): Vector[String] = e match {
      case FieldRef(n) if fieldTypes.get(n).exists(TextTypes.contains) => Vector(n)
      case BinOp('+', l, r)        => textRefs(l) ++ textRefs(r)
      case Call("coalesce", args)  => args.flatMap(textRefs)
      case Call("if", args)        => args.drop(1).flatMap(textRefs) // the two branches propagate a value; the condition does not
      case Neg(inner)              => textRefs(inner)
      case _                       => Vector.empty
    }

    collect(for {
      node            <- nodes(ast).iterator
      (operand, ctx)  <- numericOperands(node).iterator
      if inferTypeOf(operand, fieldTypes).toOption.exists(!NumericTypes.contains(_))
      f               <- textRefs(operand).iterator
    } yield f -> ctx)
  }

  /** HEL-1455 4a: every `integer`/`float` field of `ast` passed as the text argument of `length`/`lower`/`upper`/
   *  `substring`, directly or inside a numeric sub-expression. Collection descends through value-propagating
   *  positions only (unary `-`, binary operators, `coalesce` arguments, `if` branches), never into a `+` that
   *  infers text (that concatenates, so the argument is text). An argument that also references a field in
   *  `untrusted` yields nothing: a mixed-trust argument cannot support an "every row" claim. */
  def numericFieldsInTextFunction(ast: Expr, fieldTypes: Map[String, String], untrusted: Set[String]): Vector[(String, Vector[String])] = {
    def numericRefs(e: Expr): Vector[String] = e match {
      case FieldRef(n) if fieldTypes.get(n).exists(NumericTypes.contains) => Vector(n)
      case BinOp(_, _, _) if inferTypeOf(e, fieldTypes).toOption.exists(!NumericTypes.contains(_)) => Vector.empty
      case BinOp(_, l, r)         => numericRefs(l) ++ numericRefs(r)
      case Call("coalesce", args) => args.flatMap(numericRefs)
      case Call("if", args)       => args.drop(1).flatMap(numericRefs)
      case Neg(inner)             => numericRefs(inner)
      case _                      => Vector.empty
    }

    collect(for {
      node           <- nodes(ast).iterator
      (operand, ctx) <- textOperands(node).iterator
      if inferTypeOf(operand, fieldTypes).toOption.exists(NumericTypes.contains)
      if !nodes(operand).exists { case FieldRef(n) => untrusted.contains(n); case _ => false }
      f              <- numericRefs(operand).iterator
    } yield f -> ctx)
  }

  /** HEL-1455 4b: `(literal, context)` for each wrong-type literal that fails on every row: a string literal that
   *  sits directly in a numeric context or under `+` operands from one (a `+` with a string literal is always text), and a
   *  number literal in a text function's argument reached through unary `-` or `-`/`*`/`/` operands. Never through
   *  `coalesce`, `if` or a comparison, where the row need not be null. A nested `-`/`*`/`/`/unary `-` is a context
   *  of its own, so it is not descended into. Does not depend on field types. */
  def wrongTypeLiterals(ast: Expr): Vector[(String, String)] = {
    def strLits(e: Expr): Vector[String] = e match {
      case StrLit(s)        => Vector("\"" + s + "\"")
      case BinOp('+', l, r) => strLits(l) ++ strLits(r)
      case _                => Vector.empty
    }
    def numLits(e: Expr): Vector[String] = e match {
      case NumLit(v)                                              => Vector(if (v == v.toLong.toDouble) v.toLong.toString else v.toString)
      case Neg(inner)                                             => numLits(inner)
      case BinOp(op, l, r) if op == '-' || op == '*' || op == '/' => numLits(l) ++ numLits(r)
      case _                                                      => Vector.empty
    }
    val hits = nodes(ast).flatMap { node =>
      numericOperands(node).flatMap { case (operand, ctx) => strLits(operand).map(_ -> ctx) } ++
        textOperands(node).flatMap { case (operand, ctx) => numLits(operand).map(_ -> ctx) }
    }
    hits.distinct
  }
}
