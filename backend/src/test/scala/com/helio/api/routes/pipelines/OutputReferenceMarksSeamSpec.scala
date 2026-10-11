package com.helio.api.routes.pipelines

import com.helio.api.JsonProtocols
import com.helio.api.protocols.pipelines._
import com.helio.api.protocols.sources.{StaticColumnPayload, StaticDataPayload}
import com.helio.domain.model._
import com.helio.infrastructure.persistence.pipelines.PipelineRootRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.pipelines.PipelineService
import com.helio.services.sources.{DataSourceService, SourceService}
import com.helio.testkit.{HelioRouteTest, TempDirectorySupport}
import com.helio.testsupport.OutputHistoryApiHarness
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.nio.file.{Files, Paths}
import java.util.UUID
import scala.concurrent.ExecutionContext

/** HEL-1306 seam test, backend half. `shared-test-fixtures/chart-reference-marks.json` holds the exact
 *  config the Output editor persists (`validConfig`) and the invalid shapes the three Output request
 *  schemas reject (`schemaRejects`, plus `serverOnly` rules JSON Schema cannot express); the frontend
 *  `referenceMarksSeam.test.ts` drives the editor builder and the schemas from the SAME file. Here the
 *  real routes must accept `validConfig` on create, PATCH and single-call pipeline create, read it back
 *  unchanged, and answer each invalid case with a 400 naming the key and the problem. */
