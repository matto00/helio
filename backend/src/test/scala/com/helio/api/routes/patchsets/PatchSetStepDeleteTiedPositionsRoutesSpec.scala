package com.helio.api.routes.patchsets

import com.helio.domain.model.{Output, PipelineStepId}
import org.apache.pekko.http.scaladsl.model.StatusCodes
import slick.jdbc.PostgresProfile.api._
import spray.json._

/** HEL-1522: with sibling positions tied (permitted since HEL-911), `deleteInternal`, the preview's removal bookkeeping
 *  and the fingerprint all agree on the same promoted child -- the lowest (position, id). */
class PatchSetStepDeleteTiedPositionsRoutesSpec extends PatchSetRoutesFixture {

  private def previewStatus(body: String) = Post("/patch-sets/preview", json(body)) ~> routesFor(userA) ~> check(status)

  private def twoEdits(first: String, second: String): String =
    JsObject("edits" -> JsArray(
      first.parseJson.asJsObject.fields("edits").convertTo[Vector[JsValue]].head,
      second.parseJson.asJsObject.fields("edits").convertTo[Vector[JsValue]].head
    )).compactPrint

  "deleting a step whose children share a position" should {
    "agree on the promoted child across delete, preview removals and fingerprint" in {
      val pipelineId = newPipeline()
      val root       = newStep(pipelineId)
      val (c1, c2)   = (newStep(pipelineId, Some(root)), newStep(pipelineId, Some(root), asTail = true))
      exec(sqlu"UPDATE pipeline_steps SET position = 0 WHERE id IN (${c1.value}, ${c2.value})")
      val promoted: PipelineStepId = Seq(c1, c2).minBy(_.value)
      val removed: PipelineStepId  = Seq(c1, c2).maxBy(_.value)
      val promotedOutput: Output   = newOutput(pipelineId, Some(promoted))
      val removedOutput: Output    = newOutput(pipelineId, Some(removed))

      // The read-only rule the fingerprint uses.
      await(pipelineStepRepo.removedByDeleteInternal(root)) shouldBe Set(root.value, removed.value)

      // The preview's removal bookkeeping: an Output on the removed child is gone for a later edit, the promoted one is not.
      val delete = edit("pipelineStep", root.value, "delete")
      previewStatus(twoEdits(delete, edit("output", promotedOutput.id.value, "update"))) shouldBe StatusCodes.OK
      previewStatus(twoEdits(delete, edit("output", removedOutput.id.value, "update"))) should not be StatusCodes.OK

      // The delete itself.
      Post("/patch-sets/apply", json(delete)) ~> routesFor(userA) ~> check { status shouldBe StatusCodes.OK }
      stepExists(root) shouldBe false
      stepExists(removed) shouldBe false
      stepExists(promoted) shouldBe true
      outputExists(promotedOutput.id) shouldBe true
      outputExists(removedOutput.id) shouldBe false
    }
  }
}
