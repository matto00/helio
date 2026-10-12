package com.helio.api.routes.pipelines

import org.apache.pekko.http.scaladsl.model.StatusCodes
import com.helio.domain.engine.{InProcessPipelineEngine, LaneReferenceError}
import com.helio.domain.model.{AssertionSink, AuthenticatedUser, PipelineId, TruncationSink}
import com.helio.infrastructure.storage.LocalFileSystem
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.PostgresProfile
import spray.json._

import java.nio.file.Paths
import java.util.UUID
import scala.concurrent.Await
import scala.concurrent.duration.DurationInt

/** HEL-1515 (assumed product call, see the change's design.md D4): a `lane` secondary input may not name a step
 *  that already depends on the writing step (a descendant, or a step reaching it through lane links), because
 *  the run can never schedule such a graph. Update checks the existing step's dependents; create checks the steps
 *  its insertion re-parents under the new step. Seeds go through SQL so the fixtures hold regardless of what the
 *  write surface accepts. */
class StepLaneDependentsRoutesSpec extends AnyWordSpec with Matchers with StepWriteRoutesFixture {

  private val dependsMessage = "it depends on this step"

  /** What the run does with the stored graph: the engine's own outcome, `Right` when it ran. */
  private def runOutcome(pid: PipelineId): Either[String, Int] = {
    val engine        = new InProcessPipelineEngine(new LocalFileSystem(Paths.get("/")))
    val rootId        = rootOf(pid)
    val (steps, byId) = await(stepRepo.listWithRootIdsInternal(pid))
    val frames        = Vector((rootId, Seq[Map[String, Any]](Map("doc" -> "a"))))
    try Right(Await.result(engine.executeTree(frames, steps, stepRepo, byId, dsRepo, new AssertionSink, new TruncationSink), 10.seconds).nodeOutcomes.size)
    catch { case e: LaneReferenceError => Left(e.message) }
  }

  "update: a lane reference to a step that depends on the writing step" should {
    "400 when it names a descendant, and leaves the stored config unchanged" in {
      val owner = newUser(); val pid = emptyPipeline(owner)
      val head = seedStep(pid, "rename", rename, None, 0)
      val a    = seedStep(pid, "join", draftJoin, Some(head), 0)
      val b    = seedStep(pid, "rename", rename, Some(a), 0)
      val before = storedConfigOf(a)
      patchConfig(owner, a, laneJoin(b)) {
        withClue(responseAs[String]) {
          status shouldBe StatusCodes.BadRequest
          responseAs[String] should include(s"Lane reference '$b' would create a cycle (it depends on this step).")
        }
      }
      storedConfigOf(a) shouldBe before
    }

    "BACKSTOP: the same graph written around the API fails the run with the engine's named cycle error" in {
      val owner = newUser(); val pid = emptyPipeline(owner)
      val head = seedStep(pid, "rename", rename, None, 0)
      val a    = seedStep(pid, "join", draftJoin, Some(head), 0)
      val b    = seedStep(pid, "rename", rename, Some(a), 0)
      import PostgresProfile.api._
      await(db.run(sqlu"UPDATE pipeline_steps SET config = ${laneJoin(b)}::jsonb WHERE id = $a"))
      runOutcome(pid) match {
        case Left(msg) => msg should include("Cyclic or unresolved lane reference")
        case Right(n)  => fail(s"expected the run to fail, it evaluated $n nodes")
      }
    }

    "400 when it names a step that reaches the writing step only through a lane link (not a descendant)" in {
      val owner = newUser(); val pid = emptyPipeline(owner)
      val head = seedStep(pid, "rename", rename, None, 0)
      val a    = seedStep(pid, "join", draftJoin, Some(head), 0)
      val b    = seedStep(pid, "rename", rename, Some(a), 0)
      val x    = seedStep(pid, "join", laneJoin(b), Some(head), 1) // x depends on b, b depends on a
      val before = storedConfigOf(a)
      patchConfig(owner, a, laneJoin(x)) {
        withClue(responseAs[String]) {
          status shouldBe StatusCodes.BadRequest
          responseAs[String] should include(s"Lane reference '$x' would create a cycle (it depends on this step).")
        }
      }
      storedConfigOf(a) shouldBe before
    }

    "GUARD: a lane reference to an unrelated sibling branch is still accepted" in {
      val owner = newUser(); val pid = emptyPipeline(owner)
      val head = seedStep(pid, "rename", rename, None, 0)
      val a    = seedStep(pid, "join", draftJoin, Some(head), 0)
      val side = seedStep(pid, "rename", rename, Some(head), 1)
      patchConfig(owner, a, laneJoin(side)) { withClue(responseAs[String]) { status shouldBe StatusCodes.OK } }
    }
  }

