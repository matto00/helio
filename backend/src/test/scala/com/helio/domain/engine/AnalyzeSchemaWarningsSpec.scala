package com.helio.domain.engine

import com.helio.domain.engine.AnalyzeSchemaWarnings.Warning
import com.helio.domain.engine.PipelineAnalyzeService.NodeStepInput
import com.helio.domain.model.{DataSource, DataSourceId, DatasetSource, PipelineExecutionContext, PipelineId, PipelineStepId, UserId}
import com.helio.domain.steps.{JoinConfig, JoinStep, SecondaryInput}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.time.Instant
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1235: schema-only, non-blocking analyze warnings (missing referenced field, join-key type
 *  mismatch, join column rename). Every case runs the REAL `analyzeNodes` and feeds its
 *  projections to the pass, exactly as `PipelineService` does.
 *
 *  Task 1.1 (D3 exclusion list), verified against `PipelineAnalyzeService`: ops that ALREADY
 *  report an unknown field as a blocking `validationError` and are therefore never checked by the
 *  warning pass: compute (ExpressionEvaluator.validate), convertformat, analyzewithai,
 *  generatetext, splittext, extractheadings, chunkbytokencount, pivot, unpivot, assert.
 *  The checked ops (the reference table in `AnalyzeSchemaWarnings.referencedFields`) are filter,
 *  sort, dedupe, select, rename, cast, datebucket, window, fillnull, stringops, aggregate, groupby,
 *  lookup (sourceKey) and join (joinKey). */
class AnalyzeSchemaWarningsSpec extends AnyWordSpec with Matchers {

  private def f(name: String, t: String = "string"): SchemaField = SchemaField(name, t)

  private def node(
      id: String,
      parent: Option[String],
      pos: Int,
      op: String,
      config: String,
      root: Option[String] = Some("L"),
      enabled: Boolean = true
  ): NodeStepInput = NodeStepInput(id, parent, pos, op, config, root, enabled)

  private def warnings(
      steps: Vector[NodeStepInput],
      roots: Map[String, Vector[SchemaField]],
      secondary: Map[String, Vector[SchemaField]] = Map.empty
  ): Vector[Warning] = {
    val projections = PipelineAnalyzeService.analyzeNodes(steps, roots, secondary)
    AnalyzeSchemaWarnings.compute(steps, projections, secondary)
  }

  private def codes(ws: Vector[Warning]): Vector[(String, String)] = ws.map(w => w.stepId -> w.code)

  private val Missing = AnalyzeSchemaWarnings.FieldNotInInputSchema
  private val TypeMismatch = AnalyzeSchemaWarnings.JoinKeyTypeMismatch
  private val Renamed = AnalyzeSchemaWarnings.JoinColumnRenamed

  // ---------------------------------------------------------------- missing field

