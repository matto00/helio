package com.helio.domain.steps

import com.helio.domain.engine.PipelineAnalyzeService
import com.helio.domain.engine.PipelineAnalyzeService.NodeStepInput
import com.helio.domain.engine.SchemaField
import com.helio.domain.model.{DataSource, DataSourceId, DatasetSource, PipelineExecutionContext, PipelineId, PipelineStepId, UserId}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.time.Instant
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1236: a join must never silently drop a column's value. On a column-name collision the
 *  LEFT column keeps its name and the RIGHT column is renamed `right_<name>` (collision-proofed,
 *  see `JoinColumnNaming`); the join key column is kept once, from the left. These cases run the
 *  real `JoinStep.evaluate` and the real `PipelineAnalyzeService.analyzeNodes` -- never the helper
 *  alone -- so removing the prefixing from either surface turns them red. */
class JoinColumnCollisionSpec extends AnyWordSpec with Matchers {
  private val ec: ExecutionContext = ExecutionContext.global
  private implicit val implicitEc: ExecutionContext = ec
  private val now = Instant.now()
  private val pid = PipelineId("p")

  private type Row = Map[String, Any]

  private def runLane(joinType: String, left: Seq[Row], right: Seq[Row]): Seq[Row] = {
    val step = JoinStep(PipelineStepId("j"), pid, 0, JoinConfig(SecondaryInput.Lane("r"), "id", joinType), now, now)
    val ctx = PipelineExecutionContext(
      dataSourceRepo = new DataSourceRepository(null)(ec),
      loadSource     = _ => Future.failed(new IllegalStateException("unused")),
      resolveLane    = id => if (id == "r") Some(right) else None
    )
    Await.result(step.evaluate(left, ctx), 5.seconds)
  }

  private def runSource(joinType: String, left: Seq[Row], right: Seq[Row]): Seq[Row] = {
    val step = JoinStep(PipelineStepId("j"), pid, 0, JoinConfig(SecondaryInput.Source("ds-r"), "id", joinType), now, now)
    val rightDs: DataSource = DatasetSource(DataSourceId("ds-r"), "r", UserId("u"), now, now)
    val repo = new DataSourceRepository(null)(ec) {
      override def findByIdInternal(id: DataSourceId): Future[Option[DataSource]] =
        Future.successful(if (id.value == "ds-r") Some(rightDs) else None)
    }
    val ctx = PipelineExecutionContext(dataSourceRepo = repo, loadSource = _ => Future.successful(right))
    Await.result(step.evaluate(left, ctx), 5.seconds)
  }

  private def f(name: String): SchemaField = SchemaField(name, "string")

  private def analyzeLane(leftCols: Seq[String], rightCols: Seq[String], joinType: String = "inner"): Vector[SchemaField] = {
    val laneL = NodeStepInput("laneL", None, 0, "rename", """{"renames":{}}""", rootId = Some("L"))
    val laneR = NodeStepInput("laneR", None, 1, "rename", """{"renames":{}}""", rootId = Some("R"))
    val join = NodeStepInput(
      "join", Some("laneL"), 2, "join",
      s"""{"joinKey":"id","joinType":"$joinType","secondaryInput":{"kind":"lane","stepId":"laneR"}}""",
      rootId = Some("L")
    )
    val result = PipelineAnalyzeService.analyzeNodes(
      Vector(laneL, laneR, join),
      Map("L" -> leftCols.map(f).toVector, "R" -> rightCols.map(f).toVector)
    )
    result("join").validationError shouldBe None
    result("join").outputSchema
  }

  private def analyzeSource(
      leftCols: Seq[String],
      rightCols: Option[Seq[String]],
      joinType: String = "inner"
  ): Vector[SchemaField] = {
    val join = NodeStepInput(
      "join", None, 0, "join",
      s"""{"joinKey":"id","joinType":"$joinType","secondaryInput":{"kind":"source","dataSourceId":"ds-r"}}""",
      rootId = Some("L")
    )
    val secondary = rightCols.map(cs => Map("ds-r" -> cs.map(f).toVector)).getOrElse(Map.empty[String, Vector[SchemaField]])
    val result = PipelineAnalyzeService.analyzeNodes(Vector(join), Map("L" -> leftCols.map(f).toVector), secondary)
    result("join").validationError shouldBe None
    result("join").outputSchema
  }

