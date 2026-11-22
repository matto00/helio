package com.helio.api.routes.pipelines

import com.helio.testsupport.ContextAnalyzeApiFixture
import spray.json._

/** HEL-1625 task 4.3b (a GUARD, written before the refactor, passing on the pre-change code): an editor or viewer
 *  grantee's `/analyze` of a pipeline whose `upsertsource` step targets a dataset the OWNER owns reports no
 *  `validationError` on that step. The upsert target is resolved as the pipeline OWNER, never the calling grantee;
 *  a refactor that wires the grantee into that resolver turns this red (mutation recorded in the change dir). */
class PipelineAnalyzeUpsertGranteeGuardSpec extends ContextAnalyzeApiFixture {

  private def upsertStepErrors(pipelineId: String, user: String): Vector[(String, Option[String])] =
    analyzeOf(pipelineId, user).fields("steps").convertTo[Vector[JsObject]]
      .filter(_.fields("type") == JsString("upsertsource"))
      .map(s => s.fields("id").convertTo[String] -> s.fields.get("validationError").map(_.convertTo[String]))

  "GET /api/pipelines/:id/analyze on a pipeline with an owner-owned upsert target" should {
    "report no validationError for the owner, an editor grantee and a viewer grantee" in {
      reset()
      val orders  = seedSource(userA, "orders-a")
      val dataset = seedSource(userA, "dataset-a", kind = "dataset")
      val (pid, Vector(root)) = seedPipeline(userA, "shared-upsert", Vector(orders))
      addStep(pid, "upsertsource", upsertTo(dataset), root = Some(root))
      grant(pid, userB, "editor")
      grant(pid, userC, "viewer")

      for (u <- Seq(userA, userB, userC)) {
        val errors = upsertStepErrors(pid, u)
        withClue(s"user $u: ") {
          errors should have size 1
          errors.head._2 shouldBe None
        }
      }
    }
  }
}
