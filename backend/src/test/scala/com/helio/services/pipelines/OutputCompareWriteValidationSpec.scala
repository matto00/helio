package com.helio.services.pipelines

import com.helio.api.JsonProtocols
import com.helio.api.protocols.patchsets.{Edit, EditTarget, PatchSet}
import com.helio.api.protocols.pipelines._
import com.helio.api.protocols.sources.{StaticColumnPayload, StaticDataPayload}
import com.helio.api.routes.pipelines.OutputRoutes
import com.helio.domain.model._
import com.helio.domain.engine.SchemaField
import com.helio.services.ServiceError
import com.helio.services.patchsets.PatchSetPreviewService
import com.helio.testkit.HelioRouteTest
import com.helio.testsupport.OutputHistoryApiHarness
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.ExecutionContext

/** HEL-1273 task 4.7: `config.compare` is validated on every Output config write path -- create,
 *  update (merged config), the patch-set preview of an Output update, single-call pipeline create and
 *  the grounding of a pipeline proposal's Outputs. Each rejection leaves the stored config unchanged. */
class OutputCompareWriteValidationSpec
    extends AnyWordSpec
    with Matchers
    with HelioRouteTest
    with JsonProtocols
    with BeforeAndAfterAll
    with OutputHistoryApiHarness {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  override protected def harnessEc: ExecutionContext     = typedSystem.executionContext

  private var ownerId: String = _
  private def owner           = AuthenticatedUser(UserId(ownerId))

  override def beforeAll(): Unit = { super.beforeAll(); startHarness(); ownerId = seedUser() }
  override def afterAll(): Unit  = { stopHarness(); super.afterAll() }

  private def routes(): Route = new OutputRoutes(outputService, owner, Some(historyService))(harnessEc).routes

  /** Every shape the spec scenario names as invalid. */
  private val invalid: Seq[JsValue] =
    Seq("2d", "7D", "custom:P1W", "custom:-PT1H", "custom:P400D", "custom:P", "custom:PT", "custom:PT99999999999999999999H").map(JsString(_)) :+ JsNumber(7)
  private val valid: Seq[JsValue] = Seq("previous_run", "7d", "custom:PT6H").map(JsString(_))

  private def cfg(compare: JsValue): JsObject = JsObject("compare" -> compare)
  private def storedConfig(oid: String): JsObject = awaitDb(outputRepo.findConfigsByIdsInternal(Vector(oid)))(oid)

  "POST /pipelines/:id/outputs" should {
    "400 every invalid compare and persist nothing; accept every valid one" in {
      val (pid, _) = seedMetricOutput(ownerId, None)
      val before   = awaitDb(outputRepo.listByPipelineInternal(PipelineId(pid))).size
      invalid.foreach { c =>
        withClue(s"compare ${c.compactPrint}: ") {
          Post(s"/pipelines/$pid/outputs", CreateOutputRequest(None, "table", "bad", Some(cfg(c)))) ~> routes() ~> check { status shouldBe StatusCodes.BadRequest }
        }
      }
      awaitDb(outputRepo.listByPipelineInternal(PipelineId(pid))).size shouldBe before
      valid.foreach { c =>
        Post(s"/pipelines/$pid/outputs", CreateOutputRequest(None, "table", "ok", Some(cfg(c)))) ~> routes() ~> check {
          status shouldBe StatusCodes.Created
          responseAs[JsObject].fields("config").asJsObject.fields("compare") shouldBe c
        }
      }
    }
  }

  "PATCH /outputs/:id" should {
    "400 every invalid compare leaving the stored config unchanged; accept valid; null clears" in {
      val (_, oid) = seedMetricOutput(ownerId, Some("7d"))
      val original = storedConfig(oid)
      invalid.foreach { c =>
        withClue(s"compare ${c.compactPrint}: ") {
          Patch(s"/outputs/$oid", UpdateOutputRequest(None, Some(cfg(c)))) ~> routes() ~> check { status shouldBe StatusCodes.BadRequest }
        }
      }
      storedConfig(oid) shouldBe original
      Patch(s"/outputs/$oid", UpdateOutputRequest(None, Some(cfg(JsString("custom:PT6H"))))) ~> routes() ~> check { status shouldBe StatusCodes.OK }
      storedConfig(oid).fields("compare") shouldBe JsString("custom:PT6H")
      Patch(s"/outputs/$oid", UpdateOutputRequest(None, Some(cfg(JsNull)))) ~> routes() ~> check { status shouldBe StatusCodes.OK }
      storedConfig(oid).fields.get("compare") shouldBe Some(JsNull)
    }

    "validate the MERGED config: an unrelated patch does not bypass a stored invalid compare" in {
      val (_, oid) = seedMetricOutput(ownerId, Some("bogus")) // raw-seeded, outside any validated path
      Patch(s"/outputs/$oid", UpdateOutputRequest(Some("renamed"), Some(JsObject("legend" -> JsObject("show" -> JsBoolean(true)))))) ~> routes() ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }
  }

  "the patch-set preview of an Output update" should {
    "reject an invalid compare exactly like apply would (400), and accept a valid one" in {
      val (_, oid) = seedMetricOutput(ownerId, None)
      val preview  = new PatchSetPreviewService(panelRepo, dashboardRepo, dataSourceRepo, pipelineRepo, stepRepo, accessChecker, outputRepo)(harnessEc)
      def edit(c: JsValue) = PatchSet(None, Vector(
        Edit(EditTarget("output", Some(oid), None), "update", None, None, None, None, None, None, Some(UpdateOutputRequest(None, Some(cfg(c)))))
      ))
      invalid.foreach { c =>
        withClue(s"compare ${c.compactPrint}: ")(awaitDb(preview.preview(edit(c), owner)) shouldBe a[Left[_, _]])
      }
      awaitDb(preview.preview(edit(JsString("7d")), owner)) shouldBe a[Right[_, _]]
      storedConfig(oid).fields.get("compare") shouldBe None
    }
  }

  "single-call pipeline create (POST /api/pipelines)" should {
    "400 an invalid compare on an Output and persist no pipeline" in {
      val now = Instant.now()
      val src = awaitDb(dataSourceRepo.insert(DatasetSource(DataSourceId(UUID.randomUUID().toString), "src", owner.id, now, now, inferredSchema = Vector(SchemaField("amount", "float"))), owner))
      val svc = new PipelineService(pipelineRepo, stepRepo, dataSourceRepo, outputRepo = outputRepo)(harnessEc)
      def req(name: String, c: JsValue) = CreatePipelineRequest(
        name, Vector(CreatePipelineRootRequest(Some(src.id.value))),
        outputs = Vector(CreatePipelineTransactionalOutputRequest(None, "table", "o", Some(cfg(c))))
      )
      invalid.zipWithIndex.foreach { case (c, i) =>
        val name = s"compare-bad-$i-${UUID.randomUUID()}"
        withClue(s"compare ${c.compactPrint}: ") {
          awaitDb(svc.create(req(name, c), owner)) match {
            case Left(ServiceError.BadRequest(msg)) => msg should include("compare")
            case other                              => fail(s"expected BadRequest, got $other")
          }
        }
        awaitDb(db.run(sql"select count(*) from pipelines where name = $name".as[Int].head)) shouldBe 0
      }
      awaitDb(svc.create(req(s"compare-ok-${UUID.randomUUID()}", JsString("7d")), owner)) shouldBe a[Right[_, _]]
    }
  }

  "pipeline proposal grounding (analyze-proposal)" should {
    "report an invalid compare on a proposed Output as that Output's validationError" in {
      val svc = new PipelineService(pipelineRepo, stepRepo, dataSourceRepo, outputRepo = outputRepo)(harnessEc)
      def proposal(c: JsValue) = PipelineProposal(
        pipelineName = "grounded",
        roots = Vector(PipelineProposalSource(
          sourceId = None, `type` = Some("static"), name = None, csvConfig = None, restConfig = None, sqlConfig = None,
          staticConfig = Some(StaticDataPayload(Vector(StaticColumnPayload("amount", "string")), Vector.empty))
        )),
        steps = Vector.empty,
        outputs = Vector(CreatePipelineTransactionalOutputRequest(None, "table", "o", Some(cfg(c))))
      )
      invalid.foreach { c =>
        withClue(s"compare ${c.compactPrint}: ") {
          val resp = awaitDb(svc.analyzeProposal(proposal(c), owner)).getOrElse(fail("analyze failed"))
          resp.outputs.head.validationError.getOrElse(fail("expected validationError")) should include("compare")
        }
      }
      awaitDb(svc.analyzeProposal(proposal(JsString("7d")), owner)).getOrElse(fail("analyze failed")).outputs.head.validationError shouldBe None
    }
  }
}
