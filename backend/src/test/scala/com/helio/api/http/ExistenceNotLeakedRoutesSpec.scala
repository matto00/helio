package com.helio.api.http

import com.helio.api.{ApiRoutes, JsonProtocols}
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.{ResourcePermissionRepository, UserPreferenceRepository, UserRepository, UserSessionRepository}
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineRepository, PipelineRunRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.spark.{PipelineRunCache, RunStatus, SparkJobSubmitter}
import com.helio.testkit.HelioRouteTest
import com.helio.testkit.TempDirectorySupport
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, HttpMethod, HttpMethods, HttpRequest, StatusCodes}
import org.apache.pekko.http.scaladsl.model.headers.{Cookie, RawHeader}
import org.apache.pekko.http.scaladsl.server.Directives.mapRequest
import org.apache.pekko.http.scaladsl.server.Route
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}

import java.nio.file.{Files, Path, Paths}
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.jdk.CollectionConverters._

/** HEL-1002: an authenticated caller must not be able to tell a real-but-foreign resource from a
 *  nonexistent one on ANY route that gates on ownership/grants. For every row of [[rows]] the
 *  same request is sent twice as a stranger -- once at an id that exists under another tenant
 *  (no grant), once at a random nonexistent id -- and the (status, content-type, serialized body)
 *  must be identical. The only normalisation is replacing the probed id with `<ID>`, because a
 *  few existing messages legitimately echo the id the CALLER supplied (`Panel '<id>' not found`).
 *
 *  Anti-vacuity: the foreign arm must be exactly `404`, and where the row is flagged
 *  `ownerControl` the OWNER's request against the real resource must NOT be 404/403 (so the row
 *  genuinely reaches the guarded code rather than failing earlier on a bad path/body).
 *
 *  Completeness guards (also failable): every source file calling one of the four shared access
 *  helpers must be named by at least one row's `sites`, and the per-file count of
 *  `ServiceError.Forbidden(` producers is pinned, so a new producer cannot ship unclassified (see
 *  openspec/changes/archive/2026-10-02-collapse-owner-only-existence-leak/forbidden-classification.md). */
