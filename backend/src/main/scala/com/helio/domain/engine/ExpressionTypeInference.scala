package com.helio.domain.engine

import ExpressionEvaluator.{NumericFunctions, unknownFieldMessage}
import ExpressionParser.{And, BinOp, BoolLit, Call, Cmp, Expr, FieldRef, Neg, Not, NumLit, Or, StrLit}

// Static result-type inference over the parsed AST.
private[engine] object ExpressionTypeInference {

  /** Types whose `+` result is text: a timestamp is text at evaluation time, and a boolean concatenates
   *  as `true`/`false`. */
  private val TextLike = Set("string", "timestamp", "boolean")

  private val NumericTypes = Set("integer", "float")
  private val TextTypes    = Set("string", "string-body", "timestamp")

  private val BooleanAsNumberHint =
    "a boolean expression cannot be used as a number; convert it first with if(cond, 1, 0)"

  private[engine] def inferTypeOf(expr: Expr, fieldTypes: Map[String, String]): Either[String, String] =
    expr match {
      case NumLit(_)  => Right("float")
      case StrLit(_)  => Right("string")
      case BoolLit(_) => Right("boolean")
      case FieldRef(name) =>
        fieldTypes.get(name).toRight(unknownFieldMessage(name, fieldTypes.keySet))
      case BinOp(op, l, r) =>
        for {
          lt <- inferTypeOf(l, fieldTypes)
          rt <- inferTypeOf(r, fieldTypes)
          _  <- if (op == '+') Right(()) else noBooleanExprs(s"'$op'", Seq(l -> lt, r -> rt))
        } yield {
          // A timestamp value is text at evaluation time (cast keeps the string, SQL timestamps are
          // stringified), so `+` with one concatenates rather than adds.
          if (op == '+' && (TextLike(lt) || TextLike(rt))) "string"
          else "float"
        }
      // Same rule as binary `-`: always numeric, whatever the operand (an unknown field still fails).
      case Neg(e) =>
        inferTypeOf(e, fieldTypes).flatMap(t => noBooleanExprs("unary '-'", Seq(e -> t))).map(_ => "float")
      case Cmp(op, l, r) =>
        for {
          lt <- inferTypeOf(l, fieldTypes)
          rt <- inferTypeOf(r, fieldTypes)
          _  <- checkComparable(op, lt, rt)
        } yield "boolean"
      case And(l, r) => booleanOperands("and", Seq(l, r), fieldTypes)
      case Or(l, r)  => booleanOperands("or", Seq(l, r), fieldTypes)
      case Not(e)    => booleanOperands("not", Seq(e), fieldTypes)
      case Call(name, args) =>
        args
          .foldLeft[Either[String, Vector[String]]](Right(Vector.empty)) { (acc, a) =>
            acc.flatMap(ts => inferTypeOf(a, fieldTypes).map(ts :+ _))
          }
          .flatMap { ts =>
            name match {
              case "coalesce" => commonType("coalesce", ts)
              case "if" =>
                if (ts.head == "boolean") commonType("if", ts.tail)
                else Left(s"if requires a boolean condition, got ${ts.head}; use a comparison such as $$x = 1")
              case "length" => Right("float") // text function: a boolean argument reads as `true`/`false`
              case n if NumericFunctions.contains(n) =>
                noBooleanExprs(n, args.zip(ts)).map(_ => "float")
              case "seconds_between" => Right("float")
              case "add_days"        => noBooleanExprs(name, args.zip(ts).drop(1)).map(_ => "timestamp")
              case "date_trunc"      => Right("timestamp")
              case _ => Right("string") // concat, substring, lower, upper
            }
          }
    }

  private def booleanOperands(op: String, operands: Seq[Expr], fieldTypes: Map[String, String]): Either[String, String] =
    operands
      .foldLeft[Either[String, Vector[String]]](Right(Vector.empty)) { (acc, e) =>
        acc.flatMap(ts => inferTypeOf(e, fieldTypes).map(ts :+ _))
      }
      .flatMap { ts =>
        if (ts.forall(_ == "boolean")) Right("boolean")
        else Left(s"'$op' requires boolean operands, got ${ts.mkString(" and ")}")
      }

  private def kindOf(t: String): Option[String] =
    if (NumericTypes(t)) Some("number") else if (TextTypes(t)) Some("text") else if (t == "boolean") Some("boolean") else None

  /** Comparison typing (D6): both sides one kind; booleans only `=`/`!=`. The number-vs-text message tells the
   *  user how to fix it (cast step, or `seconds_between` for an instant comparison). */
  private def checkComparable(op: String, lt: String, rt: String): Either[String, Unit] =
    (kindOf(lt), kindOf(rt)) match {
      case (Some(a), Some(b)) if a == b =>
        if (a == "boolean" && op != "=" && op != "!=") Left(s"'$op' cannot order boolean values (got $lt and $rt); booleans support only '=' and '!='")
        else Right(())
      case (Some(a), Some(b)) =>
        val base = s"'$op' cannot compare $lt with $rt"
        if (Set(a, b) == Set("number", "text")) {
          val instants = if (lt == "timestamp" || rt == "timestamp") "; to compare instants use seconds_between(a, b)" else ""
          Left(s"$base; add a cast step to convert the text field to a number$instants")
        } else Left(s"$base; both sides must be numbers, both text or both boolean")
      case _ => Left(s"'$op' cannot compare $lt with $rt; both sides must be numbers, both text or both boolean")
    }

  /** D6b: a boolean-valued expression other than a bare field reference nulls every row when used as a number. */
  private def noBooleanExprs(context: String, operands: Seq[(Expr, String)]): Either[String, Unit] =
    operands.collectFirst { case (e, "boolean") if !e.isInstanceOf[FieldRef] => e } match {
      case Some(_) => Left(s"$context: $BooleanAsNumberHint")
      case None    => Right(())
    }

  /** HEL-1423 / HEL-1070: the common type of `coalesce`'s arguments or `if`'s two branches. Numeric types are all
   *  `VNum` at run time, every text type a `VStr`, and a boolean its own `VBool`, so any other mix has no
   *  truthful type. */
  private def commonType(fn: String, ts: Vector[String]): Either[String, String] = {
    val noun = if (fn == "coalesce") "arguments" else "branches"
    if (ts.distinct.size == 1) Right(ts.head)
    else if (ts.forall(NumericTypes)) Right("float")
    else if (!ts.exists(NumericTypes) && !ts.contains("boolean")) Right("string")
    else if (ts.contains("boolean"))
      Left(s"$fn $noun must all be booleans or none be; got ${ts.mkString(", ")}")
    else
      Left(s"$fn $noun must all be numbers or all be text; got ${ts.mkString(", ")}" +
        (if (fn == "coalesce") " — wrap a number in concat() to coalesce it as text" else ""))
  }

}
