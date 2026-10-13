package com.helio.api.routes.pipelines

import org.apache.pekko.http.scaladsl.model.StatusCodes
import com.helio.domain.model.{AuthenticatedUser, PipelineId}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** HEL-1523: a create with a bare `position` takes its lane-check ancestors from the SAME anchor it inserts at
 *  (`current(position - 1)`), not from the trunk's last step. */
class StepLanePositionAnchorRoutesSpec extends AnyWordSpec with Matchers with StepWriteRoutesFixture {

  /** Trunk a -> b -> c, plus a tail t of a. Execution order: a, t, b, c. */
  private def trunkWithTailOfHead(owner: AuthenticatedUser): (PipelineId, String, String, String, String) = {
    val pid = emptyPipeline(owner)
    val a   = seedStep(pid, "rename", rename, None, 0)
    val b   = seedStep(pid, "rename", rename, Some(a), 0)
    val c   = seedStep(pid, "rename", rename, Some(b), 0)
    val t   = seedStep(pid, "rename", rename, Some(a), 1)
    (pid, a, b, c, t)
  }

  private def parentOf(id: String): Option[String] = {
    import slick.jdbc.PostgresProfile.api._
    await(db.run(sql"SELECT parent_step_id FROM pipeline_steps WHERE id = $id".as[Option[String]].head))
  }

  "create at a bare position" should {
    "accept a lane to a step that is an ancestor of trunk-last but not of the anchor, and place it under the anchor" in {
      val owner = newUser(); val (pid, _, b, _, t) = trunkWithTailOfHead(owner)
      createJoin(owner, pid, b, "position" -> JsNumber(2)) {
        withClue(responseAs[String]) {
          status shouldBe StatusCodes.Created
          // The placement that actually happened: anchored at t, so the new step's parent is t.
          responseAs[JsObject].fields("parentStepId").convertTo[String] shouldBe t
        }
      }
      stepCountOf(owner, pid) shouldBe 5
    }

    "reject a lane to the anchor itself or to the anchor's ancestors, persisting nothing" in {
      val owner = newUser(); val (pid, a, _, _, t) = trunkWithTailOfHead(owner)
      for (target <- Seq(t, a))
        createJoin(owner, pid, target, "position" -> JsNumber(2)) {
          withClue(responseAs[String]) {
            status shouldBe StatusCodes.BadRequest
            responseAs[String] should include(s"Lane reference '$target' would create a cycle")
          }
        }
      stepCountOf(owner, pid) shouldBe 4
    }
  }
}