class OutputReferenceMarksSeamSpec
    extends AnyWordSpec
    with Matchers
    with HelioRouteTest
    with JsonProtocols
    with BeforeAndAfterAll
    with TempDirectorySupport
    with OutputHistoryApiHarness {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  override protected def harnessEc: ExecutionContext     = typedSystem.executionContext

  private val fixture = JsonParser(Files.readString(Paths.get("../shared-test-fixtures/chart-reference-marks.json"))).asJsObject
  private val validConfig: JsObject = fixture.fields("validConfig").asJsObject
  private def cases(key: String): Vector[JsObject] = fixture.fields(key).convertTo[Vector[JsValue]].map(_.asJsObject)
  private def str(o: JsObject, k: String): String = o.fields(k).convertTo[String]
  private val invalid: Vector[(String, String, JsObject, String)] =
    cases("schemaRejects").map(c => (str(c, "name"), "chart", c.fields("config").asJsObject, str(c, "message"))) ++
      cases("serverOnly").map(c => (str(c, "name"), str(c, "kind"), c.fields("config").asJsObject, str(c, "message")))

  private var ownerId: String = _
  private def owner           = AuthenticatedUser(UserId(ownerId))

  override def beforeAll(): Unit = { super.beforeAll(); startHarness(); ownerId = seedUser() }
  override def afterAll(): Unit  = { stopHarness(); super.afterAll() }

  private def routes(): Route = new OutputRoutes(outputService, owner, Some(historyService))(harnessEc).routes
  private def pipelineRoutes(): Route = {
    implicit val ec: ExecutionContext = harnessEc
    val fs = new LocalFileSystem(newTempDir("output-reference-marks-seam"))
    val service = new PipelineService(
      pipelineRepo, stepRepo, dataSourceRepo, outputRepo = outputRepo, pipelineRootRepo = new PipelineRootRepository(ctx),
      sourceService = new SourceService(dataSourceRepo, connector = null), dataSourceService = new DataSourceService(dataSourceRepo, fs)
    )
    new PipelineRoutes(service, owner).routes
  }
  private def storedConfig(oid: String): JsObject = awaitDb(outputRepo.findConfigsByIdsInternal(Vector(oid)))(oid)
  private def count(pid: String): Int = awaitDb(outputRepo.listByPipelineInternal(PipelineId(pid))).size

  "the shared chart-reference-marks fixture" should {

    "be accepted by POST /pipelines/:id/outputs and read back identical by GET /outputs/:id" in {
      val (pid, _) = seedMetricOutput(ownerId, None)
      val created = Post(s"/pipelines/$pid/outputs", CreateOutputRequest(None, "chart", "marks", Some(validConfig))) ~> routes() ~> check {
        status shouldBe StatusCodes.Created
        responseAs[OutputResponse]
      }
      Get(s"/outputs/${created.id}") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val cfg = responseAs[OutputResponse].config.asJsObject
        cfg.fields("referenceLines") shouldBe validConfig.fields("referenceLines")
        cfg.fields("referenceBands") shouldBe validConfig.fields("referenceBands")
      }
    }

    "be accepted by PATCH /outputs/:id, and clearing both keys with null succeeds" in {
      val (pid, _) = seedMetricOutput(ownerId, None)
      val oid = awaitDb(outputRepo.insertInternal(PipelineId(pid), None, owner.id, "seeded", OutputKind.Chart, JsObject("chartType" -> JsString("bar")), explicitRootId = None)).id.value
      Patch(s"/outputs/$oid", UpdateOutputRequest(None, Some(validConfig))) ~> routes() ~> check { status shouldBe StatusCodes.OK }
      storedConfig(oid).fields("referenceLines") shouldBe validConfig.fields("referenceLines")
      Patch(s"/outputs/$oid", UpdateOutputRequest(None, Some(JsObject("referenceLines" -> JsNull, "referenceBands" -> JsArray.empty)))) ~> routes() ~> check {
        status shouldBe StatusCodes.OK
      }
    }

    "be accepted by a single-call POST /pipelines, creating the chart Output" in {
      val root = CreatePipelineRootRequest(
        `type` = Some("dataset"), name = Some(s"marks-${UUID.randomUUID()}"),
        staticConfig = Some(StaticDataPayload(Vector(StaticColumnPayload("amount", "number")), Vector(Vector(JsNumber(1)))))
      )
      val out = CreatePipelineTransactionalOutputRequest(None, "chart", "o", config = Some(validConfig))
      Post("/pipelines", CreatePipelineRequest("marks-ok", Vector(root), outputs = Vector(out))) ~> pipelineRoutes() ~> check {
        status shouldBe StatusCodes.Created
      }
    }

    cases("schemaAccepts").foreach { c =>
      s"accept '${str(c, "name")}' on create and read it back" in {
        val (pid, _) = seedMetricOutput(ownerId, None)
        val cfg      = c.fields("config").asJsObject
        val created = Post(s"/pipelines/$pid/outputs", CreateOutputRequest(None, "chart", "ok", Some(cfg))) ~> routes() ~> check {
          status shouldBe StatusCodes.Created
          responseAs[OutputResponse]
        }
        storedConfig(created.id).fields("referenceLines") shouldBe cfg.fields("referenceLines")
      }
    }

    invalid.foreach { case (name, kind, cfg, message) =>
      s"reject '$name' on create with a 400 containing '$message', persisting nothing" in {
        val (pid, _) = seedMetricOutput(ownerId, None)
        val before   = count(pid)
        Post(s"/pipelines/$pid/outputs", CreateOutputRequest(None, kind, "bad", Some(cfg))) ~> routes() ~> check {
          status shouldBe StatusCodes.BadRequest
          responseAs[String] should include(message)
        }
        count(pid) shouldBe before
      }
    }

    invalid.filter(_._2 == "chart").foreach { case (name, _, cfg, message) =>
      s"reject '$name' on PATCH and on single-call create with a 400 containing '$message'" in {
        val (pid, _) = seedMetricOutput(ownerId, None)
        val oid = awaitDb(outputRepo.insertInternal(PipelineId(pid), None, owner.id, "seeded", OutputKind.Chart, JsObject("chartType" -> JsString("bar")), explicitRootId = None)).id.value
        Patch(s"/outputs/$oid", UpdateOutputRequest(None, Some(cfg))) ~> routes() ~> check {
          status shouldBe StatusCodes.BadRequest
          responseAs[String] should include(message)
        }
        storedConfig(oid).fields.keySet should not contain "referenceLines"
        val root = CreatePipelineRootRequest(
          `type` = Some("dataset"), name = Some(s"marks-bad-${UUID.randomUUID()}"),
          staticConfig = Some(StaticDataPayload(Vector(StaticColumnPayload("amount", "number")), Vector(Vector(JsNumber(1)))))
        )
        val out = CreatePipelineTransactionalOutputRequest(None, "chart", "o", config = Some(cfg))
        Post("/pipelines", CreatePipelineRequest("marks-bad", Vector(root), outputs = Vector(out))) ~> pipelineRoutes() ~> check {
          status shouldBe StatusCodes.BadRequest
          responseAs[String] should include(message)
        }
      }
    }
  }
}
