package com.helio.domain.engine

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** HEL-1403: unary minus / negative literals in the strict compute grammar. */
class ExpressionUnaryMinusSpec extends AnyWordSpec with Matchers {

  private def ev(e: String, pairs: (String, JsValue)*) = ExpressionEvaluator.evaluate(e, pairs.toMap)
  private def num(d: Double): Either[EvaluationError, JsValue] = Right(JsNumber(d))
  private val N: JsValue = JsNull

  "unary minus evaluation" should {
    "negate a numeric literal" in { ev("-5") shouldBe num(-5) }

    "negate a column reference, propagate null, and type-error on a string" in {
      ev("-$x", "x" -> JsNumber(4.5)) shouldBe num(-4.5)
      ev("-$x", "x" -> N) shouldBe Right(JsNull)
      ev("-$x", "x" -> JsString("abc")) shouldBe a[Left[_, _]]
      ev("-$x", "x" -> JsString("abc")).left.toOption.get shouldBe a[EvaluationError.TypeError]
    }

    "never produce negative zero" in {
      ev("-$x", "x" -> JsNumber(0)).map(_.toString) shouldBe Right("0.0")
    }

    "accept a negative literal as a function argument" in {
      ev("mod(-7, 3)") shouldBe num(2)
      ev("mod(7, -3)") shouldBe num(-2)
      ev("floor(-2.5)") shouldBe num(-3)
      ev("round($x, -2)", "x" -> JsNumber(1234)) shouldBe num(1200)
    }

    "accept a unary minus after a binary operator" in {
      ev("2 - -3") shouldBe num(5)
      ev("2--3") shouldBe num(5)
      ev("2 * -3") shouldBe num(-6)
    }

    "be repeatable and cancel" in {
      ev("--$x", "x" -> JsNumber(4)) shouldBe num(4)
      ev("- -$x", "x" -> JsNumber(4)) shouldBe num(4)
    }

    "bind tighter than * and /" in {
      ev("-$a * $b", "a" -> JsNumber(2), "b" -> JsNumber(3)) shouldBe num(-6)
      ExpressionParser.parse("-$a * $b") shouldBe ExpressionParser.parse("(-$a) * $b")
      ExpressionParser.parse("-$a * $b") should not be ExpressionParser.parse("-($a * $b)")
      ev("-$a + $b", "a" -> JsNumber(2), "b" -> JsNumber(3)) shouldBe num(1)
    }

    "apply to a function call and a parenthesised group" in {
      ev("-floor($x)", "x" -> JsNumber(2.5)) shouldBe num(-2)
      ev("-(1 + 2)") shouldBe num(-3)
    }

    "match 0 - e over a table of numeric and null inputs" in {
      val inputs = Seq(JsNumber(3), JsNumber(-4.5), JsNumber(0), N)
      Seq("$x", "$x * 2", "floor($x)", "($x + 1)").foreach { e =>
        inputs.foreach { in =>
          withClue(s"$e with $in") {
            ev(s"-($e)", "x" -> in) shouldBe ev(s"0 - ($e)", "x" -> in)
          }
        }
      }
    }
  }

  "unary minus validation and inference" should {
    "infer float" in {
      ExpressionEvaluator.inferType("-$n", Map("n" -> "integer")) shouldBe Right("float")
      ExpressionEvaluator.inferType("-5", Map.empty) shouldBe Right("float")
    }
    "propagate an unknown field from the operand" in {
      ExpressionEvaluator.inferType("-$nope", Map("n" -> "integer")).isLeft shouldBe true
      ExpressionEvaluator.validate("-$nope", Set("n")).isLeft shouldBe true
    }
    "accept valid unary expressions" in {
      ExpressionEvaluator.validate("-$n", Set("n")) shouldBe Right(())
      ExpressionEvaluator.validate("mod(-7, 3)", Set.empty) shouldBe Right(())
    }
    "reject a dangling minus" in {
      ExpressionEvaluator.validate("$a * -", Set("a")) shouldBe a[Left[_, _]]
      ExpressionEvaluator.validate("-", Set.empty) shouldBe a[Left[_, _]]
    }
    "still reject unary plus" in {
      ExpressionEvaluator.validate("+5", Set.empty) shouldBe a[Left[_, _]]
    }
  }

  "the frozen legacy parser (D3)" should {
    "treat a legacy bare-identifier unary minus exactly as before on the run path" in {
      val unchanged = "Unexpected token in expression: Minus"
      ev("-price", "price" -> JsNumber(3)) shouldBe Left(EvaluationError.ParseError(unchanged))
      ExpressionEvaluator.parseProblem("-price") shouldBe Some(unchanged)
    }
    "not let a strict unary-minus expression fall through to legacy" in {
      ev("price - -1", "price" -> JsNumber(3)) shouldBe Left(EvaluationError.ParseError("Unexpected token in expression: Minus"))
      ev("$price - -1", "price" -> JsNumber(3)) shouldBe num(4)
    }
  }
}
