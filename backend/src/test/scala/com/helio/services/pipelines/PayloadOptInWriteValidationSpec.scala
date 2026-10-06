package com.helio.services.pipelines

import com.helio.api.JsonProtocols
import com.helio.api.protocols.pipelines._
import com.helio.api.routes.pipelines.OutputRoutes
import com.helio.domain.engine.SchemaField
import com.helio.domain.model._
import com.helio.services.ServiceError
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

/** HEL-1276 task 2.2: `config.historyPayloads` is validated on both Output config write paths
 *  (create/update and single-call pipeline create); a rejection leaves the stored config unchanged. */
class PayloadOptInWriteValidationSpec
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
  private val invalid: Seq[JsValue] = Seq(JsString("yes"), JsNumber(1), JsArray(), JsObject.empty)
  private def cfg(v: JsValue): JsObject = JsObject("historyPayloads" -> v)
  private def stored(oid: String): JsObject = awaitDb(outputRepo.findConfigsByIdsInternal(Vector(oid)))(oid)

  "POST /pipelines/:id/outputs" should {
    "400 every non-boolean historyPayloads and persist nothing; accept true, false and null" in {
      val (pid, _) = seedMetricOutput(ownerId, None)
      val before   = awaitDb(outputRepo.listByPipelineInternal(PipelineId(pid))).size
      invalid.foreach { v =>
        Post(s"/pipelines/$pid/outputs", CreateOutputRequest(None, "table", "bad", Some(cfg(v)))) ~> routes() ~> check { status shouldBe StatusCodes.BadRequest }
      }
      awaitDb(outputRepo.listByPipelineInternal(PipelineId(pid))).size shouldBe before
      Seq(JsTrue, JsFalse, JsNull).foreach { v =>
        Post(s"/pipelines/$pid/outputs", CreateOutputRequest(None, "table", "ok", Some(cfg(v)))) ~> routes() ~> check { status shouldBe StatusCodes.Created }
      }
    }
  }

  "PATCH /outputs/:id" should {
    "400 a non-boolean leaving the stored config unchanged, and accept a boolean" in {
      val (_, oid) = seedMetricOutput(ownerId, Some("7d"))
      val original = stored(oid)
      invalid.foreach { v =>
        Patch(s"/outputs/$oid", UpdateOutputRequest(None, Some(cfg(v)))) ~> routes() ~> check { status shouldBe StatusCodes.BadRequest }
      }
      stored(oid) shouldBe original
      Patch(s"/outputs/$oid", UpdateOutputRequest(None, Some(cfg(JsTrue)))) ~> routes() ~> check { status shouldBe StatusCodes.OK }
      stored(oid).fields("historyPayloads") shouldBe JsTrue
    }
  }

  "single-call pipeline create (POST /api/pipelines)" should {
    "400 a non-boolean historyPayloads and persist no pipeline" in {
      val now = Instant.now()
      val src = awaitDb(dataSourceRepo.insert(DatasetSource(DataSourceId(UUID.randomUUID().toString), "src", owner.id, now, now, inferredSchema = Vector(SchemaField("amount", "float"))), owner))
      val svc = new PipelineService(pipelineRepo, stepRepo, dataSourceRepo, outputRepo = outputRepo)(harnessEc)
      def req(name: String, v: JsValue) = CreatePipelineRequest(
        name, Vector(CreatePipelineRootRequest(Some(src.id.value))),
        outputs = Vector(CreatePipelineTransactionalOutputRequest(None, "table", "o", Some(cfg(v))))
      )
      invalid.zipWithIndex.foreach { case (v, i) =>
        val name = s"payload-bad-$i-${UUID.randomUUID()}"
        awaitDb(svc.create(req(name, v), owner)) match {
          case Left(ServiceError.BadRequest(msg)) => msg should include("historyPayloads")
          case other                              => fail(s"expected BadRequest, got $other")
        }
        awaitDb(db.run(sql"select count(*) from pipelines where name = $name".as[Int].head)) shouldBe 0
      }
      awaitDb(svc.create(req(s"payload-ok-${UUID.randomUUID()}", JsTrue), owner)) shouldBe a[Right[_, _]]
    }
  }
}
