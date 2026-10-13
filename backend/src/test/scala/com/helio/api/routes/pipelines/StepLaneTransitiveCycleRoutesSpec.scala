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
import scala.concurrent.Await
import scala.concurrent.duration.DurationInt

/** HEL-1521: a `lane` secondary input may not close a cycle THROUGH lane links either. The engine treats a lane
 *  target as a dependency (`isReady`), so `a` lanes to `x`, `x` lanes to a descendant of `a` can never run. The
 *  write is refused on update, create and trunk reorder, and nothing is persisted. Seeds go through SQL. */
class StepLaneTransitiveCycleRoutesSpec extends AnyWordSpec with Matchers with StepWriteRoutesFixture {

  private val viaLaneMessage = "it depends on this step through a lane link"

  private def runOutcome(pid: PipelineId): Either[String, Int] = {
    val engine        = new InProcessPipelineEngine(new LocalFileSystem(Paths.get("/")))
    val (steps, byId) = await(stepRepo.listWithRootIdsInternal(pid))
    val frames        = Vector((rootOf(pid), Seq[Map[String, Any]](Map("doc" -> "a"))))
    try Right(Await.result(engine.executeTree(frames, steps, stepRepo, byId, dsRepo, new AssertionSink, new TruncationSink), 10.seconds).nodeOutcomes.size)
    catch { case e: LaneReferenceError => Left(e.message) }
  }

  /** head -> a -> d; x a tail of head whose lane names d. */
  private def seeded(owner: AuthenticatedUser): (PipelineId, String, String, String, String) = {
    val pid  = emptyPipeline(owner)
    val head = seedStep(pid, "rename", rename, None, 0)
    val a    = seedStep(pid, "join", draftJoin, Some(head), 0)
    val d    = seedStep(pid, "rename", rename, Some(a), 0)
    val x    = seedStep(pid, "join", laneJoin(d), Some(head), 1)
    (pid, head, a, d, x)
  }

  "update: a lane reference to a step that depends on the writing step through a lane link" should {
    "400, leave the stored config unchanged, and match what the run would reject" in {
      val owner = newUser(); val (pid, _, a, _, x) = seeded(owner)
      val before = storedConfigOf(a)
      patchConfig(owner, a, laneJoin(x)) {
        withClue(responseAs[String]) {
          status shouldBe StatusCodes.BadRequest
          responseAs[String] should include(s"Lane reference '$x' would create a cycle ($viaLaneMessage).")
        }
      }
      storedConfigOf(a) shouldBe before
      // BACKSTOP: the same graph written around the API fails the run.
      import PostgresProfile.api._
      await(db.run(sqlu"UPDATE pipeline_steps SET config = ${laneJoin(x)}::jsonb WHERE id = $a"))
      runOutcome(pid) match {
        case Left(msg) => msg should include("Cyclic or unresolved lane reference")
        case Right(n)  => fail(s"expected the run to fail, it evaluated $n nodes")
      }
    }

    "400 through two lane hops" in {
      val owner = newUser(); val (pid, head, a, _, x) = seeded(owner)
      val y = seedStep(pid, "join", laneJoin(x), Some(head), 2)
      val before = storedConfigOf(a)
      patchConfig(owner, a, laneJoin(y)) {
        withClue(responseAs[String]) {
          status shouldBe StatusCodes.BadRequest
          responseAs[String] should include(viaLaneMessage)
        }
      }
      storedConfigOf(a) shouldBe before
    }

    "keep the descendant message for a parent-chain descendant that is also a dependent" in {
      val owner = newUser(); val (_, _, a, d, _) = seeded(owner)
      patchConfig(owner, a, laneJoin(d)) {
        withClue(responseAs[String]) {
          status shouldBe StatusCodes.BadRequest
          responseAs[String] should include("it is a descendant of this step")
        }
      }
    }

    "GUARD: re-saving a step's current valid lane target still succeeds" in {
      val owner = newUser(); val (pid, head, a, _, _) = seeded(owner)
      val side = seedStep(pid, "rename", rename, Some(head), 2)
      patchConfig(owner, a, laneJoin(side)) { withClue(responseAs[String]) { status shouldBe StatusCodes.OK } }
      patchConfig(owner, a, laneJoin(side)) { withClue(responseAs[String]) { status shouldBe StatusCodes.OK } }
    }

    "GUARD: a lane to a node that is upstream only through another step's lane link is accepted" in {
      val owner = newUser(); val (pid, head, a, _, _) = seeded(owner)
      val z = seedStep(pid, "rename", rename, Some(head), 2)
      val y = seedStep(pid, "join", laneJoin(z), Some(head), 3)
      // a -> y -> z : y does not depend on a, so a lane to y is fine.
      patchConfig(owner, a, laneJoin(y)) { withClue(responseAs[String]) { status shouldBe StatusCodes.OK } }
    }
  }

