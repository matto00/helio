package com.helio.api.routes.dashboards

import com.helio.api.JsonProtocols
import com.helio.api.http.{AclDirective, ResourceType => AclResourceType, ResourceTypeRegistry}
import com.helio.domain.model._
import com.helio.domain.steps.SecondaryInput
import com.helio.infrastructure.crypto.TokenHashing
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ResourcePermissionRepository
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines._
import com.helio.infrastructure.persistence.sharing.ShareTokenRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.services.pipelines.ProvenanceService
import com.helio.services.sharing.ShareTokenValidatorImpl
import com.helio.testkit.HelioRouteTest
import com.helio.testsupport.ProvenanceFixtures
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.{StatusCode, StatusCodes}
import org.apache.pekko.http.scaladsl.server.Route
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import com.helio.testkit.VerifiedEmbeddedPostgres
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

/** HEL-1206 (red-first): `GET /dashboards/:dashboardId/panels/:panelId/provenance`. The public
 *  response is asserted FIELD BY FIELD against an explicit allowlist -- exact key sets at every
 *  level, plus a leak-marker scan for values a structural key check alone would not catch
 *  (`errorLog`, assertion `observed`, ids, `ownerId`). Gate behaviour (other dashboard's panel,
 *  missing/invalid token, no Output) is compared against `output-meta`'s own responses. */
