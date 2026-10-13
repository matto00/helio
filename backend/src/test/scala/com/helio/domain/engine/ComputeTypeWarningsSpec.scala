package com.helio.domain.engine

import com.helio.domain.engine.AnalyzeSchemaWarnings.Warning
import com.helio.domain.engine.PipelineAnalyzeService.NodeStepInput
import com.helio.domain.steps.CastStep
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json.JsString

/** HEL-1455: per-column type trust, `string-body` in `+`, `substring`'s start/end, and the two new non-blocking
 *  compute warnings (`text-function-on-numeric-field`, `literal-type-mismatch`). Every case runs the REAL
 *  `analyzeNodes` and feeds its projections to the pass. */
class ComputeTypeWarningsSpec extends AnyWordSpec with Matchers {

  private val Numeric  = AnalyzeSchemaWarnings.NumericOpOnTextField
  private val TextFn   = AnalyzeSchemaWarnings.TextFunctionOnNumericField
  private val Literal  = AnalyzeSchemaWarnings.LiteralTypeMismatch
  private val Mismatch = AnalyzeSchemaWarnings.JoinKeyTypeMismatch

  private def f(name: String, t: String = "string"): SchemaField = SchemaField(name, t)

  private val roots: Map[String, Vector[SchemaField]] = Map(
    "L" -> Vector(
      f("price"), f("name"), f("start"), f("id"), f("flag", "boolean"), f("sb", "string-body"),
      f("n", "integer"), f("u", "float"), f("ts", "timestamp")
    ),
    "R" -> Vector(f("id", "integer"), f("total", "float"))
  )

  private def node(id: String, parent: Option[String], pos: Int, op: String, config: String, root: String = "L"): NodeStepInput =
    NodeStepInput(id, parent, pos, op, config, Some(root), true)

  private def compute(id: String, parent: Option[String], pos: Int, column: String, expr: String): NodeStepInput =
    node(id, parent, pos, "compute", s"""{"column":"$column","type":"string","expression":${JsString(expr).compactPrint}}""")

  private def warnings(steps: Vector[NodeStepInput]): Vector[Warning] = {
    val projections = PipelineAnalyzeService.analyzeNodes(steps, roots, Map.empty)
    AnalyzeSchemaWarnings.compute(steps, projections, Map.empty)
  }

  private def one(expr: String, code: String): Vector[Warning] =
    warnings(Vector(compute("c1", None, 0, "o", expr))).filter(_.code == code)

  "item 1: `+` with a string-body or boolean operand" should {
    "infer string for $sb + 1" in {
      ExpressionEvaluator.inferType("$sb + 1", Map("sb" -> "string-body")) shouldBe Right("string")
    }
    "warn for floor($sb + 1) over a trusted string-body field" in {
      val ws = one("floor($sb + 1)", Numeric)
      ws should have size 1
      ws.head.message should include("'sb'")
      ws.head.message should include("string-body")
      ws.head.message should include("floor")
    }
    "still warn for floor($flag + 1) over a boolean (regression)" in {
      val ws = one("floor($flag + 1)", Numeric)
      ws should have size 1
      ws.head.message should include("'flag'")
    }
  }

  "item 2: per-column trust through compute" should {
    "warn for floor($price) after a compute that wrote another column" in {
      val steps = Vector(compute("c1", None, 0, "total", "1"), compute("c2", Some("c1"), 1, "o", "floor($price)"))
      val ws = warnings(steps).filter(_.code == Numeric)
      ws.map(_.stepId) shouldBe Vector("c2")
      ws.head.message should include("'price'")
    }
    "stay silent for the column a compute wrote" in {
      val steps = Vector(compute("c1", None, 0, "total", "$price"), compute("c2", Some("c1"), 1, "o", "floor($total)"))
      warnings(steps).filter(_.code == Numeric) shouldBe empty
    }
    "keep a compute-written column untrusted through rename" in {
      val steps = Vector(
        compute("c1", None, 0, "total", "$price"),
        node("r", Some("c1"), 1, "rename", """{"renames":{"total":"t2"}}"""),
        compute("c2", Some("r"), 2, "o", "floor($t2)")
      )
      warnings(steps).filter(_.code == Numeric) shouldBe empty
    }
    "keep an untouched column trusted through compute -> rename -> compute" in {
      val steps = Vector(
        compute("c1", None, 0, "total", "$price"),
        node("r", Some("c1"), 1, "rename", """{"renames":{"price":"p2"}}"""),
        compute("c2", Some("r"), 2, "o", "floor($p2)")
      )
      warnings(steps).filter(_.code == Numeric).map(_.stepId) shouldBe Vector("c2")
    }
    "keep trust through compute -> select -> compute, and drop an unselected written column" in {
      val steps = Vector(
        compute("c1", None, 0, "total", "$price"),
        node("s", Some("c1"), 1, "select", """{"fields":["price","total"]}"""),
        compute("c2", Some("s"), 2, "o", "floor($price) + floor($total)")
      )
      val ws = warnings(steps).filter(_.code == Numeric)
      ws should have size 1
      ws.head.message should include("'price'")
    }
    "make a compute-written column trusted again once a supported cast pins it" in {
      val steps = Vector(
        compute("c1", None, 0, "total", "$price"),
        node("k", Some("c1"), 1, "cast", """{"casts":{"total":"float"}}"""),
        compute("c2", Some("k"), 2, "o", "floor($total)")
      )
      warnings(steps).filter(_.code == Numeric) shouldBe empty
    }
  }

