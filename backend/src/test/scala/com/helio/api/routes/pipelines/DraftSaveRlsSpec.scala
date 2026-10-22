package com.helio.api.routes.pipelines

import com.helio.testsupport.DraftSaveApiFixture
import com.helio.testsupport.DraftSaveSeed
import org.apache.pekko.http.scaladsl.model.{HttpMethods, StatusCode, StatusCodes}
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

    // HEL-1652 (root add/remove): editors MAY add and remove roots (the service contract, "Editor or Owner"); the writes run on the
    // privileged connection after the service-level check, so the owner-only pipeline_roots/pipeline_steps write policies never
    // refuse or silently hide an editor's write. These replace HEL-1629's C5 tests, which pinned the 500 and the false 200.
    def addRoot(seed: DraftSaveSeed, user: String, sourceId: String): (StatusCode, String) =
      req(HttpMethods.POST, s"/api/pipelines/${seed.pipeline}/roots", user, Some(JsObject("sourceId" -> JsString(sourceId)).compactPrint)) ~> routes ~> check {
        (status, responseAs[String])
      }

    def removeRoot(seed: DraftSaveSeed, user: String, rootId: String): (StatusCode, String) =
      req(HttpMethods.DELETE, s"/api/pipelines/${seed.pipeline}/roots/$rootId", user) ~> routes ~> check { (status, responseAs[String]) }

    def seedSourceB(seed: DraftSaveSeed): String = {
      exec(s"INSERT INTO data_sources (id,name,source_type,config,created_at,updated_at,owner_id,inferred_schema) VALUES ('${seed.id("dsB")}','dsB','dataset','{}',now(),now(),'$userB','[]')")
      seed.id("dsB")
    }

    def roots(seed: DraftSaveSeed): Vector[String] =
      queryStrings(s"SELECT data_source_id FROM pipeline_roots WHERE pipeline_id='${seed.pipeline}' ORDER BY position")

    "let an editor add a root with a source the editor owns, and read it back" in {
      val seed = seedPipeline()
      exec(seed.grant(userB, "editor"))
      val dsB = seedSourceB(seed)
      val (code, body) = addRoot(seed, userB, dsB)
      withClue(body)(code shouldBe StatusCodes.Created)
      roots(seed) shouldBe Vector(seed.ds1, seed.ds2, dsB)
    }

    "let an editor remove a root, with its steps and their snapshots, and compact positions" in {
      val seed = seedPipeline()
      exec(seed.grant(userB, "editor"))
      exec(s"DELETE FROM outputs WHERE id='${seed.od}'")
      exec(s"INSERT INTO node_snapshots (pipeline_id,node_step_id,row_index,data) VALUES ('${seed.pipeline}','${seed.t4}',0,'{}')")
      val (code, body) = removeRoot(seed, userB, seed.r2)
      withClue(body)(code shouldBe StatusCodes.OK)
      roots(seed) shouldBe Vector(seed.ds1)
      queryStrings(s"SELECT id FROM pipeline_steps WHERE id='${seed.t4}'") shouldBe Vector.empty
      queryStrings(s"SELECT count(*) FROM node_snapshots WHERE pipeline_id='${seed.pipeline}' AND node_step_id='${seed.t4}'") shouldBe Vector("0")
    }

    "refuse a viewer (403) and a stranger (404) on root add and remove, writing nothing" in {
      val seed = seedPipeline()
      exec(seed.grant(userB, "viewer"))
      exec(s"INSERT INTO data_sources (id,name,source_type,config,created_at,updated_at,owner_id,inferred_schema) VALUES ('${seed.id("dsC")}','dsC','dataset','{}',now(),now(),'$userC','[]')")
      val dsB = seedSourceB(seed)
      val before = storedState(seed)
      addRoot(seed, userB, dsB)._1 shouldBe StatusCodes.Forbidden
      removeRoot(seed, userB, seed.r2)._1 shouldBe StatusCodes.Forbidden
      addRoot(seed, userC, seed.id("dsC"))._1 shouldBe StatusCodes.NotFound
      removeRoot(seed, userC, seed.r2)._1 shouldBe StatusCodes.NotFound
      storedState(seed) shouldBe before
    }

    "still let the owner add and remove a root" in {
      val seed = seedPipeline()
      exec(s"INSERT INTO data_sources (id,name,source_type,config,created_at,updated_at,owner_id,inferred_schema) VALUES ('${seed.id("dsA")}','dsA','dataset','{}',now(),now(),'$userA','[]')")
      addRoot(seed, userA, seed.id("dsA"))._1 shouldBe StatusCodes.Created
      roots(seed) shouldBe Vector(seed.ds1, seed.ds2, seed.id("dsA"))
      removeRoot(seed, userA, seed.r2)._1 shouldBe StatusCodes.OK
      roots(seed) shouldBe Vector(seed.ds1, seed.id("dsA"))
    }

    // The cycle is seeded by SQL (an upsertsource step of the OWNER's pipeline writing existing source dsB), not built through the
    // API. Under the old user-context path the editor could not see that step, so the guard passed vacuously.
    "answer 400 and write nothing when an editor's root add closes a cycle through the owner's upsertsource step" in {
      val seed = seedPipeline()
      exec(seed.grant(userB, "editor"))
      val dsB = seedSourceB(seed)
      exec(s"""INSERT INTO pipeline_steps (id,pipeline_id,position,op,config,created_at,updated_at,enabled,parent_step_id,root_id) VALUES
        ('${seed.id("ups")}','${seed.pipeline}',0,'upsertsource','{"target":{"kind":"existingSource","dataSourceId":"$dsB"},"mode":"append"}',now(),now(),true,'${seed.t4}',NULL)""")
      val before = storedState(seed)
      val (code, body) = addRoot(seed, userB, dsB)
      withClue(body)(code shouldBe StatusCodes.BadRequest)
      storedState(seed) shouldBe before
    }
  }
}
