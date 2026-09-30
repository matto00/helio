package com.helio.api.routes.pipelines

import com.helio.api.JsonProtocols
import com.helio.api.protocols.panels.PanelResponse
import com.helio.domain.model._
import com.helio.domain.panels.{DividerPanel, DividerPanelConfig}
import com.helio.domain.steps.SecondaryInput
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines._
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.services.pipelines.ProvenanceService
import com.helio.testsupport.ProvenanceFixtures
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1206: authenticated `GET /api/outputs/:id/provenance` route shell (200 shape, 404 paths).
 *  The sharing-aware ACL itself is exercised against a NON-superuser pool in `ProvenanceServiceSpec`. */
class ProvenanceRoutesSpec extends AnyWordSpec with Matchers with ScalatestRouteTest with JsonProtocols with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                   = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var outputRepo: OutputRepository       = _
  private var fx: ProvenanceFixtures             = _
  private var routes: Route = _

  private val ownerId = UUID.randomUUID().toString
  private val owner   = AuthenticatedUser(UserId(ownerId))

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure().dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration").load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx            = new DbContext(db, db)(routeEc)
    val dataSourceRepo = new DataSourceRepository(ctx)(routeEc)
    val pipelineRepo   = new PipelineRepository(ctx, dataSourceRepo)(routeEc)
    val stepRepo       = new PipelineStepRepository(ctx)(routeEc)
    val rootRepo       = new PipelineRootRepository(ctx)(routeEc)
    val runRepo        = new PipelineRunRepository(ctx)(routeEc)
    val snapRepo       = new NodeSnapshotRepository(ctx)(routeEc)
    outputRepo         = new OutputRepository(ctx)(routeEc)
    val svc            = new ProvenanceService(outputRepo, pipelineRepo, stepRepo, rootRepo, dataSourceRepo, runRepo, snapRepo)(routeEc)
    fx                 = new ProvenanceFixtures(owner, dataSourceRepo, pipelineRepo, stepRepo, rootRepo, runRepo, snapRepo)(routeEc)
    routes             = new ProvenanceRoutes(svc, owner)(routeEc).routes
    await(db.run({
      import PostgresProfile.api._
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($ownerId::uuid, ${s"owner-$ownerId@helio.test"}, now())"""
    }))
  }

  override def afterAll(): Unit = { db.close(); embeddedPostgres.close(); super.afterAll() }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  "GET /outputs/:id/provenance" should {
    "return the full authenticated shape (ids included) for a readable Output" in {
      val b   = fx.newPipeline("Auth Pipe", Vector("Src A", "Src B"))
      val sa  = fx.filterStep(b.pipelineId, None, Some(b.roots(0)))
      val sb  = fx.filterStep(b.pipelineId, None, Some(b.roots(1)))
      val j   = fx.joinStep(b.pipelineId, sa.id, SecondaryInput.Lane(sb.id.value))
      val out = await(outputRepo.insertInternal(b.pipelineId, Some(j.id), owner.id, "O", OutputKind.Table, explicitRootId = None))
      fx.snapshot(b.pipelineId, Some(j.id), None, rows = 5)
      fx.run(b.pipelineId, "succeeded")

      Get(s"/outputs/${out.id.value}/provenance") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val body = responseAs[JsObject]
        body.fields.keySet shouldBe Set("outputId", "pipeline", "sources", "nodePath", "lastRun", "assertions")
        body.fields("outputId") shouldBe JsString(out.id.value)
        body.fields("pipeline").asJsObject.fields shouldBe Map("id" -> JsString(b.pipelineId.value), "name" -> JsString("Auth Pipe"))
        val sources = body.fields("sources").convertTo[Vector[JsObject]]
        sources.map(_.fields.keySet).toSet shouldBe Set(Set("id", "name", "kind"))
        sources.map(_.fields("name")) shouldBe Vector(JsString("Src A"), JsString("Src B"))
        body.fields("lastRun").asJsObject.fields("rowCount") shouldBe JsNumber(5)
        body.fields("assertions").asJsObject.fields.keySet shouldBe Set("defined", "passed", "failed", "warned", "rootBound")
      }
    }

    "404 for an Output id that does not exist" in {
      Get(s"/outputs/${UUID.randomUUID()}/provenance") ~> routes ~> check { status shouldBe StatusCodes.NotFound }
    }
  }

  // HEL-1197 regression: making PanelResponse.ownerId optional must leave every authenticated
  // producer's serialization byte-identical (the patch-set undo conflict check compares it).
  "PanelResponse authenticated serialization" should {
    "be exactly the pre-change JSON (default includeOwnerId), and drop ONLY ownerId when asked" in {
      val now = Instant.parse("2026-01-01T00:00:00Z")
      val panel = DividerPanel(
        PanelId("p1"), DashboardId("d1"), "Title", ResourceMeta("u1", now, now),
        PanelAppearance("#fff", "#000", 1.0), UserId("u1"), DividerPanelConfig.Empty
      )
      val expected = JsObject(
        "id" -> JsString("p1"), "dashboardId" -> JsString("d1"), "title" -> JsString("Title"), "type" -> JsString(DividerPanel.Kind),
        "meta" -> JsObject("createdBy" -> JsString("u1"), "createdAt" -> JsString(now.toString), "lastUpdated" -> JsString(now.toString)),
        "appearance" -> JsObject("background" -> JsString("#fff"), "color" -> JsString("#000"), "transparency" -> JsNumber(1.0)),
        "ownerId" -> JsString("u1"),
        "config" -> JsObject("orientation" -> JsString("horizontal"))
      )
      PanelResponse.fromDomain(panel).toJson.asJsObject shouldBe expected
      PanelResponse.fromDomain(panel, includeOwnerId = false).toJson.asJsObject shouldBe JsObject(expected.fields - "ownerId")
    }
  }
}
