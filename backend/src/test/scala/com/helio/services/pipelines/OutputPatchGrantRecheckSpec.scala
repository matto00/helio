package com.helio.services.pipelines

import com.helio.api.protocols.pipelines.UpdateOutputRequest
import com.helio.domain.model.{AuthenticatedUser, Output, OutputId, UserId}
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.OutputRepository
import com.helio.services.ServiceError
import com.helio.testsupport.{DraftSaveApiFixture, DraftSaveSeed, GrantRecheckSupport}
import org.apache.pekko.http.scaladsl.model.{HttpMethods, StatusCode, StatusCodes}
import slick.jdbc.PostgresProfile.api._
import spray.json._

import scala.concurrent.Future

/** HEL-1882 X2: `PATCH /api/outputs/:id` requires the caller to have created the Output AND to be the pipeline owner or a
 *  current editor (the HEL-1707 R2 rule for delete). Everything runs on the NOBYPASSRLS app pool: a superuser run proves
 *  nothing here (RLS never runs on it).
 *
 *  Reds on main: a creator DOWNGRADED to viewer still edits (the race and the non-race case). A REVOKED creator is already
 *  refused by RLS inside the UPDATE (`outputs_select` hides the row), so every revoke case is a GUARD. */
class OutputPatchGrantRecheckSpec extends DraftSaveApiFixture {

  private val creatorB = AuthenticatedUser(UserId(userB))

  private def seedOutputOfB(seed: DraftSaveSeed): String = {
    val id = seed.id("ox")
    exec(s"""INSERT INTO outputs (id,pipeline_id,node_step_id,owner_id,name,kind,config,schema,position,created_at,updated_at,root_id) VALUES
      ('$id','${seed.pipeline}','${seed.t2}','$userB','ox','table','{}','[]',9,now(),now(),NULL)""")
    id
  }

  private def patch(id: String, user: String, body: String): (StatusCode, String) =
    req(HttpMethods.PATCH, s"/api/outputs/$id", user, Some(body)) ~> routes ~> check { (status, responseAs[String]) }

  private def stored(id: String): Vector[String] = queryStrings(s"SELECT name||'|'||config FROM outputs WHERE id='$id'")

  private def revoke(seed: DraftSaveSeed): Future[Any] =
    superDb.run(sqlu"DELETE FROM resource_permissions WHERE resource_type='pipeline' AND resource_id=${seed.pipeline} AND grantee_id::text=$userB")
  private def downgrade(seed: DraftSaveSeed): Future[Any] =
    superDb.run(sqlu"UPDATE resource_permissions SET role='viewer' WHERE resource_type='pipeline' AND resource_id=${seed.pipeline} AND grantee_id::text=$userB")

  private val NotFoundBody = """{"message":"Output not found"}"""

  private def editorSeed(): (DraftSaveSeed, String) = {
    val seed = seedPipeline()
    exec(seed.grant(userB, "editor"))
    (seed, seedOutputOfB(seed))
  }

