package com.helio.api.routes.dashboards

import com.helio.api._
import com.helio.api.http.{AclDirective, ResourceType => AclResourceType, ResourceTypeRegistry}
import com.helio.domain.model._
import com.helio.infrastructure.crypto.TokenHashing
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ResourcePermissionRepository
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputRepository, PipelineRepository}
import com.helio.infrastructure.persistence.sharing.ShareTokenRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.services.sharing.ShareTokenValidatorImpl
import spray.json._
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

import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-590 task 6.3: anonymous access to `PublicDashboardRoutes` via `?token=`. A valid token
 *  returns panels; expired/revoked/nonexistent/wrong-resource tokens, no token on a private
 *  dashboard, and a nonexistent dashboard id all collapse to the SAME response -- asserted by
 *  comparing the six responses to each other, never to a hardcoded literal, per the ticket's own
 *  evidence standard. */
class ShareTokenPublicAccessSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                   = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var dashboardRepo: DashboardRepository = _
  private var panelRepo: PanelRepository         = _
  private var shareTokenRepo: ShareTokenRepository = _
  private var aclDirective: AclDirective         = _
  // HEL-590 evaluation-2.md CR-A: needed to seed a real output-bound panel + pipeline run so the
  // non-zero-rows evidence is genuine, not just a status-code check.
  private var dataSourceRepo: DataSourceRepository     = _
  private var pipelineRepo: PipelineRepository         = _
  private var outputRepo: OutputRepository             = _
  private var nodeSnapshotRepo: NodeSnapshotRepository = _

  private val ownerId = UUID.randomUUID().toString
  private val owner   = AuthenticatedUser(UserId(ownerId))

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx = new DbContext(db, db)(routeEc)

    dashboardRepo  = new DashboardRepository(ctx)(routeEc)
    panelRepo      = new PanelRepository(ctx)(routeEc)
    shareTokenRepo = new ShareTokenRepository(ctx)(routeEc)
    dataSourceRepo   = new DataSourceRepository(ctx)(routeEc)
    pipelineRepo     = new PipelineRepository(ctx, dataSourceRepo)(routeEc)
    outputRepo       = new OutputRepository(ctx)(routeEc)
    nodeSnapshotRepo = new NodeSnapshotRepository(ctx)(routeEc)
    val permissionRepo = new ResourcePermissionRepository(ctx)(routeEc)
    val validator       = new ShareTokenValidatorImpl(Some(shareTokenRepo))(routeEc)

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
    new PublicDashboardRoutes(
      panelRepo,
      aclDirective,
      userOpt = None,
      Some(outputRepo),
      Some(pipelineRepo),
      Some(nodeSnapshotRepo)
    )(typedSystem).routes

  private def seedPrivateDashboard(): String = {
    import PostgresProfile.api._
    val id = UUID.randomUUID().toString
    await(db.run(
      sqlu"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id)
             VALUES ($id, 'Private Dashboard', $ownerId, now(), now(),
                     '{"background":"transparent","gridBackground":"transparent"}',
                     '{"lg":[],"md":[],"sm":[],"xs":[]}', ${ownerId}::uuid)"""
    ))
    id
  }

  /** HEL-590 evaluation-2.md CR-A: a real panel row, seeded with no `resource_permissions` grant
   *  of any kind -- the ONLY thing that can authorize its read is the share token itself. */
  private def seedTextPanel(dashId: String, title: String): String = {
    import PostgresProfile.api._
    val panelId = UUID.randomUUID().toString
    await(db.run(
      sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, kind, owner_id)
             VALUES ($panelId, $dashId, $title, $ownerId, now(), now(),
                     '{"background":"transparent","color":"inherit","transparency":0.0}',
                     'text', ${ownerId}::uuid)"""
    ))
    panelId
  }

  /** Real source -> pipeline -> Output -> panel chain with materialized rows, so the `/rows`
   *  non-zero evidence is genuine data flowing through the real read path, not a status code. */
  private def seedOutputPanelWithRows(dashId: String): String = {
    val now    = Instant.now()
    val source = StaticSource(DataSourceId(UUID.randomUUID().toString), "src", owner.id, now, now)
    val createdSource = await(dataSourceRepo.insert(source, owner))
    val pipeline = await(pipelineRepo.create("pipe", Vector(createdSource.id), owner)).getOrElse(
      throw new IllegalStateException("seedOutputPanelWithRows fixture: pipeline create failed")
    )
    val pipelineId = PipelineId(pipeline.id)
    val output = await(outputRepo.insertInternal(pipelineId, None, owner.id, "Output", OutputKind.Table, explicitRootId = None))
    await(nodeSnapshotRepo.overwriteRows(pipelineId.value, None, Seq(JsObject("a" -> JsString("1"))), explicitRootId = None))

    import PostgresProfile.api._
    val panelId = UUID.randomUUID().toString
    await(db.run(
      sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, kind, output_id, owner_id)
             VALUES ($panelId, $dashId, 'Output Panel', $ownerId, now(), now(),
                     '{"background":"transparent","color":"inherit","transparency":0.0}',
                     'output', ${output.id.value}, ${ownerId}::uuid)"""
    ))
    panelId
  }

  private def seedToken(
      dashboardId: String,
      rawToken: String,
      expiresAt: Option[Instant] = None,
      revokedAt: Option[Instant] = None
  ): Unit =
    await(shareTokenRepo.insert(
      ShareToken(
        id          = ShareTokenId(UUID.randomUUID().toString),
        dashboardId = DashboardId(dashboardId),
        userId      = UserId(ownerId),
        tokenHash   = TokenHashing.sha256Hex(rawToken),
        expiresAt   = expiresAt,
        revokedAt   = revokedAt,
        createdAt   = Instant.now()
      )
    ))

  "GET /dashboards/:id/panels?token=..." should {

    // HEL-590 evaluation-2.md CR-A: this is the exact test that would have failed throughout
    // cycles 1 and 2 -- the route returned `200 {"items":[],...}` for a valid token because
    // `PanelRepository.findAllByDashboardId` re-derived access from `userOpt` alone (owner /
    // grantee / public-viewer-grant), none of which a token satisfies. Asserting only `status
    // shouldBe OK` (the old assertion) cannot catch that; asserting the actual panel data can.
    "return the dashboard's actual panels for a valid token, on a dashboard with NO public-viewer grant" in {
      val dashId = seedPrivateDashboard()
      seedTextPanel(dashId, "Revenue")
      seedTextPanel(dashId, "Costs")
      val raw = "valid-" + UUID.randomUUID()
      seedToken(dashId, raw)

      Get(s"/dashboards/$dashId/panels?token=$raw") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val items = responseAs[JsObject].fields("items").convertTo[Vector[JsObject]]
        items should have size 2
        items.map(_.fields("title").convertTo[String]) should contain allOf ("Revenue", "Costs")
      }
    }

    "return panels for a valid token" in {
      val dashId = seedPrivateDashboard()
      val raw    = "valid-" + UUID.randomUUID()
      seedToken(dashId, raw)

      Get(s"/dashboards/$dashId/panels?token=$raw") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
      }
    }

    "expired, revoked, nonexistent, and wrong-resource tokens -- plus no token at all, plus a nonexistent " +
      "dashboard id -- all produce byte-identical status and body" in {
      val dashId      = seedPrivateDashboard()
      val otherDashId = seedPrivateDashboard()

      val expiredRaw = "expired-" + UUID.randomUUID()
      seedToken(dashId, expiredRaw, expiresAt = Some(Instant.now().minus(1, ChronoUnit.HOURS)))

      val revokedRaw = "revoked-" + UUID.randomUUID()
      seedToken(dashId, revokedRaw, revokedAt = Some(Instant.now()))

      val wrongResourceRaw = "wrong-resource-" + UUID.randomUUID()
      seedToken(otherDashId, wrongResourceRaw)

      val nonexistentToken = "never-minted-" + UUID.randomUUID()
      val nonexistentDashId = UUID.randomUUID().toString

      def responseFor(url: String): (StatusCodes.NotFound.type, String) = {
        Get(url) ~> routes() ~> check {
          status shouldBe StatusCodes.NotFound
          (StatusCodes.NotFound, responseAs[String])
        }
      }

      val bodies = Vector(
        responseFor(s"/dashboards/$dashId/panels?token=$expiredRaw"),
        responseFor(s"/dashboards/$dashId/panels?token=$revokedRaw"),
        responseFor(s"/dashboards/$dashId/panels?token=$nonexistentToken"),
        responseFor(s"/dashboards/$dashId/panels?token=$wrongResourceRaw"),
        responseFor(s"/dashboards/$dashId/panels"),
        responseFor(s"/dashboards/$nonexistentDashId/panels")
      ).map(_._2)

      // Compare every response to every other -- never to a hardcoded literal (ticket's own
      // evidence standard) -- proving indistinguishability as a relation, not an assertion about
      // one fixed expected string that all six happen to also match.
      bodies.distinct should have size 1
    }
  }

  "GET /dashboards/:dashboardId/panels/:panelId/rows?token=..." should {

    // HEL-590 evaluation-2.md CR-A: `resolveRows` has the identical defect via the same
    // `findAllByDashboardId(..., userOpt, ...)` call -- a token holder previously got zero panels
    // back from that lookup and therefore always hit the `Panel not found` branch, i.e. every
    // rows request 404'd regardless of a valid token. Asserts real, non-empty row data.
    "return the panel's actual rows for a valid token, on a dashboard with NO public-viewer grant" in {
      val dashId  = seedPrivateDashboard()
      val panelId = seedOutputPanelWithRows(dashId)
      val raw     = "valid-rows-" + UUID.randomUUID()
      seedToken(dashId, raw)

      Get(s"/dashboards/$dashId/panels/$panelId/rows?token=$raw") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val items = responseAs[JsObject].fields("items").convertTo[Vector[JsObject]]
        items should have size 1
        items.head.fields("a") shouldBe JsString("1")
      }
    }
  }
}