class ExistenceNotLeakedRoutesSpec
    extends AnyWordSpec
    with Matchers
    with HelioRouteTest
    with JsonProtocols
    with BeforeAndAfterAll
    with TempDirectorySupport {

  import ExistenceNotLeakedRoutesSpec._

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                   = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres           = _
  private var db: JdbcBackend.Database                     = _
  private var ctx: DbContext                               = _
  private var dashboardRepo: DashboardRepository           = _
  private var panelRepo: PanelRepository                   = _
  private var dataSourceRepo: DataSourceRepository         = _
  private var permissionRepo: ResourcePermissionRepository = _
  private var userRepo: UserRepository                     = _
  private var userPrefRepo: UserPreferenceRepository       = _

  private val ownerId    = UUID.randomUUID().toString
  private val strangerId = UUID.randomUUID().toString
  private val viewerId   = UUID.randomUUID().toString
  private val owner      = AuthenticatedUser(UserId(ownerId))
  private val stranger   = AuthenticatedUser(UserId(strangerId))
  private val viewer     = AuthenticatedUser(UserId(viewerId))

  private val stubSessionRepo: UserSessionRepository = new UserSessionRepository {
    override def findValidSession(token: String): Future[Option[AuthenticatedUser]] =
      Future.successful(token match {
        case "tok-owner"    => Some(owner)
        case "tok-stranger" => Some(stranger)
        case "tok-viewer"   => Some(viewer)
        case _              => None
      })
  }

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db             = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    ctx            = new DbContext(db, db)(routeEc)
    dashboardRepo  = new DashboardRepository(ctx)(routeEc)
    panelRepo      = new PanelRepository(ctx)(routeEc)
    dataSourceRepo = new DataSourceRepository(ctx)(routeEc)
    permissionRepo = new ResourcePermissionRepository(ctx)(routeEc)
    userRepo       = new UserRepository(db)(routeEc)
    userPrefRepo   = new UserPreferenceRepository(db)(routeEc)
    import PostgresProfile.api._
    Seq(ownerId, strangerId, viewerId).foreach { id =>
      await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($id::uuid, ${s"$id@helio.test"}, now())"""))
    }
  }

  override def afterAll(): Unit = { db.close(); embeddedPostgres.close(); super.afterAll() }

  private def await[T](f: Future[T]): T = Await.result(f, 20.seconds)

  // ---- seeding (fresh resources per row so a destructive row cannot affect another) ----

  private case class Seeded(dashboardId: String, panelId: String, pipelineId: String, stepId: String, outputId: String)

  private def seedOwned(): Seeded = {
    import PostgresProfile.api._
    val dash = UUID.randomUUID().toString
    val pnl  = UUID.randomUUID().toString
    val pip  = UUID.randomUUID().toString
    val ds   = UUID.randomUUID().toString
    val stp  = UUID.randomUUID().toString
    val cfg  = """{"columns":[],"rows":[]}"""
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id)
               VALUES ($dash, 'Leak Test', $ownerId, now(), now(),
                       '{"background":"transparent","gridBackground":"transparent"}',
                       '{"lg":[],"md":[],"sm":[],"xs":[]}', ${ownerId}::uuid)""",
      sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, kind, owner_id)
               VALUES ($pnl, $dash, 'Leak Panel', $ownerId, now(), now(),
                       '{"background":"transparent","color":"inherit","transparency":0.0}',
                       'text', ${ownerId}::uuid)""",
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
               VALUES ($ds, 'ds', 'dataset', $cfg, ${ownerId}::uuid, now(), now())""",
      sqlu"""INSERT INTO pipelines (id, name, owner_id, created_at, updated_at)
               VALUES ($pip, 'pipe', ${ownerId}::uuid, now(), now())""",
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($pip, $pip, $ds, 0)""",
      sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, created_at, updated_at, root_id)
               VALUES ($stp, $pip, 0, 'upsertsource',
                       ${s"""{"target":{"kind":"existingSource","dataSourceId":"$ds"},"mode":"append"}"""}::text,
                       now(), now(), $pip)"""
    )))
    // HEL-1239: an owner-scoped Output on the seeded pipeline (source-attached, so no step needed).
    val out = await(new OutputRepository(ctx).insertInternal(
      PipelineId(pip), None, UserId(ownerId), "Leak Output", OutputKind.Table, explicitRootId = None
    ))
    Seeded(dash, pnl, pip, stp, out.id.value)
  }

  private def grantViewer(dashId: String): Unit = {
    import PostgresProfile.api._
    await(db.run(
      sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
               VALUES ('dashboard', $dashId, ${viewerId}::uuid, 'viewer', now())"""
    ))
  }

  // ---- routes ----

  private def buildApi(cache: PipelineRunCache = new PipelineRunCache()): ApiRoutes = {
    val pipelineRepo = new PipelineRepository(ctx, dataSourceRepo)(routeEc)
    new ApiRoutes(
      dashboardRepo, panelRepo, dataSourceRepo, permissionRepo,
      new LocalFileSystem(newTempDir("helio-existence-leak-spec")),
      new RestApiConnectorDriver(Some(_ => Future.successful(Left("no HTTP in tests")))),
      userRepo, stubSessionRepo, userPrefRepo,
      pipelineRepo, new PipelineStepRepository(ctx)(routeEc),
      cache,
      new SparkJobSubmitter("local", dataSourceRepo, pipelineRepo)(routeEc),
      pipelineRunRepo = new PipelineRunRepository(ctx)(routeEc),
      dbContext       = ctx
    )
  }

  private def asUser(api: ApiRoutes, token: String): Route =
    mapRequest { req =>
      val withCookie = req.withHeaders(req.headers :+ Cookie(SessionCookies.Name -> token))
      withCookie.withHeaders(withCookie.headers :+ RawHeader(AuthDirectives.CsrfHeaderName, AuthDirectives.CsrfHeaderValue))
    } { api.routes }

  private def request(row: Row, id: String, seeded: Seeded): HttpRequest = {
    def sub(s: String) = s.replace("{id}", id).replace("{dash}", seeded.dashboardId)
    val base = HttpRequest(method = row.method, uri = sub(row.path))
    row.body match {
      case None    => base
      case Some(b) => base.withEntity(HttpEntity(ContentTypes.`application/json`, sub(b)))
    }
  }

  private case class Outcome(status: Int, contentType: String, body: String)

  private def run(route: Route, req: HttpRequest, id: String): Outcome = {
    var out: Outcome = null
    req ~> route ~> check {
      val raw = responseAs[String]
      out = Outcome(status.intValue, contentType.toString, raw.replace(id, "<ID>"))
    }
    out
  }

  private def targetIdOf(row: Row, seeded: Seeded): String = row.target match {
    case Dashboard => seeded.dashboardId
    case Panel     => seeded.panelId
    case Pipeline  => seeded.pipelineId
    case Step      => seeded.stepId
    case OutputT   => seeded.outputId
  }

  "a stranger probing an owner-only route" should {
    rows.foreach { row =>
      s"get an identical 404 for a foreign and a nonexistent id: ${row.name}" in {
        val seeded      = seedOwned()
        val realId      = targetIdOf(row, seeded)
        val missingId   = UUID.randomUUID().toString
        val cache       = new PipelineRunCache()
        if (row.seedRun) seedRun(cache, seeded.pipelineId)
        val api         = buildApi(cache)
        val asStranger  = asUser(api, "tok-stranger")

        val foreign     = run(asStranger, request(row, realId, seeded), realId)
        // The "nonexistent" request uses a random id for the probed segment only; a dashboard-scoped
        // body field ({dash}) stays the real dashboard when the probed target is a panel.
        val nonexistent = run(asStranger, request(row, missingId, seeded), missingId)

        withClue(s"foreign=$foreign nonexistent=$nonexistent: ") {
          foreign.status shouldBe StatusCodes.NotFound.intValue
          nonexistent.status shouldBe StatusCodes.NotFound.intValue
          foreign shouldBe nonexistent
        }

        if (row.ownerControl) {
          val control = run(asUser(api, "tok-owner"), request(row, realId, seeded), realId)
          withClue(s"owner control reached the guarded code (got $control): ") {
            control.status should not be StatusCodes.NotFound.intValue
            control.status should not be StatusCodes.Forbidden.intValue
          }
        }
      }
    }
  }

  // HEL-1249: GET /pipelines/:id/runs/:runId reaches the cache arms (absent run, wrong pipeline)
  // that the foreign-vs-nonexistent PIPELINE row above never gets to.
  private def seedRun(cache: PipelineRunCache, pipelineId: String): Unit = {
    cache.put(SeededRunId, pipelineId, RunStatus.Queued)
    cache.update(SeededRunId, RunStatus.Succeeded, rows = Some(Seq(Map[String, Any]("secret" -> "owner-row"))))
  }

  private def runStatusRequest(pipelineId: String, runId: String): HttpRequest =
    HttpRequest(HttpMethods.GET, s"/api/pipelines/$pipelineId/runs/$runId")

  "GET /api/pipelines/:id/runs/:runId" should {
    "return a byte-identical 404 for foreign pipeline, absent pipeline, absent run, and a run of another pipeline" in {
      val a     = seedOwned()
      val b     = seedOwned()
      val cache = new PipelineRunCache()
      seedRun(cache, a.pipelineId)
      val api = buildApi(cache)
      val asStranger = asUser(api, "tok-stranger")
      val asOwner    = asUser(api, "tok-owner")
      val missing    = UUID.randomUUID().toString
      val missingRun = UUID.randomUUID().toString

      // run() normalises the probed segment; the run id is normalised too via a second pass.
      def norm(o: Outcome) = o.copy(body = o.body.replace(SeededRunId, "<RUN>").replace(missingRun, "<RUN>"))
      val foreignPipeline = norm(run(asStranger, runStatusRequest(a.pipelineId, SeededRunId), a.pipelineId))
      val absentPipeline  = norm(run(asStranger, runStatusRequest(missing, SeededRunId), missing))
      val absentRun       = norm(run(asOwner, runStatusRequest(a.pipelineId, missingRun), a.pipelineId))
      val wrongPipeline   = norm(run(asOwner, runStatusRequest(b.pipelineId, SeededRunId), b.pipelineId))

      withClue(s"foreign=$foreignPipeline absentPipeline=$absentPipeline absentRun=$absentRun wrongPipeline=$wrongPipeline: ") {
        foreignPipeline.status shouldBe StatusCodes.NotFound.intValue
        absentPipeline  shouldBe foreignPipeline
        absentRun       shouldBe foreignPipeline
        wrongPipeline   shouldBe foreignPipeline
      }
    }

    "still serve the run to the owner and to a pipeline grantee" in {
      val a     = seedOwned()
      val cache = new PipelineRunCache()
      seedRun(cache, a.pipelineId)
      val api = buildApi(cache)
      import PostgresProfile.api._
      await(db.run(
        sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
                 VALUES ('pipeline', ${a.pipelineId}, ${viewerId}::uuid, 'viewer', now())"""
      ))
      run(asUser(api, "tok-owner"), runStatusRequest(a.pipelineId, SeededRunId), a.pipelineId).status shouldBe 200
      run(asUser(api, "tok-viewer"), runStatusRequest(a.pipelineId, SeededRunId), a.pipelineId).status shouldBe 200
    }
  }

  "a grantee who can already see the resource" should {
    "still get 403 (not 404) for an operation their grant does not allow" in {
      val seeded = seedOwned()
      grantViewer(seeded.dashboardId)
      val api = buildApi()
      val asViewer = asUser(api, "tok-viewer")
      def statusOf(req: HttpRequest) = run(asViewer, req, seeded.dashboardId).status

      statusOf(HttpRequest(HttpMethods.GET, s"/api/dashboards/${seeded.dashboardId}/permissions")) shouldBe 403
      statusOf(HttpRequest(HttpMethods.GET, s"/api/dashboards/${seeded.dashboardId}/share-tokens")) shouldBe 403
      statusOf(HttpRequest(HttpMethods.POST, s"/api/dashboards/${seeded.dashboardId}/duplicate")) shouldBe 403
      statusOf(
        HttpRequest(HttpMethods.POST, "/api/panels")
          .withEntity(HttpEntity(ContentTypes.`application/json`, s"""{"dashboardId":"${seeded.dashboardId}","title":"x","type":"text"}"""))
      ) shouldBe 403
    }
  }

  "the completeness guards" should {
    "name every source file that calls a shared access helper in at least one table row" in {
      val covered = rows.flatMap(_.sites).toSet
      val missing = filesCallingAccessHelpers() -- covered
      withClue(s"files calling requireOwnerOnly/requireAccess/authorizeResource[WithSharing] but not covered by any row: ") {
        missing shouldBe empty
      }
    }

    "cover every (kind, op) the patch-set resolvers dispatch, or exempt it with a recorded reason" in {
      val dispatched = patchSetDispatchPairs()
      val covered    = rows.flatMap(_.patchKinds).toSet
      val unaccounted = dispatched -- covered -- patchKindExemptions.keySet
      withClue("add a row (patchKinds) or an exemption with a reason for: ") { unaccounted shouldBe empty }
      withClue("stale exemption/coverage entries no longer dispatched: ") {
        ((covered ++ patchKindExemptions.keySet) -- dispatched) shouldBe empty
      }
    }

    "pin the per-file count of ServiceError.Forbidden producers so none ships unclassified" in {
      val actual = forbiddenProducerCounts()
      withClue("update expectedForbiddenProducers AND forbidden-classification.md together: ") {
        actual shouldBe expectedForbiddenProducers
      }
    }
  }
}

