package com.helio.api.routes.dashboards

import com.helio.api.JsonProtocols
import com.helio.api.http.{AclDirective, ResourceType => AclResourceType, ResourceTypeRegistry}
import com.helio.api.protocols.panels.{PanelResponse, PanelsResponse}
import com.helio.domain.engine.SchemaField
import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ResourcePermissionRepository
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputRepository, PipelineRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.testkit.HelioRouteTest
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.net.URLEncoder
import java.sql.Timestamp
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
    with HelioRouteTest
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
    new PublicDashboardRoutes(panelRepo, aclDirective, userOpt = None, outputRepo, Some(pipelineRepo), Some(nodeSnapshotRepo))(typedSystem).routes

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
   *  (mirrors what `PipelineRunExecutor.onRunSuccess` would set on a real successful run,
   *  without needing to run the whole engine for this route-level test). */
  private def newPipelineWithLastRunAt(lastRunAt: Instant): PipelineId = {
    val now    = Instant.now()
    val source = DatasetSource(DataSourceId(UUID.randomUUID().toString), "src", owner.id, now, now)
    val createdSource = await(dataSourceRepo.insert(source, owner))
    val pipeline = await(pipelineRepo.create("pipe", Vector(createdSource.id), owner)).getOrElse(
      throw new IllegalStateException("newPipelineWithLastRunAt fixture: pipeline create failed")
    )
    val pipelineId = PipelineId(pipeline.id)
    import PostgresProfile.api._
    await(db.run(sqlu"UPDATE pipelines SET last_run_at = ${Timestamp.from(lastRunAt)} WHERE id = ${pipelineId.value}"))
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

  /** HEL-1189 design.md D5 — an Output panel seeded WITH a `controls` list, bound to `column` on
   *  an Output whose declared `schema` starts as `[{column: TimestampType}]` (eligible for the
   *  seeded date-range control). Returns the Output's id so a test can drift its schema via
   *  `outputRepo.updateSchemaInternal` afterward. */
  private def seedOutputPanelWithDateRangeControl(dashId: String, pipelineId: PipelineId, column: String): (String, OutputId) = {
    val output = await(outputRepo.insertInternal(
      pipelineId, None, owner.id, "Controls Output", OutputKind.Table,
      schema = Vector(SchemaField(column, "timestamp")),
      explicitRootId = None
    ))
    import PostgresProfile.api._
    val panelId = UUID.randomUUID().toString
    val controlsJson = s"""[{"id":"c1","kind":"date-range","column":"$column","label":"Date"}]"""
    await(db.run(
      sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, kind, output_id, output_controls, owner_id)
               VALUES ($panelId, $dashId, 'Controls Panel', $ownerId, now(), now(),
                       '{"background":"transparent","color":"inherit","transparency":0.0}',
                       'output', ${output.id.value}, $controlsJson::jsonb, ${ownerId}::uuid)"""
    ))
    (panelId, output.id)
  }

  private def firstControlOrphaned(items: Vector[PanelResponse]): Boolean =
    items.head.config.asJsObject.fields("controls").convertTo[Vector[JsObject]].head.fields("orphaned").convertTo[Boolean]

  /** HEL-1190 design.md D5/D6 (owner ruling C11) — a panel with exactly ONE configured control
   *  (`dropdown` bound to `region`), on an Output whose schema ALSO declares `amount` (integer) —
   *  eq/in AND gte/lte eligible on its own, low-cardinality, but deliberately NOT named by any
   *  control on this panel. Every test below that asserts a non-control-column rejection uses
   *  `amount` specifically so the rejection is proven against a column that would otherwise be
   *  served by the authenticated Output-scoped route family — never a column that's rejected for some
   *  OTHER reason (ineligible type, absent from schema). */
  private def seedOutputPanelWithDropdownControl(dashId: String, pipelineId: PipelineId): (String, OutputId) = {
    val output = await(outputRepo.insertInternal(
      pipelineId, None, owner.id, "Dropdown Output", OutputKind.Table,
      schema = Vector(SchemaField("region", "string"), SchemaField("amount", "integer")),
      explicitRootId = None
    ))
    import PostgresProfile.api._
    val panelId = UUID.randomUUID().toString
    await(db.run(
      sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, kind, output_id, output_controls, owner_id)
               VALUES ($panelId, $dashId, 'Dropdown Panel', $ownerId, now(), now(),
                       '{"background":"transparent","color":"inherit","transparency":0.0}',
                       'output', ${output.id.value},
                       '[{"id":"c1","kind":"dropdown","column":"region","label":"Region"}]'::jsonb, ${ownerId}::uuid)"""
    ))
    (panelId, output.id)
  }

  private def encodeFilter(json: String): String = URLEncoder.encode(json, "UTF-8")

  "GET /dashboards/:id/panels" should {
    "HEL-1197: omit ownerId from the anonymous panel list wire (raw JSON key absent)" in {
      val dashId     = seedDashboardWithPublicGrant()
      val pipelineId = newPipelineWithLastRunAt(Instant.now())
      seedOutputPanel(dashId, pipelineId)

      Get(s"/dashboards/$dashId/panels") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val rawItems = responseAs[JsObject].fields("items").convertTo[Vector[JsObject]]
        rawItems should have size 1
        rawItems.head.fields.keySet should not contain "ownerId"
        // HEL-1216: `meta.createdBy` (the creator's user id) is omitted too.
        rawItems.head.fields("meta").asJsObject.fields.keySet should not contain "createdBy"
      }
    }

    "HEL-1216: an AUTHENTICATED non-owner Viewer grantee does NOT receive ownerId or meta.createdBy (superseding HEL-1197)" in {
      val dashId     = seedDashboardWithPublicGrant()
      val pipelineId = newPipelineWithLastRunAt(Instant.now())
      seedOutputPanel(dashId, pipelineId)
      val viewer = AuthenticatedUser(UserId(UUID.randomUUID().toString))
      import PostgresProfile.api._
      await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES (${viewer.id.value}::uuid, ${s"viewer-${viewer.id.value}@helio.test"}, now())"""))
      await(permissionRepo.insert(ResourcePermission("dashboard", dashId, Some(viewer.id), Role.Viewer, Instant.now())))
      val authedRoutes =
        new PublicDashboardRoutes(panelRepo, aclDirective, userOpt = Some(viewer), outputRepo, Some(pipelineRepo), Some(nodeSnapshotRepo))(typedSystem).routes

      Get(s"/dashboards/$dashId/panels") ~> authedRoutes ~> check {
        status shouldBe StatusCodes.OK
        val item = responseAs[JsObject].fields("items").convertTo[Vector[JsObject]].head
        item.fields.keySet should not contain "ownerId"
        item.fields("meta").asJsObject.fields.keySet should not contain "createdBy"
      }
    }

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
      val source     = DatasetSource(DataSourceId(UUID.randomUUID().toString), "src2", owner.id, now, now)
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

    // HEL-1189 design.md D5 / evaluation-1.md CR1 — the panel-READ path (this route) is where
    // `output-panel-placement`'s Requirement 3 ("reported as orphaned wherever the panel's
    // controls are read") is actually enforced. Both AC drift scenarios covered: column removed
    // from the schema entirely, and column retyped so it no longer fits the control's kind.
    "reports orphaned: false for a control whose bound column is still eligible" in {
      val dashId   = seedDashboardWithPublicGrant()
      val pipeline = await(pipelineRepo.create(
        "controls-pipe",
        Vector(await(dataSourceRepo.insert(DatasetSource(DataSourceId(UUID.randomUUID().toString), "src-controls", owner.id, Instant.now(), Instant.now()), owner)).id),
        owner
      )).getOrElse(throw new IllegalStateException("fixture: pipeline create failed"))
      seedOutputPanelWithDateRangeControl(dashId, PipelineId(pipeline.id), "created_at")

      Get(s"/dashboards/$dashId/panels") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val items = responseAs[JsObject].fields("items").convertTo[Vector[PanelResponse]]
        firstControlOrphaned(items) shouldBe false
      }
    }

    "reports orphaned: true after the bound column is removed from the Output's schema" in {
      val dashId   = seedDashboardWithPublicGrant()
      val pipeline = await(pipelineRepo.create(
        "controls-pipe-removed",
        Vector(await(dataSourceRepo.insert(DatasetSource(DataSourceId(UUID.randomUUID().toString), "src-removed", owner.id, Instant.now(), Instant.now()), owner)).id),
        owner
      )).getOrElse(throw new IllegalStateException("fixture: pipeline create failed"))
      val (_, outputId) = seedOutputPanelWithDateRangeControl(dashId, PipelineId(pipeline.id), "created_at")

      // Schema drift: the column the control was bound to is dropped from the Output entirely.
      await(outputRepo.updateSchemaInternal(outputId, Vector.empty))

      Get(s"/dashboards/$dashId/panels") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val items = responseAs[JsObject].fields("items").convertTo[Vector[PanelResponse]]
        firstControlOrphaned(items) shouldBe true
      }
    }

    "reports orphaned: true after the bound column is retyped to no longer fit the control's kind" in {
      val dashId   = seedDashboardWithPublicGrant()
      val pipeline = await(pipelineRepo.create(
        "controls-pipe-retyped",
        Vector(await(dataSourceRepo.insert(DatasetSource(DataSourceId(UUID.randomUUID().toString), "src-retyped", owner.id, Instant.now(), Instant.now()), owner)).id),
        owner
      )).getOrElse(throw new IllegalStateException("fixture: pipeline create failed"))
      val (_, outputId) = seedOutputPanelWithDateRangeControl(dashId, PipelineId(pipeline.id), "created_at")

      // Schema drift: "created_at" survives but is no longer a timestamp column, so the
      // date-range control (Gte+Lte AND type = timestamp, design.md D3) no longer fits it.
      await(outputRepo.updateSchemaInternal(outputId, Vector(SchemaField("created_at", "string"))))

      Get(s"/dashboards/$dashId/panels") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val items = responseAs[JsObject].fields("items").convertTo[Vector[PanelResponse]]
        firstControlOrphaned(items) shouldBe true
      }
    }

    // evaluation-1.md CR2 — genuine end-to-end coverage of the refactored `dropdown` branch
    // (`OutputControlsValidator.resolveOperators` -> a REAL `eqInEligibleColumn` cardinality scan
    // -> `OutputControlEligibility.kindsFor`), not just the pure-function `kindsFor` coverage
    // `OutputControlEligibilitySpec` already has. Low real cardinality (2 distinct values, well
    // under the 50 cap) on a real `node_snapshots` row set -> eq/in-eligible -> not orphaned.
    "reports orphaned: false for a dropdown control whose real cardinality is low (real eq/in scan, not just schema/type)" in {
      val dashId   = seedDashboardWithPublicGrant()
      val pipeline = await(pipelineRepo.create(
        "controls-pipe-dropdown",
        Vector(await(dataSourceRepo.insert(DatasetSource(DataSourceId(UUID.randomUUID().toString), "src-dropdown", owner.id, Instant.now(), Instant.now()), owner)).id),
        owner
      )).getOrElse(throw new IllegalStateException("fixture: pipeline create failed"))
      val pipelineId = PipelineId(pipeline.id)
      val output = await(outputRepo.insertInternal(
        pipelineId, None, owner.id, "Dropdown Output", OutputKind.Table,
        schema = Vector(SchemaField("region", "string")),
        explicitRootId = None
      ))
      import PostgresProfile.api._
      val panelId = UUID.randomUUID().toString
      await(db.run(
        sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, kind, output_id, output_controls, owner_id)
                 VALUES ($panelId, $dashId, 'Dropdown Panel', $ownerId, now(), now(),
                         '{"background":"transparent","color":"inherit","transparency":0.0}',
                         'output', ${output.id.value},
                         '[{"id":"c1","kind":"dropdown","column":"region","label":"Region"}]'::jsonb, ${ownerId}::uuid)"""
      ))
      await(nodeSnapshotRepo.overwriteRows(
        pipelineId.value, None,
        Seq(JsObject("region" -> JsString("east")), JsObject("region" -> JsString("west"))),
        explicitRootId = None
      ))

      Get(s"/dashboards/$dashId/panels") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val items = responseAs[JsObject].fields("items").convertTo[Vector[PanelResponse]]
        firstControlOrphaned(items) shouldBe false
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

    // HEL-1190 design.md D5/D6 (owner ruling C11, task 1.2/1.3) — the public rows route's NEW
    // sort/filter support. Red-first: before this ticket, `sort`/`filter` were not accepted
    // params on this route at all, so a `filter=` naming ANY column (control or not) was silently
    // ignored and every row came back unfiltered — this test would have failed pre-fix both by
    // returning the wrong (unfiltered) row count for the first case and by returning 200 (not
    // 400) for the second.
    "narrow the result via filter= on a column that IS one of the panel's own configured controls" in {
      val dashId     = seedDashboardWithPublicGrant()
      val pipelineId = newPipelineWithLastRunAt(Instant.now())
      val (panelId, _) = seedOutputPanelWithDropdownControl(dashId, pipelineId)
      await(nodeSnapshotRepo.overwriteRows(
        pipelineId.value, None,
        Seq(
          JsObject("region" -> JsString("east"), "amount" -> JsNumber(10)),
          JsObject("region" -> JsString("west"), "amount" -> JsNumber(20))
        ),
        explicitRootId = None
      ))

      val filter = encodeFilter("""{"ops":[{"column":"region","op":"eq","value":"east"}]}""")
      Get(s"/dashboards/$dashId/panels/$panelId/rows?filter=$filter") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val items = responseAs[JsObject].fields("items").convertTo[Vector[JsObject]]
        items should have size 1
        items.head.fields("region") shouldBe JsString("east")
      }
    }

    "reject a filter= naming a column that is Output-eligible but NOT one of the panel's own configured controls" in {
      val dashId     = seedDashboardWithPublicGrant()
      val pipelineId = newPipelineWithLastRunAt(Instant.now())
      val (panelId, _) = seedOutputPanelWithDropdownControl(dashId, pipelineId)
      await(nodeSnapshotRepo.overwriteRows(
        pipelineId.value, None,
        Seq(JsObject("region" -> JsString("east"), "amount" -> JsNumber(10))),
        explicitRootId = None
      ))

      // "amount" is a real, gte-eligible Output column -- just not a control on THIS panel.
      val filter = encodeFilter("""{"ops":[{"column":"amount","op":"gte","value":"5"}]}""")
      Get(s"/dashboards/$dashId/panels/$panelId/rows?filter=$filter") ~> routes() ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[String] should include("amount")
      }
    }

    "reject a quick filter, which would match across non-control columns" in {
      val dashId       = seedDashboardWithPublicGrant()
      val pipelineId   = newPipelineWithLastRunAt(Instant.now())
      val (panelId, _) = seedOutputPanelWithDropdownControl(dashId, pipelineId)
      await(nodeSnapshotRepo.overwriteRows(pipelineId.value, None, Seq(JsObject("region" -> JsString("east"), "amount" -> JsNumber(10))), explicitRootId = None))
      Get(s"/dashboards/$dashId/panels/$panelId/rows?filter=${encodeFilter("""{"quick":"10"}""")}") ~> routes() ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }

    "reject a sort on a column that is not one of the panel's control columns, and allow a control column" in {
      val dashId       = seedDashboardWithPublicGrant()
      val pipelineId   = newPipelineWithLastRunAt(Instant.now())
      val (panelId, _) = seedOutputPanelWithDropdownControl(dashId, pipelineId)
      await(nodeSnapshotRepo.overwriteRows(pipelineId.value, None, Seq(JsObject("region" -> JsString("east"), "amount" -> JsNumber(10))), explicitRootId = None))
      Get(s"/dashboards/$dashId/panels/$panelId/rows?sort=amount:asc") ~> routes() ~> check {
        status shouldBe StatusCodes.BadRequest
      }
      Get(s"/dashboards/$dashId/panels/$panelId/rows?sort=region:asc") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
      }
    }
  }

  /** HEL-1190 design.md D5 (task 2.1) — panel-scoped `filter-capabilities`, mounted alongside
   *  `.../rows` on the same optional-auth tree. */
  "GET /dashboards/:dashboardId/panels/:panelId/filter-capabilities" should {
    "report only the panel's own configured control columns, even when another Output column is independently eq/in-eligible" in {
      val dashId       = seedDashboardWithPublicGrant()
      val pipelineId   = newPipelineWithLastRunAt(Instant.now())
      val (panelId, _) = seedOutputPanelWithDropdownControl(dashId, pipelineId)
      await(nodeSnapshotRepo.overwriteRows(
        pipelineId.value, None,
        Seq(
          JsObject("region" -> JsString("east"), "amount" -> JsNumber(10)),
          JsObject("region" -> JsString("west"), "amount" -> JsNumber(20))
        ),
        explicitRootId = None
      ))

      Get(s"/dashboards/$dashId/panels/$panelId/filter-capabilities") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val columns = responseAs[JsObject].fields("columns").convertTo[Vector[JsObject]].map(_.fields("column").convertTo[String])
        columns shouldBe Vector("region")
      }
    }

    "return an authorization error for a non-shared dashboard, identically to rows" in {
      import PostgresProfile.api._
      val dashId = UUID.randomUUID().toString
      await(db.run(
        sqlu"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id)
                 VALUES ($dashId, 'Private Dashboard 2', $ownerId, now(), now(),
                         '{"background":"transparent","gridBackground":"transparent"}',
                         '{"lg":[],"md":[],"sm":[],"xs":[]}', ${ownerId}::uuid)"""
      ))
      val pipelineId    = newPipelineWithLastRunAt(Instant.now())
      val (panelId, _)  = seedOutputPanelWithDropdownControl(dashId, pipelineId)

      Get(s"/dashboards/$dashId/panels/$panelId/filter-capabilities") ~> routes() ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
  }

  /** HEL-1190 design.md D5 (task 2.2) — panel-scoped `distinct-values`, same gate as
   *  filter-capabilities above but per-request (`column` IS a param here). */
  "GET /dashboards/:dashboardId/panels/:panelId/distinct-values" should {
    "return distinct values for a column that is one of the panel's own configured controls" in {
      val dashId       = seedDashboardWithPublicGrant()
      val pipelineId   = newPipelineWithLastRunAt(Instant.now())
      val (panelId, _) = seedOutputPanelWithDropdownControl(dashId, pipelineId)
      await(nodeSnapshotRepo.overwriteRows(
        pipelineId.value, None,
        Seq(JsObject("region" -> JsString("east"), "amount" -> JsNumber(10)), JsObject("region" -> JsString("west"), "amount" -> JsNumber(20))),
        explicitRootId = None
      ))

      Get(s"/dashboards/$dashId/panels/$panelId/distinct-values?column=region") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val values = responseAs[JsObject].fields("values").convertTo[Vector[JsObject]].map(_.fields("value").convertTo[String])
        values.toSet shouldBe Set("east", "west")
      }
    }

    "reject a column that is Output-eligible but NOT configured as a control on this panel" in {
      val dashId       = seedDashboardWithPublicGrant()
      val pipelineId   = newPipelineWithLastRunAt(Instant.now())
      val (panelId, _) = seedOutputPanelWithDropdownControl(dashId, pipelineId)
      await(nodeSnapshotRepo.overwriteRows(
        pipelineId.value, None,
        Seq(JsObject("region" -> JsString("east"), "amount" -> JsNumber(10))),
        explicitRootId = None
      ))

      Get(s"/dashboards/$dashId/panels/$panelId/distinct-values?column=amount") ~> routes() ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }
  }

  /** HEL-1190 design.md D8 (task 2.4) — the public/anonymous-safe Output-metadata route
   *  `usePublicPanelData` needs to pick/configure a renderer. */
  "GET /dashboards/:dashboardId/panels/:panelId/output-meta" should {
    "return kind/config/schema, and nothing else (no ownerId, HEL-1197), for a shared dashboard's output panel" in {
      val dashId     = seedDashboardWithPublicGrant()
      val pipelineId = newPipelineWithLastRunAt(Instant.now())
      val panelId    = seedOutputPanel(dashId, pipelineId)

      Get(s"/dashboards/$dashId/panels/$panelId/output-meta") ~> routes() ~> check {
        status shouldBe StatusCodes.OK
        val body = responseAs[JsObject]
        body.fields.keySet shouldBe Set("kind", "config", "schema")
        body.fields("kind") shouldBe JsString("table")
        body.toString should not include ownerId
      }
    }

    "return an authorization error for a non-shared dashboard, identically to rows" in {
      import PostgresProfile.api._
      val dashId = UUID.randomUUID().toString
      await(db.run(
        sqlu"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id)
                 VALUES ($dashId, 'Private Dashboard 3', $ownerId, now(), now(),
                         '{"background":"transparent","gridBackground":"transparent"}',
                         '{"lg":[],"md":[],"sm":[],"xs":[]}', ${ownerId}::uuid)"""
      ))
      val pipelineId = newPipelineWithLastRunAt(Instant.now())
      val panelId    = seedOutputPanel(dashId, pipelineId)

      Get(s"/dashboards/$dashId/panels/$panelId/output-meta") ~> routes() ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
  }
}
