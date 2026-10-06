package com.helio.api.routes.dashboards

import com.helio.api.JsonProtocols
import com.helio.api.http.{AclDirective, ResourceType => AclResourceType, ResourceTypeRegistry}
import com.helio.domain.engine.SchemaField
import com.helio.domain.model._
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
import com.helio.testsupport.{OwnerIdGuard, ProvenanceFixtures}
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

import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1216: no public / optional-auth route may expose an owner-id-equivalent to a caller who is not
 *  the owner. One DISTINCTIVE id is used for the panel owner, dashboard owner, output owner, pipeline
 *  owner and share-token creator, so a generic recursive contains-match over every response (including
 *  404/403/400 bodies) catches a leak under ANY field name. Per-field assertions pin the panel-list wire
 *  shape; owner-view tests pin that the owner (and a panel's own creator) keep their fields. */
class PublicRouteOwnerIdLeakSpec
    extends AnyWordSpec
    with Matchers
    with HelioRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                   = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres       = _
  private var db: JdbcBackend.Database                 = _
  private var panelRepo: PanelRepository               = _
  private var outputRepo: OutputRepository             = _
  private var pipelineRepo: PipelineRepository        = _
  private var nodeSnapshotRepo: NodeSnapshotRepository = _
  private var shareTokenRepo: ShareTokenRepository     = _
  private var permissionRepo: ResourcePermissionRepository = _
  private var aclDirective: AclDirective               = _
  private var provenance: ProvenanceService            = _
  private var fx: ProvenanceFixtures                   = _
  private var dataSourceRepo: DataSourceRepository     = _

  /** The ONE distinctive id: panel owner == dashboard owner == output owner == pipeline owner == token creator. */
  private val ownerId = "0badc0de-1216-4abc-8def-0123456789ab"
  private val owner   = AuthenticatedUser(UserId(ownerId))
  private val editor   = AuthenticatedUser(UserId(UUID.randomUUID().toString))
  private val viewer   = AuthenticatedUser(UserId(UUID.randomUUID().toString))
  private val stranger = AuthenticatedUser(UserId(UUID.randomUUID().toString))

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration").load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx = new DbContext(db, db)(routeEc)
    val dashboardRepo = new DashboardRepository(ctx)(routeEc)
    panelRepo         = new PanelRepository(ctx)(routeEc)
    shareTokenRepo    = new ShareTokenRepository(ctx)(routeEc)
    dataSourceRepo    = new DataSourceRepository(ctx)(routeEc)
    pipelineRepo      = new PipelineRepository(ctx, dataSourceRepo)(routeEc)
    outputRepo        = new OutputRepository(ctx)(routeEc)
    nodeSnapshotRepo  = new NodeSnapshotRepository(ctx)(routeEc)
    val stepRepo      = new PipelineStepRepository(ctx)(routeEc)
    val rootRepo      = new PipelineRootRepository(ctx)(routeEc)
    val runRepo       = new PipelineRunRepository(ctx)(routeEc)
    permissionRepo    = new ResourcePermissionRepository(ctx)(routeEc)
    provenance = new ProvenanceService(outputRepo, pipelineRepo, stepRepo, rootRepo, dataSourceRepo, runRepo, nodeSnapshotRepo)(routeEc)
    fx = new ProvenanceFixtures(owner, dataSourceRepo, pipelineRepo, stepRepo, rootRepo, runRepo, nodeSnapshotRepo)(routeEc)
    val validator = new ShareTokenValidatorImpl(Some(shareTokenRepo))(routeEc)
    val registry = new ResourceTypeRegistry(
      AclResourceType("dashboard", id => dashboardRepo.findByIdInternal(DashboardId(id)).map(_.map(_.ownerId.value)))
    )
    aclDirective = new AclDirective(permissionRepo, registry, Some(validator))(routeEc)
    import PostgresProfile.api._
    Seq(owner, editor, viewer, stranger).foreach { u =>
      await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES (${u.id.value}::uuid, ${s"u-${u.id.value}@helio.test"}, now())"""))
    }
  }

  override def afterAll(): Unit = { db.close(); embeddedPostgres.close(); super.afterAll() }

  private def await[T](f: Future[T]): T = Await.result(f, 15.seconds)

  private def routesFor(user: Option[AuthenticatedUser]): Route =
    new PublicDashboardRoutes(panelRepo, aclDirective, user, outputRepo, Some(pipelineRepo), Some(nodeSnapshotRepo), Some(provenance))(typedSystem).routes

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

  private def seedToken(dashboardId: String): String = {
    val raw = "tok-" + UUID.randomUUID()
    await(shareTokenRepo.insert(ShareToken(ShareTokenId(UUID.randomUUID().toString), DashboardId(dashboardId), UserId(ownerId), TokenHashing.sha256Hex(raw), None, None, Instant.now())))
    raw
  }

  private def grant(dashId: String, user: AuthenticatedUser, role: Role): Unit =
    await(permissionRepo.insert(ResourcePermission("dashboard", dashId, Some(user.id), role, Instant.now())))

  /** An output panel created by `creator` (panel `created_by` and `owner_id` both = creator). */
  private def seedPanel(dashId: String, outputId: Option[String], creator: String = ownerId, controls: String = "[]", kind: String = "output"): String = {
    import PostgresProfile.api._
    val panelId = UUID.randomUUID().toString
    await(db.run(
      sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, kind, output_id, output_controls, owner_id)
               VALUES ($panelId, $dashId, 'P', $creator, now(), now(),
                       '{"background":"transparent","color":"inherit","transparency":0.0}',
                       $kind, ${outputId}, $controls::jsonb, ${creator}::uuid)"""
    ))
    panelId
  }

  /** Output with a declared schema + real snapshot rows + a dropdown control, owned (pipeline, output, source) by `ownerId`. */
  private def seedRowsPanel(dashId: String): String = {
    val now     = Instant.now()
    val source  = await(dataSourceRepo.insert(DatasetSource(DataSourceId(UUID.randomUUID().toString), "src", owner.id, now, now), owner))
    val pipe    = await(pipelineRepo.create("pipe", Vector(source.id), owner)).getOrElse(throw new IllegalStateException("pipeline create failed"))
    val pid     = PipelineId(pipe.id)
    val output  = await(outputRepo.insertInternal(pid, None, owner.id, "Rows Output", OutputKind.Table,
      schema = Vector(SchemaField("region", "string"), SchemaField("amount", "integer")), explicitRootId = None))
    await(nodeSnapshotRepo.overwriteRows(pid.value, None,
      Seq(JsObject("region" -> JsString("east"), "amount" -> JsNumber(1)), JsObject("region" -> JsString("west"), "amount" -> JsNumber(2))),
      explicitRootId = None))
    seedPanel(dashId, Some(output.id.value), controls = """[{"id":"c1","kind":"dropdown","column":"region","label":"Region"}]""")
  }

  private def seedProvenancePanel(dashId: String): String = {
    val b   = fx.newPipeline("Quarterly Pipeline", Vector("Sales DB", "Regions"))
    val s1  = fx.filterStep(b.pipelineId, None, Some(b.roots(0)))
    val a   = fx.assertStep(b.pipelineId, Some(s1.id))
    val out = await(outputRepo.insertInternal(b.pipelineId, Some(a.id), owner.id, "Out", OutputKind.Table, explicitRootId = None))
    fx.snapshot(b.pipelineId, Some(a.id), None, rows = 3)
    fx.run(b.pipelineId, "failed", errorLog = Some("boom"), assertions = Seq(
      AssertionResult(a.id.value, "notNull", Some("amount"), "error", passed = false, observed = Some("x"), message = Some("m"))
    ))
    seedPanel(dashId, Some(out.id.value))
  }

  private def panelListItems(user: Option[AuthenticatedUser], dashId: String, query: String = ""): Vector[JsObject] =
    Get(s"/dashboards/$dashId/panels$query") ~> routesFor(user) ~> check {
      status shouldBe StatusCodes.OK
      responseAs[JsObject].fields("items").convertTo[Vector[JsObject]]
    }

  private def assertNoOwnerIdentifyingFields(items: Vector[JsObject], label: String): Unit = {
    items should not be empty
    items.foreach { item =>
      withClue(s"$label panel ${item.fields("id")}: ") {
        item.fields.keySet should not contain "ownerId"
        val meta = item.fields("meta").asJsObject
        meta.fields.keySet should not contain "createdBy"
        meta.fields.keySet shouldBe Set("createdAt", "lastUpdated")
        meta.fields("createdAt") shouldBe a[JsString]
        meta.fields("lastUpdated") shouldBe a[JsString]
      }
    }
  }

  "GET /dashboards/:id/panels (field by field, serialized JSON)" should {
    "omit ownerId and meta.createdBy for an anonymous caller (createdAt/lastUpdated present)" in {
      val dashId = seedDashboard(public = true)
      seedRowsPanel(dashId); seedProvenancePanel(dashId)
      assertNoOwnerIdentifyingFields(panelListItems(None, dashId), "anonymous")
    }

    "omit ownerId and meta.createdBy for a share-token-only caller on a private dashboard" in {
      val dashId = seedDashboard(public = false)
      seedRowsPanel(dashId)
      val raw = seedToken(dashId)
      assertNoOwnerIdentifyingFields(panelListItems(None, dashId, s"?token=$raw"), "share-token-only")
    }

    "omit both for an AUTHENTICATED non-owner (stranger) holding a share token" in {
      val dashId = seedDashboard(public = false)
      seedRowsPanel(dashId)
      val raw = seedToken(dashId)
      assertNoOwnerIdentifyingFields(panelListItems(Some(stranger), dashId, s"?token=$raw"), "authenticated stranger + token")
    }

    "omit both for an authenticated Viewer grantee of the dashboard (not owner, not the panel's creator)" in {
      val dashId = seedDashboard(public = false)
      seedRowsPanel(dashId)
      grant(dashId, viewer, Role.Viewer)
      assertNoOwnerIdentifyingFields(panelListItems(Some(viewer), dashId), "viewer grantee")
    }
  }

  "GET /dashboards/:id/panels owner views (no regression)" should {
    "give the dashboard owner ownerId and meta.createdBy on every panel, including a grantee-created one" in {
      val dashId = seedDashboard(public = true)
      grant(dashId, editor, Role.Editor)
      seedRowsPanel(dashId)
      val granteePanel = seedPanel(dashId, None, creator = editor.id.value, kind = "text")
      val items = panelListItems(Some(owner), dashId)
      items.size shouldBe 2
      items.foreach { item =>
        item.fields.get("ownerId") should not be empty
        item.fields("meta").asJsObject.fields.get("createdBy") should not be empty
        item.fields("meta").asJsObject.fields.keySet shouldBe Set("createdBy", "createdAt", "lastUpdated")
      }
      val g = items.find(_.fields("id") == JsString(granteePanel)).get
      g.fields("ownerId") shouldBe JsString(editor.id.value)
      g.fields("meta").asJsObject.fields("createdBy") shouldBe JsString(editor.id.value)
      val o = items.find(_.fields("id") != JsString(granteePanel)).get
      o.fields("ownerId") shouldBe JsString(ownerId)
      o.fields("meta").asJsObject.fields("createdBy") shouldBe JsString(ownerId)
    }

    "give a panel's CREATOR (Editor grantee) their own panel's fields, but not another user's panel's" in {
      val dashId = seedDashboard(public = false)
      grant(dashId, editor, Role.Editor)
      val ownersPanel  = seedRowsPanel(dashId)
      val granteePanel = seedPanel(dashId, None, creator = editor.id.value, kind = "text")
      val items = panelListItems(Some(editor), dashId)
      val mine   = items.find(_.fields("id") == JsString(granteePanel)).get
      val theirs = items.find(_.fields("id") == JsString(ownersPanel)).get
      mine.fields("ownerId") shouldBe JsString(editor.id.value)
      mine.fields("meta").asJsObject.fields("createdBy") shouldBe JsString(editor.id.value)
      theirs.fields.keySet should not contain "ownerId"
      theirs.fields("meta").asJsObject.fields.keySet should not contain "createdBy"
    }

    "NOT give another grantee a grantee-created panel's creator id" in {
      val dashId = seedDashboard(public = false)
      grant(dashId, editor, Role.Editor)
      grant(dashId, viewer, Role.Viewer)
      seedPanel(dashId, None, creator = editor.id.value, kind = "text")
      assertNoOwnerIdentifyingFields(panelListItems(Some(viewer), dashId), "other grantee")
    }
  }

  "Generic owner-id guard over every public route" should {
    "find the owner id in NO response (success and error bodies) for anonymous, share-token and non-owner callers" in {
      val publicDash  = seedDashboard(public = true)
      val privateDash = seedDashboard(public = false)
      val rowsPublic  = seedRowsPanel(publicDash)
      val provPublic  = seedProvenancePanel(publicDash)
      val rowsPrivate = seedRowsPanel(privateDash)
      val provPrivate = seedProvenancePanel(privateDash)
      val tok         = seedToken(privateDash)
      grant(privateDash, viewer, Role.Viewer)

      def paths(dash: String, rowsP: String, provP: String, q: String): Seq[String] = {
        val sep = if (q.isEmpty) "?" else s"$q&"
        Seq(
          s"/dashboards/$dash/panels$q",
          s"/dashboards/$dash/panels/$rowsP/rows$q",
          s"/dashboards/$dash/panels/$rowsP/rows${sep}filter=" + java.net.URLEncoder.encode("""{"column":"region","op":"eq","value":"east"}""", "UTF-8"),
          s"/dashboards/$dash/panels/$rowsP/filter-capabilities$q",
          s"/dashboards/$dash/panels/$rowsP/distinct-values${sep}column=region",
          s"/dashboards/$dash/panels/$rowsP/distinct-values${sep}column=amount", // 400: not a control column
          s"/dashboards/$dash/panels/$rowsP/output-meta$q",
          s"/dashboards/$dash/panels/$provP/output-meta$q",
          s"/dashboards/$dash/panels/$provP/provenance$q",
          s"/dashboards/$dash/panels/${UUID.randomUUID()}/provenance$q", // 404 missing panel
          s"/dashboards/$dash/panels/${UUID.randomUUID()}/output-meta$q",
          s"/dashboards/$dash/panels/$rowsP/rows${sep}offset=-1"          // 400
        )
      }
      val scenarios: Seq[(String, Option[AuthenticatedUser], Seq[String])] = Seq(
        ("anonymous / public dashboard", None, paths(publicDash, rowsPublic, provPublic, "")),
        ("anonymous / private dashboard, no token (404)", None, paths(privateDash, rowsPrivate, provPrivate, "")),
        ("anonymous / private dashboard, wrong token (404)", None, paths(privateDash, rowsPrivate, provPrivate, "?token=wrong")),
        ("share-token only / private dashboard", None, paths(privateDash, rowsPrivate, provPrivate, s"?token=$tok")),
        ("stranger + token / private dashboard", Some(stranger), paths(privateDash, rowsPrivate, provPrivate, s"?token=$tok")),
        ("stranger, no token / private dashboard (403)", Some(stranger), paths(privateDash, rowsPrivate, provPrivate, "")),
        ("viewer grantee / private dashboard", Some(viewer), paths(privateDash, rowsPrivate, provPrivate, "")),
        ("anonymous / nonexistent dashboard (404)", None, paths(UUID.randomUUID().toString, rowsPublic, provPublic, ""))
      )
      var checked = 0
      scenarios.foreach { case (label, user, ps) =>
        ps.foreach { p =>
          Get(p) ~> routesFor(user) ~> check {
            OwnerIdGuard.assertNoOwnerId(responseAs[String], ownerId, s"[$label] GET $p (status $status)")
            checked += 1
          }
        }
      }
      checked shouldBe scenarios.map(_._3.size).sum
      // The guard must not be vacuous: at least the OK responses on a public dashboard really carry data.
      Get(s"/dashboards/$publicDash/panels/$rowsPublic/rows") ~> routesFor(None) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String] should include("east")
      }
      Get(s"/dashboards/$publicDash/panels/$provPublic/provenance") ~> routesFor(None) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String] should include("Quarterly Pipeline")
      }
    }
  }
}
