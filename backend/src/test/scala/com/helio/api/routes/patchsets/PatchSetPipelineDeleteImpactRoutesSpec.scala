package com.helio.api.routes.patchsets

import com.helio.domain.model.{Output, Panel, PipelineId}
import slick.jdbc.PostgresProfile.api._
import spray.json._

/** HEL-1522 item 2: a pipeline-delete preview names the bound panels and alert rules the delete removes. */
class PatchSetPipelineDeleteImpactRoutesSpec extends PatchSetRoutesFixture {

  private val StaleRowsHint = "Pipeline output rows will be stale until re-run."
  private val CascadeHint   = "Cascades to this pipeline's steps and run history."

  private def impactOf(body: String): Vector[String] =
    previewJson(body).fields("edits").convertTo[Vector[JsObject]].last.fields("impact").convertTo[Vector[String]]

  private def deleteBody(pipelineId: PipelineId): String = edit("pipeline", pipelineId.value, "delete")

  private def setup(): (PipelineId, Output) = {
    val pipelineId = newPipeline()
    (pipelineId, newOutput(pipelineId))
  }

  "a pipeline-delete preview" should {
    "name a caller-visible bound panel and a targeting alert rule" in {
      val (pipelineId, output) = setup()
      bindPanel(output, "Revenue")
      newAlertRule(output, "Revenue drop")
      impactOf(deleteBody(pipelineId)) shouldBe Vector(
        StaleRowsHint, CascadeHint, "Removes 1 panel(s): \"Revenue\".", "Removes 1 alert rule(s): \"Revenue drop\"."
      )
    }

    "count a panel the caller cannot see without naming it" in {
      val (pipelineId, output) = setup()
      bindPanel(output, "Visible")
      val hidden = bindPanel(output, "Secret board")
      exec(sqlu"UPDATE dashboards SET owner_id = ${userBId}::uuid WHERE id = ${hidden.dashboardId.value}")
      val impact = impactOf(deleteBody(pipelineId))
      impact should contain("Removes 2 panel(s): \"Visible\"; 1 you cannot see.")
      impact.mkString should not include "Secret board"
    }

    "count an alert rule the caller does not own without naming it" in {
      val (pipelineId, output) = setup()
      val rule = newAlertRule(output, "Someone else's rule")
      exec(sqlu"UPDATE alert_rules SET owner_id = ${userBId}::uuid WHERE id = ${rule.id.value}")
      val impact = impactOf(deleteBody(pipelineId))
      impact should contain("Removes 1 alert rule(s): 1 you cannot see.")
      impact.mkString should not include "Someone else's rule"
    }

    "omit a panel an earlier edit of the same set already deletes" in {
      val (pipelineId, output) = setup()
      val gone = bindPanel(output, "Deleted first")
      bindPanel(output, "Kept")
      val body = s"""{"edits":[{"target":{"kind":"panel","id":"${gone.id.value}"},"op":"delete"},{"target":{"kind":"pipeline","id":"${pipelineId.value}"},"op":"delete"}]}"""
      val impact = impactOf(body)
      impact should contain("Removes 1 panel(s): \"Kept\".")
      impact.mkString should not include "Deleted first"
    }

    "add no naming hint when nothing is bound" in {
      val (pipelineId, _) = setup()
      impactOf(deleteBody(pipelineId)) shouldBe Vector(StaleRowsHint, CascadeHint)
    }

    "name at most five and count the rest" in {
      val (pipelineId, output) = setup()
      (1 to 7).foreach(i => bindPanel(output, s"Panel $i"))
      val line = impactOf(deleteBody(pipelineId)).find(_.startsWith("Removes 7 panel(s)")).getOrElse(fail("no panel hint"))
      line.count(_ == '"') shouldBe 10
      line should endWith("and 2 more.")
    }
  }
}