object ExistenceNotLeakedRoutesSpec {

  sealed trait Target
  case object Dashboard extends Target
  case object Panel     extends Target
  case object Pipeline  extends Target
  case object Step      extends Target
  case object OutputT   extends Target

  /** `{id}` is the probed resource id (real vs random); `{dash}` is the seeded dashboard id. */
  final case class Row(
      name: String,
      method: HttpMethod,
      path: String,
      target: Target,
      sites: Set[String],
      body: Option[String] = None,
      ownerControl: Boolean = true,
      // HEL-1249: seed [[SeededRunId]] into the PipelineRunCache, bound to the seeded pipeline
      seedRun: Boolean = false,
      // "kind:op" pairs of POST /patch-sets/{apply,preview} this row exercises (per-kind guard)
      patchKinds: Set[String] = Set.empty
  )

  /** HEL-1249: fixed run id seeded into the PipelineRunCache for `seedRun` rows. */
  val SeededRunId = "run-hel1249-seeded"

  private val AnyUuid   = "00000000-0000-0000-0000-000000000001"
  private val Json      = (s: String) => Some(s)

  val rows: Vector[Row] = Vector(
    // requireOwnerOnly -- dashboard permissions / share tokens
    Row("GET dashboard permissions", HttpMethods.GET, "/api/dashboards/{id}/permissions", Dashboard, Set("PermissionService.scala")),
    Row("POST dashboard permissions", HttpMethods.POST, "/api/dashboards/{id}/permissions", Dashboard, Set("PermissionService.scala"),
      Json(s"""{"granteeId":"$AnyUuid","role":"viewer"}"""), ownerControl = false),
    Row("DELETE dashboard public permission", HttpMethods.DELETE, "/api/dashboards/{id}/permissions/public", Dashboard, Set("PermissionService.scala"), ownerControl = false),
    Row("DELETE dashboard grantee permission", HttpMethods.DELETE, s"/api/dashboards/{id}/permissions/$AnyUuid", Dashboard, Set("PermissionService.scala"), ownerControl = false),
    Row("GET share tokens", HttpMethods.GET, "/api/dashboards/{id}/share-tokens", Dashboard, Set("ShareTokenService.scala")),
    Row("POST share tokens", HttpMethods.POST, "/api/dashboards/{id}/share-tokens", Dashboard, Set("ShareTokenService.scala"), Json("{}")),
    Row("DELETE share token", HttpMethods.DELETE, s"/api/dashboards/{id}/share-tokens/$AnyUuid", Dashboard, Set("ShareTokenService.scala"), ownerControl = false),
    // requireOwnerOnly -- pipeline permissions
    Row("GET pipeline permissions", HttpMethods.GET, "/api/pipelines/{id}/permissions", Pipeline, Set("PipelinePermissionService.scala")),
    Row("POST pipeline permissions", HttpMethods.POST, "/api/pipelines/{id}/permissions", Pipeline, Set("PipelinePermissionService.scala"),
      Json(s"""{"granteeId":"$AnyUuid","role":"viewer"}"""), ownerControl = false),
    Row("DELETE pipeline grantee permission", HttpMethods.DELETE, s"/api/pipelines/{id}/permissions/$AnyUuid", Pipeline, Set("PipelinePermissionService.scala"), ownerControl = false),
    // authorizeResourceWithSharing (public/shared dashboard read routes)
    Row("GET dashboard panels", HttpMethods.GET, "/api/dashboards/{id}/panels", Dashboard, Set("PublicDashboardRoutes.scala")),
    Row("GET panel rows", HttpMethods.GET, s"/api/dashboards/{id}/panels/$AnyUuid/rows", Dashboard, Set("PublicDashboardRoutes.scala"), ownerControl = false),
    Row("GET panel filter-capabilities", HttpMethods.GET, s"/api/dashboards/{id}/panels/$AnyUuid/filter-capabilities", Dashboard, Set("PublicDashboardRoutes.scala"), ownerControl = false),
    Row("GET panel distinct-values", HttpMethods.GET, s"/api/dashboards/{id}/panels/$AnyUuid/distinct-values?column=x", Dashboard, Set("PublicDashboardRoutes.scala"), ownerControl = false),
    Row("GET panel output-meta", HttpMethods.GET, s"/api/dashboards/{id}/panels/$AnyUuid/output-meta", Dashboard, Set("PublicDashboardRoutes.scala"), ownerControl = false),
    Row("GET panel provenance", HttpMethods.GET, s"/api/dashboards/{id}/panels/$AnyUuid/provenance", Dashboard, Set("PublicDashboardRoutes.scala"), ownerControl = false),
    // dashboard service paths (sharing-aware read first, then requireAccess for grantees)
    Row("GET dashboard export", HttpMethods.GET, "/api/dashboards/{id}/export", Dashboard, Set("DashboardService.scala")),
    Row("POST dashboard duplicate", HttpMethods.POST, "/api/dashboards/{id}/duplicate", Dashboard, Set("DashboardService.scala")),
    Row("POST dashboard layout repair", HttpMethods.POST, "/api/dashboards/{id}/layout/repair", Dashboard, Set("DashboardService.scala"),
      Json("""{"xs":[]}""")),
    Row("PATCH dashboard update", HttpMethods.PATCH, "/api/dashboards/{id}/update", Dashboard, Set("DashboardService.scala"),
      Json("""{"fields":["name"],"dashboard":{"name":"renamed"}}""")),
    Row("PATCH dashboard", HttpMethods.PATCH, "/api/dashboards/{id}", Dashboard, Set("DashboardService.scala"), Json("""{"name":"renamed"}""")),
    Row("DELETE dashboard", HttpMethods.DELETE, "/api/dashboards/{id}", Dashboard, Set("DashboardService.scala")),
    Row("PUT dashboard contents", HttpMethods.PUT, "/api/dashboards/{id}/contents", Dashboard, Set("DashboardContentsService.scala"), Json("""{"panels":[]}""")),
    Row("POST dashboard auto-layout", HttpMethods.POST, "/api/dashboards/{id}/auto-layout", Dashboard, Set("AutoLayoutService.scala"),
      Json("""{"items":[],"cols":12}""")),
    // panel creation by dashboardId in the body (requireAccess direct)
    Row("POST panel create", HttpMethods.POST, "/api/panels", Dashboard, Set("PanelService.scala"),
      Json("""{"dashboardId":"{id}","title":"x","type":"text"}""")),
    Row("POST panel batch create", HttpMethods.POST, "/api/panels/batch", Dashboard, Set("PanelService.scala"),
      Json("""{"dashboardId":"{id}","panels":[{"title":"x","type":"text"}]}""")),
    Row("POST patch-set apply: panel create", HttpMethods.POST, "/api/patch-sets/apply", Dashboard, Set("PatchSetApplyResolvers.scala"),
      Json("""{"edits":[{"target":{"kind":"panel"},"op":"create","patch":{"dashboardId":"{id}","title":"x","type":"text"}}]}"""), patchKinds = Set("panel:create")),
    // panel-scoped (id is a PANEL id; resolved through its parent dashboard)
    Row("PATCH panel", HttpMethods.PATCH, "/api/panels/{id}", Panel, Set("PanelService.scala"), Json("""{"title":"renamed"}""")),
    Row("DELETE panel", HttpMethods.DELETE, "/api/panels/{id}", Panel, Set("PanelService.scala")),
    Row("POST panel duplicate", HttpMethods.POST, "/api/panels/{id}/duplicate", Panel, Set("PanelService.scala")),
    Row("POST panel updateBatch", HttpMethods.POST, "/api/panels/updateBatch", Panel, Set("PanelService.scala"),
      Json("""{"fields":["title"],"panels":[{"id":"{id}","title":"renamed"}]}""")),
    Row("POST panel submit", HttpMethods.POST, "/api/panels/{id}/submit", Panel, Set("PanelService.scala"), Json("""{"values":{}}"""), ownerControl = false),
    Row("POST patch-set apply: panel update", HttpMethods.POST, "/api/patch-sets/apply", Panel, Set("PatchSetApplyResolvers.scala"),
      Json("""{"edits":[{"target":{"kind":"panel","id":"{id}"},"op":"update","patch":{"title":"renamed"}}]}"""), patchKinds = Set("panel:update")),
    Row("POST patch-set apply: panel delete", HttpMethods.POST, "/api/patch-sets/apply", Panel, Set("PatchSetApplyResolvers.scala"),
      Json("""{"edits":[{"target":{"kind":"panel","id":"{id}"},"op":"delete"}]}"""), patchKinds = Set("panel:delete")),
    // pipeline steps (id is a STEP id; parent pipeline resolved through the visibility-filtered lookup)
    Row("PATCH pipeline step", HttpMethods.PATCH, "/api/pipeline-steps/{id}", Step, Set("PipelineService.scala"), Json("""{"position":0}"""), ownerControl = false),
    Row("DELETE pipeline step", HttpMethods.DELETE, "/api/pipeline-steps/{id}", Step, Set("PipelineService.scala"), ownerControl = false),
    Row("POST pipeline step duplicate", HttpMethods.POST, "/api/pipeline-steps/{id}/duplicate", Step, Set("PipelineService.scala"), ownerControl = false),
    Row("POST patch-set apply: pipelineStep update", HttpMethods.POST, "/api/patch-sets/apply", Step, Set("PatchSetApplyResolvers.scala"),
      Json("""{"edits":[{"target":{"kind":"pipelineStep","id":"{id}"},"op":"update","patch":{"position":0}}]}"""), ownerControl = false, patchKinds = Set("pipelineStep:update")),
    Row("POST patch-set apply: pipelineStep delete", HttpMethods.POST, "/api/patch-sets/apply", Step, Set("PatchSetApplyResolvers.scala"),
      Json("""{"edits":[{"target":{"kind":"pipelineStep","id":"{id}"},"op":"delete"}]}"""), ownerControl = false, patchKinds = Set("pipelineStep:delete")),
    Row("POST patch-set preview: pipelineStep update", HttpMethods.POST, "/api/patch-sets/preview", Step, Set("PatchSetApplyResolvers.scala"),
      Json("""{"edits":[{"target":{"kind":"pipelineStep","id":"{id}"},"op":"update","patch":{"position":0}}]}"""), ownerControl = false),
    Row("POST patch-set preview: pipelineStep delete", HttpMethods.POST, "/api/patch-sets/preview", Step, Set("PatchSetApplyResolvers.scala"),
      Json("""{"edits":[{"target":{"kind":"pipelineStep","id":"{id}"},"op":"delete"}]}"""), ownerControl = false),
    Row("POST patch-set apply: pipelineStep create", HttpMethods.POST, "/api/patch-sets/apply", Pipeline, Set("PatchSetApplyResolvers.scala"),
      Json("""{"edits":[{"target":{"kind":"pipelineStep","parentId":"{id}"},"op":"create","patch":{"type":"cast","config":{}}}]}"""), ownerControl = false, patchKinds = Set("pipelineStep:create")),
    // outputs (HEL-1239): id is an OUTPUT id; owner-only, single `Output not found` for foreign AND absent
    Row("POST patch-set apply: output update", HttpMethods.POST, "/api/patch-sets/apply", OutputT, Set("PatchSetApplyResolvers.scala"),
      Json("""{"edits":[{"target":{"kind":"output","id":"{id}"},"op":"update","patch":{"name":"renamed"}}]}"""), patchKinds = Set("output:update")),
    Row("POST patch-set apply: output delete", HttpMethods.POST, "/api/patch-sets/apply", OutputT, Set("PatchSetApplyResolvers.scala"),
      Json("""{"edits":[{"target":{"kind":"output","id":"{id}"},"op":"delete"}]}"""), patchKinds = Set("output:delete")),
    Row("POST patch-set preview: output update", HttpMethods.POST, "/api/patch-sets/preview", OutputT, Set("PatchSetApplyResolvers.scala"),
      Json("""{"edits":[{"target":{"kind":"output","id":"{id}"},"op":"update","patch":{"name":"renamed"}}]}"""), patchKinds = Set("output:update")),
    Row("POST patch-set preview: output delete", HttpMethods.POST, "/api/patch-sets/preview", OutputT, Set("PatchSetApplyResolvers.scala"),
      Json("""{"edits":[{"target":{"kind":"output","id":"{id}"},"op":"delete"}]}"""), patchKinds = Set("output:delete")),
    // pipeline-scoped
    Row("GET pipeline outputs", HttpMethods.GET, "/api/pipelines/{id}/outputs", Pipeline, Set("OutputService.scala")),
    Row("POST pipeline outputs", HttpMethods.POST, "/api/pipelines/{id}/outputs", Pipeline, Set("OutputService.scala"),
      Json("""{"kind":"table","name":"x","config":{}}"""), ownerControl = false),
    Row("GET pipeline", HttpMethods.GET, "/api/pipelines/{id}", Pipeline, Set("PipelineService.scala")),
    Row("PATCH pipeline", HttpMethods.PATCH, "/api/pipelines/{id}", Pipeline, Set("PipelineService.scala"), Json("""{"name":"renamed"}""")),
    Row("DELETE pipeline", HttpMethods.DELETE, "/api/pipelines/{id}", Pipeline, Set("PipelineService.scala")),
    Row("GET pipeline analyze", HttpMethods.GET, "/api/pipelines/{id}/analyze", Pipeline, Set("PipelineService.scala"), ownerControl = false),
    Row("POST pipeline run", HttpMethods.POST, "/api/pipelines/{id}/run", Pipeline, Set("PipelineRunService.scala"), ownerControl = false),
    Row("GET pipeline run status", HttpMethods.GET, s"/api/pipelines/{id}/runs/$SeededRunId", Pipeline, Set("PipelineRunQueries.scala"), seedRun = true),
    Row("POST pipeline dry run", HttpMethods.POST, "/api/pipelines/{id}/run?dry=true", Pipeline, Set("PipelineRunService.scala"), ownerControl = false)
  )

