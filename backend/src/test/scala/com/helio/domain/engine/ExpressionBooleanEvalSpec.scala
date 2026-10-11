package com.helio.domain.engine

import com.helio.domain.steps.{ComputeConfig, ComputeStep}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** HEL-1070: run-time semantics of comparisons, boolean operators, `if` and boolean columns. */
class ExpressionBooleanEvalSpec extends AnyWordSpec with Matchers {

  private def ev(e: String, pairs: (String, JsValue)*) = ExpressionEvaluator.evaluate(e, pairs.toMap)
  private def b(v: Boolean): Either[EvaluationError, JsValue] = Right(JsBoolean(v))
  private val N: JsValue                                       = JsNull
  private val NullResult: Either[EvaluationError, JsValue]     = Right(JsNull)
  private def isTypeError(r: Either[EvaluationError, JsValue]) =
    r match { case Left(_: EvaluationError.TypeError) => true; case _ => false }

  "comparison" should {
    "compare numbers numerically" in {
      ev("$amount > 100", "amount" -> JsNumber(150)) shouldBe b(true)
      ev("$amount > 100", "amount" -> JsNumber(100)) shouldBe b(false)
      ev("$amount >= 100", "amount" -> JsNumber(100)) shouldBe b(true)
      ev("$amount <= 100", "amount" -> JsNumber(100)) shouldBe b(true)
      ev("$amount >= 100", "amount" -> JsNumber(99)) shouldBe b(false)
      ev("$amount <= 100", "amount" -> JsNumber(101)) shouldBe b(false)
      ev("$amount < 100", "amount" -> JsNumber(99)) shouldBe b(true)
      ev("$amount <= 99", "amount" -> JsNumber(100)) shouldBe b(false)
      ev("$amount = 100", "amount" -> JsNumber(100)) shouldBe b(true)
      ev("$amount != 100", "amount" -> JsNumber(100)) shouldBe b(false)
      ev("$a + 1 = 3", "a" -> JsNumber(2)) shouldBe b(true)
    }

    "compare text exactly, by UTF-16 code unit" in {
      ev("""$status = "Done"""", "status" -> JsString("Done")) shouldBe b(true)
      ev("""$status = "Done"""", "status" -> JsString("done")) shouldBe b(false)
      ev("""$status != "Done"""", "status" -> JsString("done")) shouldBe b(true)
      ev("""$s < "b"""", "s" -> JsString("a")) shouldBe b(true)
      ev("""$s < "a"""", "s" -> JsString("B")) shouldBe b(true) // uppercase sorts first
      ev("""$s > "Z"""", "s" -> JsString("a")) shouldBe b(true)
      ev("""$s <= "a"""", "s" -> JsString("a")) shouldBe b(true)
      ev("""$s >= "b"""", "s" -> JsString("b")) shouldBe b(true)
      ev("""$s <= "b"""", "s" -> JsString("a")) shouldBe b(true)
      ev("""$s >= "c"""", "s" -> JsString("b")) shouldBe b(false)
      ev("""$s <= "a"""", "s" -> JsString("b")) shouldBe b(false)
    }

    "sweep every operator over numbers and text: below, equal and above the bound" in {
      // Expected values come from the sign of the ordering (-1 below, 0 equal, 1 above), not from the evaluator.
      def expected(op: String, sign: Int): Boolean = op match {
        case "="  => sign == 0
        case "!=" => sign != 0
        case "<"  => sign < 0
        case "<=" => sign <= 0
        case ">"  => sign > 0
        case _    => sign >= 0
      }
      val numbers = Seq(JsNumber(99) -> -1, JsNumber(100) -> 0, JsNumber(101) -> 1)
      val texts   = Seq(JsString("a") -> -1, JsString("b") -> 0, JsString("c") -> 1)
      for (op <- Seq("=", "!=", "<", "<=", ">", ">="); (v, sign) <- numbers)
        withClue(s"number $v $op 100")(ev(s"$$x $op 100", "x" -> v) shouldBe b(expected(op, sign)))
      for (op <- Seq("=", "!=", "<", "<=", ">", ">="); (v, sign) <- texts)
        withClue(s"text $v $op b")(ev(s"""$$x $op "b"""", "x" -> v) shouldBe b(expected(op, sign)))
    }

    "sweep = and != over booleans: every pairing" in {
      for (l <- Seq(true, false); r <- Seq(true, false)) {
        ev("$l = $r", "l" -> JsBoolean(l), "r" -> JsBoolean(r)) shouldBe b(l == r)
        ev("$l != $r", "l" -> JsBoolean(l), "r" -> JsBoolean(r)) shouldBe b(l != r)
      }
    }

    "compare a timestamp as its text, not as an instant" in {
      ev("""$t < "2026-07-02T00:00:00Z"""", "t" -> JsString("2026-07-01T00:00:00Z")) shouldBe b(true)
      ev("""$t = "2026-07-01"""", "t" -> JsString("2026-07-01T00:00:00Z")) shouldBe b(false)
    }

    "support = and != on booleans" in {
      ev("$a = $b", "a" -> JsBoolean(true), "b" -> JsBoolean(true)) shouldBe b(true)
      ev("$a != $b", "a" -> JsBoolean(true), "b" -> JsBoolean(false)) shouldBe b(true)
      ev("$a = true", "a" -> JsBoolean(false)) shouldBe b(false)
    }

    "type-error on an ordering comparison of booleans" in {
      isTypeError(ev("$a < $b", "a" -> JsBoolean(true), "b" -> JsBoolean(false))) shouldBe true
    }

    "type-error (not false) when kinds differ" in {
      isTypeError(ev("""$n = "5"""", "n" -> JsNumber(5))) shouldBe true
      isTypeError(ev("""$s = 5""", "s" -> JsString("5"))) shouldBe true
      isTypeError(ev("$f = 1", "f" -> JsBoolean(true))) shouldBe true
      isTypeError(ev("""$f = "true"""", "f" -> JsBoolean(true))) shouldBe true
    }

    "yield null when an operand is null" in {
      ev("$x != 5", "x" -> N) shouldBe NullResult
      ev("5 = $x", "x" -> N) shouldBe NullResult
      ev("$x = $y", "x" -> N, "y" -> N) shouldBe NullResult
    }

    "yield null for the row via ComputeStep.apply when kinds differ, and never throw" in {
      val out = ComputeStep.apply(Seq(Map[String, Any]("n" -> 5.0)), ComputeConfig("r", """$n = "5"""", None))
      out.head("r").asInstanceOf[AnyRef] shouldBe null
    }
  }

  "three-valued boolean logic" should {
    val T: JsValue = JsBoolean(true)
    val F: JsValue = JsBoolean(false)

    "give the full and/or/not truth tables" in {
      val vals: Seq[(String, JsValue)] = Seq("T" -> T, "F" -> F, "N" -> N)
      def expectAnd(l: String, r: String): Either[EvaluationError, JsValue] = (l, r) match {
        case ("F", _) | (_, "F") => b(false)
        case ("T", "T")          => b(true)
        case _                   => NullResult
      }
      def expectOr(l: String, r: String): Either[EvaluationError, JsValue] = (l, r) match {
        case ("T", _) | (_, "T") => b(true)
        case ("F", "F")          => b(false)
        case _                   => NullResult
      }
      for ((ln, lv) <- vals; (rn, rv) <- vals) {
        withClue(s"$ln and $rn")(ev("$l and $r", "l" -> lv, "r" -> rv) shouldBe expectAnd(ln, rn))
        withClue(s"$ln or $rn")(ev("$l or $r", "l" -> lv, "r" -> rv) shouldBe expectOr(ln, rn))
      }
      ev("not $x", "x" -> T) shouldBe b(false)
      ev("not $x", "x" -> F) shouldBe b(true)
      ev("not $x", "x" -> N) shouldBe NullResult
    }

    "follow SQL logic when a comparison is null" in {
      ev("$x > 1 and false", "x" -> N) shouldBe b(false)
      ev("$x > 1 or true", "x" -> N) shouldBe b(true)
      ev("$x > 1 and true", "x" -> N) shouldBe NullResult
      ev("$x > 1 or false", "x" -> N) shouldBe NullResult
    }

    "type-error on a non-boolean operand" in {
      isTypeError(ev("1 and true")) shouldBe true
      isTypeError(ev("true and 1")) shouldBe true
      isTypeError(ev("""true or "x"""")) shouldBe false // short-circuit: right never evaluated
      isTypeError(ev("""false or "x"""")) shouldBe true
      isTypeError(ev("not 1")) shouldBe true
      isTypeError(ev("""not $s""", "s" -> JsString("x"))) shouldBe true
    }

    "short-circuit and / or so an erroring right operand is never evaluated" in {
      ev("false and floor($s) > 1", "s" -> JsString("x")) shouldBe b(false)
      ev("true or floor($s) > 1", "s" -> JsString("x")) shouldBe b(true)
      // control: the right operand does error when it is reached
      isTypeError(ev("true and floor($s) > 1", "s" -> JsString("x"))) shouldBe true
      isTypeError(ev("false or floor($s) > 1", "s" -> JsString("x"))) shouldBe true
    }

    "yield the literals as JSON booleans" in {
      ev("true") shouldBe b(true)
      ev("FALSE") shouldBe b(false)
    }
  }

  "if" should {
    "pick a branch by the condition (conditional count column)" in {
      val e = """if($status = "Done", 1, 0)"""
      ev(e, "status" -> JsString("Done")) shouldBe Right(JsNumber(1))
      ev(e, "status" -> JsString("Open")) shouldBe Right(JsNumber(0))
      ev(e, "status" -> N) shouldBe Right(JsNumber(0)) // null condition -> else branch
    }

    "return the selected value unchanged, including null" in {
      ev("if(true, $x, 5)", "x" -> N) shouldBe NullResult
      ev("""if(false, 1, "a")""") shouldBe Right(JsString("a")) // runtime does not enforce branch types
    }

    "evaluate only the chosen branch" in {
      ev("if($b = 0, 0, $a / $b)", "a" -> JsNumber(4), "b" -> JsNumber(0)) shouldBe Right(JsNumber(0))
      ev("if($b = 0, 0, $a / $b)", "a" -> JsNumber(4), "b" -> JsNumber(2)) shouldBe Right(JsNumber(2))
      ev("if($b != 0, $a / $b, -1)", "a" -> JsNumber(4), "b" -> JsNumber(0)) shouldBe Right(JsNumber(-1))
    }

    "type-error on a non-boolean, non-null condition" in {
      isTypeError(ev("if(1, 2, 3)")) shouldBe true
      isTypeError(ev("""if($s, 2, 3)""", "s" -> JsString("x"))) shouldBe true
    }

    "propagate an evaluation error from the chosen branch" in {
      ev("if(true, $a / 0, 1)", "a" -> JsNumber(1)) shouldBe a[Left[_, _]]
    }

    "nest for multiple branches" in {
      val e = """if($n < 10, "low", if($n < 100, "mid", "high"))"""
      Seq(5 -> "low", 50 -> "mid", 500 -> "high").foreach { case (n, expected) =>
        ev(e, "n" -> JsNumber(n)) shouldBe Right(JsString(expected))
      }
    }
  }

  "a boolean column" should {
    "evaluate as a JSON boolean when referenced alone, and through coalesce / if" in {
      ev("$flag", "flag" -> JsBoolean(true)) shouldBe b(true)
      ev("$flag", "flag" -> JsBoolean(false)) shouldBe b(false)
      ev("coalesce($flag, false)", "flag" -> N) shouldBe b(false)
      ev("if(true, $flag, false)", "flag" -> JsBoolean(true)) shouldBe b(true)
    }

    "be usable as a condition and with and / or / not / = / !=" in {
      ev("""if($flag, "yes", "no")""", "flag" -> JsBoolean(true)) shouldBe Right(JsString("yes"))
      ev("""if($flag, "yes", "no")""", "flag" -> JsBoolean(false)) shouldBe Right(JsString("no"))
      ev("$flag and not $other", "flag" -> JsBoolean(true), "other" -> JsBoolean(false)) shouldBe b(true)
    }

    "still concatenate under + and concat" in {
      ev("$flag + 1", "flag" -> JsBoolean(true)) shouldBe Right(JsString("true1"))
      ev("1 + $flag", "flag" -> JsBoolean(true)) shouldBe Right(JsString("1true"))
      ev("$flag + $flag", "flag" -> JsBoolean(true)) shouldBe Right(JsString("truetrue"))
      ev("""$flag + "x"""", "flag" -> JsBoolean(false)) shouldBe Right(JsString("falsex"))
      ev("concat($flag, 1)", "flag" -> JsBoolean(true)) shouldBe Right(JsString("true1"))
    }

    "read as its text under length / upper / lower / substring" in {
      ev("length($flag)", "flag" -> JsBoolean(true)) shouldBe Right(JsNumber(4))
      ev("upper($flag)", "flag" -> JsBoolean(true)) shouldBe Right(JsString("TRUE"))
      ev("lower($flag)", "flag" -> JsBoolean(false)) shouldBe Right(JsString("false"))
      ev("substring($flag, 0, 1)", "flag" -> JsBoolean(true)) shouldBe Right(JsString("t"))
    }

    "stay a type error where a number is required" in {
      isTypeError(ev("$flag - 1", "flag" -> JsBoolean(true))) shouldBe true
      isTypeError(ev("$flag * 2", "flag" -> JsBoolean(true))) shouldBe true
      isTypeError(ev("-$flag", "flag" -> JsBoolean(true))) shouldBe true
      isTypeError(ev("floor($flag)", "flag" -> JsBoolean(true))) shouldBe true
      isTypeError(ev("round($flag, 1)", "flag" -> JsBoolean(true))) shouldBe true
      isTypeError(ev("mod($flag, 2)", "flag" -> JsBoolean(true))) shouldBe true
    }

    "null the row (never fail the run) when given to a date/time function" in {
      def col(e: String) =
        ComputeStep.apply(Seq(Map[String, Any]("flag" -> true, "ts" -> "2026-01-01")), ComputeConfig("r", e, None)).head("r")
      col("seconds_between($flag, $ts)").asInstanceOf[AnyRef] shouldBe null
      col("""date_trunc("day", $flag)""").asInstanceOf[AnyRef] shouldBe null
      col("add_days($flag, 1)").asInstanceOf[AnyRef] shouldBe null
      col("add_days($ts, $flag)").asInstanceOf[AnyRef] shouldBe null
    }

    "write a JSON boolean into the row through ComputeStep.apply" in {
      val out = ComputeStep.apply(Seq(Map[String, Any]("flag" -> true)), ComputeConfig("r", "$flag", None))
      out.head("r") shouldBe true
      val cmp = ComputeStep.apply(Seq(Map[String, Any]("n" -> 3.0)), ComputeConfig("r", "$n > 1", None))
      cmp.head("r") shouldBe true
    }
  }

  "precedence" should {
    val T: JsValue = JsBoolean(true)
    val F: JsValue = JsBoolean(false)

    "bind and tighter than or" in {
      // a or (b and c) = true; (a or b) and c = false
      ev("$a or $b and $c", "a" -> T, "b" -> F, "c" -> F) shouldBe b(true)
      // a and b or c: (a and b) or c = true; a and (b or c) = false
      ev("$a and $b or $c", "a" -> F, "b" -> T, "c" -> T) shouldBe b(true)
    }

    "apply not to a whole comparison" in {
      // not (1 = 2) = true; (not 1) = 2 would be a type error
      ev("not $a = $b", "a" -> JsNumber(1), "b" -> JsNumber(2)) shouldBe b(true)
      ev("not $a = $b", "a" -> JsNumber(1), "b" -> JsNumber(1)) shouldBe b(false)
    }

    "bind not tighter than and / or" in {
      // (not T) and F = false, but not (T and F) = true
      ev("not $a and $b", "a" -> T, "b" -> F) shouldBe b(false)
      // (not T) or T = true, but not (T or T) = false
      ev("not $a or $b", "a" -> T, "b" -> T) shouldBe b(true)
    }

    "bind arithmetic tighter than comparison" in {
      // (1+1) > (1*2) = false; if + bound looser than >, this would not type-check
      ev("$a + 1 > $b * 2", "a" -> JsNumber(5), "b" -> JsNumber(3)) shouldBe b(false)
      ev("$a + 1 > $b * 2", "a" -> JsNumber(6), "b" -> JsNumber(3)) shouldBe b(true)
    }

    "repeat not" in {
      ev("not not $x", "x" -> T) shouldBe b(true)
      ev("not not not $x", "x" -> T) shouldBe b(false)
    }

    "bind unary minus tighter than comparison" in {
      ev("-$a < $b", "a" -> JsNumber(5), "b" -> JsNumber(-4)) shouldBe b(true)
      ev("-$a < $b", "a" -> JsNumber(-5), "b" -> JsNumber(4)) shouldBe b(false)
    }

    "let parentheses override" in {
      ev("($a or $b) and $c", "a" -> T, "b" -> F, "c" -> F) shouldBe b(false)
      ev("(1 < 2) = true") shouldBe b(true)
    }
  }
}
