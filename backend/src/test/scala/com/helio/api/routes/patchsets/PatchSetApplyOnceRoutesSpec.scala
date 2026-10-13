package com.helio.api.routes.patchsets

import com.helio.api.protocols.patchsets.{PatchSet, PatchSetApplyResponse}
import com.helio.domain.model.Dashboard
import com.helio.services.ServiceError
import com.helio.services.dashboards.DashboardService
import com.helio.testsupport.JsonSchemaValidation
import org.apache.pekko.http.scaladsl.model.{StatusCode, StatusCodes}
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.util.UUID
import scala.concurrent.Future

/** HEL-1522 item 3: a patch set carrying a server-minted `proposalId` applies at most once per user. */
class PatchSetApplyOnceRoutesSpec extends PatchSetRoutesFixture {

  private val alreadyAppliedSchema = JsonSchemaValidation.compile("shared/patch-set-already-applied-response.schema.json")

  private def newProposalId(): String = UUID.randomUUID().toString

  private def createBody(name: String, proposalId: Option[String]): String =
    JsObject(Map(
      "edits" -> JsArray(JsObject("target" -> JsObject("kind" -> JsString("dashboard")), "op" -> JsString("create"), "patch" -> JsObject("name" -> JsString(name))))
    ) ++ proposalId.map("proposalId" -> JsString(_))).compactPrint

  private def dashboardsNamed(name: String): Int =
    await(db.run(sql"SELECT count(*) FROM dashboards WHERE name = $name".as[Int].head))

  private def post(body: String): (StatusCode, String) =
    Post("/patch-sets/apply", json(body)) ~> routesFor(userA) ~> check((status, responseAs[String]))

  /** A dashboard rename to a blank name: passes resolve-time checks, fails in forward apply (a genuine mid-set failure). */
  private def failingEdit(dashboard: Dashboard): JsObject =
    JsObject("target" -> JsObject("kind" -> JsString("dashboard"), "id" -> JsString(dashboard.id.value)), "op" -> JsString("update"), "patch" -> JsObject("name" -> JsString("")))

  private def newDashboard(): Dashboard =
    await(dashboardService.create(DashboardService.CreateDashboardInput(Some("Dash " + UUID.randomUUID())), userA))._1

  "apply with a proposalId" should {
    "refuse a second apply of the same proposal and create nothing twice" in {
      val (name, id) = ("Once " + UUID.randomUUID(), newProposalId())
      post(createBody(name, Some(id)))._1 shouldBe StatusCodes.OK
      val (secondStatus, secondBody) = post(createBody(name, Some(id)))
      secondStatus shouldBe StatusCodes.Conflict
      JsonSchemaValidation.validationErrors(alreadyAppliedSchema, secondBody) shouldBe empty
      secondBody.parseJson.asJsObject.fields("code") shouldBe JsString("PATCH_SET_ALREADY_APPLIED")
      secondBody.parseJson.asJsObject.fields.keySet shouldBe Set("message", "code")
      dashboardsNamed(name) shouldBe 1
    }

    "apply the same create-only patch set twice when it carries no proposalId" in {
      val name = "Twice " + UUID.randomUUID()
      post(createBody(name, None))._1 shouldBe StatusCodes.OK
      post(createBody(name, None))._1 shouldBe StatusCodes.OK
      dashboardsNamed(name) shouldBe 2
    }

    "scope the claim to the user" in {
      val (name, id) = ("Scoped " + UUID.randomUUID(), newProposalId())
      post(createBody(name, Some(id)))._1 shouldBe StatusCodes.OK
      Post("/patch-sets/apply", json(createBody(name, Some(id)))) ~> routesFor(userB) ~> check { status shouldBe StatusCodes.OK }
    }

    "reject a proposalId that is not a UUID with 400 and create nothing" in {
      val name = "BadId " + UUID.randomUUID()
      post(createBody(name, Some("not-a-uuid")))._1 shouldBe StatusCodes.BadRequest
      dashboardsNamed(name) shouldBe 0
    }

    "not consume the proposalId when the apply is refused as stale" in {
      val pipelineId = newPipeline()
      val id         = newProposalId()
      val renameBody = edit("pipeline", pipelineId.value, "update")
      val fingerprint = previewFingerprint(renameBody)
      newStep(pipelineId) // the target changes after the preview
      def withProposal(fp: String) = JsObject(withFingerprint(renameBody, fp).parseJson.asJsObject.fields + ("proposalId" -> JsString(id))).compactPrint
      val (staleStatus, staleBody) = post(withProposal(fingerprint))
      staleStatus shouldBe StatusCodes.Conflict
      staleBody.parseJson.asJsObject.fields("code") shouldBe JsString("PATCH_SET_STALE")
      post(withProposal(previewFingerprint(renameBody)))._1 shouldBe StatusCodes.OK
    }

    "release the proposalId when every applied edit rolled back cleanly" in {
      val (name, id) = ("Rolled back " + UUID.randomUUID(), newProposalId())
      val failing    = failingEdit(newDashboard())
      val create     = createBody(name, None).parseJson.asJsObject.fields("edits").convertTo[Vector[JsValue]].head
      val failedBody = JsObject("edits" -> JsArray(create, failing), "proposalId" -> JsString(id)).compactPrint
      val (status1, body1) = post(failedBody)
      status1 shouldBe StatusCodes.OK
      body1.parseJson.convertTo[PatchSetApplyResponse].edits.map(_.status) should contain("rolledBack")
      dashboardsNamed(name) shouldBe 0
      post(createBody(name, Some(id)))._1 shouldBe StatusCodes.OK
    }

    "keep the proposalId when a rollback could not restore a delete" in {
      val (name, id) = ("Unrecoverable " + UUID.randomUUID(), newProposalId())
      val doomed     = newDashboard()
      val delete     = JsObject("target" -> JsObject("kind" -> JsString("dashboard"), "id" -> JsString(doomed.id.value)), "op" -> JsString("delete"))
      val body       = JsObject("edits" -> JsArray(delete, failingEdit(newDashboard())), "proposalId" -> JsString(id)).compactPrint
      val (status1, body1) = post(body)
      status1 shouldBe StatusCodes.OK
      body1.parseJson.convertTo[PatchSetApplyResponse].edits.map(_.status) should contain("unrecoverable")
      post(createBody(name, Some(id)))._1 shouldBe StatusCodes.Conflict
      dashboardsNamed(name) shouldBe 0
    }

    "apply two concurrent applies of one proposal exactly once" in {
      val (name, id) = ("Race " + UUID.randomUUID(), newProposalId())
      val patchSet = createBody(name, Some(id)).parseJson.convertTo[PatchSet]
      val results = await(Future.sequence(Vector.fill(4)(patchSetApplyService.apply(patchSet, userA))))
      results.count(_.isRight) shouldBe 1
      results.collect { case Left(e) => e }.foreach(_ shouldBe a[ServiceError.PatchSetAlreadyApplied])
      dashboardsNamed(name) shouldBe 1
    }
  }
}
