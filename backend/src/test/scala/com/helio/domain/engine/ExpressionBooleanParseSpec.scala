package com.helio.domain.engine

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** HEL-1070: parsing of the comparison / boolean / `if` syntax and its interaction with the legacy
 *  bare-identifier fallback. */
class ExpressionBooleanParseSpec extends AnyWordSpec with Matchers {

  private val fields                = Set("a", "b", "c", "x", "s", "price", "qty")
  private val DollarMsg             = "Column references require a '$' prefix"
  private def validate(e: String)   = ExpressionEvaluator.validate(e, fields)
  private def msg(e: String): String = validate(e).left.getOrElse(fail(s"expected a parse error for: $e"))
  private def ev(e: String, pairs: (String, JsValue)*) = ExpressionEvaluator.evaluate(e, pairs.toMap)

  "the strict parser" should {
    "accept every comparison operator" in {
      Seq("=", "!=", "<", "<=", ">", ">=").foreach { op =>
        withClue(op)(validate(s"$$a $op 1") shouldBe Right(()))
      }
    }

    "accept and / or / not / true / false, case-insensitively" in {
      Seq(
        "$a and $b", "$a or $b", "not $a", "true", "false", "$a AND $b", "$a Or $b", "NOT $a", "TRUE", "False",
        "not not $a", "$a or $b and $c", "($a or $b) and $c"
      ).foreach(e => withClue(e)(validate(e) shouldBe Right(())))
    }

    "treat a keyword written directly before '(' as the operator / literal, not a function" in {
      Seq("$a and($b)", "$a or($b)", "not($a)", "$a AND($b)", "NOT($a)").foreach { e =>
        withClue(e)(validate(e) shouldBe Right(()))
      }
      ev("$a and($b or $c)", "a" -> JsBoolean(true), "b" -> JsBoolean(false), "c" -> JsBoolean(true)) shouldBe Right(JsBoolean(true))
      ev("not($a)", "a" -> JsBoolean(true)) shouldBe Right(JsBoolean(false))
    }

    "accept comparisons and boolean expressions as function arguments and in groups" in {
      validate("if($a > 1 and $b, 1, 0)") shouldBe Right(())
      validate("concat(if($a = 1, \"x\", \"y\"), \"z\")") shouldBe Right(())
      validate("($a > 1)") shouldBe Right(())
    }

    "reject a chained comparison" in {
      msg("1 < $x < 5").toLowerCase should include("chain")
      msg("$a = $b = $c").toLowerCase should include("chain")
      validate("(1 < $x) = true") shouldBe Right(())
    }

    "reject == and <> with a hint at the right operator" in {
      msg("$a == 1") should include("'='")
      msg("$a <> 1") should include("'!='")
    }

    "reject a lone '!' as an unexpected character" in {
      msg("!$a") should include("Unexpected character")
    }

    "require exactly three arguments for if" in {
      msg("if($a > 1, 1)") should (include("if") and include("3 arguments"))
      msg("if($a > 1, 1, 2, 3)") should (include("if") and include("3 arguments"))
      msg("if()") should include("3 arguments")
      validate("if($a > 1, 1, 0)") shouldBe Right(())
    }

    "list if among the supported functions in the unknown-function message" in {
      msg("reverse($a)") should include("if")
    }

    "report a reserved word used as a value as a reserved-word error, never the dollar-prefix error" in {
      Seq("$a = and", "$a and or $b", "not", "and + 1", "not + price", "$a = or", "$a + not").foreach { e =>
        withClue(e) {
          val m = msg(e)
          m should not be DollarMsg
          ExpressionParser.isDollarPrefixError(m) shouldBe false
        }
      }
      msg("$a = and") should (include("'and'") and include("reserved"))
      msg("not") should (include("'not'") and include("reserved"))
    }

    "never retry the legacy grammar for a reserved-word error" in {
      ExpressionEvaluator.parseProblem("and + 1") shouldBe defined
      ExpressionEvaluator.evaluate("and + 1", Map("and" -> JsNumber(1))) match {
        case Left(EvaluationError.ParseError(m)) => m should include("reserved")
        case other                               => fail(s"expected a ParseError, got $other")
      }
    }
  }

  "legacy bare-identifier expressions" should {
    "keep falling back when a non-reserved bare name is reached first" in {
      val row = Map[String, JsValue]("price" -> JsNumber(2), "qty" -> JsNumber(3), "and" -> JsNumber(3), "true" -> JsString("x"), "True" -> JsString("x"))
      ev("price * qty", row.toSeq: _*) shouldBe Right(JsNumber(6))
      ev("price * and", row.toSeq: _*) shouldBe Right(JsNumber(6))
      ev("true + price", row.toSeq: _*) shouldBe Right(JsString("x2"))
      ev("True + price", row.toSeq: _*) shouldBe Right(JsString("x2"))
      ExpressionEvaluator.parseProblem("price * and") shouldBe None
      ExpressionEvaluator.parseProblem("true + price") shouldBe None
    }

    "now read an all-true/false bare-word expression as the literal" in {
      ev("true", "true" -> JsString("x")) shouldBe Right(JsBoolean(true))
      ev("false") shouldBe Right(JsBoolean(false))
    }

    "now type-error (per-row) on arithmetic over a bare boolean literal" in {
      ev("true * 2", "true" -> JsNumber(5)) match {
        case Left(_: EvaluationError.TypeError) => succeed
        case other                              => fail(s"expected a TypeError, got $other")
      }
    }

    "now fail to parse a reserved word misused as a value first" in {
      ExpressionEvaluator.parseProblem("and + 1") shouldBe defined
      ExpressionEvaluator.parseProblem("not") shouldBe defined
      ExpressionEvaluator.parseProblem("not + price") shouldBe defined
    }
  }
}
