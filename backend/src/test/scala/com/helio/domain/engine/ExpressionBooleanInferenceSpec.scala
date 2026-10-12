package com.helio.domain.engine

import com.helio.domain.steps.{ComputeConfig, ComputeStep}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** HEL-1070: analyze-vs-apply parity for every new construct, and the analyze-time inference errors. */
class ExpressionBooleanInferenceSpec extends AnyWordSpec with Matchers {

  private val types = Map(
    "n"      -> "integer",
    "f"      -> "float",
    "s"      -> "string",
    "body"   -> "string-body",
    "ts"     -> "timestamp",
    "flag"   -> "boolean",
    "other"  -> "boolean",
    "bin"    -> "binary-ref"
  )
  private val row: Map[String, JsValue] = Map(
    "n"     -> JsNumber(3),
    "f"     -> JsNumber(1.5),
    "s"     -> JsString("Done"),
    "body"  -> JsString("long text"),
    "ts"    -> JsString("2026-07-01T00:00:00Z"),
    "flag"  -> JsBoolean(true),
    "other" -> JsBoolean(false)
  )

  private def infer(e: String)    = ExpressionEvaluator.inferType(e, types)
  private def err(e: String): String = infer(e).left.getOrElse(fail(s"expected an inference error for: $e, got ${infer(e)}"))

  /** `(expression, expected inferred type)` for every new construct; the JSON kind at run time must match. */
  private val parityCases: Seq[(String, String)] = Seq(
    "true"                                          -> "boolean",
    "false"                                         -> "boolean",
    "$n = 3"                                        -> "boolean",
    "$f != 1"                                       -> "boolean",
    "$n < $f"                                       -> "boolean",
    "$n <= 3"                                       -> "boolean",
    "$f > 1"                                        -> "boolean",
    "$f >= 1.5"                                     -> "boolean",
    """$s = "Done""""                               -> "boolean",
    """$s < $body"""                                -> "boolean",
    """$ts < "2027-01-01""""                        -> "boolean",
    "$ts = $s"                                      -> "boolean",
    "$flag = $other"                                -> "boolean",
    "$flag != true"                                 -> "boolean",
    "$flag and $other"                              -> "boolean",
    "$flag or $other"                               -> "boolean",
    "not $flag"                                     -> "boolean",
    "$n > 1 and not $flag or $s = \"x\""            -> "boolean",
    "$flag"                                         -> "boolean",
    "coalesce($flag, false)"                        -> "boolean",
    "if($flag, $flag, $other)"                      -> "boolean",
    "if($n > 1, 1, 0)"                              -> "float",
    "if($flag, $n, 0)"                              -> "float",
    "if($flag, $n, $f)"                             -> "float",
    "if($flag, $n, $n)"                             -> "integer",
    """if($flag, "a", "b")"""                       -> "string",
    "if($flag, $s, $body)"                          -> "string",
    "if($flag, $s, $ts)"                            -> "string",
    "if($flag, $ts, $ts)"                           -> "timestamp",
    "if($flag, $n + 1, $f * 2)"                     -> "float",
    "$flag + 1"                                     -> "string",
    "1 + $flag"                                     -> "string",
    "$flag + $other"                                -> "string",
    "($n > 1) + 1"                                  -> "string",
    "concat($flag, $n)"                             -> "string",
    "length($flag)"                                 -> "float",
    "upper($flag)"                                  -> "string"
  )

  private def kindOf(v: JsValue): String = v match {
    case _: JsBoolean => "boolean"
    case _: JsNumber  => "number"
    case _: JsString  => "string"
    case JsNull       => "null"
    case _            => "other"
  }

  /** The JSON kind a given inferred type must produce at run time. */
  private val kindFor = Map(
    "boolean" -> "boolean", "float" -> "number", "integer" -> "number", "string" -> "string", "timestamp" -> "string"
  )

  "analyze-vs-apply parity" should {
    "agree for every new construct" in {
      parityCases.foreach { case (e, expected) =>
        withClue(e) {
          ExpressionEvaluator.validate(e, types.keySet) shouldBe Right(())
          ExpressionEvaluator.inferType(e, types) shouldBe Right(expected)
          val applied = ExpressionEvaluator.evaluate(e, row).getOrElse(fail(s"evaluation failed for $e"))
          kindOf(applied) shouldBe kindFor(expected)
        }
      }
    }

    "agree through ComputeStep.apply and the analyze output type" in {
      parityCases.foreach { case (e, expected) =>
        withClue(e) {
          val stepRow = Map[String, Any](
            "n" -> 3.0, "f" -> 1.5, "s" -> "Done", "body" -> "long text", "ts" -> "2026-07-01T00:00:00Z",
            "flag" -> true, "other" -> false
          )
          val value = ComputeStep.apply(Seq(stepRow), ComputeConfig("r", e, None)).head("r")
          (kindFor(expected), value) match {
            case ("boolean", _: Boolean) => succeed
            case ("number", _: Double)   => succeed
            case ("string", _: String)   => succeed
            case other                   => fail(s"kind mismatch: $other")
          }
        }
      }
    }

    "report a boolean column referenced alone as boolean (it evaluated as the text 'true' before)" in {
      infer("$flag") shouldBe Right("boolean")
      ExpressionEvaluator.evaluate("$flag", row) shouldBe Right(JsBoolean(true))
    }
  }

