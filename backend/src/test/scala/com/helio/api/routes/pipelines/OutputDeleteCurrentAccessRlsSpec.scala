package com.helio.api.routes.pipelines

import com.helio.testsupport.{DraftSaveApiFixture, DraftSaveSeed}
import org.apache.pekko.http.scaladsl.model.{HttpMethods, StatusCode, StatusCodes}
import spray.json._

/** HEL-1707 R2: `DELETE /api/outputs/:id` and the patch-set undo of an Output create require the caller to have created the
 *  Output AND to be the pipeline owner or a current editor. A creator later downgraded to viewer (or revoked) gets the 404 a
 *  viewer or stranger gets, and nothing is deleted. Full route tree over the NOBYPASSRLS app pool. */
class OutputDeleteCurrentAccessRlsSpec extends DraftSaveApiFixture {

  private def seedOutputOfB(seed: DraftSaveSeed): String = {
    val id = seed.id("ox")
    exec(s"""INSERT INTO outputs (id,pipeline_id,node_step_id,owner_id,name,kind,config,schema,position,created_at,updated_at,root_id) VALUES
      ('$id','${seed.pipeline}','${seed.t2}','$userB','ox','table','{}','[]',9,now(),now(),NULL)""")
    id
  }

  private def deleteOutput(id: String, user: String): StatusCode =
    req(HttpMethods.DELETE, s"/api/outputs/$id", user) ~> routes ~> check { status }

  private def outputExists(id: String): Boolean = queryStrings(s"SELECT id FROM outputs WHERE id='$id'").nonEmpty

  "DELETE /api/outputs/:id" should {
    "refuse (404, nothing deleted) a creator who was downgraded to viewer" in {
      val seed = seedPipeline()
      exec(seed.grant(userB, "editor"))
      val ox = seedOutputOfB(seed)
      exec(s"UPDATE resource_permissions SET role='viewer' WHERE resource_id='${seed.pipeline}' AND grantee_id::text='$userB'")
      deleteOutput(ox, userB) shouldBe StatusCodes.NotFound
      outputExists(ox) shouldBe true
    }

    // GUARDS (green on main): R2 must not take delete rights from anyone who has them today.
    // GUARD, already 404 on main: the service's RLS-scoped `outputRepo.findById` cannot see the Output once the grant is gone, so the
    // answer is produced before the HEL-1707 in-transaction re-check runs (which is only a second detector here). Only the
    // downgrade-to-viewer case above is the visible R2 change. Failable only by an unscoped read AND neutralised R2 (see evidence).
    "GUARD: refuse (404, nothing deleted) a creator whose grant was fully revoked" in {
      val seed = seedPipeline()
      exec(seed.grant(userB, "editor"))
      val ox = seedOutputOfB(seed)
      exec(s"DELETE FROM resource_permissions WHERE resource_id='${seed.pipeline}' AND grantee_id::text='$userB'")
      deleteOutput(ox, userB) shouldBe StatusCodes.NotFound
      outputExists(ox) shouldBe true
    }

    "GUARD: let a current editor delete the Output they created" in {
      val seed = seedPipeline()
      exec(seed.grant(userB, "editor"))
      val ox = seedOutputOfB(seed)
      deleteOutput(ox, userB) shouldBe StatusCodes.OK
      outputExists(ox) shouldBe false
    }
    "GUARD: let the pipeline owner delete their own Output" in {
      val seed = seedPipeline()
      deleteOutput(seed.oa, userA) shouldBe StatusCodes.OK
      outputExists(seed.oa) shouldBe false
    }
    "GUARD: still refuse a non-creator editor (404)" in {
      val seed = seedPipeline()
      exec(seed.grant(userB, "editor"))
      deleteOutput(seed.oa, userB) shouldBe StatusCodes.NotFound
      outputExists(seed.oa) shouldBe true
    }
  }

  "patch-set undo of an Output create" should {
    "not delete the Output when the creator was downgraded to viewer after applying" in {
      val seed = seedPipeline()
      exec(seed.grant(userB, "editor"))
      val body = s"""{"edits":[{"target":{"kind":"output","parentId":"${seed.pipeline}"},"op":"create","patch":{"name":"Created by B","kind":"table","nodeStepId":"${seed.t2}"}}]}"""
      val (applyCode, applied) = req(HttpMethods.POST, "/api/patch-sets/apply", userB, Some(body)) ~> routes ~> check {
        (status, responseAs[String].parseJson.asJsObject)
      }
      withClue(applied.compactPrint)(applyCode shouldBe StatusCodes.OK)
      val outputId = applied.fields("edits").convertTo[Vector[JsObject]].head.fields("newId").convertTo[String]
      val appId    = applied.fields("applicationId").convertTo[String]
      outputExists(outputId) shouldBe true

      exec(s"UPDATE resource_permissions SET role='viewer' WHERE resource_id='${seed.pipeline}' AND grantee_id::text='$userB'")
      val (undoCode, undone) = req(HttpMethods.POST, s"/api/patch-sets/$appId/undo", userB) ~> routes ~> check {
        (status, responseAs[String].parseJson.asJsObject)
      }
      withClue(undone.compactPrint) {
        undoCode shouldBe StatusCodes.OK
        undone.fields("edits").convertTo[Vector[JsObject]].map(_.fields("status")) shouldBe Vector(JsString("failed"))
        outputExists(outputId) shouldBe true
      }
    }
  }
}
