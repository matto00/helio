package com.helio.services.pipelines

import com.helio.api.protocols.pipelines.CreateOutputRequest
import com.helio.domain.model.{AuthenticatedUser, PipelineId, UserId}
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.OutputRepository
import com.helio.services.ServiceError
import com.helio.testsupport.{DraftSaveApiFixture, DraftSaveSeed, GrantRecheckSupport, RaceLocks}
import org.apache.pekko.http.scaladsl.model.{HttpMethods, StatusCode, StatusCodes}
import slick.jdbc.PostgresProfile.api._

import scala.concurrent.Future

/** HEL-1882 D1: Output create re-checks the caller's owner-or-editor access inside its transaction, right after the
 *  pipeline-row lock. The racer commits (on a SEPARATE superuser connection) as a step of the write's own transaction,
 *  before the lock is taken, exactly as if it had landed between the service-layer check and the insert (the HEL-1707
 *  `RaceLocks` harness). A refusal answers what the route's own check answers had the racer landed first. */
class OutputCreateGrantRecheckSpec extends DraftSaveApiFixture {

  private val editorB = AuthenticatedUser(UserId(userB))

  private final class Rig(val seed: DraftSaveSeed) {
    val locks   = new RaceLocks
    val repo    = new OutputRepository(ctx, locks)
    val service = new OutputService(repo, new PanelRepository(ctx), GrantRecheckSupport.accessChecker(ctx))
  }

  private def rig(): Rig = {
    val seed = seedPipeline()
    exec(seed.grant(userB, "editor"))
    new Rig(seed)
  }

  private def revoke(seed: DraftSaveSeed): Future[Any] =
    superDb.run(sqlu"DELETE FROM resource_permissions WHERE resource_type='pipeline' AND resource_id=${seed.pipeline} AND grantee_id::text=$userB")
  private def downgrade(seed: DraftSaveSeed): Future[Any] =
    superDb.run(sqlu"UPDATE resource_permissions SET role='viewer' WHERE resource_type='pipeline' AND resource_id=${seed.pipeline} AND grantee_id::text=$userB")

  private def create(r: Rig, name: String) =
    r.service.create(PipelineId(r.seed.pipeline), CreateOutputRequest(Some(r.seed.t2), "table", name, None), editorB)

  private def outputsNamed(name: String): Vector[String] = queryStrings(s"SELECT id FROM outputs WHERE name='$name'")

  private def postCreate(seed: DraftSaveSeed, user: String, name: String): (StatusCode, String) =
    req(HttpMethods.POST, s"/api/pipelines/${seed.pipeline}/outputs", user, Some(s"""{"nodeStepId":"${seed.t2}","kind":"table","name":"$name"}""")) ~> routes ~> check {
      (status, responseAs[String])
    }

  "Output create whose grant changes between the service check and the insert" should {
    "refuse with the unknown-pipeline 404 and write nothing when the editor grant is revoked mid-request" in {
      val r = rig()
      r.locks.arm()(revoke(r.seed))
      val result = await(create(r, "d1-revoked"))
      withClue(s"the Output was created: $result")(result shouldBe Left(ServiceError.NotFound("Pipeline not found")))
      outputsNamed("d1-revoked") shouldBe Vector.empty
    }
    "refuse with 403 Forbidden and write nothing when the editor grant is downgraded to viewer mid-request" in {
      val r = rig()
      r.locks.arm()(downgrade(r.seed))
      val result = await(create(r, "d1-downgraded"))
      withClue(s"the Output was created: $result")(result shouldBe Left(ServiceError.Forbidden("Forbidden")))
      outputsNamed("d1-downgraded") shouldBe Vector.empty
    }

    // GUARDS (green on main): what the route's own check answers when the change lands FIRST, and the unchanged happy paths.
    "GUARD: the route answers 404 {message: Pipeline not found} to a revoked editor before the write" in {
      val seed = seedPipeline()
      val (code, body) = postCreate(seed, userB, "d1-stranger")
      code shouldBe StatusCodes.NotFound
      body shouldBe """{"message":"Pipeline not found"}"""
      outputsNamed("d1-stranger") shouldBe Vector.empty
    }
    "GUARD: the route answers 403 {message: Forbidden} to a viewer before the write" in {
      val seed = seedPipeline()
      exec(seed.grant(userB, "viewer"))
      val (code, body) = postCreate(seed, userB, "d1-viewer")
      code shouldBe StatusCodes.Forbidden
      body shouldBe """{"message":"Forbidden"}"""
      outputsNamed("d1-viewer") shouldBe Vector.empty
    }
    "GUARD: a current editor still creates an Output (race armed with a no-op)" in {
      val r = rig()
      r.locks.arm()(Future.successful(()))
      val result = await(create(r, "d1-editor"))
      result.isRight shouldBe true
      outputsNamed("d1-editor").size shouldBe 1
    }
    "GUARD: the pipeline owner still creates an Output" in {
      val r = rig()
      val result = await(r.service.create(PipelineId(r.seed.pipeline), CreateOutputRequest(Some(r.seed.t2), "table", "d1-owner", None), AuthenticatedUser(UserId(userA))))
      result.isRight shouldBe true
      outputsNamed("d1-owner").size shouldBe 1
    }
  }
}
