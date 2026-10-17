package com.helio.api.routes.pipelines

import com.helio.testsupport.{DraftSaveApiFixture, DraftSaveSeed}
import org.apache.pekko.http.scaladsl.model.{HttpMethods, StatusCode, StatusCodes}
import spray.json._

/** HEL-1629 tasks 4.2 and 6.6: `POST /api/patch-sets/:id/undo` of a draft save is ONE atomic restore through the save's own
 *  transaction, against the post-save fingerprint. Owner ruling 2026-10-16 `refuse-dependent-restore-rest`: steps and
 *  Outputs with no bound panels or alert rules come back under their ORIGINAL ids; if the save's cascade removed a panel or
 *  an alert rule, the undo is refused with a 409 naming each one and nothing changes. */
class DraftSaveUndoSpec extends DraftSaveApiFixture {

  private def undo(applicationId: String, user: String = userA): (StatusCode, JsObject) =
    req(HttpMethods.POST, s"/api/patch-sets/$applicationId/undo", user) ~> routes ~> check { (status, responseAs[String].parseJson.asJsObject) }

  private def savedOk(seed: DraftSaveSeed, draft: JsObject, user: String = userA): String = {
    val (code, body) = save(seed, user, draft)
    withClue(body.compactPrint)(code shouldBe StatusCodes.OK)
    body.fields("saved").asJsObject.fields("applicationId").convertTo[String]
  }

  "undo of a save that reordered steps and deleted an unbound one" should {
    "restore the prior order and recreate the step under its original id, in one transaction" in {
      val seed = seedPipeline()
      val (fp, definition) = read(seed)
      val before = storedState(seed)
      val draft0 = draftOf(fp, definition)
      val steps = replacing(replacing(without(stepsOf(draft0), seed.t4), seed.t2)(s => set(s, "position", JsNumber(1))), seed.t3)(s => set(s, "position", JsNumber(0)))
      val appId = savedOk(seed, withConfirm(withSteps(draft0, steps), confirm(steps = Seq(seed.t4))))
      storedState(seed) should not be before
      val journals = journalCount(userA)

      val (code, body) = undo(appId)
      withClue(body.compactPrint)(code shouldBe StatusCodes.OK)
      storedState(seed) shouldBe before
      read(seed)._1 shouldBe fp
      journalCount(userA) shouldBe journals + 1 // undo writes its own journal row
    }
  }

  "undo of a save that deleted a branching step" should {
    "restore it with its children re-parented back under the original ids" in {
      val seed = seedPipeline()
      val (fp, definition) = read(seed)
      val before = storedState(seed)
      val draft0 = draftOf(fp, definition)
      val steps = replacing(replacing(without(stepsOf(draft0), seed.t1), seed.t2)(s => set(unset(s, "parentStepId"), "rootId", JsString(seed.r1))), seed.t3)(s => set(s, "parentStepId", JsString(seed.t2)))
      val appId = savedOk(seed, withConfirm(withSteps(draft0, steps), confirm(steps = Seq(seed.t1))))
      stepRows(seed).exists(_.startsWith(seed.t1)) shouldBe false
      val (code, body) = undo(appId)
      withClue(body.compactPrint)(code shouldBe StatusCodes.OK)
      storedState(seed) shouldBe before
    }
  }