  "missing referenced field" should {

    "warn for count(amount) over a step whose output is (category,total) -- the HEL-1069 shape" in {
      val roots = Map("L" -> Vector(f("category"), f("amount", "float")))
      val steps = Vector(
        node("s1", None, 0, "aggregate",
          """{"groupBy":[{"name":"category","type":"string"}],"aggregations":[{"alias":"total","fn":"sum","field":"amount"}]}"""),
        node("s2", Some("s1"), 1, "aggregate",
          """{"groupBy":[],"aggregations":[{"alias":"n","fn":"count","field":"amount"}]}""")
      )
      val projections = PipelineAnalyzeService.analyzeNodes(steps, roots)
      projections("s2").validationError shouldBe None
      val ws = warnings(steps, roots)
      codes(ws) shouldBe Vector("s2" -> Missing)
      ws.head.message should include("'amount'")
      ws.head.message should include("not found in this step's inferred input schema")
      ws.head.message should include("available: category, total")
    }

    // One row per reference-table op: a missing field warns, a present one does not.
    val tableRows: Vector[(String, String, String, String)] = Vector(
      ("filter", """{"combinator":"AND","conditions":[{"field":"%s","operator":"=","value":"1"}]}""", "a", "nope"),
      ("sort", """{"sortBy":[{"field":"%s","direction":"asc"}]}""", "a", "nope"),
      ("dedupe", """{"keys":["%s"],"keep":"first"}""", "a", "nope"),
      ("select", """{"fields":["%s"]}""", "a", "nope"),
      ("rename", """{"renames":{"%s":"z"}}""", "a", "nope"),
      ("cast", """{"casts":{"%s":"integer"}}""", "a", "nope"),
      ("datebucket", """{"field":"%s","granularity":"day"}""", "a", "nope"),
      ("window", """{"partitionBy":["%s"],"orderBy":[],"function":"row_number","outputColumn":"rn"}""", "a", "nope"),
      ("window", """{"partitionBy":[],"orderBy":[{"field":"%s","direction":"asc"}],"function":"row_number","outputColumn":"rn"}""", "a", "nope"),
      ("window", """{"partitionBy":[],"orderBy":[],"function":"lag","field":"%s","outputColumn":"rn"}""", "a", "nope"),
      ("fillnull", """{"columns":["%s"],"strategy":"constant","value":"0"}""", "a", "nope"),
      ("stringops", """{"operation":"upper","field":"%s","outputColumn":"o"}""", "a", "nope"),
      ("stringops", """{"operation":"concat","fields":["%s"],"outputColumn":"o"}""", "a", "nope"),
      ("aggregate", """{"groupBy":[{"name":"%s","type":"string"}],"aggregations":[]}""", "a", "nope"),
      ("aggregate", """{"groupBy":[],"aggregations":[{"alias":"t","fn":"sum","field":"%s"}]}""", "a", "nope"),
      ("groupby", """{"groupBy":["%s"],"aggColumn":"a","aggFunction":"count"}""", "a", "nope"),
      ("groupby", """{"groupBy":["a"],"aggColumn":"%s","aggFunction":"count"}""", "a", "nope"),
      ("lookup", """{"secondaryInput":{"kind":"source","dataSourceId":"ds"},"sourceKey":"%s","lookupKey":"k","columns":["c"]}""", "a", "nope")
    )
    tableRows.zipWithIndex.foreach { case ((op, template, present, absent), idx) =>
      s"check $op reference variant #$idx" in {
        val roots = Map("L" -> Vector(f("a"), f("b")))
        def run(name: String) = warnings(Vector(node("s", None, 0, op, template.format(name))), roots)
        run(present) shouldBe empty
        val ws = run(absent)
        codes(ws) shouldBe Vector("s" -> Missing)
        ws.head.message should include(s"'$absent'")
      }
    }

    "never treat a 'no field' value as a reference" in {
      val roots = Map("L" -> Vector(f("a")))
      val cases = Vector(
        "aggregate" -> """{"groupBy":[],"aggregations":[{"alias":"n","fn":"count","field":""}]}""",
        "filter"    -> """{"combinator":"AND","conditions":[{"field":"","operator":"=","value":"1"}]}""",
        "window"    -> """{"partitionBy":[],"orderBy":[],"function":"rank","outputColumn":"rn"}""",
        "groupby"   -> """{"groupBy":["a"],"aggColumn":"","aggFunction":"count"}""",
        "dedupe"    -> """{"keys":[],"keep":"first"}"""
      )
      cases.foreach { case (op, cfg) =>
        withClue(op) { warnings(Vector(node("s", None, 0, op, cfg)), roots) shouldBe empty }
      }
    }

    "not warn for output-only names (aliases, new column names)" in {
      val roots = Map("L" -> Vector(f("a")))
      warnings(Vector(node("s", None, 0, "stringops", """{"operation":"upper","field":"a","outputColumn":"brand_new"}""")), roots) shouldBe empty
    }

    "emit one warning per distinct missing field" in {
      val roots = Map("L" -> Vector(f("a")))
      val ws = warnings(Vector(node("s", None, 0, "select", """{"fields":["x","x","y","a"]}""")), roots)
      ws.map(_.message.contains("'x'")) should contain(true)
      ws should have size 2
    }

    "cap the available-field list" in {
      val roots = Map("L" -> (1 to 30).map(i => f(s"c$i")).toVector)
      val ws = warnings(Vector(node("s", None, 0, "select", """{"fields":["nope"]}""")), roots)
      ws.head.message should include("c20")
      ws.head.message should not include "c21,"
      ws.head.message should include("…")
    }

    "not warn for a disabled step" in {
      val roots = Map("L" -> Vector(f("a")))
      warnings(Vector(node("s", None, 0, "select", """{"fields":["nope"]}""", enabled = false)), roots) shouldBe empty
    }

    "not warn for a step that carries a validationError" in {
      val roots = Map("L" -> Vector(f("a")))
      val steps = Vector(node("s", None, 0, "aggregate",
        """{"groupBy":[],"aggregations":[{"alias":"t","fn":"bogus","field":"nope"}]}"""))
      PipelineAnalyzeService.analyzeNodes(steps, roots)("s").validationError should not be empty
      warnings(steps, roots) shouldBe empty
    }

    "not double-report an op whose analyze path already errors on an unknown field" in {
      val roots = Map("L" -> Vector(f("a", "string-body")))
      val splitText = node("s", None, 0, "splittext", """{"field":"nope"}""")
      val pivot = node("p", None, 1, "pivot", """{"index":["nope"],"column":"a","values":"a","agg":"sum"}""")
      val projections = PipelineAnalyzeService.analyzeNodes(Vector(splitText, pivot), roots)
      projections("s").validationError.exists(_.contains("Unknown field")) shouldBe true
      projections("p").validationError.exists(_.contains("Unknown field")) shouldBe true
      warnings(Vector(splitText, pivot), roots) shouldBe empty
    }

    "not warn when the input schema is empty" in {
      warnings(Vector(node("s", None, 0, "select", """{"fields":["nope"]}""")), Map("L" -> Vector.empty)) shouldBe empty
    }

    // D3a completeness negatives (a)-(g)

    "(a) not warn for a secondary-only column after a union with a source-kind secondary" in {
      val roots = Map("L" -> Vector(f("a")))
      val steps = Vector(
        node("u", None, 0, "union", """{"mode":"byName","secondaryInput":{"kind":"source","dataSourceId":"ds"}}"""),
        node("s", Some("u"), 1, "select", """{"fields":["only_in_secondary"]}""")
      )
      warnings(steps, roots) shouldBe empty
    }

    "(b) not warn for a right-side column after a join with an unresolvable source secondary" in {
      val roots = Map("L" -> Vector(f("id")))
      val steps = Vector(
        node("j", None, 0, "join", """{"joinKey":"id","joinType":"inner","secondaryInput":{"kind":"source","dataSourceId":"ds"}}"""),
        node("s", Some("j"), 1, "select", """{"fields":["right_only"]}""")
      )
      warnings(steps, roots) shouldBe empty
    }

    "(c) not warn for a source column after an empty root feeds a column-adding step" in {
      val steps = Vector(
        node("st", None, 0, "stringops", """{"operation":"upper","field":"x","outputColumn":"o"}"""),
        node("s", Some("st"), 1, "select", """{"fields":["source_col"]}""")
      )
      warnings(steps, Map("L" -> Vector.empty)) shouldBe empty
    }

    "(d) not warn for a descendant of a step with a validationError" in {
      val roots = Map("L" -> Vector(f("a")))
      val steps = Vector(
        node("bad", None, 0, "aggregate", """{"groupBy":[],"aggregations":[{"alias":"t","fn":"bogus","field":"a"}]}"""),
        node("s", Some("bad"), 1, "select", """{"fields":["nope"]}""")
      )
      warnings(steps, roots) shouldBe empty
    }

    "(e) an aggregate under an incomplete input resets name-completeness (its child DOES warn)" in {
      val steps = Vector(
        node("agg", None, 0, "aggregate", """{"groupBy":[],"aggregations":[{"alias":"total","fn":"count","field":""}]}"""),
        node("ok", Some("agg"), 1, "select", """{"fields":["total"]}"""),
        node("s", Some("agg"), 2, "select", """{"fields":["missing_alias"]}""")
      )
      val ws = warnings(steps, Map("L" -> Vector.empty))
      codes(ws) shouldBe Vector("s" -> Missing)
    }

    "(g) not warn for a data-derived column after a pivot" in {
      val roots = Map("L" -> Vector(f("region"), f("year"), f("sales", "float")))
      val steps = Vector(
        node("p", None, 0, "pivot", """{"index":["region"],"column":"year","values":"sales","agg":"sum"}"""),
        node("s", Some("p"), 1, "select", """{"fields":["sales_2024"]}""")
      )
      PipelineAnalyzeService.analyzeNodes(steps, roots)("p").validationError shouldBe None
      warnings(steps, roots) shouldBe empty
    }
  }

