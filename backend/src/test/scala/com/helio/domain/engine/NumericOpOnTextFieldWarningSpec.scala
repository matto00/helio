package com.helio.domain.engine

import com.helio.domain.engine.AnalyzeSchemaWarnings.Warning
import com.helio.domain.engine.PipelineAnalyzeService.NodeStepInput
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json.JsString

/** HEL-1403: the non-blocking `numeric-op-on-text-field` compute warning. Every case runs the
 *  REAL `analyzeNodes` and feeds its projections to the pass, as `PipelineService` does. A CSV root
 *  projects every column as `string` and is type-trusted (HEL-893 D1). */
class NumericOpOnTextFieldWarningSpec extends AnyWordSpec with Matchers {

  private val Code = AnalyzeSchemaWarnings.NumericOpOnTextField

  private def f(name: String, t: String = "string"): SchemaField = SchemaField(name, t)

  private val roots: Map[String, Vector[SchemaField]] = Map(
    "L" -> Vector(f("price"), f("s"), f("t"), f("first"), f("last"), f("b", "boolean"), f("n", "integer"))
  )

  private def compute(id: String, parent: Option[String], pos: Int, column: String, expr: String, enabled: Boolean = true): NodeStepInput =
    NodeStepInput(id, parent, pos, "compute", s"""{"column":"$column","type":"string","expression":${JsString(expr).compactPrint}}""", Some("L"), enabled)

  private def warnings(steps: Vector[NodeStepInput]): Vector[Warning] = {
    val projections = PipelineAnalyzeService.analyzeNodes(steps, roots, Map.empty)
    AnalyzeSchemaWarnings.compute(steps, projections, Map.empty)
  }

  private def one(expr: String): Vector[Warning] = warnings(Vector(compute("c1", None, 0, "o", expr))).filter(_.code == Code)

  "numeric-op-on-text-field" should {

    "warn for floor($price) over an uncast CSV column, naming field, type, function and a cast step" in {
      val ws = one("floor($price)")
      ws should have size 1
      ws.head.stepId shouldBe "c1"
      ws.head.message should include("'price'")
      ws.head.message should include("string")
      ws.head.message should include("floor")
      ws.head.message should include("cast step")
      ws.head.message should include("compute")
    }

    "warn once for $s - 1" in { one("$s - 1").map(_.message).count(_.contains("'s'")) shouldBe 1 }

    "warn ONCE for s used in two contexts, naming both" in {
      val ws = one("floor($s) + $s * 2")
      ws should have size 1
      ws.head.message should include("floor")
      ws.head.message should include("*")
    }

    "warn for a boolean field under unary minus" in {
      val ws = one("-$b")
      ws should have size 1
      ws.head.message should include("'b'")
      ws.head.message should include("boolean")
    }

    "warn for a text field inside a non-numeric sub-expression of a numeric function (floor($s + 1))" in {
      one("floor($s + 1)").map(_.message).exists(_.contains("'s'")) shouldBe true
    }

    "warn for floor(coalesce($s, \"0\"))" in {
      one("""floor(coalesce($s, "0"))""").map(_.message).exists(_.contains("'s'")) shouldBe true
    }

    "warn on s ONLY for floor($s + length($t)) -- never into another function's arguments" in {
      val ws = one("floor($s + length($t))")
      ws should have size 1
      ws.head.message should include("'s'")
    }

    "not warn for string concatenation, a string function, or an integer field" in {
      one("""$first + " " + $last""") shouldBe empty
      one("length($s)") shouldBe empty
      one("floor($n)") shouldBe empty
      one("$s + 1") shouldBe empty
    }

    "not warn after a trusted cast to double" in {
      val steps = Vector(
        NodeStepInput("k1", None, 0, "cast", """{"casts":{"price":"double"}}""", Some("L"), true),
        compute("c1", Some("k1"), 1, "o", "floor($price)")
      )
      warnings(steps).filter(_.code == Code) shouldBe empty
    }

    "not warn when the field was produced by an upstream compute as TEXT (untrusted types)" in {
      // x = $s is text-typed; without the trust gate floor($x) WOULD warn, so the gate alone is why none appears.
      val steps = Vector(compute("c1", None, 0, "x", "$s"), compute("c2", Some("c1"), 1, "o", "floor($x)"))
      val projections = PipelineAnalyzeService.analyzeNodes(steps, roots, Map.empty)
      projections("c2").inputSchema.find(_.name == "x").map(_.`type`) shouldBe Some("string")
      warnings(steps).filter(_.code == Code) shouldBe empty
    }

    "not warn for an unrelated column after a compute (trust is per step, design D5)" in {
      val steps = Vector(compute("c1", None, 0, "k", "1"), compute("c2", Some("c1"), 1, "o", "floor($price)"))
      warnings(steps).filter(_.code == Code) shouldBe empty
    }

    "not warn for a disabled step or for a step with a validationError" in {
      warnings(Vector(compute("c1", None, 0, "o", "floor($price)", enabled = false))).filter(_.code == Code) shouldBe empty
      val bad = Vector(compute("c1", None, 0, "o", "floor($price) + $nope"))
      PipelineAnalyzeService.analyzeNodes(bad, roots, Map.empty)("c1").validationError shouldBe defined
      warnings(bad).filter(_.code == Code) shouldBe empty
    }
  }
}