  "undo of a save that created a step and an Output" should {
    "delete exactly what the save created" in {
      val seed = seedPipeline()
      val (fp, definition) = read(seed)
      val before = storedState(seed)
      val draft0 = draftOf(fp, definition)
      val draft = withOutputs(withSteps(draft0, stepsOf(draft0) :+ newStep("n1", Left(seed.t4))), outputsOf(draft0) :+
        JsObject("clientId" -> JsString("nc"), "name" -> JsString("nc"), "kind" -> JsString("table"), "nodeStepClientId" -> JsString("n1"), "config" -> JsObject.empty))
      val appId = savedOk(seed, draft)
      storedState(seed) should not be before
      val (code, body) = undo(appId)
      withClue(body.compactPrint)(code shouldBe StatusCodes.OK)
      storedState(seed) shouldBe before
    }

    "be refused with a 409 naming the panel when one was bound to the created Output after the save" in {
      val seed = seedPipeline()
      val (fp, definition) = read(seed)
      val draft0 = draftOf(fp, definition)
      val draft = withOutputs(withSteps(draft0, stepsOf(draft0) :+ newStep("n1", Left(seed.t4))), outputsOf(draft0) :+
        JsObject("clientId" -> JsString("nc"), "name" -> JsString("nc"), "kind" -> JsString("table"), "nodeStepClientId" -> JsString("n1"), "config" -> JsObject.empty))
      val appId = savedOk(seed, draft)
      val created = queryStrings(s"SELECT id FROM outputs WHERE pipeline_id='${seed.pipeline}' AND name='nc'").head
      exec(s"INSERT INTO panels (id,dashboard_id,title,created_by,created_at,last_updated,appearance,owner_id,kind,output_id) VALUES ('late-panel','${seed.d1}','late','u',now(),now(),'${DraftSaveSeed.PanelAppearance}','$userA','output','$created')")
      val stateAfterSave = storedState(seed)
      val (code, body) = undo(appId)
      code shouldBe StatusCodes.Conflict
      body.compactPrint should include("late-panel")
      storedState(seed) shouldBe stateAfterSave
    }
  }

  "undo after a later edit" should {
    "answer 409 PATCH_SET_STALE and write nothing" in {
      val seed = seedPipeline()
      val (fp, definition) = read(seed)
      val appId = savedOk(seed, draftOf(fp, definition, Map.empty).fields.get("steps").fold(draftOf(fp, definition))(_ => withSteps(draftOf(fp, definition), replacing(stepsOf(draftOf(fp, definition)), seed.t2)(s => set(s, "config", limit(55))))))
      exec(s"UPDATE pipeline_steps SET enabled=false WHERE id='${seed.t3}'")
      val state = storedState(seed)
      val (code, body) = undo(appId)
      code shouldBe StatusCodes.Conflict
      body.fields("code") shouldBe JsString("PATCH_SET_STALE")
      storedState(seed) shouldBe state
    }
  }

  "undo of a save whose cascade removed bound panels and alert rules" should {
    "answer 409 naming each panel and alert rule, restoring nothing" in {
      val seed = seedPipeline()
      val (fp, definition) = read(seed)
      val draft0 = draftOf(fp, definition)
      val draft = withOutputs(withSteps(draft0, without(stepsOf(draft0), seed.t2)), without(outputsOf(draft0), seed.oa, seed.ob))
      val appId = savedOk(seed, withConfirm(draft, confirm(
        steps = Seq(seed.t2), outputs = Seq(seed.oa, seed.ob), panels = Seq(seed.pa, seed.pb), rules = Seq(seed.ra, seed.rb)
      )))
      val state = storedState(seed)
      val (code, body) = undo(appId)
      code shouldBe StatusCodes.Conflict
      val text = body.compactPrint
      Seq(seed.pa, seed.pb, seed.ra, seed.rb).foreach(id => text should include(id))
      storedState(seed) shouldBe state
    }
  }

  "undo" should {
    "be 404 for another user, and refuse a second undo of the same application (the first moved the fingerprint)" in {
      val seed = seedPipeline()
      val (fp, definition) = read(seed)
      val draft0 = draftOf(fp, definition)
      val appId = savedOk(seed, withSteps(draft0, replacing(stepsOf(draft0), seed.t2)(s => set(s, "config", limit(55)))))
      undo(appId, userC)._1 shouldBe StatusCodes.NotFound
      undo(appId)._1 shouldBe StatusCodes.OK
      undo(appId)._1 shouldBe StatusCodes.Conflict
    }

    "let an editor undo their own save, and refuse the pipeline owner the editor's journal row" in {
      val seed = seedPipeline()
      exec(seed.grant(userB, "editor"))
      val (fp, definition) = read(seed, userB)
      val draft0 = draftOf(fp, definition)
      val appId = savedOk(seed, withSteps(draft0, replacing(stepsOf(draft0), seed.t2)(s => set(s, "config", limit(55)))), userB)
      undo(appId, userA)._1 shouldBe StatusCodes.NotFound
      undo(appId, userB)._1 shouldBe StatusCodes.OK
    }
  }
}