  // ---- source scanning ----

  private def mainSourceRoot: Path = {
    val p = Paths.get("src/main/scala")
    require(Files.isDirectory(p), s"expected to run with cwd=backend (missing ${p.toAbsolutePath})")
    p
  }

  private def scalaFiles(): Vector[Path] = {
    val stream = Files.walk(mainSourceRoot)
    try stream.iterator().asScala.filter(_.toString.endsWith(".scala")).toVector
    finally stream.close()
  }

  /** Code lines only: drop block/line comments and doc lines so prose mentions never count. */
  private def codeLines(p: Path): Vector[String] =
    Files.readAllLines(p).asScala.toVector.map(_.trim).filterNot(l => l.startsWith("*") || l.startsWith("//") || l.startsWith("/*"))

  private val helperCall = """\b(requireOwnerOnly|requireAccess|authorizeResourceWithSharing|authorizeResource)\(""".r

  def filesCallingAccessHelpers(): Set[String] =
    scalaFiles().filter { p =>
      val name = p.getFileName.toString
      // the helpers' own definitions/implementations are not call sites
      name != "AccessCheckerImpl.scala" && name != "AccessChecker.scala" && name != "AclDirective.scala" &&
        codeLines(p).exists(l => !l.startsWith("def ") && !l.contains(" def ") && helperCall.findFirstIn(l).isDefined)
    }.map(_.getFileName.toString).toSet

