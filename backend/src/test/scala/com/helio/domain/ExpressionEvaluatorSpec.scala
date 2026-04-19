package com.helio.domain

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

class ExpressionEvaluatorSpec extends AnyWordSpec with Matchers {

  private def row(pairs: (String, JsValue)*): Map[String, JsValue] = pairs.toMap

  // ── validate ──────────────────────────────────────────────────────────────

  "ExpressionEvaluator.validate" should {

    "accept a simple arithmetic expression with known fields" in {
      ExpressionEvaluator.validate("price * quantity", Set("price", "quantity")) shouldBe Right(())
    }

    "accept numeric literals without any field references" in {
      ExpressionEvaluator.validate("1 + 2 * 3", Set.empty) shouldBe Right(())
    }

    "accept parenthesised expressions" in {
      ExpressionEvaluator.validate("(a + b) * c", Set("a", "b", "c")) shouldBe Right(())
    }

    "accept string concatenation with a string literal" in {
      ExpressionEvaluator.validate("""first_name + " " + last_name""", Set("first_name", "last_name")) shouldBe Right(())
    }

    "reject an expression that references an unknown field" in {
      ExpressionEvaluator.validate("missing_field + 1", Set("other")) shouldBe a[Left[_, _]]
    }

    "reject an expression with a syntax error (extra operator)" in {
      ExpressionEvaluator.validate("a ++ b", Set("a", "b")) shouldBe a[Left[_, _]]
    }

    "reject an empty expression" in {
      ExpressionEvaluator.validate("  ", Set.empty) shouldBe a[Left[_, _]]
    }

    "reject an unterminated string literal" in {
      ExpressionEvaluator.validate("""a + "unterminated""", Set("a")) shouldBe a[Left[_, _]]
    }
  }

  // ── evaluate — arithmetic ────────────────────────────────────────────────

  "ExpressionEvaluator.evaluate" should {

    "evaluate addition of two numbers" in {
      val result = ExpressionEvaluator.evaluate("1 + 2", Map.empty)
      result shouldBe Right(JsNumber(3.0))
    }

    "evaluate subtraction" in {
      ExpressionEvaluator.evaluate("10 - 3", Map.empty) shouldBe Right(JsNumber(7.0))
    }

    "evaluate multiplication" in {
      ExpressionEvaluator.evaluate("4 * 5", Map.empty) shouldBe Right(JsNumber(20.0))
    }

    "evaluate division" in {
      ExpressionEvaluator.evaluate("10 / 4", Map.empty) shouldBe Right(JsNumber(2.5))
    }

    "evaluate nested parenthesised expression" in {
      ExpressionEvaluator.evaluate("(2 + 3) * 4", Map.empty) shouldBe Right(JsNumber(20.0))
    }

    "evaluate operator precedence (* before +)" in {
      ExpressionEvaluator.evaluate("2 + 3 * 4", Map.empty) shouldBe Right(JsNumber(14.0))
    }

    // ── field references ────────────────────────────────────────────────────

    "resolve a numeric field reference" in {
      val r = row("price" -> JsNumber(5.0), "quantity" -> JsNumber(3.0))
      ExpressionEvaluator.evaluate("price * quantity", r) shouldBe Right(JsNumber(15.0))
    }

    "resolve a string field reference" in {
      val r = row("first" -> JsString("Hello"), "last" -> JsString("World"))
      ExpressionEvaluator.evaluate("""first + " " + last""", r) shouldBe Right(JsString("Hello World"))
    }

    // ── string concatenation ─────────────────────────────────────────────────

    "concatenate two string literals with +" in {
      ExpressionEvaluator.evaluate(""""foo" + "bar"""", Map.empty) shouldBe Right(JsString("foobar"))
    }

    "concatenate a number and a string" in {
      ExpressionEvaluator.evaluate("""42 + " items"""", Map.empty) shouldBe Right(JsString("42 items"))
    }

    // ── errors ───────────────────────────────────────────────────────────────

    "return DivisionByZero error for division by zero" in {
      ExpressionEvaluator.evaluate("10 / 0", Map.empty) match {
        case Left(EvaluationError.DivisionByZero(_)) => succeed
        case other => fail(s"Expected DivisionByZero, got $other")
      }
    }

    "return UnknownField error for missing field reference" in {
      ExpressionEvaluator.evaluate("missing_field + 1", Map.empty) match {
        case Left(EvaluationError.UnknownField("missing_field")) => succeed
        case other => fail(s"Expected UnknownField, got $other")
      }
    }

    "return ParseError for malformed expression" in {
      ExpressionEvaluator.evaluate("* invalid", Map.empty) match {
        case Left(_: EvaluationError.ParseError) => succeed
        case other => fail(s"Expected ParseError, got $other")
      }
    }

    "return ParseError for empty expression" in {
      ExpressionEvaluator.evaluate("", Map.empty) match {
        case Left(_: EvaluationError.ParseError) => succeed
        case other => fail(s"Expected ParseError, got $other")
      }
    }

    "return TypeError when subtracting a string from a number" in {
      val r = row("s" -> JsString("hello"))
      ExpressionEvaluator.evaluate("s - 1", r) match {
        case Left(_: EvaluationError.TypeError) => succeed
        case other => fail(s"Expected TypeError, got $other")
      }
    }

    "propagate null from a field as JsNull" in {
      val r = row("x" -> JsNull)
      ExpressionEvaluator.evaluate("x + 1", r) shouldBe Right(JsNull)
    }
  }
}