  "PATCH /api/outputs/:id outside any race" should {
    "refuse (404 Output not found, nothing written) a creator downgraded to viewer: name" in {
      val (seed, ox) = editorSeed()
      val before = stored(ox)
      await(downgrade(seed))
      val (code, body) = patch(ox, userB, """{"name":"renamed"}""")
      withClue(body) { code shouldBe StatusCodes.NotFound; body.parseJson shouldBe NotFoundBody.parseJson }
      stored(ox) shouldBe before
    }
    "refuse (404, nothing written) a creator downgraded to viewer: config" in {
      val (seed, ox) = editorSeed()
      val before = stored(ox)
      await(downgrade(seed))
      val (code, body) = patch(ox, userB, """{"config":{"columnOrder":["b","a"]}}""")
      withClue(body) { code shouldBe StatusCodes.NotFound; body.parseJson shouldBe NotFoundBody.parseJson }
      stored(ox) shouldBe before
    }
    "refuse (404) a creator downgraded to viewer: empty body" in {
      val (seed, ox) = editorSeed()
      await(downgrade(seed))
      val (code, body) = patch(ox, userB, "{}")
      withClue(body) { code shouldBe StatusCodes.NotFound; body.parseJson shouldBe NotFoundBody.parseJson }
    }

    // GUARDS (green on main).
    "GUARD: refuse (404, nothing written) a creator whose grant was revoked" in {
      val (seed, ox) = editorSeed()
      val before = stored(ox)
      await(revoke(seed))
      val (code, body) = patch(ox, userB, """{"name":"renamed"}""")
      withClue(body) { code shouldBe StatusCodes.NotFound; body.parseJson shouldBe NotFoundBody.parseJson }
      stored(ox) shouldBe before
    }
    "GUARD: let a current editor edit the Output they created" in {
      val (_, ox) = editorSeed()
      val (code, body) = patch(ox, userB, """{"name":"renamed"}""")
      withClue(body)(code shouldBe StatusCodes.OK)
      stored(ox).head should startWith("renamed|")
    }
    "GUARD: let the pipeline owner edit their own Output" in {
      val seed = seedPipeline()
      val (code, body) = patch(seed.oa, userA, """{"name":"renamed"}""")
      withClue(body)(code shouldBe StatusCodes.OK)
    }
    "GUARD: still refuse a non-creator editor (404, nothing written)" in {
      val seed = seedPipeline()
      exec(seed.grant(userB, "editor"))
      val before = stored(seed.oa)
      val (code, body) = patch(seed.oa, userB, """{"name":"renamed"}""")
      withClue(body)(code shouldBe StatusCodes.NotFound)
      stored(seed.oa) shouldBe before
    }
    "GUARD: an empty body from a current-editor creator is still 200" in {
      val (_, ox) = editorSeed()
      val (code, body) = patch(ox, userB, "{}")
      withClue(body)(code shouldBe StatusCodes.OK)
    }
  }

  // The racer fires between `OutputService.update`'s reads and `updateOwned` (the seam cannot tell an in-transaction check
  // from a service-level one made just before `updateOwned`; PATCH takes no pipeline lock).
  private final class RacyOutputRepo(race: () => Future[Any]) extends OutputRepository(ctx) {
    @volatile var armed = true
    override def updateOwned(id: OutputId, user: AuthenticatedUser, name: Option[String], config: Option[JsObject]): Future[Option[Output]] =
      if (armed) { armed = false; race().flatMap(_ => super.updateOwned(id, user, name, config)) }
      else super.updateOwned(id, user, name, config)
  }

  private def serviceFor(repo: OutputRepository) =
    new OutputService(repo, new PanelRepository(ctx), GrantRecheckSupport.accessChecker(ctx))

  "OutputService.update with the grant changing between its reads and the write" should {
    "refuse (404 Output not found) and write nothing when the creator is downgraded to viewer mid-request" in {
      val (seed, ox) = editorSeed()
      val before = stored(ox)
      val svc    = serviceFor(new RacyOutputRepo(() => downgrade(seed)))
      val result = await(svc.update(OutputId(ox), UpdateOutputRequest(name = Some("renamed"), config = None), creatorB))
      result shouldBe Left(ServiceError.NotFound("Output not found"))
      stored(ox) shouldBe before
    }
    "refuse (404 Output not found) and write nothing when the creator is downgraded mid-request: empty body" in {
      val (seed, ox) = editorSeed()
      val svc    = serviceFor(new RacyOutputRepo(() => downgrade(seed)))
      val result = await(svc.update(OutputId(ox), UpdateOutputRequest(name = None, config = None), creatorB))
      result shouldBe Left(ServiceError.NotFound("Output not found"))
    }
    "GUARD: refuse (404) and write nothing when the creator's grant is revoked mid-request (RLS refuses inside the update)" in {
      val (seed, ox) = editorSeed()
      val before = stored(ox)
      val svc    = serviceFor(new RacyOutputRepo(() => revoke(seed)))
      val result = await(svc.update(OutputId(ox), UpdateOutputRequest(name = Some("renamed"), config = None), creatorB))
      result shouldBe Left(ServiceError.NotFound("Output not found"))
      stored(ox) shouldBe before
    }
    "GUARD: a current-editor creator with no race still updates" in {
      val (_, ox) = editorSeed()
      val svc    = serviceFor(new RacyOutputRepo(() => Future.successful(())))
      val result = await(svc.update(OutputId(ox), UpdateOutputRequest(name = Some("renamed"), config = None), creatorB))
      result.isRight shouldBe true
      stored(ox).head should startWith("renamed|")
    }
  }
}
