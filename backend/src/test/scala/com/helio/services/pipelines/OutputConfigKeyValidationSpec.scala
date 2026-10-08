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

/** HEL-1313 tasks 4.2/4.3: unknown Output config keys and malformed `aggregation`/`chartType` are
 *  rejected on every write path (route create/PATCH, patch-set preview, single-call create, proposal
 *  grounding) with a message naming the key, persisting nothing; Outputs carrying stored legacy keys
 *  still read, PATCH and round-trip. */
class OutputConfigKeyValidationSpec
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
  private def s(v: String): JsString = JsString(v)
  private def count(pid: String): Int = awaitDb(outputRepo.listByPipelineInternal(PipelineId(pid))).size
  private def seed(pid: String, kind: OutputKind, config: JsObject): String =
    awaitDb(outputRepo.insertInternal(PipelineId(pid), None, owner.id, "seeded", kind, config, explicitRootId = None)).id.value

  private val typos: Seq[(String, String, String)] = Seq(
    ("chart", "chartTyp", "chartType"), ("metric", "lable", "label"), ("table", "columnOrdr", "columnOrder"),
    ("collection", "layot", "layout"), ("timeline", "sortt", "sort"), ("markdown", "contnet", "content")
  )
  private val chartAgg = JsObject("groupBy" -> s("region"), "agg" -> s("sum"), "yField" -> s("amount"))

  "POST /pipelines/:id/outputs" should {
    "400 a typo'd key for each kind naming it and the intended key, persisting nothing" in {
      val (pid, _) = seedMetricOutput(ownerId, None)
      val before   = count(pid)
      typos.foreach { case (kind, typo, intended) =>
        Post(s"/pipelines/$pid/outputs", CreateOutputRequest(None, kind, "bad", Some(JsObject(typo -> s("x"))))) ~> routes() ~> check {
          status shouldBe StatusCodes.BadRequest
          val body = responseAs[String]
          body should include(s"`$typo`")
          body should include(s"did you mean `$intended`?")
        }
      }
      count(pid) shouldBe before
    }

    "400 a key valid only for another kind" in {
      val (pid, _) = seedMetricOutput(ownerId, None)
      Post(s"/pipelines/$pid/outputs", CreateOutputRequest(None, "table", "bad", Some(JsObject("chartType" -> s("bar"))))) ~> routes() ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String] should include("not a table config key")
      }
    }

    "400 a malformed chart aggregation, an unknown chartType and a scatter aggregation; accept a well-formed one" in {
      val (pid, _) = seedMetricOutput(ownerId, None)
      def post(cfg: JsObject) = Post(s"/pipelines/$pid/outputs", CreateOutputRequest(None, "chart", "c", Some(cfg))) ~> routes()
      post(JsObject("aggregation" -> JsObject("groupBy" -> s("r"), "agg" -> s("sum")))) ~> check { status shouldBe StatusCodes.BadRequest; responseAs[String] should include("aggregation") }
      post(JsObject("aggregation" -> JsObject("value" -> s("amount"), "agg" -> s("sum")))) ~> check { status shouldBe StatusCodes.BadRequest }
      post(JsObject("chartType" -> s("area"))) ~> check { status shouldBe StatusCodes.BadRequest; responseAs[String] should include("chartType") }
      post(JsObject("chartType" -> s("scatter"), "aggregation" -> chartAgg)) ~> check { status shouldBe StatusCodes.BadRequest; responseAs[String] should include("scatter") }
      post(JsObject("chartType" -> s("bar"), "aggregation" -> chartAgg)) ~> check { status shouldBe StatusCodes.Created }
    }
  }

  "PATCH /outputs/:id" should {
    "400 a typo'd key for each kind, leaving the stored config unchanged" in {
      val (pid, _) = seedMetricOutput(ownerId, None)
      typos.foreach { case (kind, typo, intended) =>
        val oid    = seed(pid, OutputKind.fromString(kind).toOption.get, JsObject("compare" -> s("7d")))
        val before = storedConfig(oid)
        Patch(s"/outputs/$oid", UpdateOutputRequest(None, Some(JsObject(typo -> s("x"))))) ~> routes() ~> check {
          status shouldBe StatusCodes.BadRequest
          responseAs[String] should (include(s"`$typo`") and include(s"`$intended`"))
        }
        storedConfig(oid) shouldBe before
      }
    }

    "400 a malformed chart aggregation, and the same scatter+aggregation a rollback would restore" in {
      val (pid, _) = seedMetricOutput(ownerId, None)
      val oid      = seed(pid, OutputKind.Chart, JsObject("chartType" -> s("bar"), "aggregation" -> chartAgg))
      Patch(s"/outputs/$oid", UpdateOutputRequest(None, Some(JsObject("aggregation" -> JsObject("groupBy" -> s("")))))) ~> routes() ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String] should include("aggregation")
      }
      Patch(s"/outputs/$oid", UpdateOutputRequest(None, Some(JsObject("chartType" -> s("scatter"))))) ~> routes() ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String] should include("scatter")
      }
      storedConfig(oid).fields("chartType") shouldBe s("bar")
    }

    "keep a V94-legacy-keyed Output readable and updatable; reject only changing a legacy key (AC3)" in {
      val (pid, _) = seedMetricOutput(ownerId, None)
      val legacy   = JsObject("fieldMapping" -> JsObject("value" -> s("amount")), "metricLabel" -> s("Revenue"), "metricUnit" -> s("$"))
      val oid      = seedPipelineOutputRaw(pid, legacy)
      Get(s"/outputs/$oid") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        responseAs[OutputResponse].config.asJsObject.fields("metricLabel") shouldBe s("Revenue")
      }
      Patch(s"/outputs/$oid", UpdateOutputRequest(None, Some(JsObject("compare" -> s("1d"))))) ~> routes() ~> check { status shouldBe StatusCodes.OK }
      val roundTrip = JsObject(storedConfig(oid).fields + ("compare" -> s("7d")))
      Patch(s"/outputs/$oid", UpdateOutputRequest(None, Some(roundTrip))) ~> routes() ~> check { status shouldBe StatusCodes.OK }
      Patch(s"/outputs/$oid", UpdateOutputRequest(None, Some(JsObject("metricLabel" -> s("New"))))) ~> routes() ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String] should (include("`metricLabel`") and include("use `label`"))
      }
      Patch(s"/outputs/$oid", UpdateOutputRequest(None, Some(JsObject("metricLabel" -> JsNull)))) ~> routes() ~> check { status shouldBe StatusCodes.OK }
      Get(s"/outputs/$oid") ~> routes() ~> check {
        responseAs[OutputResponse].config.asJsObject.fields("metricLabel") shouldBe JsNull
      }
    }
  }

  "the patch-set preview of an Output update" should {
    "reject an unknown key exactly like apply would, and leave the stored config unchanged" in {
      val (_, oid) = seedMetricOutput(ownerId, None)
      val preview  = new PatchSetPreviewService(panelRepo, dashboardRepo, dataSourceRepo, pipelineRepo, stepRepo, accessChecker, outputRepo)(harnessEc)
      def edit(cfg: JsObject) = PatchSet(None, Vector(
        Edit(EditTarget("output", Some(oid), None), "update", None, None, None, None, None, None, Some(UpdateOutputRequest(None, Some(cfg))))
      ))
      awaitDb(preview.preview(edit(JsObject("lable" -> s("x"))), owner)) match {
        case Left(ServiceError.BadRequest(msg)) => msg should include("`lable`")
        case other                              => fail(s"expected BadRequest, got $other")
      }
      awaitDb(preview.preview(edit(JsObject("label" -> s("x"))), owner)) shouldBe a[Right[_, _]]
      storedConfig(oid).fields.get("lable") shouldBe None
    }
  }

  "single-call pipeline create and proposal grounding" should {
    def outputs(cfg: JsObject) = Vector(CreatePipelineTransactionalOutputRequest(None, "metric", "o", Some(cfg)))
    "400 an unknown key and persist no pipeline" in {
      val now = Instant.now()
      val src = awaitDb(dataSourceRepo.insert(DatasetSource(DataSourceId(UUID.randomUUID().toString), "src", owner.id, now, now, inferredSchema = Vector(SchemaField("amount", "float"))), owner))
      val svc = new PipelineService(pipelineRepo, stepRepo, dataSourceRepo, outputRepo = outputRepo)(harnessEc)
      val name = s"unknown-key-${UUID.randomUUID()}"
      awaitDb(svc.create(CreatePipelineRequest(name, Vector(CreatePipelineRootRequest(Some(src.id.value))), outputs = outputs(JsObject("lable" -> s("x")))), owner)) match {
        case Left(ServiceError.BadRequest(msg)) => msg should (include("`lable`") and include("label"))
        case other                              => fail(s"expected BadRequest, got $other")
      }
      awaitDb(db.run(sql"select count(*) from pipelines where name = $name".as[Int].head)) shouldBe 0
      awaitDb(svc.create(CreatePipelineRequest(s"ok-${UUID.randomUUID()}", Vector(CreatePipelineRootRequest(Some(src.id.value))), outputs = outputs(JsObject("label" -> s("x")))), owner)) shouldBe a[Right[_, _]]
    }

    "report an unknown key as the proposed Output's validationError" in {
      val svc = new PipelineService(pipelineRepo, stepRepo, dataSourceRepo, outputRepo = outputRepo)(harnessEc)
      def proposal(cfg: JsObject) = PipelineProposal(
        pipelineName = "grounded",
        roots = Vector(PipelineProposalSource(
          sourceId = None, `type` = Some("static"), name = None, csvConfig = None, restConfig = None, sqlConfig = None,
          staticConfig = Some(StaticDataPayload(Vector(StaticColumnPayload("amount", "string")), Vector.empty))
        )),
        steps = Vector.empty,
        outputs = outputs(cfg)
      )
      awaitDb(svc.analyzeProposal(proposal(JsObject("lable" -> s("x"))), owner)).getOrElse(fail("analyze failed"))
        .outputs.head.validationError.getOrElse(fail("expected validationError")) should include("`lable`")
      awaitDb(svc.analyzeProposal(proposal(JsObject("label" -> s("x"))), owner)).getOrElse(fail("analyze failed")).outputs.head.validationError shouldBe None
    }
  }

  /** Raw seed (outside any validated path), mirroring a V94-migrated row. */
  private def seedPipelineOutputRaw(pid: String, config: JsObject): String = seed(pid, OutputKind.Metric, config)
}
