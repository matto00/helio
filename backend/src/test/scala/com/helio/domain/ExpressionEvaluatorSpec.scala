package com.helio.domain

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

class ExpressionEvaluatorSpec extends AnyWordSpec with Matchers {

  private def row(pairs: (String, JsValue)*): Map[String, JsValue] = pairs.toMap

  // ── validate (strict — $ required, no legacy fallback) ─────────────────────

  "ExpressionEvaluator.validate" should {

    "accept a simple arithmetic expression with $-prefixed known fields" in {
      ExpressionEvaluator.validate("$price * $quantity", Set("price", "quantity")) shouldBe Right(())
    }

    "accept numeric literals without any field references" in {
      ExpressionEvaluator.validate("1 + 2 * 3", Set.empty) shouldBe Right(())
    }

    "accept parenthesised expressions with $-prefixed refs" in {
      ExpressionEvaluator.validate("($a + $b) * $c", Set("a", "b", "c")) shouldBe Right(())
    }

    "accept string concatenation with a string literal and $-prefixed refs" in {
      ExpressionEvaluator.validate(
        """$first_name + " " + $last_name""",
        Set("first_name", "last_name")
      ) shouldBe Right(())
    }

    "reject a bare identifier unconditionally, even when it matches a known field" in {
      ExpressionEvaluator.validate("price * quantity", Set("price", "quantity")) shouldBe
        Left("Column references require a '$' prefix")
    }

    "reject an expression that references an unknown $-prefixed field" in {
      ExpressionEvaluator.validate("$missing_field + 1", Set("other")) shouldBe
        Left("Unknown field: missing_field")
    }

    "reject an expression with a syntax error (extra operator)" in {
      ExpressionEvaluator.validate("$a ++ $b", Set("a", "b")) shouldBe a[Left[_, _]]
    }

    "reject an empty expression" in {
      ExpressionEvaluator.validate("  ", Set.empty) shouldBe a[Left[_, _]]
    }

    "reject an unterminated string literal" in {
      ExpressionEvaluator.validate("""$a + "unterminated""", Set("a")) shouldBe a[Left[_, _]]
    }

    // ── function-call syntax ──────────────────────────────────────────────────

    "accept concat with $-prefixed refs and a string literal" in {
      ExpressionEvaluator.validate(
        """concat($first_name, " ", $last_name)""",
        Set("first_name", "last_name")
      ) shouldBe Right(())
    }

    "accept substring with three arguments" in {
      ExpressionEvaluator.validate("substring($sku, 0, 3)", Set("sku")) shouldBe Right(())
    }

    "accept lower/upper/length with one argument" in {
      ExpressionEvaluator.validate("lower($code)", Set("code")) shouldBe Right(())
      ExpressionEvaluator.validate("upper($code)", Set("code")) shouldBe Right(())
      ExpressionEvaluator.validate("length($code)", Set("code")) shouldBe Right(())
    }

    "reject an unknown function name" in {
      ExpressionEvaluator.validate("reverse($name)", Set("name")) shouldBe
        Left("'reverse' is not a recognized function")
    }

    "reject substring called with the wrong arity" in {
      ExpressionEvaluator.validate("substring($name, 0)", Set("name")) shouldBe
        Left("substring requires 3 arguments")
    }

    "reject concat called with zero arguments" in {
      ExpressionEvaluator.validate("concat()", Set.empty) shouldBe
        Left("concat requires at least 1 argument")
    }

    "reject lower called with two arguments" in {
      ExpressionEvaluator.validate("lower($a, $b)", Set("a", "b")) shouldBe
        Left("lower requires 1 argument")
    }

    "allow a function call nested inside arithmetic (functions bind like a factor)" in {
      ExpressionEvaluator.validate("""concat($a, $b) + "!"""", Set("a", "b")) shouldBe Right(())
    }
  }

  // ── validateTolerant (legacy-tolerant — used only by DataTypeService) ───────

  "ExpressionEvaluator.validateTolerant" should {

    "accept a bare identifier that matches a known field (today's DataTypeService behavior)" in {
      ExpressionEvaluator.validateTolerant("price * quantity", Set("price", "quantity")) shouldBe Right(())
    }

    "reject a bare identifier that does not match a known field" in {
      ExpressionEvaluator.validateTolerant("missing_field + 1", Set("other")) shouldBe a[Left[_, _]]
    }

    "still accept the new $-prefixed grammar" in {
      ExpressionEvaluator.validateTolerant("$price * $quantity", Set("price", "quantity")) shouldBe Right(())
    }

    "reject a genuine syntax error regardless of $ prefix" in {
      ExpressionEvaluator.validateTolerant("price **", Set("price")) shouldBe a[Left[_, _]]
    }
  }

  // ── inferType ────────────────────────────────────────────────────────────────

  "ExpressionEvaluator.inferType" should {

    "infer number for an arithmetic expression" in {
      ExpressionEvaluator.inferType(
        "$price * $qty",
        Map("price" -> "number", "qty" -> "number")
      ) shouldBe Right("number")
    }

    "infer string for a concat call" in {
      ExpressionEvaluator.inferType(
        """concat($first_name, " ", $last_name)""",
        Map("first_name" -> "string", "last_name" -> "string")
      ) shouldBe Right("string")
    }

    "infer string for substring/lower/upper" in {
      ExpressionEvaluator.inferType("substring($sku, 0, 3)", Map("sku" -> "string")) shouldBe Right("string")
      ExpressionEvaluator.inferType("lower($code)", Map("code" -> "string")) shouldBe Right("string")
      ExpressionEvaluator.inferType("upper($code)", Map("code" -> "string")) shouldBe Right("string")
    }

    "infer number for length" in {
      ExpressionEvaluator.inferType("length($name)", Map("name" -> "string")) shouldBe Right("number")
    }

    "infer string for + when either operand is a string" in {
      ExpressionEvaluator.inferType(
        """"Total: " + $amount""",
        Map("amount" -> "number")
      ) shouldBe Right("string")
    }

    "infer number for + when both operands are numbers" in {
      ExpressionEvaluator.inferType("$a + $b", Map("a" -> "number", "b" -> "number")) shouldBe Right("number")
    }

    "return Left for an unresolvable field reference" in {
      ExpressionEvaluator.inferType("$missing * 2", Map.empty) shouldBe a[Left[_, _]]
    }
  }

  // ── evaluate — arithmetic (new $-prefixed grammar) ──────────────────────────

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

    // ── $-prefixed field references ─────────────────────────────────────────

    "resolve a numeric $-prefixed field reference" in {
      val r = row("price" -> JsNumber(5.0), "quantity" -> JsNumber(3.0))
      ExpressionEvaluator.evaluate("$price * $quantity", r) shouldBe Right(JsNumber(15.0))
    }

    "resolve multi-column arithmetic with a numeric constant" in {
      val r = row("amount" -> JsNumber(100.0))
      ExpressionEvaluator.evaluate("$amount * 1.05", r) shouldBe Right(JsNumber(105.0))
    }

    "resolve a string $-prefixed field reference" in {
      val r = row("first" -> JsString("Hello"), "last" -> JsString("World"))
      ExpressionEvaluator.evaluate("""$first + " " + $last""", r) shouldBe Right(JsString("Hello World"))
    }

    // ── string concatenation via + ──────────────────────────────────────────

    "concatenate two string literals with +" in {
      ExpressionEvaluator.evaluate(""""foo" + "bar"""", Map.empty) shouldBe Right(JsString("foobar"))
    }

    "concatenate a number and a string" in {
      ExpressionEvaluator.evaluate("""42 + " items"""", Map.empty) shouldBe Right(JsString("42 items"))
    }

    "coerce a number to string when the other + operand is a string ($-prefixed)" in {
      val r = row("amount" -> JsNumber(5.0))
      ExpressionEvaluator.evaluate(""""Total: " + $amount""", r) shouldBe Right(JsString("Total: 5"))
    }

    "keep + numeric when both operands are numbers (not string concatenation)" in {
      val r = row("a" -> JsNumber(1.0), "b" -> JsNumber(2.0))
      ExpressionEvaluator.evaluate("$a + $b", r) shouldBe Right(JsNumber(3.0))
    }

    // ── string functions ─────────────────────────────────────────────────────

    "concat joins multiple $-prefixed arguments as strings" in {
      val r = row("first_name" -> JsString("Ada"), "last_name" -> JsString("Lovelace"))
      ExpressionEvaluator.evaluate("""concat($first_name, " ", $last_name)""", r) shouldBe
        Right(JsString("Ada Lovelace"))
    }

    "substring extracts a range" in {
      val r = row("sku" -> JsString("ABC-1234"))
      ExpressionEvaluator.evaluate("substring($sku, 0, 3)", r) shouldBe Right(JsString("ABC"))
    }

    "substring clamps an out-of-range end index rather than erroring" in {
      val r = row("sku" -> JsString("AB"))
      ExpressionEvaluator.evaluate("substring($sku, 0, 999)", r) shouldBe Right(JsString("AB"))
    }

    "substring clamps an out-of-range start index to the string length (empty result, no error)" in {
      val r = row("sku" -> JsString("AB"))
      ExpressionEvaluator.evaluate("substring($sku, 10, 20)", r) shouldBe Right(JsString(""))
    }

    "substring on a non-string first argument is a TypeError" in {
      val r = row("amount" -> JsNumber(5.0))
      ExpressionEvaluator.evaluate("substring($amount, 0, 1)", r) match {
        case Left(_: EvaluationError.TypeError) => succeed
        case other                              => fail(s"Expected TypeError, got $other")
      }
    }

    "lower and upper change case" in {
      val r = row("code" -> JsString("ab12"))
      ExpressionEvaluator.evaluate("upper($code)", r) shouldBe Right(JsString("AB12"))
      ExpressionEvaluator.evaluate("lower($code)", row("code" -> JsString("AB12"))) shouldBe Right(JsString("ab12"))
    }

    "lower on a non-string argument is a TypeError" in {
      val r = row("amount" -> JsNumber(5.0))
      ExpressionEvaluator.evaluate("lower($amount)", r) match {
        case Left(_: EvaluationError.TypeError) => succeed
        case other                              => fail(s"Expected TypeError, got $other")
      }
    }

    "length returns the character count as a number" in {
      val r = row("name" -> JsString("Ada"))
      ExpressionEvaluator.evaluate("length($name)", r) shouldBe Right(JsNumber(3.0))
    }

    "length on a non-string argument is a TypeError" in {
      val r = row("amount" -> JsNumber(5.0))
      ExpressionEvaluator.evaluate("length($amount)", r) match {
        case Left(_: EvaluationError.TypeError) => succeed
        case other                              => fail(s"Expected TypeError, got $other")
      }
    }

    // ── numeric-strict / +-permissive coercion (design.md Decision 3/Decision in spec) ──

    "subtracting a string field is a TypeError (numeric ops are strict)" in {
      val r = row("amount" -> JsNumber(10.0), "label" -> JsString("x"))
      ExpressionEvaluator.evaluate("$amount - $label", r) match {
        case Left(_: EvaluationError.TypeError) => succeed
        case other                              => fail(s"Expected TypeError, got $other")
      }
    }

    "multiplying a string field is a TypeError" in {
      val r = row("qty" -> JsNumber(2.0), "label" -> JsString("x"))
      ExpressionEvaluator.evaluate("$qty * $label", r) match {
        case Left(_: EvaluationError.TypeError) => succeed
        case other                              => fail(s"Expected TypeError, got $other")
      }
    }

    "dividing by a string field is a TypeError" in {
      val r = row("amount" -> JsNumber(10.0), "label" -> JsString("x"))
      ExpressionEvaluator.evaluate("$amount / $label", r) match {
        case Left(_: EvaluationError.TypeError) => succeed
        case other                              => fail(s"Expected TypeError, got $other")
      }
    }

    // ── errors ───────────────────────────────────────────────────────────────

    "return DivisionByZero error for division by zero" in {
      ExpressionEvaluator.evaluate("10 / 0", Map.empty) match {
        case Left(EvaluationError.DivisionByZero(_)) => succeed
        case other => fail(s"Expected DivisionByZero, got $other")
      }
    }

    "return UnknownField error for missing $-prefixed field reference" in {
      ExpressionEvaluator.evaluate("$missing_field + 1", Map.empty) match {
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
      ExpressionEvaluator.evaluate("$s - 1", r) match {
        case Left(_: EvaluationError.TypeError) => succeed
        case other => fail(s"Expected TypeError, got $other")
      }
    }

    "propagate null from a field as JsNull" in {
      val r = row("x" -> JsNull)
      ExpressionEvaluator.evaluate("$x + 1", r) shouldBe Right(JsNull)
    }

    "propagate null through a function call argument" in {
      val r = row("name" -> JsNull)
      ExpressionEvaluator.evaluate("upper($name)", r) shouldBe Right(JsNull)
    }

    // ── legacy fallback (design.md Decision 4) ──────────────────────────────

    "evaluate a stored bare-identifier expression identically to its pre-change output" in {
      val r = row("price" -> JsNumber(9.99), "qty" -> JsNumber(3.0))
      ExpressionEvaluator.evaluate("price * qty", r) shouldBe Right(JsNumber(29.97))
    }

    "still reject the same bare-identifier expression under strict validate()" in {
      // Proves the split: evaluate() tolerates it, validate() still flags it.
      ExpressionEvaluator.validate("price * qty", Set("price", "qty")) shouldBe
        Left("Column references require a '$' prefix")
    }

    "evaluate a legacy bare-identifier string-concat expression" in {
      val r = row("first" -> JsString("Ada"), "last" -> JsString("Lovelace"))
      ExpressionEvaluator.evaluate("""first + " " + last""", r) shouldBe Right(JsString("Ada Lovelace"))
    }
  }
}
