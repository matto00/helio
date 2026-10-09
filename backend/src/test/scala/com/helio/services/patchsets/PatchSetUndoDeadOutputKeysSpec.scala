package com.helio.services.patchsets

import com.helio.api.protocols.patchsets.{Edit, EditTarget}
import com.helio.domain._
import com.helio.domain.model._
import com.helio.api.protocols.pipelines.UpdateOutputRequest
import com.helio.services.pipelines.{OutputConfigWritePolicy, OutputService}
import spray.json._

/** HEL-1409: undoing a pre-V117 `pipelineStep` delete must not reintroduce the V94/HEL-877 dead
 *  Output config keys V117 (HEL-1387) repaired. The journal is written by a REAL apply over Outputs
 *  stored with dead keys (as pre-V117 storage held them), and assertions read the STORED configs. */
class PatchSetUndoDeadOutputKeysSpec extends PatchSetUndoServiceFixture {

  private def json(s: String): JsObject = s.parseJson.asJsObject

  "PatchSetUndoService.undo (pipelineStep delete, pre-V117 journal)" should {

    "write V117-normalised stored configs for the restored bound Outputs" in {
      val sourceId = seedDatasetSource(userA, "HEL-1409 source")
      val pipeline = seedPipeline(userA, sourceId, "HEL-1409 pipeline")
      val step     = seedPipelineStep(PipelineId(pipeline.id), userA, "rename", JsObject("renames" -> JsObject("old" -> JsString("new"))))
      def seed(name: String, kind: OutputKind, config: String): Output = await(outputRepo.insertInternal(
        PipelineId(pipeline.id), Some(PipelineStepId(step.id)), userA.id, name, kind, config = json(config), explicitRootId = None
      ))

      seed("metric", OutputKind.Metric, """{"metricLabel":"Revenue","metricUnit":"USD","keep":1}""")
      seed("shadowed", OutputKind.Metric, """{"label":"Live","metricLabel":"Old"}""")
      seed("table", OutputKind.Table, """{"tableDensity":"compact","columnWidths":{"a":10},"columnOrder":["a"]}""")
      seed("timeline", OutputKind.Timeline, """{"timelineOptions":{"sort":"desc","x":1}}""")

      // Precondition: the dead keys really are stored (the red test must not pass vacuously).
      val stored = await(outputRepo.listByPipelineInternal(PipelineId(pipeline.id))).filter(_.node.stepId.contains(PipelineStepId(step.id)))
      stored should have size 4

      val applicationId = applySuccessfully(Vector(Edit(EditTarget("pipelineStep", Some(step.id)), "delete", None, None, None, None, None, None)))
      await(outputRepo.listByPipelineInternal(PipelineId(pipeline.id))).filter(_.node.stepId.contains(PipelineStepId(step.id))) shouldBe empty

      val undo = await(undoService.undo(PatchSetApplicationId(applicationId), userA)) match {
        case Right(r)  => r
        case Left(err) => fail(s"expected success, got $err")
      }
      val newStepId = undo.edits.head.newId.getOrElse(fail("expected newId"))

      val restored = await(outputRepo.listByPipelineInternal(PipelineId(pipeline.id)))
        .filter(_.node.stepId.contains(PipelineStepId(newStepId)))
      restored should have size 4
      val configs = restored.map(o => o.name -> await(outputRepo.findConfigById(o.id, userA)).getOrElse(fail("config missing"))).toMap

      configs("metric")   shouldBe json("""{"label":"Revenue","unit":"USD","keep":1}""")
      configs("shadowed") shouldBe json("""{"label":"Live"}""")
      configs("table")    shouldBe json("""{"columnOrder":["a"]}""")
      configs("timeline") shouldBe json("""{"sort":"desc"}""")
    }
  }

  "OutputService.update (HEL-1409)" should {
    def outputWithDeadKeys(): (OutputService, Output) = {
      val sourceId = seedDatasetSource(userA, "HEL-1409 update source")
      val pipeline = seedPipeline(userA, sourceId, "HEL-1409 update pipeline")
      val output = await(outputRepo.insertInternal(
        PipelineId(pipeline.id), None, userA.id, "m", OutputKind.Metric,
        config = json("""{"metricLabel":"Old","keep":1}"""), explicitRootId = None
      ))
      (new OutputService(outputRepo, panelRepo, accessChecker)(system.dispatcher), output)
    }

    "normalise the MERGED config under RestorePriorStored (stored dead key + restored dead key)" in {
      val (svc, output) = outputWithDeadKeys()
      val req = UpdateOutputRequest(name = None, config = Some(json("""{"metricUnit":"USD"}""")))
      await(svc.update(output.id, req, userA, OutputConfigWritePolicy.RestorePriorStored)) match {
        case Right(_)  => ()
        case Left(err) => fail(s"expected success, got $err")
      }
      await(outputRepo.findConfigById(output.id, userA)) shouldBe Some(json("""{"label":"Old","unit":"USD","keep":1}"""))
    }

    "leave the ValidateWrite path unnormalised (HEL-1313 rejects the new dead key; nothing is written)" in {
      val (svc, output) = outputWithDeadKeys()
      val req = UpdateOutputRequest(name = None, config = Some(json("""{"metricUnit":"USD"}""")))
      await(svc.update(output.id, req, userA)).isLeft shouldBe true
      await(outputRepo.findConfigById(output.id, userA)) shouldBe Some(json("""{"metricLabel":"Old","keep":1}"""))
    }
  }
}
