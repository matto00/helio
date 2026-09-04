package com.helio.services.workspace

import com.helio.services.sources.DataSourceService
import com.helio.services.workspace.WorkspaceTeardownService
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.PipelineRepository
import com.helio.infrastructure.persistence.pipelines.OutputRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.domain.panels.{OutputPanel, OutputPanelConfig}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.workspace.WorkspaceTeardownRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.api.protocols.sources.{StaticColumnPayload, StaticDataSourceRequest}
import com.helio.api.protocols.workspace.{TeardownRequest, TeardownResponse}
import com.helio.domain.model._
import com.helio.infrastructure.persistence.pipelines.PipelineRepository.PipelineSummary
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.apache.pekko.stream.{Materializer, SystemMaterializer}
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json.JsString

import java.nio.file.Files
import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-366 tasks.md section 6 — `WorkspaceTeardownService.teardown` coverage.
 *
 *  **Real RLS, not the simplified `DbContext(db, db)` pattern most ACL specs
 *  use.** `WorkspaceTeardownRepository`'s remaining dependent-cascade guard
 *  (`sourceDependentPipelineConflict`) is raw SQL with NO explicit `owner_id`
 *  predicate — its entire cross-owner safety comes from Postgres RLS
 *  evaluating under `withUserContext` (design.md Decision 3/6). A test
 *  harness where both the app pool and the privileged pool connect as the
 *  `postgres` superuser (BYPASSRLS) would make every guard query see every
 *  owner's rows regardless of correctness, and 6.9 would pass for the wrong
 *  reason. This spec mirrors `RlsOwnerTablesSpec`'s dual-pool harness
 *  instead: the app pool connects as a real, non-superuser `helio_app_test`
 *  role so V35/V36 FORCE ROW LEVEL SECURITY policies are actually evaluated.
 *
 *  HEL-904 task 3.2: the `resourceKind = "data_type"` teardown branch (and
 *  its `outputTypeDependentPipelineConflict`/`sourceLinkConflict`/
 *  `panelBoundConflict` guards) is REMOVED outright, per the
 *  `workspace-tag-teardown` OpenSpec delta — Outputs cascade with their
 *  owning pipeline instead. The old sections 6.5/6.6/6.12 (which exercised
 *  exactly those retired guards) are removed below; every remaining section
 *  is updated to drop its `typesDeleted` assertions (the field itself is
 *  removed from `TeardownResponse`). Companion DataTypes minted by
 *  `DataSourceService.createStatic` (legacy path, still live until section
 *  4) are no longer torn down by this service at all -- `data_types.
 *  source_id` is `ON DELETE SET NULL` (V4), so a companion row simply
 *  survives its source's deletion, orphaned but present, exactly like any
 *  other resource this ticket doesn't touch. */
class WorkspaceTeardownServiceSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private implicit val mat: Materializer                 = SystemMaterializer(typedSystem).materializer
  private def routeEc: ExecutionContext                  = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres = _
  private var appDb: JdbcBackend.Database        = _
  private var privilegedDb: JdbcBackend.Database = _
  private var ctx: DbContext                     = _

  private var dataSourceRepo: DataSourceRepository = _
  private var pipelineRepo: PipelineRepository     = _
  private var outputRepo: OutputRepository         = _
  private var panelRepo: PanelRepository           = _
  private var dashboardRepo: DashboardRepository   = _
  private var dataSourceService: DataSourceService = _
  private var teardownService: WorkspaceTeardownService = _

  private val userAId = UUID.randomUUID().toString
  private val userBId = UUID.randomUUID().toString
  private val userA   = AuthenticatedUser(UserId(userAId))
  private val userB   = AuthenticatedUser(UserId(userBId))

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    val superDs   = embeddedPostgres.getPostgresDatabase
    val superJdbc = embeddedPostgres.getJdbcUrl("postgres", "postgres")
    Flyway.configure()
      .dataSource(superJdbc, "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()

    import com.zaxxer.hikari.{HikariConfig, HikariDataSource}

    val privCfg = new HikariConfig()
    privCfg.setDataSource(superDs)
    privCfg.setMaximumPoolSize(5)
    privCfg.setConnectionInitSql("SET ROLE helio_privileged")
    privilegedDb = JdbcBackend.Database.forDataSource(new HikariDataSource(privCfg), Some(5))

    val superConn = superDs.getConnection
    try {
      val stmt = superConn.createStatement()
      stmt.execute(
        """DO $$ BEGIN
          |  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'helio_app_test') THEN
          |    CREATE ROLE helio_app_test NOSUPERUSER NOCREATEDB NOCREATEROLE NOLOGIN;
          |  END IF;
          |END $$""".stripMargin
      )
      stmt.execute("GRANT helio_app_test TO postgres")
      stmt.execute("GRANT USAGE ON SCHEMA public TO helio_app_test")
      stmt.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO helio_app_test")
      stmt.execute("GRANT USAGE ON SCHEMA public TO helio_privileged")
      stmt.execute("GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public TO helio_privileged")
      stmt.execute("GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO helio_privileged")
      stmt.close()
    } finally {
      superConn.close()
    }

    val appCfg = new HikariConfig()
    appCfg.setDataSource(superDs)
    appCfg.setMaximumPoolSize(5)
    appCfg.setConnectionInitSql("SET ROLE helio_app_test")
    appDb = JdbcBackend.Database.forDataSource(new HikariDataSource(appCfg), Some(5))

    ctx            = new DbContext(appDb, privilegedDb)(routeEc)
    dataSourceRepo = new DataSourceRepository(ctx)(routeEc)
    pipelineRepo   = new PipelineRepository(ctx, dataSourceRepo)(routeEc)
    outputRepo     = new OutputRepository(ctx)(routeEc)
    panelRepo      = new PanelRepository(ctx)(routeEc)
    dashboardRepo  = new DashboardRepository(ctx)(routeEc)

    val tmpDir = Files.createTempDirectory("helio-teardown-spec")
    val fs     = new LocalFileSystem(tmpDir)
    dataSourceService = new DataSourceService(dataSourceRepo, fs)(routeEc, mat, typedSystem)

    val teardownRepo = new WorkspaceTeardownRepository(ctx)(routeEc)
    teardownService = new WorkspaceTeardownService(teardownRepo, fs)(routeEc)

    await(ctx.withSystemContext(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($userAId::uuid, ${s"a-$userAId@test.local"}, now())""",
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($userBId::uuid, ${s"b-$userBId@test.local"}, now())"""
    )))
  }

  override def afterAll(): Unit = {
    appDb.close()
    privilegedDb.close()
    embeddedPostgres.close()
    super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  /** A fresh random tag per fixture so tests never collide with each other's
   *  tagged sets — no interstitial `TRUNCATE` needed between tests. */
  private def freshTag(): String = s"t-${UUID.randomUUID().toString.take(8)}"


  /** Create a `static` DataSource (+ its auto-created, same-tagged companion
   *  DataType — design.md Decision 6 / tasks.md 2.3(a)) owned by `user`. */
  private def createTaggedSource(
      user: AuthenticatedUser,
      tag: Option[String],
      name: String = s"src-${UUID.randomUUID()}"
  ): DataSource = {
    val req = StaticDataSourceRequest(
      name    = name,
      `type`  = "static",
      columns = Vector(StaticColumnPayload("value", "string")),
      rows    = Vector(Vector(JsString("x"))),
      tag     = tag
    )
    await(dataSourceService.createStatic(req, user)) match {
      case Right(ds)  => ds
      case Left(err)  => fail(s"createStatic failed: $err")
    }
  }


  /** Create a Pipeline (+ its freshly-inserted, same-tagged output DataType —
   *  the only insertion site, tasks.md 2.3(b)) over `sourceId`, owned by `user`. */
  /** Test-only shape mirroring the pre-3.5 `PipelineSummary` -- `id` and
   *  `outputDataTypeId` are the only fields this spec's own assertions
   *  read. */
  private final case class SeededPipeline(id: String)

  /** HEL-904 task 2.10: the companion-DataType fixture step (a `data_types`
   *  row wired in solely to satisfy `pipelines.output_data_type_id`'s FK)
   *  is removed outright -- that column is dropped by this task, and
   *  `outputDataTypeId` was never actually read by any assertion in this
   *  file. */
  private def createPipeline(
      user: AuthenticatedUser,
      sourceId: DataSourceId,
      tag: Option[String],
      name: String = s"pipe-${UUID.randomUUID()}",
      outputName: String = s"out-${UUID.randomUUID()}"
  ): SeededPipeline = {
    val summary = await(pipelineRepo.create(name, Vector(sourceId), user, tag)) match {
      case Right(s)  => s
      case Left(err) => fail(s"pipeline create failed: $err")
    }
    SeededPipeline(id = summary.id)
  }

  /** Directly rewrite a pipeline's/data type's/data source's `tag` column via
   *  the privileged pool — the only way to construct an out-of-batch-tagged
   *  dependent whose retagging later "resolves the block" (tag is set-at-
   *  create-only on every real create path per design.md's non-goals; there
   *  is no update-tag endpoint to exercise instead). */
  private def retagPipeline(id: String, tag: String): Unit =
    await(ctx.withSystemContext(sqlu"UPDATE pipelines SET tag = $tag WHERE id = $id"))

  private def teardown(user: AuthenticatedUser, tag: String, dryRun: Boolean = false): TeardownResponse =
    await(teardownService.teardown(TeardownRequest(Some(tag), Some(dryRun)), user)) match {
      case Right(resp) => resp
      case Left(err)   => fail(s"teardown failed: $err")
    }

  private def sourceExists(id: DataSourceId, user: AuthenticatedUser): Boolean =
    await(dataSourceRepo.findByIdOwned(id, user)).isDefined
  // HEL-904 task 4.1: `typeExists` (DataTypeRepository-backed) removed outright -- unused
  // (no test in this file ever called it) and DataTypeRepository no longer exists.
  private def pipelineExists(id: String, user: AuthenticatedUser): Boolean =
    await(pipelineRepo.findByIdOwned(PipelineId(id), user)).isDefined

  /** HEL-907 task 2.1/5.8: seed an Output on `pipelineId` (no node -- attached
   *  directly to the source) plus a dashboard + a placement Panel bound to
   *  it, so a teardown test can assert the whole chain (pipeline -> Output ->
   *  placement) is torn down transitively via the `ON DELETE CASCADE` FKs
   *  V94 wires (outputs.pipeline_id -> pipelines, panels.output_id ->
   *  outputs) -- Outputs/placements carry no independent tag of their own
   *  (WorkspaceTeardownRepository's own docstring). */
  private def seedOutputWithPlacement(pipelineId: String, user: AuthenticatedUser): (String, String) = {
    val output = await(
      outputRepo.insertInternal(
        PipelineId(pipelineId), None, user.id, s"out-${UUID.randomUUID()}", OutputKind.Table
      , explicitRootId = None)
    )
    val dashboard = await(dashboardRepo.insert(
      Dashboard(
        DashboardId(UUID.randomUUID().toString),
        "Placement dashboard",
        ResourceMeta(user.id.value, Instant.now(), Instant.now()),
        DashboardAppearance("#fff", "#eee"),
        DashboardLayout(Vector.empty, Vector.empty, Vector.empty, Vector.empty),
        user.id
      )
    ))
    val panel = await(panelRepo.insert(
      OutputPanel(
        PanelId(UUID.randomUUID().toString),
        dashboard.id,
        "Placement panel",
        ResourceMeta(user.id.value, Instant.now(), Instant.now()),
        PanelAppearance("#fff", "#000", 1.0),
        user.id,
        OutputPanelConfig(output.id)
      )
    ))
    (output.id.value, panel.id.value)
  }

  private def outputExists(id: String, user: AuthenticatedUser): Boolean =
    await(outputRepo.findByIdOwned(OutputId(id), user)).isDefined

  private def panelExists(id: String): Boolean =
    await(panelRepo.findByIdInternal(PanelId(id))).isDefined

  /** HEL-907 evaluator-1 CR3: a real, standalone tagged dashboard (no
   *  pipeline/Output involved) -- proves dashboards participate in
   *  tag-scoped teardown on their own, not just as `seedOutputWithPlacement`'s
   *  incidental cascade target. */
  private def seedTaggedDashboard(user: AuthenticatedUser, tag: Option[String]): Dashboard =
    await(dashboardRepo.insert(
      Dashboard(
        DashboardId(UUID.randomUUID().toString),
        "Tagged dashboard",
        ResourceMeta(user.id.value, Instant.now(), Instant.now()),
        DashboardAppearance("#fff", "#eee"),
        DashboardLayout(Vector.empty, Vector.empty, Vector.empty, Vector.empty),
        user.id,
        tag
      )
    ))

  private def dashboardExists(id: DashboardId, user: AuthenticatedUser): Boolean =
    await(dashboardRepo.findByIdOwned(id, user)).isDefined


  "teardown (6.3 happy path)" should {
    "delete only the tagged set, with correct per-kind counts, leaving untagged resources untouched" in {
      val tag = freshTag()

      // Fully self-contained tagged batch: source T, pipeline T (over the
      // same source).
      val src      = createTaggedSource(userA, Some(tag))
      val pipeline = createPipeline(userA, src.id, Some(tag))

      // Untouched control: a wholly untagged source + pipeline.
      val controlSrc      = createTaggedSource(userA, None)
      val controlPipeline = createPipeline(userA, controlSrc.id, None)

      val resp = teardown(userA, tag)

      resp.committed shouldBe true
      resp.blocked shouldBe false
      resp.conflicts shouldBe empty
      resp.sourcesDeleted shouldBe 1
      resp.pipelinesDeleted shouldBe 1

      sourceExists(src.id, userA) shouldBe false
      pipelineExists(pipeline.id, userA) shouldBe false

      sourceExists(controlSrc.id, userA) shouldBe true
      pipelineExists(controlPipeline.id, userA) shouldBe true
    }

    "cascade-delete a tagged pipeline's Outputs and their placements (HEL-907 tasks 2.1/5.8)" in {
      val tag      = freshTag()
      val src      = createTaggedSource(userA, Some(tag))
      val pipeline = createPipeline(userA, src.id, Some(tag))
      val (outputId, panelId) = seedOutputWithPlacement(pipeline.id, userA)

      outputExists(outputId, userA) shouldBe true
      panelExists(panelId) shouldBe true

      val resp = teardown(userA, tag)

      resp.committed shouldBe true
      resp.blocked shouldBe false
      pipelineExists(pipeline.id, userA) shouldBe false
      // Neither the Output nor its placement Panel carries its own tag --
      // both are torn down transitively via ON DELETE CASCADE from the
      // deleted pipeline row (outputs.pipeline_id, then panels.output_id).
      outputExists(outputId, userA) shouldBe false
      panelExists(panelId) shouldBe false
    }

    // HEL-907 evaluator-1 CR3: `create_dashboard` gained a `tag` param
    // (V95) specifically so the MCP E2E Sleeper-rebuild script's dashboards
    // are reclaimable by tag-scoped teardown, same as sources/pipelines
    // already were -- this proves the whole chain end to end at the service
    // layer (a standalone tagged dashboard, not incidentally via a
    // pipeline's Output placement).
    "delete a tagged dashboard, leaving an untagged one untouched, and reports the count" in {
      val tag = freshTag()

      val tagged   = seedTaggedDashboard(userA, Some(tag))
      val control  = seedTaggedDashboard(userA, None)

      val resp = teardown(userA, tag)

      resp.committed shouldBe true
      resp.blocked shouldBe false
      resp.dashboardsDeleted shouldBe 1

      dashboardExists(tagged.id, userA) shouldBe false
      dashboardExists(control.id, userA) shouldBe true
    }
  }


  "teardown (6.4 DataSource -> Pipeline dependent guard)" should {
    "block the whole call when the dependent pipeline is untagged, then succeed once it is tagged in" in {
      val tag = freshTag()
      val src = createTaggedSource(userA, Some(tag))
      val dep = createPipeline(userA, src.id, None) // untagged dependent

      val blockedResp = teardown(userA, tag)
      blockedResp.blocked shouldBe true
      blockedResp.committed shouldBe false
      blockedResp.conflicts should not be empty
      blockedResp.conflicts.exists(c => c.resourceKind == "data_source" && c.resourceId == src.id.value) shouldBe true
      blockedResp.sourcesDeleted shouldBe 0
      blockedResp.pipelinesDeleted shouldBe 0

      sourceExists(src.id, userA) shouldBe true
      pipelineExists(dep.id, userA) shouldBe true

      // Tag the dependent into the same batch, then retry.
      retagPipeline(dep.id, tag)

      val resp = teardown(userA, tag)
      resp.committed shouldBe true
      resp.blocked shouldBe false
      resp.sourcesDeleted shouldBe 1
      resp.pipelinesDeleted shouldBe 1

      sourceExists(src.id, userA) shouldBe false
      pipelineExists(dep.id, userA) shouldBe false
    }

    "block the whole call when the dependent pipeline is tagged into a DIFFERENT, live batch, " +
      "and leave that pipeline completely untouched" in {
      val tag       = freshTag()
      val otherTag  = freshTag()
      val src       = createTaggedSource(userA, Some(tag))
      val dep       = createPipeline(userA, src.id, Some(otherTag))

      val resp = teardown(userA, tag)
      resp.blocked shouldBe true
      resp.committed shouldBe false
      resp.conflicts.exists(c => c.resourceKind == "data_source" && c.resourceId == src.id.value) shouldBe true

      // Source is untouched (the block).
      sourceExists(src.id, userA) shouldBe true

      // The differently-tagged dependent pipeline is left COMPLETELY
      // untouched — not deleted, tag unchanged.
      val stillThere = await(pipelineRepo.findByIdOwned(PipelineId(dep.id), userA))
      stillThere shouldBe defined
      stillThere.get.tag shouldBe Some(otherTag)
    }
  }

  // ── 6.6a positive path: companion DataType is no longer torn down at all ─

  "teardown (6.6a positive path -- the ticket's primary use case)" should {
    // HEL-904 (4.1/4.3): `DataSourceService.createStatic` no longer mints a companion DataType
    // at all -- the source's schema lives inline on `data_sources.inferred_schema`, deleted
    // automatically with the row. There is no longer an orphan-survives scenario to assert.
    "delete a tagged DataSource, with no companion DataType ever created (HEL-904: the " +
      "data_type teardown branch is removed outright)" in {
      val tag = freshTag()
      val src = createTaggedSource(userA, Some(tag))

      val resp = teardown(userA, tag)
      resp.committed shouldBe true
      resp.blocked shouldBe false
      resp.sourcesDeleted shouldBe 1
      resp.pipelinesDeleted shouldBe 0

      sourceExists(src.id, userA) shouldBe false
    }
  }


  "teardown (6.7 idempotency)" should {
    "return all-zero counts on a repeat call with the same tag after success" in {
      val tag = freshTag()
      createTaggedSource(userA, Some(tag))

      val first = teardown(userA, tag)
      first.committed shouldBe true
      first.sourcesDeleted shouldBe 1

      val second = teardown(userA, tag)
      second.committed shouldBe true
      second.blocked shouldBe false
      second.sourcesDeleted shouldBe 0
      second.pipelinesDeleted shouldBe 0
    }
  }


  "teardown (6.8 dry run)" should {
    "report would-be counts for a clean set without deleting anything" in {
      val tag = freshTag()
      val src = createTaggedSource(userA, Some(tag))

      val resp = teardown(userA, tag, dryRun = true)
      resp.dryRun shouldBe true
      resp.committed shouldBe false
      resp.blocked shouldBe false
      resp.sourcesDeleted shouldBe 1

      sourceExists(src.id, userA) shouldBe true
    }

    "report the same conflicts a real call would hit, for a blocked set" in {
      val tag = freshTag()
      val src = createTaggedSource(userA, Some(tag))
      createPipeline(userA, src.id, None) // untagged dependent -> blocks

      val dry  = teardown(userA, tag, dryRun = true)
      val real = teardown(userA, tag, dryRun = false)

      dry.blocked shouldBe true
      dry.committed shouldBe false
      real.blocked shouldBe true
      real.committed shouldBe false
      dry.conflicts.map(c => (c.resourceKind, c.resourceId, c.reason)) shouldBe
        real.conflicts.map(c => (c.resourceKind, c.resourceId, c.reason))

      sourceExists(src.id, userA) shouldBe true
    }
  }

  // ── 6.9 Cross-owner isolation (the most important test in this change) ──

  "teardown (6.9 cross-owner isolation)" should {
    "never discover, count, report, or delete another owner's same-tagged resources" in {
      val tag = freshTag()

      // User B's own tagged resource graph.
      val bSrc      = createTaggedSource(userB, Some(tag))
      val bPipeline  = createPipeline(userB, bSrc.id, Some(tag))

      // User A's own, smaller tagged resource (source + companion only).
      val aSrc = createTaggedSource(userA, Some(tag))

      val resp = teardown(userA, tag)

      // A's response reflects ONLY A's own resources.
      resp.committed shouldBe true
      resp.blocked shouldBe false
      resp.conflicts shouldBe empty
      resp.sourcesDeleted shouldBe 1
      resp.pipelinesDeleted shouldBe 0

      sourceExists(aSrc.id, userA) shouldBe false

      // Direct DB assertion (not just trusting A's response shape): B's
      // same-tagged rows are all still present, queried as B.
      sourceExists(bSrc.id, userB) shouldBe true
      pipelineExists(bPipeline.id, userB) shouldBe true
    }

    "succeed with all-zero counts when the caller owns nothing tagged, even though another owner does" in {
      val tag = freshTag()
      val bSrc = createTaggedSource(userB, Some(tag))

      val resp = teardown(userA, tag)
      resp.committed shouldBe true
      resp.blocked shouldBe false
      resp.sourcesDeleted shouldBe 0
      resp.pipelinesDeleted shouldBe 0

      sourceExists(bSrc.id, userB) shouldBe true
    }
  }
}