  // ---------------------------------------------------------------- join key type mismatch

  private def laneJoin(
      leftCols: Vector[SchemaField],
      rightCols: Vector[SchemaField],
      key: String = "id",
      leftPrefix: Vector[NodeStepInput] = Vector.empty
  ): (Vector[NodeStepInput], Map[String, Vector[SchemaField]]) = {
    val rightLane = node("laneR", None, 1, "rename", """{"renames":{}}""", root = Some("R"))
    val leftLane = node("laneL", None, 0, "rename", """{"renames":{}}""", root = Some("L"))
    val chain = leftLane +: leftPrefix
    val tailId = chain.last.id
    val join = node("join", Some(tailId), 10, "join",
      s"""{"joinKey":"$key","joinType":"inner","secondaryInput":{"kind":"lane","stepId":"laneR"}}""")
    (chain :+ rightLane :+ join, Map("L" -> leftCols, "R" -> rightCols))
  }

  "join key type mismatch" should {

    "warn for a string key (CSV) joined to an integer key" in {
      val (steps, roots) = laneJoin(Vector(f("id", "string")), Vector(f("id", "integer")))
      val ws = warnings(steps, roots)
      codes(ws) shouldBe Vector("join" -> TypeMismatch)
      ws.head.message should include("'id'")
      ws.head.message should include("string")
      ws.head.message should include("integer")
    }

    "warn when the secondary is a resolved source-kind schema" in {
      val steps = Vector(node("join", None, 0, "join",
        """{"joinKey":"id","joinType":"inner","secondaryInput":{"kind":"source","dataSourceId":"ds"}}"""))
      val ws = warnings(steps, Map("L" -> Vector(f("id", "string"))), Map("ds" -> Vector(f("id", "integer"))))
      codes(ws) shouldBe Vector("join" -> TypeMismatch)
    }

    "not warn when key types match" in {
      val (steps, roots) = laneJoin(Vector(f("id", "string")), Vector(f("id", "string")))
      warnings(steps, roots) shouldBe empty
    }

    "not warn between integer and float keys (they match at run time)" in {
      val (steps, roots) = laneJoin(Vector(f("id", "integer")), Vector(f("id", "float")))
      warnings(steps, roots) shouldBe empty
    }

    "not warn for a timestamp key (its run-time class is not pinned)" in {
      val (steps, roots) = laneJoin(Vector(f("id", "timestamp")), Vector(f("id", "string")))
      warnings(steps, roots) shouldBe empty
    }

    "report a missing left key as field-not-in-input-schema, not a type mismatch" in {
      val (steps, roots) = laneJoin(Vector(f("other", "string")), Vector(f("id", "integer")))
      codes(warnings(steps, roots)) shouldBe Vector("join" -> Missing)
    }

    "report a missing right key against the secondary schema" in {
      val (steps, roots) = laneJoin(Vector(f("id", "string")), Vector(f("other", "string")))
      val ws = warnings(steps, roots)
      codes(ws) shouldBe Vector("join" -> Missing)
      ws.head.message should include("secondary")
    }

    "not warn for an unresolved secondary" in {
      val steps = Vector(node("join", None, 0, "join",
        """{"joinKey":"id","joinType":"inner","secondaryInput":{"kind":"source","dataSourceId":"ds"}}"""))
      warnings(steps, Map("L" -> Vector(f("id", "string")))) shouldBe empty
    }

    "(f) be suppressed when a side is type-incomplete (lookup placeholder column as the key)" in {
      val lookup = node("lk", Some("laneL"), 5, "lookup",
        """{"secondaryInput":{"kind":"source","dataSourceId":"ds"},"sourceKey":"k","lookupKey":"k2","columns":["id"]}""")
      val (steps, roots) = laneJoin(Vector(f("k", "string")), Vector(f("id", "integer")), leftPrefix = Vector(lookup))
      // lookup appends a placeholder `id: string`; the secondary is unresolved, so it must not be trusted.
      PipelineAnalyzeService.analyzeNodes(steps, roots)("join").inputSchema.map(_.name) should contain("id")
      warnings(steps, roots) shouldBe empty
    }

    "(h) be suppressed after an aggregate whose informational group-by type says integer" in {
      val agg = node("agg", Some("laneL"), 5, "aggregate",
        """{"groupBy":[{"name":"id","type":"integer"}],"aggregations":[{"alias":"n","fn":"count","field":"id"}]}""")
      val (steps, roots) = laneJoin(Vector(f("id", "string")), Vector(f("id", "string")), leftPrefix = Vector(agg))
      // projected: integer on the left, string on the right -- but the aggregate groups by the raw (string) value.
      PipelineAnalyzeService.analyzeNodes(steps, roots)("join").inputSchema.find(_.name == "id").map(_.`type`) shouldBe Some("integer")
      warnings(steps, roots) shouldBe empty
    }

    "be suppressed after a compute (its projected type is not proven to equal the run-time class)" in {
      // `$a * 1` projects `float`; against a string right key a trusted compute WOULD warn.
      val compute = node("c", Some("laneL"), 5, "compute", """{"column":"id","expression":"$a * 1","type":"float"}""")
      val (steps, roots) = laneJoin(Vector(f("a", "float")), Vector(f("id", "string")), leftPrefix = Vector(compute))
      PipelineAnalyzeService.analyzeNodes(steps, roots)("join").inputSchema.find(_.name == "id").map(_.`type`) shouldBe Some("float")
      warnings(steps, roots) shouldBe empty
    }

    "be suppressed after a fillnull (constant fill writes the raw string regardless of the column type)" in {
      val fill = node("fl", Some("laneL"), 5, "fillnull", """{"columns":["id"],"strategy":"constant","value":"x"}""")
      val (steps, roots) = laneJoin(Vector(f("id", "integer")), Vector(f("id", "string")), leftPrefix = Vector(fill))
      warnings(steps, roots) shouldBe empty
    }

    "trust a cast to integer (CastStep emits Int) and warn against a string key" in {
      val cast = node("cs", Some("laneL"), 5, "cast", """{"casts":{"id":"integer"}}""")
      val (steps, roots) = laneJoin(Vector(f("id", "string")), Vector(f("id", "string")), leftPrefix = Vector(cast))
      codes(warnings(steps, roots)) shouldBe Vector("join" -> TypeMismatch)
    }

    "not trust a cast to float (CastStep falls through to the raw string)" in {
      val cast = node("cs", Some("laneL"), 5, "cast", """{"casts":{"id":"float"}}""")
      val (steps, roots) = laneJoin(Vector(f("id", "string")), Vector(f("id", "string")), leftPrefix = Vector(cast))
      warnings(steps, roots) shouldBe empty
    }

    "stay quiet when the left side is name-incomplete" in {
      val (steps, roots) = laneJoin(Vector.empty, Vector(f("id", "integer")))
      warnings(steps, roots) shouldBe empty
    }
  }

