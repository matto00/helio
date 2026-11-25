package com.helio.api.routes.pipelines

import com.helio.testsupport.{DraftSaveApiFixture, DraftSaveSeed}
import org.apache.pekko.http.scaladsl.model.{HttpMethods, StatusCode}
import spray.json._

/** HEL-1882 task 3.3: what the patch-set paths report when the grant re-check they inherit refuses, over the NOBYPASSRLS pool.
 *  Pins "an edit-level answer, never a 5xx, nothing written" for a creator downgraded to viewer. */
class OutputWriteGrantPatchSetRlsSpec extends DraftSaveApiFixture {

  private def seedOutputOfB(seed: DraftSaveSeed): String = {
    val id = seed.id("ox")
    exec(s"""INSERT INTO outputs (id,pipeline_id,node_step_id,owner_id,name,kind,config,schema,position,created_at,updated_at,root_id) VALUES
      ('$id','${seed.pipeline}','${seed.t2}','$userB','ox','table','{}','[]',9,now(),now(),NULL)""")
    id
  }
  private def post(path: String, user: String, body: Option[String]): (StatusCode, JsObject) =
    req(HttpMethods.POST, path, user, body) ~> routes ~> check { (status, responseAs[String].parseJson.asJsObject) }
  private def downgrade(seed: DraftSaveSeed): Unit =
    exec(s"UPDATE resource_permissions SET role='viewer' WHERE resource_id='${seed.pipeline}' AND grantee_id::text='$userB'")
  private def nameOf(id: String): String = queryStrings(s"SELECT name FROM outputs WHERE id='$id'").head

  "a patch set applying an Output update for a creator downgraded to viewer" should {
    "answer 200 with the set-level failure \"Output not found\" (not a 5xx) and write nothing" in {
      val seed = seedPipeline()
      exec(seed.grant(userB, "editor"))
      val ox = seedOutputOfB(seed)
      downgrade(seed)
      val (code, body) = post("/api/patch-sets/apply", userB, Some(s"""{"edits":[{"target":{"kind":"output","id":"$ox"},"op":"update","patch":{"name":"renamed"}}]}"""))
      withClue(s"$code $body") {
        code.intValue shouldBe 200
        body.fields("failure") shouldBe JsString("Output not found")
        body.fields("edits") shouldBe JsArray.empty
        nameOf(ox) shouldBe "ox"
      }
    }
  }

  // The step restore itself (HEL-1707's step-write re-check) refuses first here; the refusal inside `restoreBoundOutputs` (HEL-1882 D1)
  // is reachable only by a race, and `safeRestoreOne` turns any failure there into the same edit-level "failed" outcome.
  "patch-set undo of a step delete for an editor downgraded to viewer after applying" should {
    "report the edit as failed (not a 5xx) and restore nothing" in {
      val seed = seedPipeline()
      exec(seed.grant(userB, "editor"))
      val (applyCode, applied) = post("/api/patch-sets/apply", userB, Some(s"""{"edits":[{"target":{"kind":"pipelineStep","id":"${seed.t3}"},"op":"delete"}]}"""))
      withClue(s"$applyCode $applied")(applyCode.intValue shouldBe 200)
      queryStrings(s"SELECT id FROM pipeline_steps WHERE id='${seed.t3}'") shouldBe Vector.empty
      downgrade(seed)
      val (undoCode, undone) = post(s"/api/patch-sets/${applied.fields("applicationId").convertTo[String]}/undo", userB, None)
      withClue(s"$undoCode $undone") {
        undoCode.intValue shouldBe 200
        undone.fields("edits").convertTo[Vector[JsObject]].map(_.fields("status")) shouldBe Vector(JsString("failed"))
        queryStrings(s"SELECT id FROM pipeline_steps WHERE id='${seed.t3}'") shouldBe Vector.empty
        queryStrings(s"SELECT id FROM outputs WHERE id='${seed.oc}'") shouldBe Vector.empty
      }
    }
  }
}