  "item 3: HEL-1436 cast regression" should {
    "stay silent for cast price -> float then floor($price)" in {
      val steps = Vector(node("k", None, 0, "cast", """{"casts":{"price":"float"}}"""), compute("c1", Some("k"), 1, "o", "floor($price)"))
      warnings(steps).filter(_.code == Numeric) shouldBe empty
    }
    "keep a legacy/unsupported cast target (string-body) untrusted: floor($price) stays silent" in {
      CastStep.SupportedTargets should not contain "string-body"
      val steps = Vector(node("k", None, 0, "cast", """{"casts":{"price":"string-body"}}"""), compute("c1", Some("k"), 1, "o", "floor($price)"))
      warnings(steps).filter(_.code == Numeric) shouldBe empty
    }
  }

  "substring start/end (item 4)" should {
    "warn for a text start" in {
      val ws = one("substring($name, $start, 3)", Numeric)
      ws should have size 1
      ws.head.message should include("'start'")
      ws.head.message should include("substring")
    }
    "not warn for the text argument" in { one("substring($name, 1, 3)", Numeric) shouldBe empty }
  }

  "text-function-on-numeric-field (4a)" should {
    "warn for length($n) over a trusted integer, without blocking" in {
      val steps = Vector(compute("c1", None, 0, "o", "length($n)"))
      val projections = PipelineAnalyzeService.analyzeNodes(steps, roots, Map.empty)
      projections("c1").validationError shouldBe None
      val ws = warnings(steps).filter(_.code == TextFn)
      ws should have size 1
      ws.head.message should include("'n'")
      ws.head.message should include("integer")
      ws.head.message should include("length")
    }
    "warn for lower/upper/substring first argument over a float" in {
      one("lower($u)", TextFn) should have size 1
      one("upper($u)", TextFn) should have size 1
      one("substring($u, 1, 2)", TextFn) should have size 1
    }
    "warn through arithmetic" in { one("length($n * 2)", TextFn).map(_.message).exists(_.contains("'n'")) shouldBe true }
    "not warn once the argument is text" in {
      one("length(concat($n))", TextFn) shouldBe empty
      one("length($n + \"\")", TextFn) shouldBe empty
    }
    "not warn for a text field" in { one("length($name)", TextFn) shouldBe empty }
    "not warn for an untrusted (compute-written) numeric field" in {
      val steps = Vector(compute("c1", None, 0, "n2", "$u * 2"), compute("c2", Some("c1"), 1, "o", "length($n2)"))
      warnings(steps).filter(_.code == TextFn) shouldBe empty
    }
    "not warn for a mixed-trust argument" in {
      val steps = Vector(compute("c1", None, 0, "w", "$u * 2"), compute("c2", Some("c1"), 1, "o", "length($n * $w)"))
      warnings(steps).filter(_.code == TextFn) shouldBe empty
    }
    "warn for the trusted field once the same function is applied alone" in {
      val steps = Vector(compute("c1", None, 0, "w", "$u * 2"), compute("c2", Some("c1"), 1, "o", "length($n)"))
      warnings(steps).filter(_.code == TextFn) should have size 1
    }
  }

