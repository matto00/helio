package com.helio.api.routes.pipelines

import com.helio.testsupport.{DraftSaveApiFixture, DraftSaveSeed}
import org.apache.pekko.http.scaladsl.model.StatusCodes
import spray.json._

/** HEL-1542: a `400` from `POST /api/pipelines/:id/draft/save` that names a step names it by the key the client sent (the
 *  clientId of a step the save creates, the stored id of an existing one), never by an id the server minted during the save,
 *  so the page can show the step's label. Covers the two lane messages that used to carry the server-generated id. */
class DraftSaveLaneRefusalSpec extends DraftSaveApiFixture {

  private val UuidShape = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}".r

  private def laneConfig(target: String): JsObject =
    JsObject("secondaryInput" -> JsObject("kind" -> JsString("lane"), "stepId" -> JsString(target)), "mode" -> JsString("byPosition"))

  private def newUnion(clientId: String, parent: String, target: String): JsObject =
    set(set(newStep(clientId, Left(parent)), "type", JsString("union")), "config", laneConfig(target))

  /** The ids this request sent, found in nowhere else but the message: the seed prefix keeps stored ids recognisable. */
  private def serverMintedIds(message: String, seed: DraftSaveSeed): Vector[String] =
    UuidShape.findAllIn(message).toVector.filterNot(_.startsWith(seed.prefix))

  "a lane cycle introduced by a created step" should {
    "400 naming the created step by its clientId and the target by its stored id, and write nothing" in {
      val seed = seedPipeline()
      val (fingerprint, definition) = read(seed)
      val before = storedState(seed)
      val d = draftOf(fingerprint, definition)
      // draft-new (under t1) takes a lane to t2, and t2 is re-parented under it: t2 would be its descendant.
      val steps = replacing(stepsOf(d), seed.t2)(s => set(unset(s, "parentStepId"), "parentClientId", JsString("draft-new"))) :+
        newUnion("draft-new", seed.t1, seed.t2)
      val (code, body) = save(seed, userA, withSteps(d, steps))
      withClue(body.compactPrint)(code shouldBe StatusCodes.BadRequest)
      val message = body.fields("message").convertTo[String]
      message should include(s"Step 'draft-new' has a lane reference to '${seed.t2}'")
      message should include("its descendant")
      withClue(message)(serverMintedIds(message, seed) shouldBe empty)
      storedState(seed) shouldBe before
    }
  }

  "a dangling lane target with a created subject" should {
    "400 naming the created step by its clientId and the target by the id the client sent, and write nothing" in {
      val seed = seedPipeline()
      val (fingerprint, definition) = read(seed)
      val before = storedState(seed)
      val d = draftOf(fingerprint, definition)
      // draft-new takes a lane to t4, and the same draft removes t4.
      val steps = without(stepsOf(d), seed.t4) :+ newUnion("draft-new", seed.t1, seed.t4)
      val (code, body) = save(seed, userA, withConfirm(withSteps(d, steps), confirm(steps = Seq(seed.t4))))
      withClue(body.compactPrint)(code shouldBe StatusCodes.BadRequest)
      val message = body.fields("message").convertTo[String]
      message should include(s"Step 'draft-new' has a lane reference to '${seed.t4}', which is not a step of the draft")
      withClue(message)(serverMintedIds(message, seed) shouldBe empty)
      storedState(seed) shouldBe before
    }
  }

  "a lane cycle between existing steps" should {
    "400 naming both by their stored ids, and write nothing (guard: green before the change)" in {
      val seed = seedPipeline()
      // t2 becomes a union with a lane to its sibling t3 (not a cycle yet); the draft then re-parents t3 under t2.
      exec(s"UPDATE pipeline_steps SET op='union', config='${laneConfig(seed.t3).compactPrint}' WHERE id='${seed.t2}'")
      val (fingerprint, definition) = read(seed)
      val before = storedState(seed)
      val d = draftOf(fingerprint, definition)
      val steps = replacing(stepsOf(d), seed.t3)(s => set(s, "parentStepId", JsString(seed.t2)))
      val (code, body) = save(seed, userA, withSteps(d, steps))
      withClue(body.compactPrint)(code shouldBe StatusCodes.BadRequest)
      val message = body.fields("message").convertTo[String]
      message should include(s"Step '${seed.t2}' has a lane reference to '${seed.t3}'")
      storedState(seed) shouldBe before
    }
  }
}
