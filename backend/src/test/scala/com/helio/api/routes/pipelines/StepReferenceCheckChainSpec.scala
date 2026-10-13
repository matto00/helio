package com.helio.api.routes.pipelines

import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.util.UUID

/** HEL-1515: each stage of the shared reference-check chain (access -> ownership -> lane -> upsert target), and the order
 *  create settles them in, pinned on EACH write path SEPARATELY. The older specs exercise create, update and
 *  duplicate inside one test, so a stage that broke on one path could hide behind another path's earlier
 *  assertion; every test here drives exactly one path, which is what makes a per-stage, per-path mutation
 *  attributable. */
class StepReferenceCheckChainSpec extends AnyWordSpec with Matchers with StepWriteRoutesFixture {

  private def sourceJoin(dsId: String): String =
    s"""{"secondaryInput":{"kind":"source","dataSourceId":"$dsId"},"joinKey":"id","joinType":"inner"}"""

  private def upsertTo(dsId: String): String =
    s"""{"target":{"kind":"existingSource","dataSourceId":"$dsId"},"mode":"append"}"""

  private val noSuchStep = UUID.randomUUID().toString

  "stage 1, secondary-source ownership (CALLER identity)" should {
    "create: an editor joining the owner's source gets 404 'Data source not found'" in {
      val owner = newUser(); val editor = newUser(); val pid = emptyPipeline(owner); grant(pid, editor, "editor")
      Post(s"/pipelines/${pid.value}/steps", JsObject("type" -> JsString("join"), "config" -> sourceJoin(newSource(owner)).parseJson)) ~>
        routesFor(editor) ~> check {
        withClue(responseAs[String]) { status shouldBe StatusCodes.NotFound }
        responseAs[String] should include("Data source not found")
      }
    }

    "update: an editor switching a join to the owner's source gets 404 'Data source not found'" in {
      val owner = newUser(); val editor = newUser(); val pid = emptyPipeline(owner); grant(pid, editor, "editor")
      val join = seedStep(pid, "join", draftJoin, None, 0)
      patchConfig(editor, join, sourceJoin(newSource(owner))) {
        withClue(responseAs[String]) { status shouldBe StatusCodes.NotFound }
        responseAs[String] should include("Data source not found")
      }
    }

    "duplicate: an editor duplicating a join on the owner's source gets 404 'Data source not found'" in {
      val owner = newUser(); val editor = newUser(); val pid = emptyPipeline(owner); grant(pid, editor, "editor")
      val join = seedStep(pid, "join", sourceJoin(newSource(owner)), None, 0)
      Post(s"/pipeline-steps/$join/duplicate") ~> routesFor(editor) ~> check {
        withClue(responseAs[String]) { status shouldBe StatusCodes.NotFound }
        responseAs[String] should include("Data source not found")
      }
    }
  }

  "stage 2, lane reference" should {
    "create: a lane naming no step of the pipeline gets 422 'does not exist in this pipeline'" in {
      val owner = newUser(); val pid = emptyPipeline(owner)
      createJoin(owner, pid, noSuchStep) {
        withClue(responseAs[String]) { status shouldBe StatusCodes.UnprocessableEntity }
        responseAs[String] should include(s"Lane reference '$noSuchStep' does not exist in this pipeline.")
      }
    }

    "update: a lane naming no step of the pipeline gets 422 'does not exist in this pipeline'" in {
      val owner = newUser(); val pid = emptyPipeline(owner)
      val join = seedStep(pid, "join", draftJoin, None, 0)
      patchConfig(owner, join, laneJoin(noSuchStep)) {
        withClue(responseAs[String]) { status shouldBe StatusCodes.UnprocessableEntity }
        responseAs[String] should include(s"Lane reference '$noSuchStep' does not exist in this pipeline.")
      }
    }

    "duplicate: a stored lane naming no step of the pipeline gets 422 'does not exist in this pipeline'" in {
      val owner = newUser(); val pid = emptyPipeline(owner)
      val join = seedStep(pid, "join", laneJoin(noSuchStep), None, 0)
      Post(s"/pipeline-steps/$join/duplicate") ~> routesFor(owner) ~> check {
        withClue(responseAs[String]) { status shouldBe StatusCodes.UnprocessableEntity }
        responseAs[String] should include(s"Lane reference '$noSuchStep' does not exist in this pipeline.")
      }
    }
  }

