package com.helio.api.routes.patchsets

import com.helio.api.protocols.alerts.UpdateAlertRuleRequest
import com.helio.api.protocols.pipelines.UpdatePipelineStepRequest
import com.helio.domain.model.{AlertRuleId, PipelineStepId}
import spray.json._

/** HEL-1522 items 1-2: an `output` / `pipelineStep` DELETE edit's fingerprint covers what its cascade removes, so a
 *  change between preview and apply is refused with 409 and nothing is deleted; the matching UPDATE edits ignore
 *  those cascaded rows. */
class PatchSetStaleCascadeRoutesSpec extends PatchSetRoutesFixture {

  private def setPosition(step: PipelineStepId, position: Int): Unit =
    await(pipelineService.updateStep(step, UpdatePipelineStepRequest(None, None, Some(position)), userA)) shouldBe a[Right[_, _]]

  /** A trunk step `root` with a head child (promoted on delete) and a tail child (removed with it). */
  private def forkedStep() = {
    val pipelineId = newPipeline()
    val root = newStep(pipelineId)
    val head = newStep(pipelineId, Some(root))
    val tail = newStep(pipelineId, Some(root), asTail = true)
    (pipelineId, root, head, tail)
  }

  "an output delete" should {
    "be refused after a panel was bound to the Output" in {
      val output = newOutput(newPipeline())
      assertRefusedAfter(edit("output", output.id.value, "delete"))(bindPanel(output))
      outputExists(output.id) shouldBe true
    }

    "be refused after an alert rule targeting the Output was created" in {
      val output = newOutput(newPipeline())
      assertRefusedAfter(edit("output", output.id.value, "delete"))(newAlertRule(output))
      outputExists(output.id) shouldBe true
    }

    "be refused after an alert rule targeting the Output was edited" in {
      val output = newOutput(newPipeline())
      val rule   = newAlertRule(output)
      assertRefusedAfter(edit("output", output.id.value, "delete")) {
        await(alertRuleService.update(AlertRuleId(rule.id.value), UpdateAlertRuleRequest(None, None, None, Some(false), Some("Edited")), userA)) shouldBe a[Right[_, _]]
      }
      outputExists(output.id) shouldBe true
    }

    "be refused after an alert rule targeting the Output was deleted" in {
      val output = newOutput(newPipeline())
      val rule   = newAlertRule(output)
      assertRefusedAfter(edit("output", output.id.value, "delete"))(await(alertRuleService.delete(rule.id, userA)) shouldBe a[Right[_, _]])
      outputExists(output.id) shouldBe true
    }
  }

  "a pipelineStep delete" should {
    "be refused after a panel was bound to an Output on the step" in {
      val pipelineId = newPipeline()
      val step       = newStep(pipelineId)
      val output     = newOutput(pipelineId, Some(step))
      assertRefusedAfter(edit("pipelineStep", step.value, "delete"))(bindPanel(output))
      stepExists(step) shouldBe true
    }

    "be refused after a panel was bound to an Output on a removed tail step" in {
      val (pipelineId, root, _, tail) = forkedStep()
      val output = newOutput(pipelineId, Some(tail))
      assertRefusedAfter(edit("pipelineStep", root.value, "delete"))(bindPanel(output))
      stepExists(root) shouldBe true
      stepExists(tail) shouldBe true
    }

    "be refused after an alert rule was created on an Output of the step" in {
      val pipelineId = newPipeline()
      val step       = newStep(pipelineId)
      val output     = newOutput(pipelineId, Some(step))
      assertRefusedAfter(edit("pipelineStep", step.value, "delete"))(newAlertRule(output))
      stepExists(step) shouldBe true
    }

    // The next three change nothing the `outputs` key covers: only the removed-step set can notice them.
    "be refused after a removed tail step itself was edited" in {
      val (_, root, _, tail) = forkedStep()
      assertRefusedAfter(edit("pipelineStep", root.value, "delete")) {
        await(pipelineService.updateStep(tail, UpdatePipelineStepRequest(None, Some(JsObject("count" -> JsNumber(99))), None), userA)) shouldBe a[Right[_, _]]
      }
      stepExists(root) shouldBe true
    }

    "be refused after a new child was added under a removed tail root" in {
      val (pipelineId, root, _, tail) = forkedStep()
      assertRefusedAfter(edit("pipelineStep", root.value, "delete"))(newStep(pipelineId, Some(tail)))
      stepExists(root) shouldBe true
    }

    "be refused after a sibling reorder changed which child is promoted" in {
      val (_, root, head, _) = forkedStep()
      assertRefusedAfter(edit("pipelineStep", root.value, "delete"))(setPosition(head, 5))
      stepExists(root) shouldBe true
    }
  }

  "output and pipelineStep update fingerprints" should {
    "ignore a panel bound to the Output" in {
      val pipelineId = newPipeline()
      val step       = newStep(pipelineId)
      val output     = newOutput(pipelineId, Some(step))
      val outputBody = edit("output", output.id.value, "update")
      val stepBody   = edit("pipelineStep", step.value, "update", """{"enabled":false}""")
      val (outputBefore, stepBefore) = (previewFingerprint(outputBody), previewFingerprint(stepBody))
      bindPanel(output)
      newAlertRule(output)
      previewFingerprint(outputBody) shouldBe outputBefore
      previewFingerprint(stepBody) shouldBe stepBefore
    }
  }
}