  "create: a lane reference to a step the insert re-parents under the new step" should {
    /** head -> t (trunk-last) with a tail q (position 1) hanging off t. */
    def trunkWithTail(owner: AuthenticatedUser): (PipelineId, String, String, String) = {
      val pid  = emptyPipeline(owner)
      val head = seedStep(pid, "rename", rename, None, 0)
      val t    = seedStep(pid, "rename", rename, Some(head), 0)
      val q    = seedStep(pid, "rename", rename, Some(t), 1)
      (pid, head, t, q)
    }

    "400 for a plain append onto trunk-last's tail (the append re-parents the tail), nothing persisted" in {
      val owner = newUser(); val (pid, _, _, q) = trunkWithTail(owner)
      createJoin(owner, pid, q) {
        withClue(responseAs[String]) {
          status shouldBe StatusCodes.BadRequest
          responseAs[String] should include(s"Lane reference '$q' would create a cycle (it depends on this step).")
        }
      }
      stepCountOf(owner, pid) shouldBe 3
    }

    "400 for a parentStepId splice (the anchor's children move under the new step)" in {
      val owner = newUser(); val pid = emptyPipeline(owner)
      val head = seedStep(pid, "rename", rename, None, 0)
      val a    = seedStep(pid, "rename", rename, Some(head), 0)
      val b    = seedStep(pid, "rename", rename, Some(a), 0)
      createJoin(owner, pid, a, "parentStepId" -> JsString(head)) {
        withClue(responseAs[String]) { status shouldBe StatusCodes.BadRequest }
      }
      // b is not a direct child of head, but depends on a, which moves under the new step.
      createJoin(owner, pid, b, "parentStepId" -> JsString(head)) {
        withClue(responseAs[String]) {
          status shouldBe StatusCodes.BadRequest
          responseAs[String] should include(dependsMessage)
        }
      }
      stepCountOf(owner, pid) shouldBe 3
    }

    "400 for a rootId splice at position 0 (the root's parentless steps move under the new step)" in {
      val owner = newUser(); val pid = emptyPipeline(owner)
      val head = seedStep(pid, "rename", rename, None, 0)
      seedStep(pid, "rename", rename, Some(head), 0)
      createJoin(owner, pid, head, "rootId" -> JsString(rootOf(pid)), "position" -> JsNumber(0)) {
        withClue(responseAs[String]) {
          status shouldBe StatusCodes.BadRequest
          responseAs[String] should include(dependsMessage)
        }
      }
      stepCountOf(owner, pid) shouldBe 2
    }

    "400 for a bare position splice (current(position-1)'s children move under the new step)" in {
      val owner = newUser(); val (pid, head, t, q) = trunkWithTail(owner)
      // execution order: head, t, q -- position 2 anchors on t and re-parents q.
      createJoin(owner, pid, q, "position" -> JsNumber(2)) {
        withClue(responseAs[String] + s" head=$head t=$t") {
          status shouldBe StatusCodes.BadRequest
          responseAs[String] should include(dependsMessage)
        }
      }
      stepCountOf(owner, pid) shouldBe 3
    }

    "GUARD: attachAsTail re-parents nothing, so a lane to a sibling tail is accepted" in {
      val owner = newUser(); val (pid, _, t, q) = trunkWithTail(owner)
      createJoin(owner, pid, q, "parentStepId" -> JsString(t), "attachAsTail" -> JsBoolean(true)) {
        withClue(responseAs[String]) { status shouldBe StatusCodes.Created }
      }
    }

    "GUARD: a splice that re-parents only unrelated steps still accepts a lane to another branch" in {
      val owner = newUser(); val pid = emptyPipeline(owner)
      val head = seedStep(pid, "rename", rename, None, 0)
      val a    = seedStep(pid, "rename", rename, Some(head), 0)
      seedStep(pid, "rename", rename, Some(a), 0)
      val side = seedStep(pid, "rename", rename, Some(head), 1)
      // Splice under `a` re-parents a's one child; `side` is not among them nor below them.
      createJoin(owner, pid, side, "parentStepId" -> JsString(a)) {
        withClue(responseAs[String]) { status shouldBe StatusCodes.Created }
      }
    }

    "GUARD: an out-of-range position with a lane reference keeps its own 422 (no index error, no 400 from the new check)" in {
      val owner = newUser(); val (pid, _, _, q) = trunkWithTail(owner)
      createJoin(owner, pid, q, "position" -> JsNumber(99)) {
        withClue(responseAs[String]) {
          status shouldBe StatusCodes.UnprocessableEntity
          responseAs[String] should include("position must be between 0 and 3")
        }
      }
      createJoin(owner, pid, q, "position" -> JsNumber(-1)) {
        withClue(responseAs[String]) { status shouldBe StatusCodes.UnprocessableEntity }
      }
    }

    "GUARD: naming both parentStepId and rootId keeps its own 400 message" in {
      val owner = newUser(); val (pid, head, _, q) = trunkWithTail(owner)
      createJoin(owner, pid, q, "parentStepId" -> JsString(head), "rootId" -> JsString(rootOf(pid))) {
        withClue(responseAs[String]) {
          status shouldBe StatusCodes.BadRequest
          responseAs[String] should include("Cannot name both parentStepId and rootId")
        }
      }
    }

    "GUARD: an unknown parentStepId keeps its own 422" in {
      val owner = newUser(); val (pid, _, _, q) = trunkWithTail(owner)
      createJoin(owner, pid, q, "parentStepId" -> JsString(UUID.randomUUID().toString)) {
        withClue(responseAs[String]) {
          status shouldBe StatusCodes.UnprocessableEntity
          responseAs[String] should include("is not a step of this pipeline")
        }
      }
    }
  }
}
