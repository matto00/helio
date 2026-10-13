package com.helio.api.routes.pipelines

import org.apache.pekko.http.scaladsl.model.StatusCodes
import com.helio.domain.model.{AuthenticatedUser, PipelineId}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** HEL-1523: a trunk reorder may not store a `lane` reference naming the referencing step's own ancestor or
 *  descendant (the write surface create/update already refuse), and a refused reorder persists nothing. */
class StepReorderLaneCycleRoutesSpec extends AnyWordSpec with Matchers with StepWriteRoutesFixture {

  /** Trunk a -> b -> c with a tail t of a whose lane names `lane(c)` (legal: c is neither ancestor nor descendant of t). */
  private def seeded(owner: AuthenticatedUser): (PipelineId, String, String, String, String) = {
    val pid = emptyPipeline(owner)
    val a   = seedStep(pid, "rename", rename, None, 0)
    val b   = seedStep(pid, "rename", rename, Some(a), 0)
    val c   = seedStep(pid, "rename", rename, Some(b), 0)
    val t   = seedStep(pid, "join", laneJoin(c), Some(a), 1)
    (pid, a, b, c, t)
  }

  private def layout(pid: PipelineId): Vector[(String, Option[String], Option[String], Int)] = {
    import slick.jdbc.PostgresProfile.api._
    await(db.run(sql"SELECT id, parent_step_id, root_id, position FROM pipeline_steps WHERE pipeline_id = ${pid.value} ORDER BY id".as[(String, Option[String], Option[String], Int)])).toVector
  }

  private def reorder(owner: AuthenticatedUser, pid: PipelineId, ids: String*)(assertion: => Any): Unit =
    Put(s"/pipelines/${pid.value}/steps/order", JsObject("stepIds" -> JsArray(ids.map(JsString(_)).toVector))) ~> routesFor(owner) ~> check { assertion }

  "PUT steps/order" should {
    "400 naming the cycle when the reorder makes a lane target an ancestor, and persist nothing" in {
      val owner = newUser(); val (pid, a, b, c, t) = seeded(owner)
      val before = layout(pid)
      reorder(owner, pid, c, a, b) {
        withClue(responseAs[String]) {
          status shouldBe StatusCodes.BadRequest
          responseAs[String] should (include("Reorder would create a cycle") and include(t) and include(c) and include("ancestor"))
        }
      }
      layout(pid) shouldBe before
    }

    "200 for a reorder that introduces no lane cycle" in {
      val owner = newUser(); val (pid, a, b, c, _) = seeded(owner)
      reorder(owner, pid, a, c, b) { withClue(responseAs[String]) { status shouldBe StatusCodes.OK } }
    }

    "200 when a violation already existed and the reorder does not introduce it" in {
      val owner = newUser(); val (pid, a, b, c, _) = seeded(owner)
      // x is a tail of a that lanes to a: stored around the API, already a cycle before any reorder.
      seedStep(pid, "join", laneJoin(a), Some(a), 2)
      reorder(owner, pid, a, c, b) { withClue(responseAs[String]) { status shouldBe StatusCodes.OK } }
    }

    "keep the permutation-shape 422 for a malformed request" in {
      val owner = newUser(); val (pid, a, b, _, _) = seeded(owner)
      reorder(owner, pid, a, b) { status shouldBe StatusCodes.UnprocessableEntity }
    }
  }
}