  // ---------------------------------------------------------------- join column rename

  "join column rename" should {

    "warn when both lanes carry the same non-key column and leave the projection untouched" in {
      val (steps, roots) = laneJoin(Vector(f("id"), f("total", "float")), Vector(f("id"), f("total", "float")))
      val ws = warnings(steps, roots)
      codes(ws) shouldBe Vector("join" -> Renamed)
      ws.head.message should include("'total'")
      ws.head.message should include("right_total")
      PipelineAnalyzeService.analyzeNodes(steps, roots)("join").outputSchema.map(_.name) shouldBe Vector("id", "total", "right_total")
    }

    "not warn for the join key itself or for non-colliding columns" in {
      val (steps, roots) = laneJoin(Vector(f("id"), f("a")), Vector(f("id"), f("b")))
      warnings(steps, roots) shouldBe empty
    }

    "warn for a lookup column that collides with an input column" in {
      val lookup = node("lk", None, 2, "lookup",
        """{"secondaryInput":{"kind":"lane","stepId":"laneR"},"sourceKey":"id","lookupKey":"id","columns":["total","extra"]}""")
      val laneR = node("laneR", None, 1, "rename", """{"renames":{}}""", root = Some("R"))
      val laneL = node("laneL", None, 0, "rename", """{"renames":{}}""", root = Some("L"))
      val lk = lookup.copy(parentStepId = Some("laneL"))
      val roots = Map("L" -> Vector(f("id"), f("total")), "R" -> Vector(f("id"), f("total"), f("extra")))
      val ws = warnings(Vector(laneL, laneR, lk), roots)
      codes(ws) shouldBe Vector("lk" -> Renamed)
      ws.head.message should include("right_total")
    }

    "not warn when the secondary is unresolved" in {
      val steps = Vector(node("join", None, 0, "join",
        """{"joinKey":"id","joinType":"inner","secondaryInput":{"kind":"source","dataSourceId":"ds"}}"""))
      warnings(steps, Map("L" -> Vector(f("id"), f("total")))) shouldBe empty
    }

    "not warn when the left input is name-incomplete" in {
      val (steps, roots) = laneJoin(Vector.empty, Vector(f("id"), f("total")))
      warnings(steps, roots) shouldBe empty
    }
  }

