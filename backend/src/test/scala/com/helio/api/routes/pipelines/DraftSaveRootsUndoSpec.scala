package com.helio.api.routes.pipelines

import com.helio.testsupport.{DraftSaveApiFixture, DraftSaveSeed}
import org.apache.pekko.http.scaladsl.model.{HttpMethods, StatusCode, StatusCodes}
import spray.json._

import java.util.UUID

/** HEL-1734 task 3.3: undo of a draft save that changed roots restores them through the save's own transaction, under their
 *  original ids and positions, so the post-undo fingerprint equals the pre-save one. */
class DraftSaveRootsUndoSpec extends DraftSaveApiFixture {

  private def undo(applicationId: String): (StatusCode, JsObject) =
    req(HttpMethods.POST, s"/api/patch-sets/$applicationId/undo", userA) ~> routes ~> check { (status, responseAs[String].parseJson.asJsObject) }

  private def savedOk(seed: DraftSaveSeed, draft: JsObject): String = {
    val (code, body) = save(seed, userA, draft)
    withClue(body.compactPrint)(code shouldBe StatusCodes.OK)
    body.fields("saved").asJsObject.fields("applicationId").convertTo[String]
  }

  private def seedSource(): String = {
    val id = "src-" + UUID.randomUUID().toString.take(8)
    exec(s"INSERT INTO data_sources (id,name,source_type,config,created_at,updated_at,owner_id,inferred_schema) VALUES ('$id','$id','dataset','{}',now(),now(),'$userA','[]')")
    id
  }

  private def removeFirstRoot(seed: DraftSaveSeed, fp: String, definition: JsObject): JsObject = {
    val d0 = draftOf(fp, definition)
    val d = withOutputs(
      withSteps(JsObject(d0.fields + ("roots" -> JsArray(JsObject("id" -> JsString(seed.r2))))), stepsOf(d0).filter(_.fields("id") == JsString(seed.t4))),
      outputsOf(d0).filter(_.fields("id") == JsString(seed.od))
    )
    withConfirm(d, JsObject("confirmCascade" -> JsObject(
      "stepIds" -> JsArray(Vector(seed.t1, seed.t2, seed.t3).map(JsString(_))), "outputIds" -> JsArray(Vector(seed.oa, seed.ob, seed.oc).map(JsString(_))),
      "panelIds" -> JsArray(), "alertRuleIds" -> JsArray(), "rootIds" -> JsArray(JsString(seed.r1))
    )))
  }

  "undo of a root add" should {
    "remove the added root and the steps under it, restoring the pre-save state and fingerprint" in {
      val seed = seedPipeline()
      val ds3 = seedSource()
      val (fp, definition) = read(seed)
      val before = storedState(seed)
      val d0 = draftOf(fp, definition)
      val step = JsObject("clientId" -> JsString("ns"), "type" -> JsString("limit"), "config" -> limit(7), "position" -> JsNumber(0), "rootClientId" -> JsString("nr"))
      val draft = withSteps(JsObject(d0.fields + ("roots" -> JsArray(
        JsObject("id" -> JsString(seed.r1)), JsObject("id" -> JsString(seed.r2)), JsObject("clientId" -> JsString("nr"), "sourceId" -> JsString(ds3))
      ))), stepsOf(d0) :+ step)
      val appId = savedOk(seed, draft)
      storedState(seed) should not be before
      val (code, body) = undo(appId)
      withClue(body.compactPrint)(code shouldBe StatusCodes.OK)
      storedState(seed) shouldBe before
      read(seed)._1 shouldBe fp
    }
  }

  "undo of the removal of the root at position 0 of two" should {
    "recreate it under its original id and position, with its steps and Outputs, and equal the pre-save fingerprint" in {
      val seed = seedPipeline()
      exec(s"DELETE FROM panels WHERE id IN ('${seed.pa}','${seed.pb}')")
      exec(s"DELETE FROM alert_rules WHERE id IN ('${seed.ra}','${seed.rb}')")
      val (fp, definition) = read(seed)
      val before = storedState(seed)
      val appId = savedOk(seed, removeFirstRoot(seed, fp, definition))
      queryStrings(s"SELECT id||'|'||position FROM pipeline_roots WHERE pipeline_id='${seed.pipeline}'") shouldBe Vector(s"${seed.r2}|0")
      val (code, body) = undo(appId)
      withClue(body.compactPrint)(code shouldBe StatusCodes.OK)
      // Restored Outputs are appended (a pre-existing property of undo, HEL-1629); everything else returns exactly.
      def noOutputPositions(rows: Vector[String]) = rows.map(r => if (r.contains("|table|")) r.split('|').patch(6, Nil, 1).mkString("|") else r)
      noOutputPositions(storedState(seed)) shouldBe noOutputPositions(before)
      queryStrings(s"SELECT id||'|'||position FROM pipeline_roots WHERE pipeline_id='${seed.pipeline}' ORDER BY position") shouldBe
        Vector(s"${seed.r1}|0", s"${seed.r2}|1")
      read(seed)._1 shouldBe fp
    }

    "be refused with 409 and change nothing when the removed root's source no longer exists" in {
      val seed = seedPipeline()
      exec(s"DELETE FROM panels WHERE id IN ('${seed.pa}','${seed.pb}')")
      exec(s"DELETE FROM alert_rules WHERE id IN ('${seed.ra}','${seed.rb}')")
      val (fp, definition) = read(seed)
      val appId = savedOk(seed, removeFirstRoot(seed, fp, definition))
      exec(s"DELETE FROM data_sources WHERE id='${seed.ds1}'")
      val after = storedState(seed)
      val (code, body) = undo(appId)
      withClue(body.compactPrint)(code shouldBe StatusCodes.Conflict)
      body.fields("message").convertTo[String] should include(seed.ds1)
      storedState(seed) shouldBe after
    }
  }
}
