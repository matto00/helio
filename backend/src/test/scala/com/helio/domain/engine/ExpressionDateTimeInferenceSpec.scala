package com.helio.domain.engine

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** Analyze/apply parity for the date/time functions (HEL-1314): the type `inferType` reports is the JSON
 *  kind `evaluate` produces. Iterates `DateTimeFunctions`, so a new date function must be classified. */
class ExpressionDateTimeInferenceSpec extends AnyWordSpec with Matchers {

  private val fields = Map("end" -> "timestamp", "start" -> "timestamp", "n" -> "float")
  private val row: Map[String, JsValue] = Map(
    "end"   -> JsString("2026-07-01T12:01:30Z"),
    "start" -> JsString("2026-07-01T12:00:00Z"),
    "n"     -> JsNumber(1)
  )

  private val exprByFunction = Map(
    "seconds_between" -> ("seconds_between($end, $start)", "float"),
    "date_trunc"      -> ("""date_trunc("day", $end)""", "timestamp"),
    "add_days"        -> ("add_days($end, $n)", "timestamp")
  )

  "date/time functions" should {
    "have an infer/apply parity case for every DateTimeFunctions entry" in {
      exprByFunction.keySet shouldBe ExpressionEvaluator.DateTimeFunctions.toSet
    }

    "infer the type the evaluator produces" in {
      exprByFunction.foreach { case (fn, (expr, expectedType)) =>
        withClue(fn) {
          ExpressionEvaluator.validate(expr, fields.keySet) shouldBe Right(())
          ExpressionEvaluator.inferType(expr, fields) shouldBe Right(expectedType)
          (expectedType, ExpressionEvaluator.evaluate(expr, row)) match {
            case ("float", Right(_: JsNumber))      => succeed
            case ("timestamp", Right(_: JsString))  => succeed
            case other                              => fail(s"kind mismatch: $other")
          }
        }
      }
    }

    "compose: a date_trunc result feeds seconds_between and add_days" in {
      val e = """seconds_between(add_days(date_trunc("day", $end), 1), date_trunc("day", $end))"""
      ExpressionEvaluator.inferType(e, fields) shouldBe Right("float")
      ExpressionEvaluator.evaluate(e, row) shouldBe Right(JsNumber(86400))
    }
  }

  "'+' with a timestamp operand" should {
    "infer string and concatenate at run time" in {
      ExpressionEvaluator.inferType("$ts + 1", Map("ts" -> "timestamp")) shouldBe Right("string")
      ExpressionEvaluator.inferType("1 + $ts", Map("ts" -> "timestamp")) shouldBe Right("string")
      ExpressionEvaluator.evaluate("$ts + 1", Map("ts" -> JsString("2026-07-01"))) shouldBe Right(JsString("2026-07-011"))
    }
    "keep float for two numbers and string for a string operand" in {
      ExpressionEvaluator.inferType("$a + 1", Map("a" -> "float")) shouldBe Right("float")
      ExpressionEvaluator.inferType("""$a + "x"""", Map("a" -> "float")) shouldBe Right("string")
    }
  }
}
