package com.helio.api.routes.dashboards

import com.helio.api.JsonProtocols
import com.helio.api.http.{AclDirective, ResourceType => AclResourceType, ResourceTypeRegistry}
import com.helio.api.protocols.panels.{PanelResponse, PanelsResponse}
import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ResourcePermissionRepository
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputRepository, PipelineRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
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

/** HEL-906 cycle 6 (evaluation-5.md CR6): `GET /api/dashboards/:id/panels` returning `dataAsOf`
 *  for an Output-backed placement via the NEW `panel -> output -> pipeline.lastRunAt` path,
 *  rewired in `PublicDashboardRoutes` after HEL-904 task 4.1 dropped the old
 *  `dataTypeId`-keyed lookup outright. */
class PublicDashboardRoutesSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                   = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres   = _
  private var db: JdbcBackend.Database             = _
  private var ctx: DbContext                       = _
  private var dashboardRepo: DashboardRepository   = _
  private var panelRepo: PanelRepository           = _
  private var dataSourceRepo: DataSourceRepository = _
  private var pipelineRepo: PipelineRepository     = _
  private var outputRepo: OutputRepository         = _
  private var nodeSnapshotRepo: NodeSnapshotRepository = _
  private var permissionRepo: ResourcePermissionRepository = _
  private var aclDirective: AclDirective           = _

  private val ownerId = UUID.randomUUID().toString
  private val owner   = AuthenticatedUser(UserId(ownerId))

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    ctx = new DbContext(db, db)(routeEc)

    dashboardRepo  = new DashboardRepository(ctx)(routeEc)
    panelRepo      = new PanelRepository(ctx)(routeEc)
    dataSourceRepo = new DataSourceRepository(ctx)(routeEc)
    pipelineRepo   = new PipelineRepository(ctx, dataSourceRepo)(routeEc)
    outputRepo     = new OutputRepository(ctx)(routeEc)
    nodeSnapshotRepo = new NodeSnapshotRepository(ctx)(routeEc)
    permissionRepo = new ResourcePermissionRepository(ctx)(routeEc)

    val registry = new ResourceTypeRegistry(
      AclResourceType("dashboard", id => dashboardRepo.findByIdInternal(DashboardId(id)).map(_.map(_.ownerId.value)))
    )
    aclDirective = new AclDirective(permissionRepo, registry)(routeEc)

    await(db.run({
      import PostgresProfile.api._
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($ownerId::uuid, ${s"owner-$ownerId@helio.test"}, now())"""
    }))
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def routes(): Route =
    new PublicDashboardRoutes(panelRepo, aclDirective, userOpt = None, Some(outputRepo), Some(pipelineRepo), Some(nodeSnapshotRepo))(typedSystem).routes

  private def seedDashboardWithPublicGrant(): String = {
    import PostgresProfile.api._
    val id = UUID.randomUUID().toString
    await(db.run(
      sqlu"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id)
               VALUES ($id, 'Public Dashboard', $ownerId, now(), now(),
                       '{"background":"transparent","gridBackground":"transparent"}',
                       '{"lg":[],"md":[],"sm":[],"xs":[]}', ${ownerId}::uuid)"""
    ))
    await(db.run(
      sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
               VALUES ('dashboard', $id, NULL, 'viewer', now())"""
    ))
    id
  }

  /** Real source -> pipeline chain with a real, non-null `last_run_at` stamped directly
   *  (mirrors what `PipelineRunService.onRunSuccess` would set on a real successful run,
   *  without needing to run the whole engine for this route-level test). */
  private def newPipelineWithLastRunAt(lastRunAt: Instant): PipelineId = {
    val now    = Instant.now()
    val source = StaticSource(DataSourceId(UUID.randomUUID().toString), "src", owner.id, now, now)
    val createdSource = await(dataSourceRepo.insert(source, owner))
    val pipeline = await(pipelineRepo.create("pipe", Vector(createdSource.id), owner)).getOrElse(
      throw new IllegalStateException("newPipelineWithLastRunAt fixture: pipeline create failed")
    )
    val pipelineId = PipelineId(pipeline.id)
    import PostgresProfile.api._
    await(db.run(sqlu"UPDATE pipelines SET last_run_at = ${java.sql.Timestamp.from(lastRunAt)} WHERE id = ${pipelineId.value}"))
    pipelineId
  }

  private def seedOutputPanel(dashId: String, pipelineId: PipelineId): String = {
    val output = await(outputRepo.insertInternal(pipelineId, None, owner.id, "Public Output", OutputKind.Table, explicitRootId = None))
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

  "GET /dashboards/:id/panels" should {
    "return dataAsOf = the bound pipeline's lastRunAt for an Output-backed placement" in {
      val dashId       = seedDashboardWithPublicGrant()
      val lastRunAt    = Instant.parse("2026-08-30T12:00:00Z")
      val pipelineId   = newPipelineWithLastRunAt(lastRunAt)
      seedOutputPanel(dashId, pipelineId)

      Get(s"/dashboards/$dashId/panels") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val items = responseAs[JsObject].fields("items").convertTo[Vector[PanelResponse]]
        items should have size 1
        items.head.`type` shouldBe "output"
        items.head.dataAsOf shouldBe Some(lastRunAt.toString)
      }
    }

    "return dataAsOf = None for a non-Output panel kind (unchanged pre-existing behaviour)" in {
      val dashId = seedDashboardWithPublicGrant()
      import PostgresProfile.api._
      val panelId = UUID.randomUUID().toString
      await(db.run(
        sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, kind, owner_id)
                 VALUES ($panelId, $dashId, 'Text Panel', $ownerId, now(), now(),
                         '{"background":"transparent","color":"inherit","transparency":0.0}',
                         'text', ${ownerId}::uuid)"""
      ))

      Get(s"/dashboards/$dashId/panels") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val items = responseAs[JsObject].fields("items").convertTo[Vector[PanelResponse]]
        items should have size 1
        items.head.dataAsOf shouldBe None
      }
    }

    "return dataAsOf = None for an Output-backed placement whose pipeline has not run yet" in {
      val dashId     = seedDashboardWithPublicGrant()
      val now        = Instant.now()
      val source     = StaticSource(DataSourceId(UUID.randomUUID().toString), "src2", owner.id, now, now)
      val createdSrc = await(dataSourceRepo.insert(source, owner))
      val pipeline   = await(pipelineRepo.create("pipe-no-run", Vector(createdSrc.id), owner)).getOrElse(
        throw new IllegalStateException("fixture: pipeline create failed")
      )
      seedOutputPanel(dashId, PipelineId(pipeline.id))

      Get(s"/dashboards/$dashId/panels") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val items = responseAs[JsObject].fields("items").convertTo[Vector[PanelResponse]]
        items.head.dataAsOf shouldBe None
      }
    }
  }

  /** HEL-910 task 1.1/1.2: `GET /dashboards/:dashboardId/panels/:panelId/rows` -- the public
   *  path's row-data gap this ticket closes (see design.md Context). */
  "GET /dashboards/:dashboardId/panels/:panelId/rows" should {
    "return rows for a shared dashboard's output panel with no auth header" in {
      val dashId     = seedDashboardWithPublicGrant()
      val pipelineId = newPipelineWithLastRunAt(Instant.now())
      val panelId    = seedOutputPanel(dashId, pipelineId)
      await(nodeSnapshotRepo.overwriteRows(pipelineId.value, None, Seq(JsObject("a" -> JsString("1"))), explicitRootId = None))

      Get(s"/dashboards/$dashId/panels/$panelId/rows") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val items = responseAs[JsObject].fields("items").convertTo[Vector[JsObject]]
        items should have size 1
        items.head.fields("a") shouldBe JsString("1")
      }
    }

    "return an authorization error for a non-shared dashboard" in {
      import PostgresProfile.api._
      val dashId = UUID.randomUUID().toString
      await(db.run(
        sqlu"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id)
                 VALUES ($dashId, 'Private Dashboard', $ownerId, now(), now(),
                         '{"background":"transparent","gridBackground":"transparent"}',
                         '{"lg":[],"md":[],"sm":[],"xs":[]}', ${ownerId}::uuid)"""
      ))
      val pipelineId = newPipelineWithLastRunAt(Instant.now())
      val panelId    = seedOutputPanel(dashId, pipelineId)

      Get(s"/dashboards/$dashId/panels/$panelId/rows") ~> routes() ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    // HEL-910 final-gate CR2: `resolveRows` deliberately uses `findAllByDashboardId` (which
    // proves the panel belongs to THIS dashboard) rather than an unscoped `findByIdInternal`
    // lookup -- but nothing previously asserted that a panel from a DIFFERENT dashboard is
    // rejected. This is exactly the plausible future refactor that would silently open
    // cross-tenant row leakage on an unauthenticated route with every other test still green.
    "return not-found for a panelId that belongs to a DIFFERENT dashboard than the one in the URL" in {
      val sharedDashId  = seedDashboardWithPublicGrant()
      val otherDashId   = seedDashboardWithPublicGrant()
      val pipelineId    = newPipelineWithLastRunAt(Instant.now())
      val otherPanelId  = seedOutputPanel(otherDashId, pipelineId)
      await(nodeSnapshotRepo.overwriteRows(pipelineId.value, None, Seq(JsObject("a" -> JsString("1"))), explicitRootId = None))

      // otherPanelId genuinely resolves rows on ITS OWN (also-shared) dashboard...
      Get(s"/dashboards/$otherDashId/panels/$otherPanelId/rows") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val items = responseAs[JsObject].fields("items").convertTo[Vector[JsObject]]
        items should have size 1
      }
      // ...but requesting it against a DIFFERENT dashboard's URL must be rejected, not silently
      // served -- proving cross-dashboard confinement rather than assuming it from the ACL check
      // alone (the ACL only proves sharedDashId is visible, not that otherPanelId belongs to it).
      Get(s"/dashboards/$sharedDashId/panels/$otherPanelId/rows") ~> routes() ~> check {
        status shouldBe StatusCodes.NotFound
        responseAs[String] should include("Panel not found")
      }
    }

    "return an empty rows result (not a 500) when the panel's Output/pipeline no longer resolves" in {
      val dashId  = seedDashboardWithPublicGrant()
      import PostgresProfile.api._
      val panelId = UUID.randomUUID().toString
      await(db.run(
        sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, kind, owner_id)
                 VALUES ($panelId, $dashId, 'Text Panel', $ownerId, now(), now(),
                         '{"background":"transparent","color":"inherit","transparency":0.0}',
                         'text', ${ownerId}::uuid)"""
      ))

      Get(s"/dashboards/$dashId/panels/$panelId/rows") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val items = responseAs[JsObject].fields("items").convertTo[Vector[JsObject]]
        items shouldBe empty
      }
    }
  }
}