  "inference errors" should {
    "reject a number compared with text, with a cast hint" in {
      val m = err("""$n = "5"""")
      m should (include("=") and include("integer") and include("string"))
      m.toLowerCase should include("cast step")
      err("$s > 5").toLowerCase should include("cast step")
    }

    "point a numeric-vs-timestamp comparison at seconds_between" in {
      val m = err("$ts > 5")
      m should include("seconds_between")
      m.toLowerCase should include("cast step")
    }

    "reject boolean compared with number or text" in {
      err("$flag = 1") should (include("=") and include("boolean"))
      err("""$flag != "true"""") should include("boolean")
    }

    "reject an ordering comparison of booleans" in {
      err("$flag < $other") should (include("<") and include("boolean"))
      err("$flag >= true") should include(">=")
    }

    "reject a comparison with a binary-ref operand" in {
      err("$bin = $bin") should include("binary-ref")
    }

    "reject a non-boolean operand of and / or / not" in {
      err("$n and $flag") should include("and")
      err("$flag or $s") should include("or")
      err("not $n") should include("not")
    }

    "reject a non-boolean if condition" in {
      err("if($n, 1, 0)") should include("if")
      err("""if($s, 1, 0)""") should include("if")
    }

    "reject if branches of mixed kinds" in {
      err("""if($flag, $n, "none")""") should (include("if") and include("integer") and include("string"))
      err("if($flag, $flag, 1)") should (include("if") and include("boolean"))
      err("""if($flag, true, "x")""") should include("if")
    }

    "reject coalesce mixing boolean with non-boolean" in {
      err("""coalesce($flag, "x")""") should (include("coalesce") and include("boolean"))
      err("coalesce($flag, 1)") should include("coalesce")
    }

    "keep the numeric/text coalesce message and its concat hint" in {
      val m = err("""coalesce($n, "n/a")""")
      m should (include("coalesce") and include("concat("))
      infer("""coalesce(concat($n), "n/a")""") shouldBe Right("string")
    }

    "reject a boolean sub-expression used as a number, suggesting if(cond, 1, 0)" in {
      Seq(
        """($s = "Done") * 1""", "($n > 1) - 1", "1 / ($n > 1)", "-($n > 1)", "floor($n > 1)", "round($n > 1, 1)",
        "mod($n, $n > 1)", "abs(not $flag)", "(true) * 2", "($flag and $other) * 3", "add_days($ts, $n > 1)",
        "if($flag, $flag, $other) * 2", "coalesce($flag, $other) - 1"
      ).foreach { e =>
        withClue(e)(err(e) should include("if(cond, 1, 0)"))
      }
    }

    "leave a bare boolean column in a numeric context to the existing warning, not a new error" in {
      infer("$flag * 1") shouldBe Right("float")
      infer("-$flag") shouldBe Right("float")
      infer("floor($flag)") shouldBe Right("float")
    }

    "still allow + on a boolean sub-expression (it concatenates)" in {
      infer("($n > 1) + 1") shouldBe Right("string")
    }
  }

  "ColumnSchemaInference.inferCompute" should {
    import ColumnSchemaInference.inferCompute

    def schema = types.filterNot(_._1 == "bin").map { case (k, v) => SchemaField(k, v) }.toVector
    def cfg(e: String) = s"""{"column":"out","type":"string","expression":${JsString(e).compactPrint}}"""

    "surface an inference error as the step's validationError while the step still saves and projects" in {
      val (out, validation) = inferCompute(cfg("""$n = "5""""), schema)
      validation.getOrElse(fail("expected a validationError")) should (include("=") and include("cast step"))
      out.map(_.name) should contain("out")
      ExpressionEvaluator.validate("""$n = "5"""", schema.map(_.name).toSet) shouldBe Right(()) // parse validity governs saving
    }

    "project boolean / float / string output types for the new constructs" in {
      inferCompute(cfg("""$s = "Done""""), schema)._1.last shouldBe SchemaField("out", "boolean")
      inferCompute(cfg("""if($s = "Done", 1, 0)"""), schema)._1.last shouldBe SchemaField("out", "float")
      inferCompute(cfg("$flag"), schema)._1.last shouldBe SchemaField("out", "boolean")
      inferCompute(cfg("$flag"), schema)._2 shouldBe None
    }
  }

}
