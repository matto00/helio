package com.helio.domain.engine

import spray.json._

import ExpressionParser.{BinOp, Call, Expr, FieldRef, NumLit, StrLit}

// Row evaluation and function dispatch over the parsed AST.
private[engine] object ExpressionInterpreter {

  /** Intermediate value type used during evaluation. */
  private[engine] sealed trait Val
  private final case class VNum(v: Double) extends Val
  private final case class VStr(s: String) extends Val
  private case object VNull extends Val

  private[engine] def evalExpr(expr: Expr, row: Map[String, JsValue]): Either[EvaluationError, Val] =
    expr match {
      case NumLit(v) => Right(VNum(v))
      case StrLit(s) => Right(VStr(s))

      case FieldRef(name) =>
        row.get(name) match {
          case None               => Left(EvaluationError.UnknownField(name, row.keySet))
          case Some(JsNull)       => Right(VNull)
          case Some(JsNumber(v))  => Right(VNum(v.toDouble))
          case Some(JsString(s))  => Right(VStr(s))
          case Some(JsBoolean(b)) => Right(VStr(b.toString))
          case Some(other)        => Right(VStr(other.compactPrint))
        }

      case BinOp(op, l, r) =>
        for {
          lv <- evalExpr(l, row)
          rv <- evalExpr(r, row)
          res <- applyOp(op, lv, rv, expr.toString)
        } yield res

      // HEL-1423: lazy and null-exempt, so it never reaches applyFn's null guard.
      case Call("coalesce", args) =>
        args.iterator.map(evalExpr(_, row)).collectFirst { case l @ Left(_) => l; case r @ Right(v) if v != VNull => r }
          .getOrElse(Right(VNull))

      case Call(name, args) =>
        args
          .foldLeft[Either[EvaluationError, Vector[Val]]](Right(Vector.empty)) { (accE, a) =>
            accE.flatMap(acc => evalExpr(a, row).map(v => acc :+ v))
          }
          .flatMap(vals => applyFn(name, vals))
    }

  private def applyOp(op: Char, l: Val, r: Val, exprStr: String): Either[EvaluationError, Val] =
    (op, l, r) match {
      // Null propagation — if either side is null the result is null
      case (_, VNull, _) | (_, _, VNull) => Right(VNull)

      case ('+', VNum(a), VNum(b)) => Right(VNum(a + b))
      case ('-', VNum(a), VNum(b)) => Right(VNum(a - b))
      case ('*', VNum(a), VNum(b)) => Right(VNum(a * b))
      case ('/', VNum(a), VNum(b)) =>
        if (b == 0) Left(EvaluationError.DivisionByZero(exprStr))
        else Right(VNum(a / b))

      case ('+', VStr(a), VStr(b)) => Right(VStr(a + b))
      case ('+', VNum(a), VStr(b)) => Right(VStr(numStr(a) + b))
      case ('+', VStr(a), VNum(b)) => Right(VStr(a + numStr(b)))

      case _ =>
        Left(EvaluationError.TypeError(
          s"Operator '$op' cannot be applied to ${typeName(l)} and ${typeName(r)}"
        ))
    }

  /** Function-call semantics (design.md Decision 3). Null-propagating like
   *  `applyOp`: if any argument evaluates to null, the result is null rather than
   *  an error. `substring` clamps out-of-range start/end indices instead of
   *  throwing; a non-string first argument to `substring`/`lower`/`upper`/`length`
   *  is still a `TypeError`. */
  private def applyFn(name: String, args: Vector[Val]): Either[EvaluationError, Val] =
    if (args.contains(VNull)) Right(VNull)
    else
      name match {
        case "concat" =>
          Right(VStr(args.map(concatStr).mkString))

        case "substring" =>
          (args(0), args(1), args(2)) match {
            case (VStr(s), VNum(startD), VNum(endD)) =>
              val len         = s.length
              val start       = math.max(0, math.min(startD.toInt, len))
              val endClamped  = math.max(start, math.min(endD.toInt, len))
              Right(VStr(s.substring(start, endClamped)))
            case (other, _, _) if !other.isInstanceOf[VStr] =>
              Left(EvaluationError.TypeError(
                s"substring requires a string first argument, got ${typeName(other)}"
              ))
            case _ =>
              Left(EvaluationError.TypeError("substring requires numeric start/end arguments"))
          }

        case "lower" =>
          args.head match {
            case VStr(s) => Right(VStr(s.toLowerCase))
            case other   => Left(EvaluationError.TypeError(s"lower requires a string argument, got ${typeName(other)}"))
          }

        case "upper" =>
          args.head match {
            case VStr(s) => Right(VStr(s.toUpperCase))
            case other   => Left(EvaluationError.TypeError(s"upper requires a string argument, got ${typeName(other)}"))
          }

        case "length" =>
          args.head match {
            case VStr(s) => Right(VNum(s.length.toDouble))
            case other   => Left(EvaluationError.TypeError(s"length requires a string argument, got ${typeName(other)}"))
          }

        case "floor" => numericUnary(name, args.head)(math.floor)
        case "ceil"  => numericUnary(name, args.head)(math.ceil)
        case "abs"   => numericUnary(name, args.head)(math.abs)

        case "round" =>
          (args.head, args.lift(1)) match {
            case (VNum(x), None)         => Right(VNum(roundTo(x, 0)))
            case (VNum(x), Some(VNum(d))) =>
              if (d.isWhole) Right(VNum(roundTo(x, math.max(-308.0, math.min(308.0, d)).toInt)))
              else Left(EvaluationError.TypeError("round requires a whole-number digits argument"))
            case (VNum(_), Some(other)) =>
              Left(EvaluationError.TypeError(s"round requires a numeric digits argument, got ${typeName(other)}"))
            case (other, _) =>
              Left(EvaluationError.TypeError(s"round requires a numeric argument, got ${typeName(other)}"))
          }

        case "mod" =>
          (args(0), args(1)) match {
            case (VNum(_), VNum(b)) if b == 0 => Left(EvaluationError.DivisionByZero("mod"))
            case (VNum(a), VNum(b)) =>
              val r = a % b
              Right(VNum((if (r != 0 && (r < 0) != (b < 0)) r + b else r) + 0.0)) // + 0.0 turns -0.0 into 0.0
            case (VNum(_), other) =>
              Left(EvaluationError.TypeError(s"mod requires numeric arguments, got ${typeName(other)}"))
            case (other, _) =>
              Left(EvaluationError.TypeError(s"mod requires numeric arguments, got ${typeName(other)}"))
          }

        case other =>
          // Unreachable in practice: unknown function names are rejected at parse
          // time by checkArity, before evaluation is ever reached.
          Left(EvaluationError.ParseError(s"Unknown function: $other"))
      }

  private def numericUnary(name: String, v: Val)(f: Double => Double): Either[EvaluationError, Val] = v match {
    case VNum(n) => Right(VNum(f(n) + 0.0)) // + 0.0 turns -0.0 into 0.0
    case other   => Left(EvaluationError.TypeError(s"$name requires a numeric argument, got ${typeName(other)}"))
  }

  /** Round half away from zero on the double's shortest decimal representation. A non-finite
   *  value is returned unchanged (`BigDecimal.decimal` would throw). */
  private def roundTo(x: Double, digits: Int): Double =
    if (x.isNaN || x.isInfinite) x
    else BigDecimal.decimal(x).setScale(digits, BigDecimal.RoundingMode.HALF_UP).toDouble

  private def concatStr(v: Val): String = v match {
    case VNum(n) => numStr(n)
    case VStr(s) => s
    case VNull   => ""
  }

  private def numStr(v: Double): String =
    if (v.isWhole) v.toLong.toString else v.toString

  private def typeName(v: Val): String = v match {
    case VNum(_) => "number"
    case VStr(_) => "string"
    case VNull   => "null"
  }

  private[engine] def valToJs(v: Val): JsValue = v match {
    case VNum(n) => JsNumber(n)
    case VStr(s) => JsString(s)
    case VNull   => JsNull
  }
}
