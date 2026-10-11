package com.helio.domain.engine

import com.helio.api.protocols.pipelines.PipelineStepConfigCodec
import com.helio.domain.model.{PipelineId, PipelineStep, PipelineStepId}
import com.helio.domain.steps.{AggregateConfig, AggregateStep, ComputeConfig, ComputeStep}
import com.helio.infrastructure.storage.LocalFileSystem
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.nio.file.Paths
import java.time.Instant
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext}

/** HEL-1070 end to end: a compute `if` column feeding an aggregate `sum` is a conditional count, in one
 *  pipeline, which is the roadmap-dashboard completion-percentage shape the ticket was filed for. */
class ComputeConditionalCountSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global
  private val engine = new InProcessPipelineEngine(new LocalFileSystem(Paths.get("/")))

  private def step(op: String, config: String): PipelineStep = {
    val now = Instant.now()
    PipelineStepConfigCodec.decode(op, config).get match {
      case c: ComputeConfig   => ComputeStep(PipelineStepId("c"), PipelineId("p"), 0, c, now, now)
      case c: AggregateConfig => AggregateStep(PipelineStepId("a"), PipelineId("p"), 1, c, now, now)
      case other              => fail(s"unexpected config ${other.getClass.getName}")
    }
  }

  private val rows: Seq[Map[String, Any]] = Seq(
    Map("team" -> "a", "status" -> "Done", "points" -> 5.0),
    Map("team" -> "a", "status" -> "Open", "points" -> 3.0),
    Map("team" -> "a", "status" -> "Done", "points" -> 2.0),
    Map("team" -> "b", "status" -> "Open", "points" -> 4.0),
    Map("team" -> "b", "status" -> null, "points" -> 1.0)
  )

  "a compute step with if() followed by an aggregate sum" should {
    "count the rows where status = Done, alongside the plain total, per group" in {
      val compute = step("compute", """{"column":"is_done","expression":"if($status = \"Done\", 1, 0)"}""")
      val doneAmt = step("compute", """{"column":"done_points","expression":"if($status = \"Done\", $points, 0)"}""")
      val agg = step(
        "aggregate",
        """{"groupBy":[{"name":"team","type":"string"}],"aggregations":[
          |{"alias":"done","fn":"sum","field":"is_done"},
          |{"alias":"total","fn":"count","field":"status"},
          |{"alias":"done_pts","fn":"sum","field":"done_points"}]}""".stripMargin
      )
      val out = Await.result(engine.execute(rows, Seq(compute, doneAmt, agg), null), 10.seconds)
      val a   = out.find(_("team") == "a").get
      val b   = out.find(_("team") == "b").get
      a("done") shouldBe 2.0
      a("total") shouldBe 3L
      a("done_pts") shouldBe 7.0
      b("done") shouldBe 0.0 // the Open row and the null-status row both take the else branch
      b("done_pts") shouldBe 0.0
    }

    "analyze the if column as float so the sum aggregation is accepted" in {
      val schema = Vector(SchemaField("status", "string"), SchemaField("points", "float"))
      val (out, validation) = ColumnSchemaInference.inferCompute(
        """{"column":"is_done","expression":"if($status = \"Done\", 1, 0)"}""", schema
      )
      validation shouldBe None
      out.last shouldBe SchemaField("is_done", "float")
    }
  }
}