  "stage 3, upsert target (PIPELINE OWNER identity)" should {
    "create: an upsertsource targeting another user's source gets 404" in {
      val owner = newUser(); val other = newUser(); val pid = emptyPipeline(owner)
      Post(s"/pipelines/${pid.value}/steps", JsObject("type" -> JsString("upsertsource"), "config" -> upsertTo(newSource(other)).parseJson)) ~>
        routesFor(owner) ~> check { withClue(responseAs[String]) { status shouldBe StatusCodes.NotFound } }
    }

    "update: switching an upsertsource to another user's source gets 404" in {
      val owner = newUser(); val other = newUser(); val pid = emptyPipeline(owner)
      val up = seedStep(pid, "upsertsource", upsertTo(newSource(owner)), None, 0)
      patchConfig(owner, up, upsertTo(newSource(other))) { withClue(responseAs[String]) { status shouldBe StatusCodes.NotFound } }
    }

    "duplicate: a stored upsertsource targeting another user's source gets 404" in {
      val owner = newUser(); val other = newUser(); val pid = emptyPipeline(owner)
      val up = seedStep(pid, "upsertsource", upsertTo(newSource(other)), None, 0)
      Post(s"/pipeline-steps/$up/duplicate") ~> routesFor(owner) ~> check { withClue(responseAs[String]) { status shouldBe StatusCodes.NotFound } }
    }
  }

  "the order create settles its checks in" should {
    // HEL-1523 (moved expectation): access is now the FIRST stage, so a viewer's ancestor lane gets the editor 403
    // instead of the lane 400 -- the old order let a caller without edit access learn the pipeline's structure.
    "answer a viewer's ancestor lane with the pipeline-access 403, before the lane 400" in {
      val owner = newUser(); val viewer = newUser(); val pid = emptyPipeline(owner); grant(pid, viewer, "viewer")
      val head = seedStep(pid, "rename", rename, None, 0)
      createJoin(viewer, pid, head) {
        withClue(responseAs[String]) { status shouldBe StatusCodes.Forbidden }
        responseAs[String] should not include "ancestor"
      }
    }

    // HEL-1523 (moved expectation): access precedes ownership, so a stranger gets the pipeline 404; the old
    // 'Data source not found' answer told them nothing extra but the new order discloses strictly less.
    "answer a caller with no access to the pipeline and a foreign source with 'Pipeline not found', not 'Data source not found'" in {
      val owner = newUser(); val stranger = newUser(); val pid = emptyPipeline(owner)
      Post(s"/pipelines/${pid.value}/steps", JsObject("type" -> JsString("join"), "config" -> sourceJoin(newSource(owner)).parseJson)) ~>
        routesFor(stranger) ~> check {
        withClue(responseAs[String]) { status shouldBe StatusCodes.NotFound }
        responseAs[String] should include("Pipeline not found")
      }
    }

    "answer a viewer's upsert target that is not the pipeline owner's with the editor 403, before the upsert 404" in {
      val owner = newUser(); val viewer = newUser(); val pid = emptyPipeline(owner); grant(pid, viewer, "viewer")
      Post(s"/pipelines/${pid.value}/steps", JsObject("type" -> JsString("upsertsource"), "config" -> upsertTo(newSource(viewer)).parseJson)) ~>
        routesFor(viewer) ~> check { withClue(responseAs[String]) { status shouldBe StatusCodes.Forbidden } }
    }
  }
}
