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

/** HEL-1250: a lookup must never silently overwrite a left column with a brought-in column. On a
 *  collision the LEFT column keeps its name and value and the looked-up value is exposed as
 *  `right_<name>` (shared `JoinColumnNaming` rule, HEL-1236). These cases run the real
 *  `LookupStep.evaluate` and the real `PipelineAnalyzeService.analyzeNodes` -- never the helper
 *  alone -- so removing the prefixing from any surface turns them red. */
class LookupColumnCollisionSpec extends AnyWordSpec with Matchers {
  private val ec: ExecutionContext = ExecutionContext.global
  private implicit val implicitEc: ExecutionContext = ec
  private val now = Instant.now()
  private val pid = PipelineId("p")

  private type Row = Map[String, Any]

  private def cfg(si: SecondaryInput, sourceKey: String, lookupKey: String, columns: Seq[String]) =
    LookupConfig(si, sourceKey, lookupKey, columns.toVector)

  private def runLane(sourceKey: String, lookupKey: String, columns: Seq[String], left: Seq[Row], ref: Seq[Row]): Seq[Row] = {
    val step = LookupStep(PipelineStepId("l"), pid, 0, cfg(SecondaryInput.Lane("r"), sourceKey, lookupKey, columns), now, now)
    val ctx = PipelineExecutionContext(
      dataSourceRepo = new DataSourceRepository(null)(ec),
      loadSource     = _ => Future.failed(new IllegalStateException("unused")),
      resolveLane    = id => if (id == "r") Some(ref) else None
    )
    Await.result(step.evaluate(left, ctx), 5.seconds)
  }

  private def runSource(sourceKey: String, lookupKey: String, columns: Seq[String], left: Seq[Row], ref: Seq[Row]): Seq[Row] = {
    val step = LookupStep(PipelineStepId("l"), pid, 0, cfg(SecondaryInput.Source("ds-r"), sourceKey, lookupKey, columns), now, now)
    val refDs: DataSource = DatasetSource(DataSourceId("ds-r"), "r", UserId("u"), now, now)
    val repo = new DataSourceRepository(null)(ec) {
      override def findByIdInternal(id: DataSourceId): Future[Option[DataSource]] =
        Future.successful(if (id.value == "ds-r") Some(refDs) else None)
    }
    val ctx = PipelineExecutionContext(dataSourceRepo = repo, loadSource = _ => Future.successful(ref))
    Await.result(step.evaluate(left, ctx), 5.seconds)
  }

  private def colsJson(columns: Seq[String]): String = columns.map(c => "\"" + c + "\"").mkString("[", ",", "]")

  private def analyzeSource(sourceKey: String, lookupKey: String, columns: Seq[String], leftCols: Seq[String]): Vector[SchemaField] = {
    val step = NodeStepInput(
      "lookup", None, 0, "lookup",
      s"""{"secondaryInput":{"kind":"source","dataSourceId":"ds-r"},"sourceKey":"$sourceKey","lookupKey":"$lookupKey","columns":${colsJson(columns)}}""",
      rootId = Some("L")
    )
    val result = PipelineAnalyzeService.analyzeNodes(Vector(step), Map("L" -> leftCols.map(SchemaField(_, "string")).toVector))
    result("lookup").validationError shouldBe None
    result("lookup").outputSchema
  }

  /** Reference lane columns are typed `integer` so the keyed-by-ORIGINAL-name type lookup is observable. */
  private def analyzeLane(sourceKey: String, lookupKey: String, columns: Seq[String], leftCols: Seq[String], refCols: Seq[String]): Vector[SchemaField] = {
    val laneL = NodeStepInput("laneL", None, 0, "rename", """{"renames":{}}""", rootId = Some("L"))
    val laneR = NodeStepInput("laneR", None, 1, "rename", """{"renames":{}}""", rootId = Some("R"))
    val step = NodeStepInput(
      "lookup", Some("laneL"), 2, "lookup",
      s"""{"secondaryInput":{"kind":"lane","stepId":"laneR"},"sourceKey":"$sourceKey","lookupKey":"$lookupKey","columns":${colsJson(columns)}}""",
      rootId = Some("L")
    )
    val result = PipelineAnalyzeService.analyzeNodes(
      Vector(laneL, laneR, step),
      Map("L" -> leftCols.map(SchemaField(_, "string")).toVector, "R" -> refCols.map(SchemaField(_, "integer")).toVector)
    )
    result("lookup").validationError shouldBe None
    result("lookup").outputSchema
  }