  "create: a lane reference to a step that would depend on the new step through a lane link" should {
    "400 when the insert re-parents d under the new step, nothing persisted" in {
      val owner = newUser(); val (pid, _, a, _, x) = seeded(owner)
      createJoin(owner, pid, x, "parentStepId" -> JsString(a)) {
        withClue(responseAs[String]) {
          status shouldBe StatusCodes.BadRequest
          responseAs[String] should include(s"Lane reference '$x' would create a cycle ($viaLaneMessage).")
        }
      }
      stepCountOf(owner, pid) shouldBe 4
    }

    "GUARD: attachAsTail re-parents nothing, so the same lane is accepted" in {
      val owner = newUser(); val (pid, _, a, _, x) = seeded(owner)
      createJoin(owner, pid, x, "parentStepId" -> JsString(a), "attachAsTail" -> JsBoolean(true)) {
        withClue(responseAs[String]) { status shouldBe StatusCodes.Created }
      }
    }
  }

  "duplicate" should {
    "GUARD: duplicating a valid lane step still succeeds" in {
      val owner = newUser(); val (pid, head, _, _, x) = seeded(owner)
      pid.value should not be empty; head should not be empty
      Post(s"/pipeline-steps/$x/duplicate") ~> routesFor(owner) ~> check { withClue(responseAs[String]) { status shouldBe StatusCodes.Created } }
    }
  }

  "duplicate (with children)" should {
    "GUARD: duplicating a valid lane step that has children (re-parented seeds path) still succeeds" in {
      val owner = newUser(); val pid = emptyPipeline(owner)
      val head = seedStep(pid, "rename", rename, None, 0)
      val side = seedStep(pid, "rename", rename, Some(head), 1)
      val j    = seedStep(pid, "join", laneJoin(side), Some(head), 0)
      seedStep(pid, "rename", rename, Some(j), 0)
      seedStep(pid, "rename", rename, Some(j), 1)
      Post(s"/pipeline-steps/$j/duplicate") ~> routesFor(owner) ~> check { withClue(responseAs[String]) { status shouldBe StatusCodes.Created } }
      stepCountOf(owner, pid) shouldBe 6
    }
  }

  "PUT steps/order" should {
    /** trunk a, c, s, b; x a tail of a laning to c; s lanes to x. Legal: c is above s. */
    def trunk(owner: AuthenticatedUser): (PipelineId, String, String, String, String, String) = {
      val pid = emptyPipeline(owner)
      val a   = seedStep(pid, "rename", rename, None, 0)
      val c   = seedStep(pid, "rename", rename, Some(a), 0)
      val x   = seedStep(pid, "join", laneJoin(c), Some(a), 1)
      val s   = seedStep(pid, "join", laneJoin(x), Some(c), 0)
      val b   = seedStep(pid, "rename", rename, Some(s), 0)
      (pid, a, c, s, b, x)
    }
    def layout(pid: PipelineId): Vector[(String, Option[String], Option[String], Int)] = {
      import slick.jdbc.PostgresProfile.api._
      await(db.run(sql"SELECT id, parent_step_id, root_id, position FROM pipeline_steps WHERE pipeline_id = ${pid.value} ORDER BY id".as[(String, Option[String], Option[String], Int)])).toVector
    }
    def reorder(owner: AuthenticatedUser, pid: PipelineId, ids: String*)(assertion: => Any): Unit =
      Put(s"/pipelines/${pid.value}/steps/order", JsObject("stepIds" -> JsArray(ids.map(JsString(_)).toVector))) ~> routesFor(owner) ~> check { assertion }

    "400 naming the lane-linked dependent when the reorder makes the lane target depend on the step, and persist nothing" in {
      val owner = newUser(); val (pid, a, c, s, b, x) = trunk(owner) // both x->c and s->x lie on the new cycle; x is reported first
      val before = layout(pid)
      reorder(owner, pid, a, s, c, b) {
        withClue(responseAs[String]) {
          status shouldBe StatusCodes.BadRequest
          responseAs[String] should (include("Reorder would create a cycle") and include(x) and include("a step that depends on it through a lane link"))
        }
      }
      layout(pid) shouldBe before
    }

    "200 for a reorder that introduces no lane cycle" in {
      val owner = newUser(); val (pid, a, c, s, b, _) = trunk(owner)
      reorder(owner, pid, a, c, b, s) { withClue(responseAs[String]) { status shouldBe StatusCodes.OK } }
    }
  }
}