  private def rowOf(cols: Seq[String], tag: String, id: String): Row =
    cols.map(c => c -> (if (c == "id") id else s"$tag-$c": Any)).toMap

  "JoinStep.evaluate (lane-kind) on a column collision" should {
    "keep the left value under the original name and surface the right value as right_<name>" in {
      val left  = Seq(Map[String, Any]("id" -> "1", "cnt" -> 10))
      val right = Seq(Map[String, Any]("id" -> "1", "cnt" -> 99))
      runLane("inner", left, right) shouldBe Seq(Map("id" -> "1", "cnt" -> 10, "right_cnt" -> 99))
    }

    "rename every colliding column, deterministically" in {
      val left  = Seq(Map[String, Any]("id" -> "1", "a" -> 1, "b" -> 2))
      val right = Seq(Map[String, Any]("id" -> "1", "a" -> 10, "b" -> 20, "c" -> 30))
      runLane("inner", left, right) shouldBe Seq(Map("id" -> "1", "a" -> 1, "b" -> 2, "right_a" -> 10, "right_b" -> 20, "c" -> 30))
    }

    "never overwrite a pre-existing right_<name> column on the left" in {
      val left  = Seq(Map[String, Any]("id" -> "1", "cnt" -> 1, "right_cnt" -> 2))
      val right = Seq(Map[String, Any]("id" -> "1", "cnt" -> 3))
      runLane("inner", left, right) shouldBe Seq(Map("id" -> "1", "cnt" -> 1, "right_cnt" -> 2, "right_cnt_2" -> 3))
    }

    "never land a rename on a real right-side column named right_<name>" in {
      val left  = Seq(Map[String, Any]("id" -> "1", "cnt" -> 1))
      val right = Seq(Map[String, Any]("id" -> "1", "cnt" -> 3, "right_cnt" -> 4))
      runLane("inner", left, right) shouldBe Seq(Map("id" -> "1", "cnt" -> 1, "right_cnt_2" -> 3, "right_cnt" -> 4))
    }

    "left join: a matched row carries both values; an unmatched row keeps the left value" in {
      val left  = Seq(Map[String, Any]("id" -> "1", "cnt" -> 10), Map[String, Any]("id" -> "2", "cnt" -> 20))
      val right = Seq(Map[String, Any]("id" -> "1", "cnt" -> 99))
      runLane("left", left, right) shouldBe Seq(
        Map("id" -> "1", "cnt" -> 10, "right_cnt" -> 99),
        Map("id" -> "2", "cnt" -> 20)
      )
    }
  }

  "JoinStep.evaluate (source-kind) on a column collision" should {
    "keep the left value and surface the right value as right_<name>" in {
      val left  = Seq(Map[String, Any]("id" -> "1", "cnt" -> 10))
      val right = Seq(Map[String, Any]("id" -> "1", "cnt" -> 99))
      runSource("inner", left, right) shouldBe Seq(Map("id" -> "1", "cnt" -> 10, "right_cnt" -> 99))
    }
  }

  "PipelineAnalyzeService.analyzeNodes join (lane-kind) on a column collision" should {
    "project the left column unchanged and the right column as right_<name>" in {
      analyzeLane(Seq("id", "cnt"), Seq("id", "cnt")).map(_.name) shouldBe Vector("id", "cnt", "right_cnt")
    }
  }

  "PipelineAnalyzeService.analyzeNodes join (source-kind) on a column collision" should {
    "project the renamed right column when the secondary source's schema is supplied" in {
      analyzeSource(Seq("id", "cnt"), Some(Seq("id", "cnt", "extra"))).map(_.name) shouldBe Vector("id", "cnt", "right_cnt", "extra")
    }

    "fall back to the left-schema passthrough (no error) when the secondary source schema is unresolvable" in {
      analyzeSource(Seq("id", "cnt"), None).map(_.name) shouldBe Vector("id", "cnt")
    }
  }

