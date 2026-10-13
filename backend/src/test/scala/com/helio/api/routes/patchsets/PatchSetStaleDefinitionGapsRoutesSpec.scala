package com.helio.api.routes.patchsets

import com.helio.api.protocols.alerts.UpdateAlertRuleRequest
import com.helio.api.protocols.pipelines.{PutPipelineScheduleRequest, ReorderPipelineStepsRequest}
import com.helio.domain.engine.SchemaField
import com.helio.domain.model.{AlertRuleId, PipelineId}
import com.helio.domain.model.{PendingWrite, PipelineStepId}
import com.helio.domain.steps.{UpsertMode, UpsertSourceConfig, UpsertTarget}
import org.apache.pekko.http.scaladsl.model.StatusCodes
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.util.UUID

/** HEL-1522 item 4 and 5: change-then-409 coverage for fingerprinted fields that had none (alert-rule edits, schedule
 *  `enabled`/`timezone`, step reorder/reparent, Output `kind`/`nodeStepId`), the run-stability guard also rewriting an
 *  Output schema, and the documented `upsertsource` first-run exception. */
class PatchSetStaleDefinitionGapsRoutesSpec extends PatchSetRoutesFixture {

  private def renamed(id: PipelineId): Boolean = await(pipelineRepo.findByIdInternal(id)).exists(_.name == "Renamed by patch set")
  private def exists(id: PipelineId): Boolean   = await(pipelineRepo.findByIdInternal(id)).nonEmpty

  private def put(id: PipelineId, enabled: Boolean, timezone: String): Unit =
    await(scheduleService.put(id, PutPipelineScheduleRequest("interval", "1h", Some(enabled), timezone), userA)) shouldBe a[Right[_, _]]

  Vector("update", "delete").foreach { op =>
    def refused(pipelineId: PipelineId)(mutate: => Unit): Unit = {
      assertRefusedAfter(edit("pipeline", pipelineId.value, op))(mutate)
      renamed(pipelineId) shouldBe false
      exists(pipelineId) shouldBe true
    }

    s"a pipeline $op" should {
      "be refused after an alert rule on an Output was edited" in {
        val pipelineId = newPipeline()
        val rule       = newAlertRule(newOutput(pipelineId))
        refused(pipelineId) {
          await(alertRuleService.update(AlertRuleId(rule.id.value), UpdateAlertRuleRequest(None, Some(JsObject("comparator" -> JsString("lt"), "threshold" -> JsNumber(9))), None, None, None), userA)) shouldBe a[Right[_, _]]
        }
      }

      "be refused after the schedule's enabled flag changed" in {
        val pipelineId = newPipeline()
        put(pipelineId, enabled = true, "UTC")
        refused(pipelineId)(put(pipelineId, enabled = false, "UTC"))
      }

      "be refused after the schedule's timezone changed" in {
        val pipelineId = newPipeline()
        put(pipelineId, enabled = true, "UTC")
        refused(pipelineId)(put(pipelineId, enabled = true, "America/New_York"))
      }

      "be refused after the steps were reordered" in {
        val pipelineId = newPipeline()
        val (first, second) = (newStep(pipelineId), newStep(pipelineId))
        refused(pipelineId) {
          await(pipelineService.reorderSteps(pipelineId, ReorderPipelineStepsRequest(Seq(second.value, first.value)), userA)) shouldBe a[Right[_, _]]
        }
      }

      // Only `position` changes: isolates it from the relinking a reorder also does.
      "be refused after a step's position changed" in {
        val pipelineId = newPipeline()
        val step       = newStep(pipelineId)
        refused(pipelineId)(exec(sqlu"UPDATE pipeline_steps SET position = 3 WHERE id = ${step.value}"))
      }

      // Only parent_step_id changes (position stays 0): isolates `parentStepId` from `position`.
      "be refused after a step was reparented" in {
        val pipelineId = newPipeline()
        val first = newStep(pipelineId); newStep(pipelineId); val third = newStep(pipelineId)
        refused(pipelineId)(exec(sqlu"UPDATE pipeline_steps SET parent_step_id = ${first.value} WHERE id = ${third.value}"))
      }

      "be refused after an Output's kind changed" in {
        val pipelineId = newPipeline()
        val output     = newOutput(pipelineId)
        refused(pipelineId)(exec(sqlu"UPDATE outputs SET kind = 'chart' WHERE id = ${output.id.value}"))
      }

      "be refused after an Output moved to another node" in {
        val pipelineId = newPipeline()
        val step       = newStep(pipelineId)
        val output     = newOutput(pipelineId)
        refused(pipelineId)(exec(sqlu"UPDATE outputs SET node_step_id = ${step.value}, root_id = NULL WHERE id = ${output.id.value}"))
      }
    }
  }

  "a pipeline fingerprint" should {
    // HEL-1458's stability guard, extended: an Output's stored schema is rewritten by every run.
    "not change when an Output's stored schema is rewritten between two previews" in {
      val pipelineId = newPipeline()
      val output     = newOutput(pipelineId)
      val body       = edit("pipeline", pipelineId.value, "update")
      val before     = previewFingerprint(body)
      await(outputRepo.updateSchemaInternal(output.id, Vector(SchemaField("value", "integer")))) shouldBe (())
      previewFingerprint(body) shouldBe before
    }

    // Documented exception (D8): the first run rewrites the step's config to the dataset it created -- the real write path.
    "change when the first run of an upsertsource step with a new-source target rewrites the step config" in {
      val pipelineId = newPipeline()
      val stepId     = UUID.randomUUID().toString
      val config = UpsertSourceConfig(UpsertTarget.NewSource("First run " + UUID.randomUUID()), UpsertMode.Append)
      val rootId = await(db.run(sql"SELECT id FROM pipeline_roots WHERE pipeline_id = ${pipelineId.value} ORDER BY position LIMIT 1".as[String].head))
      exec(sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, created_at, updated_at, root_id)
                 VALUES ($stepId, ${pipelineId.value}, 0, 'upsertsource', ${UpsertSourceConfig.format.write(config).compactPrint}::text, now(), now(), $rootId)""")
      val body = edit("pipeline", pipelineId.value, "update")
      val sent = withFingerprint(body, previewFingerprint(body))

      val rows = Seq(Map[String, Any]("value" -> 1))
      await(dataSourceRepo.applyWriteBacks(userA, Vector(PendingWrite(stepId, config, rows)), pipelineStepRepo, maxRows = 1000)) shouldBe Right(())

      previewFingerprint(body) should not be sent.parseJson.asJsObject.fields("edits").convertTo[Vector[JsObject]].head.fields("target").asJsObject.fields("fingerprint").convertTo[String]
      Post("/patch-sets/apply", json(sent)) ~> routesFor(userA) ~> check {
        status shouldBe StatusCodes.Conflict
        responseAs[String].parseJson.asJsObject.fields("code") shouldBe JsString("PATCH_SET_STALE")
      }
      renamed(pipelineId) shouldBe false
    }
  }
}
