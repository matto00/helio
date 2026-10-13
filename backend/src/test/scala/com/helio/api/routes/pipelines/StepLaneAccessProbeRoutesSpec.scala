package com.helio.api.routes.pipelines

import org.apache.pekko.http.scaladsl.model.StatusCodes
import com.helio.domain.model.{AuthenticatedUser, PipelineId}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.util.UUID

/** HEL-1523 (security): step create establishes the caller's access to the pipeline BEFORE it reads the pipeline's
 *  steps for the `lane` check, so a caller without edit access gets the same answer whether or not the referenced
 *  step exists (no existence/structure probe on someone else's pipeline). */
class StepLaneAccessProbeRoutesSpec extends AnyWordSpec with Matchers with StepWriteRoutesFixture {

  /** Status and body of a create on `pid` by `caller` whose lane names `lane`. */
  private def outcome(caller: AuthenticatedUser, pid: PipelineId, lane: String): (Int, String) = {
    var res = (-1, "")
    createJoin(caller, pid, lane) { res = (status.intValue, responseAs[String]) }
    res
  }

  "step create with a lane reference on a pipeline the caller cannot edit" should {
    "answer identically for an existing non-ancestor step, the trunk-last step and a nonexistent id (stranger)" in {
      val owner = newUser(); val stranger = newUser(); val pid = emptyPipeline(owner)
      val head = seedStep(pid, "rename", rename, None, 0)
      val last = seedStep(pid, "rename", rename, Some(head), 0)
      val tail = seedStep(pid, "rename", rename, Some(head), 1)
      val existing = outcome(stranger, pid, tail)
      val trunkLast = outcome(stranger, pid, last)
      val missing  = outcome(stranger, pid, UUID.randomUUID().toString)
      withClue(s"existing=$existing trunkLast=$trunkLast missing=$missing") {
        existing._1 shouldBe StatusCodes.NotFound.intValue
        trunkLast shouldBe existing
        missing shouldBe existing
      }
      stepCountOf(owner, pid) shouldBe 3
    }

    "answer identically 403 for a viewer grantee, whether or not the referenced step exists" in {
      val owner = newUser(); val viewer = newUser(); val pid = emptyPipeline(owner)
      val head = seedStep(pid, "rename", rename, None, 0)
      val last = seedStep(pid, "rename", rename, Some(head), 0)
      val tail = seedStep(pid, "rename", rename, Some(head), 1)
      grant(pid, viewer, "viewer")
      val existing  = outcome(viewer, pid, tail)
      val trunkLast = outcome(viewer, pid, last)
      val missing   = outcome(viewer, pid, UUID.randomUUID().toString)
      withClue(s"existing=$existing trunkLast=$trunkLast missing=$missing") {
        existing._1 shouldBe StatusCodes.Forbidden.intValue
        trunkLast shouldBe existing
        missing shouldBe existing
      }
      stepCountOf(owner, pid) shouldBe 3
    }
  }
}