  // Runtime row columns == analyze-inferred columns, for BOTH secondary-input kinds.
  private case class ParityCase(name: String, leftCols: Seq[String], rightCols: Seq[String])
  private val parityCases = Seq(
    ParityCase("no collision", Seq("id", "l1"), Seq("id", "r1")),
    ParityCase("single collision", Seq("id", "cnt"), Seq("id", "cnt")),
    ParityCase("several collisions", Seq("id", "a", "b", "c"), Seq("id", "a", "b", "c", "d")),
    ParityCase("right_x pre-existing on the left", Seq("id", "x", "right_x"), Seq("id", "x")),
    ParityCase("right_x pre-existing on the right", Seq("id", "x"), Seq("id", "x", "right_x")),
    ParityCase("right_x on both sides plus x", Seq("id", "x", "right_x"), Seq("id", "x", "right_x", "right_x_2")),
    ParityCase("join key on both sides only", Seq("id"), Seq("id"))
  )

  "apply/infer parity (runtime JoinStep.evaluate vs analyzeNodes)" should {
    for (c <- parityCases; kind <- Seq("lane", "source"); joinType <- Seq("inner", "left")) {
      s"agree on the column set: ${c.name} / $kind-kind / $joinType join" in {
        val left  = Seq(rowOf(c.leftCols, "L", "1"), rowOf(c.leftCols, "L", "2"))
        val right = Seq(rowOf(c.rightCols, "R", "1"))
        val runtimeCols =
          (if (kind == "lane") runLane(joinType, left, right) else runSource(joinType, left, right)).flatMap(_.keys).toSet
        val analyzedCols =
          (if (kind == "lane") analyzeLane(c.leftCols, c.rightCols, joinType)
           else analyzeSource(c.leftCols, Some(c.rightCols), joinType)).map(_.name).toSet
        runtimeCols shouldBe analyzedCols
        // every value is still present: |columns| == |left| + |right| - 1 (the key, once)
        runtimeCols should have size (c.leftCols.size + c.rightCols.size - 1)
      }
    }

    "left join with no match: right-only columns are absent from the unmatched row but still listed by analyze" in {
      val leftCols  = Seq("id", "cnt")
      val rightCols = Seq("id", "cnt", "extra")
      val out = runLane("left", Seq(rowOf(leftCols, "L", "9")), Seq(rowOf(rightCols, "R", "1")))
      out shouldBe Seq(Map("id" -> "9", "cnt" -> "L-cnt"))
      analyzeLane(leftCols, rightCols, "left").map(_.name) shouldBe Vector("id", "cnt", "right_cnt", "extra")
    }

    "ragged left rows: the rename mapping is stable across rows (a column present in only some rows)" in {
      val left = Seq(Map[String, Any]("id" -> "1", "a" -> "L"), Map[String, Any]("id" -> "2"))
      val right = Seq(Map[String, Any]("id" -> "1", "a" -> "R"), Map[String, Any]("id" -> "2", "a" -> "R2"))
      runLane("inner", left, right) shouldBe Seq(
        Map("id" -> "1", "a" -> "L", "right_a" -> "R"),
        Map("id" -> "2", "right_a" -> "R2")
      )
    }

    "DOCUMENTED DIVERGENCE: a column declared in the analyze schema but absent from every left row is not renamed at runtime" in {
      // Nothing is overwritten (no left row carries 'a'), so no value is dropped; analyze still
      // renames because it works from the declared schema (design.md Decision 1).
      val left  = Seq(Map[String, Any]("id" -> "1"))
      val right = Seq(Map[String, Any]("id" -> "1", "a" -> "R"))
      runLane("inner", left, right) shouldBe Seq(Map("id" -> "1", "a" -> "R"))
      analyzeLane(Seq("id", "a"), Seq("id", "a")).map(_.name) shouldBe Vector("id", "a", "right_a")
    }
  }
}
