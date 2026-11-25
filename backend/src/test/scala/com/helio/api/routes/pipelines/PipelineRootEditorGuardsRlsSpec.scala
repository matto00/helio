package com.helio.api.routes.pipelines

import com.helio.testsupport.{DraftSaveApiFixture, DraftSaveSeed}
import org.apache.pekko.http.scaladsl.model.{HttpMethods, StatusCode, StatusCodes}
import spray.json._

/** HEL-1707 item 3: GUARDS (they pass on main; each is shown failable by a recorded mutation, see the change's evidence).
 *  The editor root writes run on the privileged connection, so nothing but the service's own checks stops these two. */
class PipelineRootEditorGuardsRlsSpec extends DraftSaveApiFixture {

  private def addRoot(seed: DraftSaveSeed, user: String, sourceId: String): (StatusCode, String) =
    req(HttpMethods.POST, s"/api/pipelines/${seed.pipeline}/roots", user, Some(JsObject("sourceId" -> JsString(sourceId)).compactPrint)) ~> routes ~> check {
      (status, responseAs[String])
    }

  private def removeRoot(seed: DraftSaveSeed, user: String, pipeline: String, rootId: String): (StatusCode, String) =
    req(HttpMethods.DELETE, s"/api/pipelines/$pipeline/roots/$rootId", user) ~> routes ~> check { (status, responseAs[String]) }

  "GUARD: an editor root add" should {
    "answer the data-source 404 and write nothing when the source belongs to another user" in {
      val seed = seedPipeline()
      exec(seed.grant(userB, "editor"))
      val dsC = seed.id("dsC")
      exec(s"INSERT INTO data_sources (id,name,source_type,config,created_at,updated_at,owner_id,inferred_schema) VALUES ('$dsC','dsC','dataset','{}',now(),now(),'$userC','[]')")
      val before = storedState(seed)
      val (code, body) = addRoot(seed, userB, dsC)
      withClue(body)(code shouldBe StatusCodes.NotFound)
      body should include(s"Data source not found: $dsC")
      storedState(seed) shouldBe before
      queryStrings(s"SELECT id FROM pipeline_roots WHERE data_source_id='$dsC'") shouldBe Vector.empty
    }
  }

  "GUARD: an editor root remove" should {
    "answer 404 Root not found and change nothing when the root id belongs to another pipeline" in {
      val seed  = seedPipeline()
      val other = seedPipeline()
      exec(seed.grant(userB, "editor"))
      val before      = storedState(seed)
      val otherBefore = storedState(other)
      val (code, body) = removeRoot(seed, userB, seed.pipeline, other.r2)
      withClue(body)(code shouldBe StatusCodes.NotFound)
      body should include(s"Root not found: ${other.r2}")
      storedState(seed) shouldBe before
      storedState(other) shouldBe otherBefore
    }
  }
}