  def forbiddenProducerCounts(): Map[String, Int] =
    scalaFiles().flatMap { p =>
      val n = codeLines(p).count(l => l.contains("ServiceError.Forbidden(") && !l.contains("Forbidden(_)"))
      if (n > 0) Some(p.getFileName.toString -> n) else None
    }.toMap

  private val dispatchCase = """case \("(\w+)", "(\w+)"\)""".r

  def patchSetDispatchPairs(): Set[String] = {
    val p = scalaFiles().find(_.getFileName.toString == "PatchSetApplyResolvers.scala").get
    codeLines(p).flatMap(l => dispatchCase.findFirstMatchIn(l).map(m => s"${m.group(1)}:${m.group(2)}")).toSet
  }

  /** Dispatch pairs not exercised by a table row, each with why that is sound (verified identical
   *  foreign-vs-absent by code reading + live probe in the evaluation; see forbidden-classification.md). */
  val patchKindExemptions: Map[String, String] = Map(
    "dashboard:update"  -> "sharing-aware dashboardRepo.findById(Some(user)) -> same `edit N: dashboard not found`",
    "dashboard:delete"  -> "sharing-aware dashboardRepo.findById(Some(user)) -> same message",
    "dashboard:create"  -> "no target id to probe",
    "dataSource:update" -> "owner-scoped lookup, single message",
    "dataSource:delete" -> "owner-scoped lookup, single message",
    "dataSource:create" -> "no target id to probe",
    "pipeline:update"   -> "findByIdShared(Some(user)) -> same `edit N: pipeline not found`",
    "pipeline:delete"   -> "findByIdShared(Some(user)) -> same message",
    "pipeline:create"   -> "no target id to probe",
    "output:create"     -> "rejected unsupported (400) for every caller"
  )

  /** Pinned inventory of `ServiceError.Forbidden(` producers; every entry is classified in
   *  forbidden-classification.md (all legitimate: the caller demonstrably already sees the
   *  resource, or the denial is not about a specific resource). The `PipelineRunPreview.scala` entry is
   *  the step-preview AI-closure gate, moved unchanged out of `PipelineRunService.scala` (HEL-1393). */
  val expectedForbiddenProducers: Map[String, Int] = Map(
    "AccessCheckerImpl.scala"        -> 1,
    "AutoLayoutService.scala"        -> 1,
    "DashboardContentsService.scala" -> 1,
    "DashboardService.scala"         -> 5,
    "HookTriggerService.scala"       -> 1,
    "OutputService.scala"            -> 1,
    "PanelService.scala"             -> 5,
    "PatchSetApplyResolvers.scala"   -> 4,
    "PipelineRunPreview.scala"       -> 1,
    "PipelineRunService.scala"       -> 1,
    "PipelineService.scala"          -> 1
  )
}