class PublicProvenanceRoutesSpec
    extends AnyWordSpec
    with Matchers
    with HelioRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                   = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var panelRepo: PanelRepository         = _
  private var outputRepo: OutputRepository       = _
  private var shareTokenRepo: ShareTokenRepository = _
  private var aclDirective: AclDirective         = _
  private var provenance: ProvenanceService      = _
  private var fx: ProvenanceFixtures             = _
  private var pipelineRepo: PipelineRepository   = _
  private var nodeSnapshotRepo: NodeSnapshotRepository = _

  private val ownerId = UUID.randomUUID().toString
  private val owner   = AuthenticatedUser(UserId(ownerId))

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration").load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx = new DbContext(db, db)(routeEc)
    val dashboardRepo  = new DashboardRepository(ctx)(routeEc)
    panelRepo          = new PanelRepository(ctx)(routeEc)
    shareTokenRepo     = new ShareTokenRepository(ctx)(routeEc)
    val dataSourceRepo = new DataSourceRepository(ctx)(routeEc)
    pipelineRepo       = new PipelineRepository(ctx, dataSourceRepo)(routeEc)
    outputRepo         = new OutputRepository(ctx)(routeEc)
    nodeSnapshotRepo   = new NodeSnapshotRepository(ctx)(routeEc)
    val stepRepo       = new PipelineStepRepository(ctx)(routeEc)
    val rootRepo       = new PipelineRootRepository(ctx)(routeEc)
    val runRepo        = new PipelineRunRepository(ctx)(routeEc)
    val permissionRepo = new ResourcePermissionRepository(ctx)(routeEc)
    provenance = new ProvenanceService(outputRepo, pipelineRepo, stepRepo, rootRepo, dataSourceRepo, runRepo, nodeSnapshotRepo)(routeEc)
    fx = new ProvenanceFixtures(owner, dataSourceRepo, pipelineRepo, stepRepo, rootRepo, runRepo, nodeSnapshotRepo)(routeEc)
    val validator = new ShareTokenValidatorImpl(Some(shareTokenRepo))(routeEc)
    val registry = new ResourceTypeRegistry(
      AclResourceType("dashboard", id => dashboardRepo.findByIdInternal(DashboardId(id)).map(_.map(_.ownerId.value)))
    )
    aclDirective = new AclDirective(permissionRepo, registry, Some(validator))(routeEc)
    await(db.run({
      import PostgresProfile.api._
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($ownerId::uuid, ${s"owner-$ownerId@helio.test"}, now())"""
    }))
  }

  override def afterAll(): Unit = { db.close(); embeddedPostgres.close(); super.afterAll() }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def routes(): Route =
    new PublicDashboardRoutes(panelRepo, aclDirective, userOpt = None, outputRepo, Some(pipelineRepo), Some(nodeSnapshotRepo), Some(provenance))(typedSystem).routes

  private def seedDashboard(public: Boolean): String = {
    import PostgresProfile.api._
    val id = UUID.randomUUID().toString
    await(db.run(
      sqlu"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id)
               VALUES ($id, 'Dash', $ownerId, now(), now(),
                       '{"background":"transparent","gridBackground":"transparent"}',
                       '{"lg":[],"md":[],"sm":[],"xs":[]}', ${ownerId}::uuid)"""
    ))
    if (public)
      await(db.run(sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
                            VALUES ('dashboard', $id, NULL, 'viewer', now())"""))
    id
  }

  private def seedToken(dashboardId: String, raw: String): Unit =
    await(shareTokenRepo.insert(ShareToken(ShareTokenId(UUID.randomUUID().toString), DashboardId(dashboardId), UserId(ownerId), TokenHashing.sha256Hex(raw), None, None, Instant.now())))

  private def seedPanel(dashId: String, outputId: Option[String], kind: String = "output"): String = {
    import PostgresProfile.api._
    val panelId = UUID.randomUUID().toString
    await(db.run(
      sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, kind, output_id, owner_id)
               VALUES ($panelId, $dashId, 'P', $ownerId, now(), now(),
                       '{"background":"transparent","color":"inherit","transparency":0.0}',
                       $kind, ${outputId}, ${ownerId}::uuid)"""
    ))
    panelId
  }

  /** join fixture with a failed run carrying an errorLog, plus an assert node carrying `observed`. */
  private def seedRichOutput(): (String, PipelineId, Seq[String]) = {
    val b     = fx.newPipeline("Quarterly Pipeline", Vector("Sales DB", "Regions"))
    val extra = fx.newSource("Extra Source")
    val sa    = fx.filterStep(b.pipelineId, None, Some(b.roots(0)))
    val sb    = fx.filterStep(b.pipelineId, None, Some(b.roots(1)))
    val j     = fx.joinStep(b.pipelineId, sa.id, SecondaryInput.Lane(sb.id.value))
    val u     = fx.unionStep(b.pipelineId, j.id, SecondaryInput.Source(extra.id.value))
    val a     = fx.assertStep(b.pipelineId, Some(u.id))
    val out   = await(outputRepo.insertInternal(b.pipelineId, Some(a.id), owner.id, "Out", OutputKind.Table, explicitRootId = None))
    fx.snapshot(b.pipelineId, Some(a.id), None, rows = 4)
    fx.run(b.pipelineId, "failed", errorLog = Some("SECRET-ERRORLOG stack trace"), assertions = Seq(
      AssertionResult(a.id.value, "notNull", Some("amount"), "error", passed = false, observed = Some("SECRET-OBSERVED"), message = Some("SECRET-MESSAGE"))
    ))
    (out.id.value, b.pipelineId, b.sources.map(_.id.value) :+ extra.id.value)
  }

  "GET /dashboards/:dashboardId/panels/:panelId/provenance" should {
    "return EXACTLY the allowlisted keys at every level and leak nothing (field by field)" in {
      val dashId                    = seedDashboard(public = true)
      val (outId, pipelineId, srcIds) = seedRichOutput()
      val panelId                   = seedPanel(dashId, Some(outId))

      Get(s"/dashboards/$dashId/panels/$panelId/provenance") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val raw  = responseAs[String]
        val body = raw.parseJson.asJsObject
        body.fields.keySet shouldBe Set("pipeline", "sources", "nodePath", "lastRun", "assertions")
        body.fields("pipeline").asJsObject.fields shouldBe Map("name" -> JsString("Quarterly Pipeline"))
        val sources = body.fields("sources").convertTo[Vector[JsObject]]
        sources.map(_.fields.keySet).toSet shouldBe Set(Set("name", "kind"))
        sources.map(s => (s.fields("name"), s.fields("kind"))) shouldBe Vector(
          (JsString("Sales DB"), JsString("dataset")), (JsString("Regions"), JsString("dataset")), (JsString("Extra Source"), JsString("dataset"))
        )
        body.fields("nodePath") shouldBe JsArray(Vector("filter", "join", "union", "assert").map(JsString(_)))
        val lastRun = body.fields("lastRun").asJsObject
        lastRun.fields.keySet shouldBe Set("status", "completedAt", "rowCount")
        lastRun.fields("status") shouldBe JsString("failed")
        lastRun.fields("rowCount") shouldBe JsNumber(4)
        body.fields("assertions").asJsObject.fields shouldBe Map(
          "defined" -> JsBoolean(true), "passed" -> JsNumber(0), "failed" -> JsNumber(1), "warned" -> JsNumber(0)
        )
        // Values a key check alone would not catch: errorLog, observed, message, every id, ownerId.
        val forbidden = Seq("SECRET-ERRORLOG", "SECRET-OBSERVED", "SECRET-MESSAGE", "errorLog", "observed", "ownerId", "id", "Id", outId, pipelineId.value, ownerId) ++ srcIds
        forbidden.foreach(f => withClue(s"leak marker '$f': ") { raw should not include f })
      }
    }

    "a never-run pipeline yields lastRun: null (explicit)" in {
      val dashId = seedDashboard(public = true)
      val b      = fx.newPipeline("Never", Vector("S"))
      val s1     = fx.filterStep(b.pipelineId, None, Some(b.roots.head))
      val out    = await(outputRepo.insertInternal(b.pipelineId, Some(s1.id), owner.id, "O", OutputKind.Table, explicitRootId = None))
      val panelId = seedPanel(dashId, Some(out.id.value))
      Get(s"/dashboards/$dashId/panels/$panelId/provenance") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        responseAs[JsObject].fields("lastRun") shouldBe JsNull
      }
    }

    "404 for ANOTHER dashboard's panel requested under this dashboard" in {
      val dashA       = seedDashboard(public = true)
      val dashB       = seedDashboard(public = true)
      val (outId, _, _) = seedRichOutput()
      val panelOnB    = seedPanel(dashB, Some(outId))
      Get(s"/dashboards/$dashA/panels/$panelOnB/provenance") ~> routes() ~> check { status shouldBe StatusCodes.NotFound }
      Get(s"/dashboards/$dashB/panels/$panelOnB/provenance") ~> routes() ~> check { status shouldBe StatusCodes.OK }
    }

    "missing or invalid token on a private dashboard is denied exactly like output-meta; a valid token is allowed" in {
      val dashId  = seedDashboard(public = false)
      val (outId, _, _) = seedRichOutput()
      val panelId = seedPanel(dashId, Some(outId))
      val raw     = "tok-" + UUID.randomUUID()
      seedToken(dashId, raw)

      def statusAndBody(path: String): (StatusCode, String) = Get(path) ~> routes() ~> check { (status, responseAs[String]) }
      for (suffix <- Seq("", "?token=wrong-" + UUID.randomUUID())) {
        val prov = statusAndBody(s"/dashboards/$dashId/panels/$panelId/provenance$suffix")
        val meta = statusAndBody(s"/dashboards/$dashId/panels/$panelId/output-meta$suffix")
        prov._1 shouldBe StatusCodes.NotFound
        prov shouldBe meta
      }
      Get(s"/dashboards/$dashId/panels/$panelId/provenance?token=$raw") ~> routes() ~> check { status shouldBe StatusCodes.OK }
      // A valid token for ANOTHER dashboard does not open this one.
      val otherDash = seedDashboard(public = false)
      val otherRaw  = "tok-" + UUID.randomUUID()
      seedToken(otherDash, otherRaw)
      Get(s"/dashboards/$dashId/panels/$panelId/provenance?token=$otherRaw") ~> routes() ~> check { status shouldBe StatusCodes.NotFound }
    }

    "404 for a panel whose Output was deleted, a non-output panel, and a missing panel" in {
      val dashId = seedDashboard(public = true)
      val (outId, _, _) = seedRichOutput()
      val orphaned = seedPanel(dashId, Some(outId))
      await(outputRepo.deleteInternal(OutputId(outId)))
      val textPanel = seedPanel(dashId, None, kind = "text")
      Get(s"/dashboards/$dashId/panels/$orphaned/provenance") ~> routes() ~> check { status shouldBe StatusCodes.NotFound }
      Get(s"/dashboards/$dashId/panels/$textPanel/provenance") ~> routes() ~> check { status shouldBe StatusCodes.NotFound }
      Get(s"/dashboards/$dashId/panels/${UUID.randomUUID()}/provenance") ~> routes() ~> check { status shouldBe StatusCodes.NotFound }
    }
  }
}