  "LookupStep.evaluate on a same-named column" should {
    "keep the left value and expose the looked-up value as right_<name> (lane and source kind)" in {
      val left = Seq(Map[String, Any]("code" -> "A", "qty" -> 5))
      val ref  = Seq(Map[String, Any]("code" -> "A", "qty" -> 99))
      val expected = Seq(Map[String, Any]("code" -> "A", "qty" -> 5, "right_qty" -> 99))
      runLane("code", "code", Seq("qty"), left, ref) shouldBe expected
      runSource("code", "code", Seq("qty"), left, ref) shouldBe expected
    }

    "keep the left value on an unmatched row, with null under right_<name>" in {
      val left = Seq(Map[String, Any]("code" -> "Z", "qty" -> 5))
      val ref  = Seq(Map[String, Any]("code" -> "A", "qty" -> 99))
      runLane("code", "code", Seq("qty"), left, ref) shouldBe Seq(Map("code" -> "Z", "qty" -> 5, "right_qty" -> null))
    }

    "rename several collisions independent of the order of columns, avoiding an existing right_<name>" in {
      val left = Seq(Map[String, Any]("code" -> "A", "a" -> 1, "b" -> 2, "right_a" -> 3))
      val ref  = Seq(Map[String, Any]("code" -> "A", "a" -> 10, "b" -> 20))
      val expected = Seq(Map[String, Any]("code" -> "A", "a" -> 1, "b" -> 2, "right_a" -> 3, "right_a_2" -> 10, "right_b" -> 20))
      runLane("code", "code", Seq("a", "b"), left, ref) shouldBe expected
      runLane("code", "code", Seq("b", "a"), left, ref) shouldBe expected
    }

    "keep the key once when sourceKey == lookupKey and the key is requested (matched and unmatched)" in {
      val left = Seq(Map[String, Any]("code" -> "A"), Map[String, Any]("code" -> "Z"))
      val ref  = Seq(Map[String, Any]("code" -> "A"))
      runLane("code", "code", Seq("code"), left, ref) shouldBe left
    }

    "treat a requested lookupKey as an ordinary column when sourceKey != lookupKey" in {
      val left = Seq(Map[String, Any]("sku" -> "A", "code" -> "mine"))
      val ref  = Seq(Map[String, Any]("code" -> "A"))
      runLane("sku", "code", Seq("code"), left, ref) shouldBe Seq(Map("sku" -> "A", "code" -> "mine", "right_code" -> "A"))
    }
  }

  "PipelineAnalyzeService.analyzeNodes lookup on a same-named column" should {
    "append the requested column as right_<name>, never replacing the input field" in {
      analyzeSource("code", "code", Seq("qty"), Seq("code", "qty")).map(_.name) shouldBe Vector("code", "qty", "right_qty")
    }
  }

  private case class ParityCase(name: String, sourceKey: String, lookupKey: String, leftCols: Seq[String], columns: Seq[String])
  private val parityCases = Seq(
    ParityCase("no collision", "id", "id", Seq("id", "l1"), Seq("r1")),
    ParityCase("single collision", "id", "id", Seq("id", "cnt"), Seq("cnt")),
    ParityCase("several collisions", "id", "id", Seq("id", "a", "b", "c"), Seq("a", "b", "c", "d")),
    ParityCase("right_x on the left", "id", "id", Seq("id", "x", "right_x"), Seq("x")),
    ParityCase("right_x requested alongside x", "id", "id", Seq("id", "x"), Seq("x", "right_x")),
    ParityCase("right_x on both sides", "id", "id", Seq("id", "x", "right_x"), Seq("x", "right_x", "right_x_2")),
    ParityCase("key only", "id", "id", Seq("id"), Seq("id")),
    ParityCase("sourceKey != lookupKey, lookupKey requested", "sku", "code", Seq("sku", "code"), Seq("code"))
  )

  private def rowOf(cols: Seq[String], tag: String, key: String, keyCol: String): Row =
    cols.map(c => c -> (if (c == keyCol) key else s"$tag-$c": Any)).toMap

  "apply/infer parity (runtime LookupStep.evaluate vs analyzeNodes)" should {
    for (c <- parityCases; kind <- Seq("lane", "source")) {
      s"agree on the column set: ${c.name} / $kind-kind" in {
        val refCols = (c.lookupKey +: c.columns).distinct
        val left    = Seq(rowOf(c.leftCols, "L", "1", c.sourceKey), rowOf(c.leftCols, "L", "9", c.sourceKey))
        val ref     = Seq(rowOf(refCols, "R", "1", c.lookupKey))
        val out =
          if (kind == "lane") runLane(c.sourceKey, c.lookupKey, c.columns, left, ref)
          else runSource(c.sourceKey, c.lookupKey, c.columns, left, ref)
        val analyzed =
          if (kind == "lane") analyzeLane(c.sourceKey, c.lookupKey, c.columns, c.leftCols, refCols)
          else analyzeSource(c.sourceKey, c.lookupKey, c.columns, c.leftCols)
        out.flatMap(_.keys).toSet shouldBe analyzed.map(_.name).toSet
        // every row carries every column (matched and unmatched alike)
        out.foreach(_.keySet shouldBe analyzed.map(_.name).toSet)
      }
    }

    "lane-kind: a renamed column is typed from the ORIGINAL requested name" in {
      val out = analyzeLane("id", "id", Seq("cnt"), Seq("id", "cnt"), Seq("id", "cnt"))
      out shouldBe Vector(SchemaField("id", "string"), SchemaField("cnt", "string"), SchemaField("right_cnt", "integer"))
    }

    "DOCUMENTED DIVERGENCE: empty left input -> nothing to collide with at runtime, analyze still renames" in {
      runLane("code", "code", Seq("qty"), Seq.empty, Seq(Map("code" -> "A", "qty" -> 1))) shouldBe Seq.empty
      analyzeSource("code", "code", Seq("qty"), Seq("code", "qty")).map(_.name) shouldBe Vector("code", "qty", "right_qty")
    }
  }
}