  "ordering" should {
    "be by step position, then id, then code" in {
      val (steps0, roots) = laneJoin(Vector(f("id", "string"), f("total")), Vector(f("id", "integer"), f("total")))
      val after = node("late", Some("join"), 20, "select", """{"fields":["nope"]}""")
      val ws = warnings(steps0 :+ after, roots)
      codes(ws) shouldBe Vector("join" -> Renamed, "join" -> TypeMismatch, "late" -> Missing)
    }
  }

  // ---------------------------------------------------------------- D4 runtime probe (task 1.3)

  "join runtime value equality (probe backing the type families)" should {
    implicit val ec: ExecutionContext = ExecutionContext.global
    val now = Instant.now()
    type Row = Map[String, Any]

    def matches(leftKey: Any, rightKey: Any): Boolean = {
      val step = JoinStep(PipelineStepId("j"), PipelineId("p"), 0, JoinConfig(SecondaryInput.Lane("r"), "id", "inner"), now, now)
      val right: Seq[Row] = Seq(Map("id" -> rightKey, "v" -> 1))
      val ctx = PipelineExecutionContext(
        dataSourceRepo = new DataSourceRepository(null)(ec),
        loadSource     = _ => Future.failed(new IllegalStateException("unused")),
        resolveLane    = id => if (id == "r") Some(right) else None
      )
      Await.result(step.evaluate(Seq(Map("id" -> leftKey)), ctx), 5.seconds).nonEmpty
    }

    "match every numeric class pair (Int, Long, Double, BigDecimal) through the real JoinStep index" in {
      val numerics: Seq[Any] = Seq(1, 1L, 1.0, BigDecimal(1))
      for (l <- numerics; r <- numerics) withClue(s"${l.getClass.getSimpleName} vs ${r.getClass.getSimpleName}") {
        matches(l, r) shouldBe true
      }
    }

    "never match a String against a number or boolean" in {
      matches("1", 1) shouldBe false
      matches("1", 1L) shouldBe false
      matches("1", 1.0) shouldBe false
      matches(1L, "1") shouldBe false
      matches("true", true) shouldBe false
      matches(true, 1) shouldBe false
    }
  }
}
