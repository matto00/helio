package com.helio.services.pipelines

import com.helio.api.JsonProtocols
import com.helio.api.protocols.patchsets.{Edit, EditTarget, PatchSet}
import com.helio.api.protocols.pipelines._
import com.helio.api.protocols.sources.{StaticColumnPayload, StaticDataPayload}
import com.helio.api.routes.pipelines.OutputRoutes
import com.helio.domain.engine.SchemaField
import com.helio.domain.model._
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

/** HEL-1307 task 4.2: an invalid `config.conditionalFormats` is rejected 400 (naming the key and rule index,
 *  persisting nothing) on every write path -- route create/PATCH, single-call create, proposal grounding and
 *  the patch-set preview -- and rollback (RestorePriorStored) is exempt. Chart/timeline/markdown reject the
 *  key; a valid list round-trips. */
class ConditionalFormatsWriteSpec
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
  private def storedConfig(oid: String): JsObject = awaitDb(outputRepo.findConfigsByIdsInternal(Vector(oid)))(oid)
  private def count(pid: String): Int = awaitDb(outputRepo.listByPipelineInternal(PipelineId(pid))).size
  private def s(v: String): JsString = JsString(v)

  private val goodRules: JsValue = """[{"op":"lt","value":50,"tone":"error","label":"Low"},{"op":"lt","value":80,"tone":"warning"}]""".parseJson
  private val badRules: JsValue  = """[{"op":"lt","value":50,"tone":"error"},{"op":"lt","value":"x","tone":"warning"}]""".parseJson
  private def cfg(v: JsValue): JsObject = JsObject("conditionalFormats" -> v)

  "POST /pipelines/:id/outputs" should {
    "400 an invalid list naming the key and index, persisting nothing; accept and round-trip a valid one" in {
      val (pid, _) = seedMetricOutput(ownerId, None)
      val before   = count(pid)
      Post(s"/pipelines/$pid/outputs", CreateOutputRequest(None, "metric", "bad", Some(cfg(badRules)))) ~> routes() ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String] should (include("conditionalFormats[1]") and include("value must be a finite number"))
      }
      count(pid) shouldBe before
      Post(s"/pipelines/$pid/outputs", CreateOutputRequest(None, "metric", "ok", Some(cfg(goodRules)))) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        val oid = responseAs[OutputResponse].id
        storedConfig(oid).fields("conditionalFormats") shouldBe goodRules
        Get(s"/outputs/$oid") ~> routes() ~> check { responseAs[OutputResponse].config.asJsObject.fields("conditionalFormats") shouldBe goodRules }
      }
    }

    "accept the key on metric, table and collection and reject it on chart, timeline and markdown" in {
      val (pid, _) = seedMetricOutput(ownerId, None)
      val tableRules = """[{"op":"lt","value":1,"tone":"error","column":"a"}]""".parseJson
      Seq(("metric", goodRules), ("table", tableRules), ("collection", goodRules)).foreach { case (k, r) =>
        Post(s"/pipelines/$pid/outputs", CreateOutputRequest(None, k, "ok", Some(cfg(r)))) ~> routes() ~> check { status shouldBe StatusCodes.Created }
      }
      Seq("chart", "timeline", "markdown").foreach { k =>
        Post(s"/pipelines/$pid/outputs", CreateOutputRequest(None, k, "bad", Some(cfg(goodRules)))) ~> routes() ~> check {
          status shouldBe StatusCodes.BadRequest
          responseAs[String] should (include("`conditionalFormats`") and include(s"not a $k config key"))
        }
      }
    }

    "400 a table rule without a column" in {
      val (pid, _) = seedMetricOutput(ownerId, None)
      Post(s"/pipelines/$pid/outputs", CreateOutputRequest(None, "table", "bad", Some(cfg(goodRules)))) ~> routes() ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String] should include("conditionalFormats[0]: column is required")
      }
    }
  }

  "PATCH /outputs/:id" should {
    "400 an invalid list leaving the stored config unchanged; clear with [] and null" in {
      val (_, oid) = seedMetricOutput(ownerId, None)
      Patch(s"/outputs/$oid", UpdateOutputRequest(None, Some(cfg(goodRules)))) ~> routes() ~> check { status shouldBe StatusCodes.OK }
      val before = storedConfig(oid)
      Patch(s"/outputs/$oid", UpdateOutputRequest(None, Some(cfg(badRules)))) ~> routes() ~> check { status shouldBe StatusCodes.BadRequest }
      storedConfig(oid) shouldBe before
      Patch(s"/outputs/$oid", UpdateOutputRequest(None, Some(cfg(JsArray())))) ~> routes() ~> check { status shouldBe StatusCodes.OK }
      storedConfig(oid).fields("conditionalFormats") shouldBe JsArray()
      Patch(s"/outputs/$oid", UpdateOutputRequest(None, Some(cfg(JsNull)))) ~> routes() ~> check { status shouldBe StatusCodes.OK }
    }
  }

  "the patch-set preview of an Output update" should {
    "reject an invalid list with the same validation the apply path uses (apply itself: PatchSetApplyServiceSpec)" in {
      val (_, oid) = seedMetricOutput(ownerId, None)
      val preview  = new PatchSetPreviewService(panelRepo, dashboardRepo, dataSourceRepo, pipelineRepo, stepRepo, accessChecker, outputRepo)(harnessEc)
      def edit(c: JsObject) = PatchSet(None, Vector(
        Edit(EditTarget("output", Some(oid), None), "update", None, None, None, None, None, None, Some(UpdateOutputRequest(None, Some(c))))
      ))
      awaitDb(preview.preview(edit(cfg(badRules)), owner)) match {
        case Left(ServiceError.BadRequest(msg)) => msg should include("conditionalFormats[1]")
        case other                              => fail(s"expected BadRequest, got $other")
      }
      awaitDb(preview.preview(edit(cfg(goodRules)), owner)) shouldBe a[Right[_, _]]
      storedConfig(oid).fields.get("conditionalFormats") shouldBe None
    }
  }

  "OutputConfigValidation.validateConfig" should {
    "check the list under ValidateWrite but not under RestorePriorStored (rollback exemption)" in {
      OutputConfigValidation.validateConfig(OutputKind.Metric, cfg(badRules), JsObject.empty) match {
        case Left(ServiceError.BadRequest(msg)) => msg should include("conditionalFormats[1]")
        case other                              => fail(s"expected BadRequest, got $other")
      }
      OutputConfigValidation.validateConfig(OutputKind.Metric, cfg(badRules), JsObject.empty, OutputConfigWritePolicy.RestorePriorStored) shouldBe Right(())
    }
  }

  "single-call pipeline create and proposal grounding" should {
    def outputs(c: JsObject) = Vector(CreatePipelineTransactionalOutputRequest(None, "metric", "o", Some(c)))
    "400 an invalid list and persist no pipeline" in {
      val now = Instant.now()
      val src = awaitDb(dataSourceRepo.insert(DatasetSource(DataSourceId(UUID.randomUUID().toString), "src", owner.id, now, now, inferredSchema = Vector(SchemaField("amount", "float"))), owner))
      val svc = new PipelineService(pipelineRepo, stepRepo, dataSourceRepo, outputRepo = outputRepo)(harnessEc)
      val name = s"cf-bad-${UUID.randomUUID()}"
      awaitDb(svc.create(CreatePipelineRequest(name, Vector(CreatePipelineRootRequest(Some(src.id.value))), outputs = outputs(cfg(badRules))), owner)) match {
        case Left(ServiceError.BadRequest(msg)) => msg should include("conditionalFormats[1]")
        case other                              => fail(s"expected BadRequest, got $other")
      }
      awaitDb(db.run(sql"select count(*) from pipelines where name = $name".as[Int].head)) shouldBe 0
      awaitDb(svc.create(CreatePipelineRequest(s"cf-ok-${UUID.randomUUID()}", Vector(CreatePipelineRootRequest(Some(src.id.value))), outputs = outputs(cfg(goodRules))), owner)) shouldBe a[Right[_, _]]
    }

    "report an invalid list as the proposed Output's validationError" in {
      val svc = new PipelineService(pipelineRepo, stepRepo, dataSourceRepo, outputRepo = outputRepo)(harnessEc)
      def proposal(c: JsObject) = PipelineProposal(
        pipelineName = "grounded",
        roots = Vector(PipelineProposalSource(
          sourceId = None, `type` = Some("static"), name = None, csvConfig = None, restConfig = None, sqlConfig = None,
          staticConfig = Some(StaticDataPayload(Vector(StaticColumnPayload("amount", "string")), Vector.empty))
        )),
        steps = Vector.empty,
        outputs = outputs(c)
      )
      awaitDb(svc.analyzeProposal(proposal(cfg(badRules)), owner)).getOrElse(fail("analyze failed"))
        .outputs.head.validationError.getOrElse(fail("expected validationError")) should include("conditionalFormats[1]")
      awaitDb(svc.analyzeProposal(proposal(cfg(goodRules)), owner)).getOrElse(fail("analyze failed")).outputs.head.validationError shouldBe None
    }
  }
}
