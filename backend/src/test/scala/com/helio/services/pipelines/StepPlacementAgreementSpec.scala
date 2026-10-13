package com.helio.services.pipelines

import org.apache.pekko.http.scaladsl.model.StatusCodes
import com.helio.api.protocols.pipelines.CreatePipelineStepRequest
import com.helio.api.routes.pipelines.StepWriteRoutesFixture
import com.helio.domain.model.PipelineRootId
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** HEL-1515: the lane check decides which steps a create re-parents from `StepPlacement.resolveCreateAnchor` +
 *  `reparentedIds`; the insert itself re-parents whatever `spliceInsertReportingInternal` finds in SQL and reports
 *  as `reparentedStepIds`. Those are two derivations of one fact, so this pins that they agree for every placement
 *  arm: a drift would let a lane reference through to a step the insert then moves under the new one. */
class StepPlacementAgreementSpec extends AnyWordSpec with Matchers with StepWriteRoutesFixture {

  /** `parent` names a step of the fixture below: "head" or "t". */
  private case class Placement(label: String, parent: Option[String] = None, root: Boolean = false, position: Option[Int] = None, tail: Boolean = false)

  "the steps a create reports as re-parented" should {
    "equal StepPlacement.reparentedIds for every placement arm" in {
      val owner = newUser()
      // head -> t -> u (trunk); q is a tail of t; s is a tail of head.
      def fresh() = {
        val pid  = emptyPipeline(owner)
        val head = seedStep(pid, "rename", rename, None, 0)
        val t    = seedStep(pid, "rename", rename, Some(head), 0)
        val u    = seedStep(pid, "rename", rename, Some(t), 0)
        val q    = seedStep(pid, "rename", rename, Some(t), 1)
        val s    = seedStep(pid, "rename", rename, Some(head), 1)
        (pid, head, t, u, q, s)
      }
      val arms = Seq(
        Placement("bare append"),
        Placement("parentStepId splice onto head", parent = Some("head")),
        Placement("parentStepId splice onto t", parent = Some("t")),
        Placement("parentStepId + attachAsTail", parent = Some("t"), tail = true),
        Placement("rootId, no position", root = true),
        Placement("rootId, position 0", root = true, position = Some(0)),
        Placement("rootId, position 2", root = true, position = Some(2)),
        Placement("bare position 0", position = Some(0)),
        Placement("bare position 1", position = Some(1)),
        Placement("bare position 3", position = Some(3)),
        Placement("bare position 5 (end)", position = Some(5))
      )
      arms.foreach { arm =>
        val (pid, headId, tId, _, _, _) = fresh()
        val rootId  = rootOf(pid)
        val parent  = arm.parent.map { case "head" => headId; case _ => tId }
        val request = CreatePipelineStepRequest(
          "rename", JsObject("renames" -> JsObject()), position = arm.position, parentStepId = parent,
          attachAsTail = if (arm.tail) Some(true) else None, rootId = if (arm.root) Some(rootId) else None
        )
        val (steps, byRoot) = await(stepRepo.listWithRootIdsInternal(pid))
        val expected = StepPlacement.resolveCreateAnchor(request, steps, byRoot, Vector(PipelineRootId(rootId)), stepRepo.trunkOf)
          .map(StepPlacement.reparentedIds(_, steps, byRoot))
        val body = JsObject(
          Map("type" -> JsString("rename"), "config" -> JsObject("renames" -> JsObject())) ++
            arm.position.map("position" -> JsNumber(_)) ++ parent.map("parentStepId" -> JsString(_)) ++
            (if (arm.tail) Some("attachAsTail" -> JsBoolean(true)) else None) ++ (if (arm.root) Some("rootId" -> JsString(rootId)) else None)
        )
        Post(s"/pipelines/${pid.value}/steps", body) ~> routesFor(owner) ~> check {
          withClue(s"${arm.label}: ${responseAs[String]}") {
            status shouldBe StatusCodes.Created
            val moved = responseAs[JsObject].fields("reparentedStepIds").convertTo[Set[String]]
            expected shouldBe Right(moved)
          }
        }
      }
    }
  }
}