  "literal-type-mismatch (4b)" should {
    "warn for \"3\" * 2 and never produce a validationError" in {
      val steps = Vector(compute("c1", None, 0, "o", "\"3\" * 2"))
      PipelineAnalyzeService.analyzeNodes(steps, roots, Map.empty)("c1").validationError shouldBe None
      val ws = warnings(steps).filter(_.code == Literal)
      ws should have size 1
      ws.head.message should include("\"3\"")
      ws.head.message should include("*")
    }
    "warn for length(5)" in {
      val ws = one("length(5)", Literal)
      ws should have size 1
      ws.head.message should include("5")
      ws.head.message should include("length")
    }
    "warn through a + operand of a numeric context, regardless of trust" in {
      one("floor(\"a\" + 1)", Literal) should have size 1
      val steps = Vector(compute("c1", None, 0, "x", "$price"), compute("c2", Some("c1"), 1, "o", "\"3\" * 2"))
      warnings(steps).filter(_.code == Literal).map(_.stepId) shouldBe Vector("c2")
    }
    "not warn for a concatenated string literal" in { one("\"Total: \" + $price", Literal) shouldBe empty }
    "not warn for a literal behind coalesce, if, or a number-literal +" in {
      one("length(coalesce($name, 0))", Literal) shouldBe empty
      one("floor(if($flag, \"a\", $u))", Literal) shouldBe empty
      one("length(5 + $u)", Literal) shouldBe empty
    }
    "dedupe the same literal in the same context" in { one("(\"3\" * 2) + (\"3\" * 4)", Literal) should have size 1 }
  }

  private def laneJoin(leftPrefix: Vector[NodeStepInput], rightPrefix: Vector[NodeStepInput]): Vector[NodeStepInput] = {
    val laneL = node("laneL", None, 0, "rename", """{"renames":{}}""")
    val laneR = node("laneR", None, 1, "rename", """{"renames":{}}""", root = "R")
    val left  = laneL +: leftPrefix
    val right = laneR +: rightPrefix
    val join  = node("join", Some(left.last.id), 20, "join", s"""{"joinKey":"id","joinType":"inner","secondaryInput":{"kind":"lane","stepId":"${right.last.id}"}}""")
    left ++ right :+ join
  }

  private def laneLookup(leftPrefix: Vector[NodeStepInput], rightPrefix: Vector[NodeStepInput]): Vector[NodeStepInput] = {
    val laneL = node("laneL", None, 0, "rename", """{"renames":{}}""")
    val laneR = node("laneR", None, 1, "rename", """{"renames":{}}""", root = "R")
    val left  = laneL +: leftPrefix
    val right = laneR +: rightPrefix
    val lk    = node("lk", Some(left.last.id), 20, "lookup",
      s"""{"secondaryInput":{"kind":"lane","stepId":"${right.last.id}"},"sourceKey":"id","lookupKey":"id","columns":["total"]}""")
    left ++ right :+ lk
  }

  private def keyWarned(steps: Vector[NodeStepInput]): Boolean = warnings(steps).exists(_.code == Mismatch)

  "join and lookup key checks use per-side, per-column trust (2b)" should {
    val otherCompute = compute("c", Some("laneL"), 5, "total2", "1")
    val writesLeftId = compute("c", Some("laneL"), 5, "id", "$price")
    val otherRight   = compute("cr", Some("laneR"), 5, "total2", "1")
    val writesRightId = compute("cr", Some("laneR"), 5, "id", "$total")

    "warn when a compute on another column precedes the join (left)" in { keyWarned(laneJoin(Vector(otherCompute), Vector.empty)) shouldBe true }
    "not warn when the left key was written by a compute" in { keyWarned(laneJoin(Vector(writesLeftId), Vector.empty)) shouldBe false }
    "not warn when the right key was written by a compute" in { keyWarned(laneJoin(Vector.empty, Vector(writesRightId))) shouldBe false }
    "warn when the lane secondary computed another column" in { keyWarned(laneJoin(Vector.empty, Vector(otherRight))) shouldBe true }
    "warn exactly like the join for a lookup" in {
      keyWarned(laneLookup(Vector(otherCompute), Vector.empty)) shouldBe true
      keyWarned(laneLookup(Vector(writesLeftId), Vector.empty)) shouldBe false
      keyWarned(laneLookup(Vector.empty, Vector(writesRightId))) shouldBe false
      keyWarned(laneLookup(Vector.empty, Vector(otherRight))) shouldBe true
      warnings(laneLookup(Vector.empty, Vector.empty)).filter(_.code == Mismatch).head.message should startWith("lookup:")
    }
  }
}
