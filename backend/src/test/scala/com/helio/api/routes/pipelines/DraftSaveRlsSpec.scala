package com.helio.api.routes.pipelines

import com.helio.testsupport.DraftSaveApiFixture
import org.apache.pekko.http.scaladsl.model.{HttpMethods, StatusCodes}
import spray.json._

/** HEL-1629 task 6.5: the save on a role WITHOUT BYPASSRLS (`TwoUserRlsApiFixture`'s application pool is `helio_app_test`,
 *  NOSUPERUSER NOBYPASSRLS; the dev and CI role bypasses RLS, which is how an RLS defect ships): owner, editor, viewer and
 *  stranger; journal ownership; and the editor round trip over state the editor cannot see (a panel on a THIRD user's
 *  dashboard and that user's alert rule), whose fingerprint must still match because it is computed on the privileged pool. */
class DraftSaveRlsSpec extends DraftSaveApiFixture {

  "on a non-BYPASSRLS application role" should {
    "let an editor read the pipeline, save it unchanged and get 200 although a panel on a third user's dashboard and that user's alert rule are in the fingerprint" in {
      val seed = seedPipeline()
      exec(seed.grant(userB, "editor"))
      // The seed's panel pb is on C's dashboard and rule rb is C's: invisible to B under RLS.
      queryStrings(s"SELECT count(*) FROM panels WHERE id='${seed.pb}'") shouldBe Vector("1")
      val (fp, definition) = read(seed, userB)
      fp shouldBe read(seed, userA)._1
      val (code, body) = save(seed, userB, draftOf(fp, definition))
      withClue(body.compactPrint)(code shouldBe StatusCodes.OK)
      body.fields("saved").asJsObject.fields("fingerprint") shouldBe JsString(fp)
    }

    "stamp Outputs and steps an editor creates with the pipeline OWNER, and own the editor's journal row by the editor" in {
      val seed = seedPipeline()
      exec(seed.grant(userB, "editor"))
      val (fp, definition) = read(seed, userB)
      val d = draftOf(fp, definition)
      val draft = withOutputs(withSteps(d, stepsOf(d) :+ newStep("n1", Left(seed.t4))), outputsOf(d) :+
        JsObject("clientId" -> JsString("nc"), "name" -> JsString("nc"), "kind" -> JsString("table"), "nodeStepClientId" -> JsString("n1"), "config" -> JsObject.empty))
      val (code, body) = save(seed, userB, draft)
      withClue(body.compactPrint)(code shouldBe StatusCodes.OK)
      queryStrings(s"SELECT owner_id FROM outputs WHERE pipeline_id='${seed.pipeline}' AND name='nc'") shouldBe Vector(userA)
      queryStrings(s"SELECT owner_id FROM patch_set_applications WHERE id='${body.fields("saved").asJsObject.fields("applicationId").convertTo[String]}'") shouldBe Vector(userB)
      journalCount(userA) shouldBe 0
    }

    "refuse a viewer (403) and a stranger (404) and write nothing" in {
      val seed = seedPipeline()
      exec(seed.grant(userB, "viewer"))
      val (fp, definition) = read(seed)
      val before = storedState(seed)
      val draft = draftOf(fp, definition)
      save(seed, userB, draft)._1 shouldBe StatusCodes.Forbidden
      save(seed, userC, draft)._1 shouldBe StatusCodes.NotFound
      storedState(seed) shouldBe before
    }

    "keep a viewer's and a stranger's reads of the fingerprint to what they may see" in {
      val seed = seedPipeline()
      exec(seed.grant(userB, "viewer"))
      get(s"/api/pipelines/${seed.pipeline}?definition=true", userB)._1 shouldBe StatusCodes.OK
      get(s"/api/pipelines/${seed.pipeline}?definition=true", userC)._1 shouldBe StatusCodes.NotFound
    }

    // C5 (root add/remove as an editor): the root writers run on the application pool and are editor-capable at the service
    // level, but RLS makes an editor's root change impossible, so there is no editor race for the pipeline-row lock to
    // protect. Pinned here so a change to those policies (which WOULD create the race) turns this red. Both behaviours are
    // pre-existing defects in their own right (a 500 and a silent no-op), recorded in g1-writers.md W29/W30.
    "make an editor's root add fail with nothing written (pipeline_roots_insert is owner-only), so no editor root-add race exists" in {
      val seed = seedPipeline()
      exec(seed.grant(userB, "editor"))
      exec(s"INSERT INTO data_sources (id,name,source_type,config,created_at,updated_at,owner_id,inferred_schema) VALUES ('${seed.id("dsB")}','dsB','dataset','{}',now(),now(),'$userB','[]')")
      val before = storedState(seed)
      val (code, _) = req(HttpMethods.POST, s"/api/pipelines/${seed.pipeline}/roots", userB, Some(JsObject("sourceId" -> JsString(seed.id("dsB"))).compactPrint)) ~> routes ~> check {
        (status, responseAs[String])
      }
      code shouldBe StatusCodes.InternalServerError
      storedState(seed) shouldBe before
    }

    "make an editor's root remove change nothing (steps and roots are hidden from the editor), so no editor root-remove race exists" in {
      val seed = seedPipeline()
      exec(seed.grant(userB, "editor"))
      exec(s"DELETE FROM outputs WHERE id='${seed.od}'")
      val before = storedState(seed)
      val (code, _) = req(HttpMethods.DELETE, s"/api/pipelines/${seed.pipeline}/roots/${seed.r2}", userB) ~> routes ~> check {
        (status, responseAs[String])
      }
      code shouldBe StatusCodes.OK
      storedState(seed) shouldBe before
      // The owner's identical request does remove the root: the no-op above is the editor's RLS view, not the request.
      req(HttpMethods.DELETE, s"/api/pipelines/${seed.pipeline}/roots/${seed.r2}", userA) ~> routes ~> check { status shouldBe StatusCodes.OK }
      storedState(seed) should not be before
    }
  }
}
