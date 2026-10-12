package com.helio.domain.engine

import com.helio.domain.engine.PipelineAnalyzeService.NodeStepInput
import com.helio.domain.model.{AssertionSink, PipelineId, PipelineRootId, PipelineStep, PipelineStepId, TruncationSink}
import com.helio.domain.steps.{CastConfig, CastStep, FillNullConfig, FillNullStep, SecondaryInput, UnionConfig, UnionStep}
import com.helio.infrastructure.persistence.pipelines.PipelineStepRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.nio.file.Paths
import java.time.Instant
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext}

/** HEL-1491: analyze/run parity for the two paths that put a number under a `timestamp` projection
 *  (fillnull mean/median over an epoch-string timestamp column; a lane-kind union whose secondary
 *  carries a numeric column the parent projects as `timestamp`, or the reverse). The run side uses
 *  the production tree walk (`executeTree`), which resolves lane secondaries.
 *  RED = fails on the pre-fix tree (analyze reports no step error); GUARD = preserved behaviour. */
class TimestampNumberParitySpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global
  private val engine   = new InProcessPipelineEngine(new LocalFileSystem(Paths.get("/")))
  private val stepRepo = new PipelineStepRepository(null)(ec)
  private val dsRepo   = new DataSourceRepository(null)(ec)
  private val pid      = PipelineId("p-ts-number")
  private val rootId   = PipelineRootId(pid.value)
  private val now      = Instant.now()

  private def cast(id: String, pos: Int, col: String, to: String, parent: Option[String] = None): CastStep =
    CastStep(PipelineStepId(id), pid, pos, CastConfig(Map(col -> to)), now, now, parent.map(PipelineStepId(_)))

  private def fill(id: String, strategy: String, cols: Vector[String], parent: String, value: Option[String] = None): FillNullStep =
    FillNullStep(PipelineStepId(id), pid, 1, FillNullConfig(cols, strategy, value), now, now, Some(PipelineStepId(parent)))

  private def union(id: String, parent: String, secondaryLane: String): UnionStep =
    UnionStep(PipelineStepId(id), pid, 1, UnionConfig(SecondaryInput.Lane(secondaryLane), "byPosition"), now, now, Some(PipelineStepId(parent)))

  private def runRows(steps: Vector[PipelineStep], rows: Seq[Map[String, Any]], node: String): Seq[Map[String, Any]] = {
    val rootIdOfStep = steps.filter(_.parentStepId.isEmpty).map(_.id -> rootId).toMap
    Await.result(
      engine.executeTree(Vector((pid.value, rows)), steps, stepRepo, rootIdOfStep, dsRepo, new AssertionSink, new TruncationSink),
      10.seconds
    ).nodeOutcomes(StepKey(node)).rows
  }

  private def analyze(inputs: Vector[NodeStepInput], source: Vector[SchemaField]): Map[String, PipelineAnalyzeService.AnalyzedStep] =
    PipelineAnalyzeService.analyzeNodes(inputs, Map("" -> source))

  private def castIn(id: String, pos: Int, col: String, to: String, parent: Option[String] = None) =
    NodeStepInput(id, parent, pos, "cast", s"""{"casts":{"$col":"$to"}}""", Some(""))

  private def fillIn(id: String, strategy: String, cols: String, parent: String, extra: String = "") =
    NodeStepInput(id, Some(parent), 1, "fillnull", s"""{"columns":[$cols],"strategy":"$strategy"$extra}""", Some(""))

  private def unionIn(id: String, parent: String, lane: String) =
    NodeStepInput(id, Some(parent), 1, "union", s"""{"secondaryInput":{"kind":"lane","stepId":"$lane"},"mode":"byPosition"}""", Some(""))

  private val tsSource = Vector(SchemaField("ts", "string"))
  private val epochRows: Seq[Map[String, Any]] =
    Seq(Map("ts" -> "1771286400"), Map("ts" -> "1771372800"), Map("ts" -> null))

  private def isNumber(v: Any): Boolean = v.isInstanceOf[Int] || v.isInstanceOf[Long] || v.isInstanceOf[Double] || v.isInstanceOf[Float]

  "fillnull mean/median after a cast to timestamp over epoch strings" should {
    for (strategy <- Seq("mean", "median")) {
      val steps  = Vector[PipelineStep](cast("c", 0, "ts", "timestamp"), fill("f", strategy, Vector("ts"), "c"))
      val inputs = Vector(castIn("c", 0, "ts", "timestamp"), fillIn("f", strategy, "\"ts\"", "c"))

      s"RED/run-side: the run writes a number into the null cell ($strategy)" in {
        val out = runRows(steps, epochRows, "f").map(_("ts"))
        isNumber(out.last) shouldBe true
      }

      s"RED: analyze projects timestamp AND reports a step error naming the strategy and column ($strategy)" in {
        val f = analyze(inputs, tsSource)("f")
        f.outputSchema.find(_.name == "ts").get.`type` shouldBe "timestamp"
        f.validationError.getOrElse(fail("expected a validationError on the fillnull step")) should (include(strategy) and include("ts"))
      }
    }
  }

  "a lane-kind union with a timestamp vs numeric collision" should {
    for ((parentTo, secTo) <- Seq(("timestamp", "integer"), ("timestamp", "float"), ("integer", "timestamp"), ("float", "timestamp"))) {
      val steps = Vector[PipelineStep](
        cast("p", 0, "ts", parentTo), cast("sec", 1, "ts", secTo), union("u", "p", "sec")
      )
      val inputs = Vector(castIn("p", 0, "ts", parentTo), castIn("sec", 1, "ts", secTo), unionIn("u", "p", "sec"))

      s"RED/run-side: the run mixes numbers and timestamp strings under ts (parent $parentTo, secondary $secTo)" in {
        val out = runRows(steps, Seq(Map("ts" -> "1771286400"), Map("ts" -> "2026-03-14T09:30:00Z")), "u").map(_("ts"))
        out.exists(isNumber) shouldBe true
        out.exists(_.isInstanceOf[String]) shouldBe true
      }

      s"RED: analyze reports a step error naming ts and both types (parent $parentTo, secondary $secTo)" in {
        val u = analyze(inputs, tsSource)("u")
        u.outputSchema.find(_.name == "ts").get.`type` shouldBe parentTo
        u.validationError.getOrElse(fail("expected a validationError on the union step")) should
          (include("ts") and include(parentTo) and include(secTo))
      }
    }
  }

  private def errorOf(inputs: Vector[NodeStepInput], id: String, source: Vector[SchemaField] = tsSource): Option[String] =
    analyze(inputs, source)(id).validationError

  "GUARD: fillnull strategies and columns that are not flagged" should {
    val castTs = castIn("c", 0, "ts", "timestamp")

    for (strategy <- Seq("forwardFill", "mode")) {
      s"report no error for $strategy on a timestamp column" in {
        errorOf(Vector(castTs, fillIn("f", strategy, "\"ts\"", "c")), "f") shouldBe None
      }
    }

    "report no error for constant on a timestamp column" in {
      errorOf(Vector(castTs, fillIn("f", "constant", "\"ts\"", "c", ""","value":"2026-01-01T00:00:00Z"""")), "f") shouldBe None
    }

    for (strategy <- Seq("mean", "median"); numeric <- Seq("integer", "float")) {
      s"report no error for $strategy on a $numeric column" in {
        errorOf(Vector(castIn("c", 0, "ts", numeric), fillIn("f", strategy, "\"ts\"", "c")), "f") shouldBe None
      }
    }

    "report no D1 error for a listed column absent from the input schema" in {
      errorOf(Vector(castTs, fillIn("f", "mean", "\"missing\"", "c")), "f") shouldBe None
    }

    "name only the timestamp columns when a mean lists a timestamp and a numeric column" in {
      val src = Vector(SchemaField("ts", "string"), SchemaField("n", "string"))
      val inputs = Vector(
        NodeStepInput("c", None, 0, "cast", """{"casts":{"ts":"timestamp","n":"integer"}}""", Some("")),
        fillIn("f", "mean", "\"ts\",\"n\"", "c")
      )
      val msg = errorOf(inputs, "f", src).getOrElse(fail("expected an error"))
      msg should include("'ts'")
      msg should not include "'n'"
    }
  }

  "a lane-kind union with two colliding fields" should {
    "RED: name every colliding field with both of its types in the one message" in {
      val src = Vector(SchemaField("ts", "string"), SchemaField("n", "string"))
      val inputs = Vector(
        NodeStepInput("p", None, 0, "cast", """{"casts":{"ts":"timestamp","n":"float"}}""", Some("")),
        NodeStepInput("sec", None, 1, "cast", """{"casts":{"ts":"integer","n":"timestamp"}}""", Some("")),
        unionIn("u", "p", "sec")
      )
      val msg = errorOf(inputs, "u", src).getOrElse(fail("expected a validationError on the union step"))
      msg should (include("'ts' (timestamp vs integer)") and include("'n' (float vs timestamp)"))
    }
  }

  "GUARD: union collisions and secondaries that are not flagged" should {
    def unionCase(parentTo: String, secTo: String) = {
      val inputs = Vector(castIn("p", 0, "ts", parentTo), castIn("sec", 1, "ts", secTo), unionIn("u", "p", "sec"))
      analyze(inputs, tsSource)("u")
    }

    for ((a, b) <- Seq(("string", "timestamp"), ("timestamp", "string"), ("integer", "float"), ("float", "integer"),
                       ("timestamp", "timestamp"), ("integer", "integer"), ("string", "integer"), ("integer", "string"))) {
      s"report no error and keep the parent type for $a vs $b" in {
        val u = unionCase(a, b)
        u.validationError shouldBe None
        u.outputSchema.find(_.name == "ts").get.`type` shouldBe a
      }
    }

    "report no error when the timestamp and numeric fields have different names" in {
      val inputs = Vector(castIn("p", 0, "ts", "timestamp"), castIn("sec", 1, "other", "integer"), unionIn("u", "p", "sec"))
      val src    = Vector(SchemaField("ts", "string"), SchemaField("other", "string"))
      errorOf(inputs, "u", src) shouldBe None
    }

    "KNOWN GAP (pinned): a source-kind secondary is not checked and keeps the parent type" in {
      val sourceUnion = NodeStepInput(
        "u", Some("p"), 1, "union",
        """{"secondaryInput":{"kind":"source","dataSourceId":"ds-1"},"mode":"byPosition"}""", Some("")
      )
      val u = analyze(Vector(castIn("p", 0, "ts", "timestamp"), sourceUnion), tsSource)("u")
      u.validationError shouldBe None
      u.outputSchema.find(_.name == "ts").get.`type` shouldBe "timestamp"
    }
  }

  "GUARD: the save path still accepts a fillnull mean over a timestamp column" in {
    PipelineStep.rawConfigProblem("fillnull", """{"columns":["ts"],"strategy":"mean"}""") shouldBe None
  }
}
