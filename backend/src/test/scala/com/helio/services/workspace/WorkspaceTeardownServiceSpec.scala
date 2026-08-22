package com.helio.services.workspace

import com.helio.services.sources.DataSourceService
import com.helio.services.workspace.WorkspaceTeardownService
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.{DataTypeRepository, PipelineRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.workspace.WorkspaceTeardownRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.api.protocols.sources.{StaticColumnPayload, StaticDataSourceRequest}
import com.helio.api.protocols.workspace.{TeardownRequest, TeardownResponse}
import com.helio.domain.model._
import com.helio.domain.panels.{MetricPanel, MetricPanelConfig}
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
import spray.json.{JsObject, JsString}

import java.nio.file.Files
import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-366 tasks.md section 6 — `WorkspaceTeardownService.teardown` coverage.
 *
 *  **Real RLS, not the simplified `DbContext(db, db)` pattern most ACL specs
 *  use.** `WorkspaceTeardownRepository`'s dependent-cascade and source-link
 *  guards (`sourceDependentPipelineConflict`/`outputTypeDependentPipelineConflict`/
 *  `sourceLinkConflict`) are raw SQL with NO explicit `owner_id` predicate —
 *  their entire cross-owner safety comes from Postgres RLS evaluating under
 *  `withUserContext` (design.md Decision 3/6). A test harness where both the
 *  app pool and the privileged pool connect as the `postgres` superuser
 *  (BYPASSRLS) would make every guard query see every owner's rows regardless
 *  of correctness, and 6.9/6.12 would pass for the wrong reason. This spec
 *  mirrors `RlsOwnerTablesSpec`'s dual-pool harness instead: the app pool
 *  connects as a real, non-superuser `helio_app_test` role so V35/V36 FORCE
 *  ROW LEVEL SECURITY policies are actually evaluated. */
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
  private var dataTypeRepo: DataTypeRepository     = _
  private var pipelineRepo: PipelineRepository     = _
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
    dataTypeRepo   = new DataTypeRepository(ctx)(routeEc)
    pipelineRepo   = new PipelineRepository(ctx, dataTypeRepo, dataSourceRepo)(routeEc)
    panelRepo      = new PanelRepository(ctx)(routeEc)
    dashboardRepo  = new DashboardRepository(ctx)(routeEc)

    val tmpDir = Files.createTempDirectory("helio-teardown-spec")
    val fs     = new LocalFileSystem(tmpDir)
    dataSourceService = new DataSourceService(dataSourceRepo, dataTypeRepo, fs)(routeEc, mat, typedSystem)

    val teardownRepo = new WorkspaceTeardownRepository(ctx, dataTypeRepo)(routeEc)
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

  // ── Fixtures ────────────────────────────────────────────────────────────

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

  /** The auto-created companion DataType for `source` — found by tag among
   *  `user`'s tagged DataTypes (companion tag mirrors the owning source's,
   *  tasks.md 2.3(a)). */
  private def companionTypeOf(source: DataSource, tag: String, user: AuthenticatedUser): DataType =
    await(dataTypeRepo.findAll(user.id, Page(0, 200), Some(tag))).items
      .find(_.sourceId.contains(source.id))
      .getOrElse(fail(s"no companion DataType found for source ${source.id.value} tagged $tag"))

  /** Create a Pipeline (+ its freshly-inserted, same-tagged output DataType —
   *  the only insertion site, tasks.md 2.3(b)) over `sourceId`, owned by `user`. */
  private def createPipeline(
      user: AuthenticatedUser,
      sourceId: DataSourceId,
      tag: Option[String],
      name: String = s"pipe-${UUID.randomUUID()}",
      outputName: String = s"out-${UUID.randomUUID()}"
  ): PipelineSummary =
    await(pipelineRepo.create(name, sourceId, outputName, user, tag)) match {
      case Right(summary) => summary
      case Left(err)       => fail(s"pipeline create failed: $err")
    }

  /** Directly rewrite a pipeline's/data type's/data source's `tag` column via
   *  the privileged pool — the only way to construct an out-of-batch-tagged
   *  dependent whose retagging later "resolves the block" (tag is set-at-
   *  create-only on every real create path per design.md's non-goals; there
   *  is no update-tag endpoint to exercise instead). */
  private def retagPipeline(id: String, tag: String): Unit =
    await(ctx.withSystemContext(sqlu"UPDATE pipelines SET tag = $tag WHERE id = $id"))
  private def retagDataType(id: String, tag: String): Unit =
    await(ctx.withSystemContext(sqlu"UPDATE data_types SET tag = $tag WHERE id = $id"))
  private def retagDataSource(id: String, tag: String): Unit =
    await(ctx.withSystemContext(sqlu"UPDATE data_sources SET tag = $tag WHERE id = $id"))
  private def clearDataSourceTag(id: String): Unit =
    await(ctx.withSystemContext(sqlu"UPDATE data_sources SET tag = NULL WHERE id = $id"))

  /** Seed a dashboard + a metric panel bound to `dataTypeId`, owned by `user`. */
  private def bindPanelTo(dataTypeId: DataTypeId, user: AuthenticatedUser): Unit = {
    val now  = Instant.now()
    val dash = Dashboard(
      id         = DashboardId(UUID.randomUUID().toString),
      name       = "Dash",
      meta       = ResourceMeta(user.id.value, now, now),
      appearance = DashboardAppearance.Default,
      layout     = DashboardLayout.Default,
      ownerId    = user.id
    )
    await(dashboardRepo.insert(dash))
    val panel = MetricPanel(
      id          = PanelId(UUID.randomUUID().toString),
      dashboardId = dash.id,
      title       = "Metric",
      meta        = ResourceMeta(user.id.value, now, now),
      appearance  = PanelAppearance.Default,
      ownerId     = user.id,
      config      = MetricPanelConfig(dataTypeId, JsObject.empty)
    )
    await(panelRepo.insert(panel))
  }

  private def teardown(user: AuthenticatedUser, tag: String, dryRun: Boolean = false): TeardownResponse =
    await(teardownService.teardown(TeardownRequest(Some(tag), Some(dryRun)), user)) match {
      case Right(resp) => resp
      case Left(err)   => fail(s"teardown failed: $err")
    }

  private def sourceExists(id: DataSourceId, user: AuthenticatedUser): Boolean =
    await(dataSourceRepo.findByIdOwned(id, user)).isDefined
  private def typeExists(id: DataTypeId, user: AuthenticatedUser): Boolean =
    await(dataTypeRepo.findByIdOwned(id, user)).isDefined
  private def pipelineExists(id: String, user: AuthenticatedUser): Boolean =
    await(pipelineRepo.findByIdOwned(PipelineId(id), user)).isDefined

  // ── 6.3 Happy path ──────────────────────────────────────────────────────

  "teardown (6.3 happy path)" should {
    "delete only the tagged set, with correct per-kind counts, leaving untagged resources untouched" in {
      val tag = freshTag()

      // Fully self-contained tagged batch: source T -> companion type T,
      // pipeline T (over the same source) -> output type T.
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
      resp.typesDeleted shouldBe 2 // companion + pipeline output

      sourceExists(src.id, userA) shouldBe false
      pipelineExists(pipeline.id, userA) shouldBe false

      // Control set is completely untouched.
      sourceExists(controlSrc.id, userA) shouldBe true
      pipelineExists(controlPipeline.id, userA) shouldBe true
    }
  }

  // ── 6.4 DataSource -> Pipeline out-of-batch dependent guard ────────────

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
      blockedResp.typesDeleted shouldBe 0

      // Nothing deleted.
      sourceExists(src.id, userA) shouldBe true
      pipelineExists(dep.id, userA) shouldBe true

      // Tag the dependent (and its own output type, mirroring what a real
      // tagged create would look like) into the same batch, then retry.
      retagPipeline(dep.id, tag)
      retagDataType(dep.outputDataTypeId, tag)

      val resp = teardown(userA, tag)
      resp.committed shouldBe true
      resp.blocked shouldBe false
      resp.sourcesDeleted shouldBe 1
      resp.pipelinesDeleted shouldBe 1
      resp.typesDeleted shouldBe 2 // companion + dependent's own output type

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

      // Source + its companion are untouched (the block).
      sourceExists(src.id, userA) shouldBe true

      // The differently-tagged dependent pipeline is left COMPLETELY
      // untouched — not deleted, tag unchanged.
      val stillThere = await(pipelineRepo.findByIdOwned(PipelineId(dep.id), userA))
      stillThere shouldBe defined
      stillThere.get.tag shouldBe Some(otherTag)
    }
  }

  // ── 6.5 output DataType -> Pipeline out-of-batch dependent guard ───────

  "teardown (6.5 output DataType -> Pipeline dependent guard)" should {
    "block the whole call when the producing pipeline is untagged" in {
      val tag = freshTag()
      // An ordinary untagged source + pipeline; then retag ONLY the output
      // DataType into the batch, artificially producing the "tagged output,
      // untagged producer" state the guard exists to catch.
      val src      = createTaggedSource(userA, None)
      val pipeline = createPipeline(userA, src.id, None)
      retagDataType(pipeline.outputDataTypeId, tag)

      val resp = teardown(userA, tag)
      resp.blocked shouldBe true
      resp.committed shouldBe false
      resp.conflicts.exists(c => c.resourceKind == "data_type" && c.resourceId == pipeline.outputDataTypeId) shouldBe true
      resp.typesDeleted shouldBe 0

      typeExists(DataTypeId(pipeline.outputDataTypeId), userA) shouldBe true
    }

    "block the whole call when the producing pipeline is tagged into a DIFFERENT, live batch, " +
      "and leave that pipeline completely untouched" in {
      val tag      = freshTag()
      val otherTag = freshTag()
      val src      = createTaggedSource(userA, None)
      val pipeline = createPipeline(userA, src.id, Some(otherTag))
      retagDataType(pipeline.outputDataTypeId, tag)

      val resp = teardown(userA, tag)
      resp.blocked shouldBe true
      resp.committed shouldBe false
      resp.conflicts.exists(c => c.resourceKind == "data_type" && c.resourceId == pipeline.outputDataTypeId) shouldBe true

      val stillThere = await(pipelineRepo.findByIdOwned(PipelineId(pipeline.id), userA))
      stillThere shouldBe defined
      stillThere.get.tag shouldBe Some(otherTag)
    }
  }

  // ── 6.6 DataType guards (panel-bound / source-link) + 6.6a positive path ─

  "teardown (6.6 DataType guards)" should {
    "block on a tagged DataType bound to a panel (matches DELETE /api/types/:id's conflict)" in {
      val tag      = freshTag()
      val src      = createTaggedSource(userA, None)
      val pipeline = createPipeline(userA, src.id, Some(tag))
      bindPanelTo(DataTypeId(pipeline.outputDataTypeId), userA)

      val resp = teardown(userA, tag)
      resp.blocked shouldBe true
      resp.committed shouldBe false
      resp.conflicts.exists { c =>
        c.resourceKind == "data_type" && c.resourceId == pipeline.outputDataTypeId && c.reason.contains("panel")
      } shouldBe true

      typeExists(DataTypeId(pipeline.outputDataTypeId), userA) shouldBe true
      pipelineExists(pipeline.id, userA) shouldBe true
    }

    "block when a tagged companion DataType's linked source is UNTAGGED (not the same batch)" in {
      val tag = freshTag()
      // Create source+companion both tagged T, then untag ONLY the source —
      // the companion stays tagged T but its link no longer matches the batch.
      val src = createTaggedSource(userA, Some(tag))
      clearDataSourceTag(src.id.value)

      val companion = companionTypeOf(src, tag, userA)

      val resp = teardown(userA, tag)
      resp.blocked shouldBe true
      resp.committed shouldBe false
      resp.conflicts.exists(c => c.resourceKind == "data_type" && c.resourceId == companion.id.value) shouldBe true

      typeExists(companion.id, userA) shouldBe true
      sourceExists(src.id, userA) shouldBe true
    }

    "block when a tagged companion DataType's linked source is tagged into a DIFFERENT batch" in {
      val tag      = freshTag()
      val otherTag = freshTag()
      val src      = createTaggedSource(userA, Some(tag))
      val companion = companionTypeOf(src, tag, userA)
      retagDataSource(src.id.value, otherTag)

      val resp = teardown(userA, tag)
      resp.blocked shouldBe true
      resp.conflicts.exists(c => c.resourceKind == "data_type" && c.resourceId == companion.id.value) shouldBe true

      typeExists(companion.id, userA) shouldBe true
      val stillThere = await(dataSourceRepo.findByIdOwned(src.id, userA))
      stillThere shouldBe defined
      stillThere.get.tag shouldBe Some(otherTag)
    }
  }

  "teardown (6.6a positive path -- the ticket's primary use case)" should {
    "delete a tagged DataSource and its own tagged companion DataType together, in one call" in {
      val tag = freshTag()
      val src = createTaggedSource(userA, Some(tag))
      val companion = companionTypeOf(src, tag, userA)

      val resp = teardown(userA, tag)
      resp.committed shouldBe true
      resp.blocked shouldBe false
      resp.sourcesDeleted shouldBe 1
      resp.typesDeleted shouldBe 1
      resp.pipelinesDeleted shouldBe 0

      sourceExists(src.id, userA) shouldBe false
      typeExists(companion.id, userA) shouldBe false
    }
  }

  // ── 6.7 Idempotency ─────────────────────────────────────────────────────

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
      second.typesDeleted shouldBe 0
    }
  }

  // ── 6.8 Dry run ─────────────────────────────────────────────────────────

  "teardown (6.8 dry run)" should {
    "report would-be counts for a clean set without deleting anything" in {
      val tag = freshTag()
      val src = createTaggedSource(userA, Some(tag))

      val resp = teardown(userA, tag, dryRun = true)
      resp.dryRun shouldBe true
      resp.committed shouldBe false
      resp.blocked shouldBe false
      resp.sourcesDeleted shouldBe 1
      resp.typesDeleted shouldBe 1

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
      val bCompanion = companionTypeOf(bSrc, tag, userB)
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
      resp.typesDeleted shouldBe 1

      sourceExists(aSrc.id, userA) shouldBe false

      // Direct DB assertion (not just trusting A's response shape): B's
      // same-tagged rows are all still present, queried as B.
      sourceExists(bSrc.id, userB) shouldBe true
      typeExists(bCompanion.id, userB) shouldBe true
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
      resp.typesDeleted shouldBe 0

      sourceExists(bSrc.id, userB) shouldBe true
    }
  }

  // ── 6.12 Teardown never touches the privileged pool (RLS-scoped, not leaked) ─

  "teardown (6.12 privileged-pool non-leak)" should {
    "treat a DataType whose sourceId points at a DataSource NOT owned by the caller as having " +
      "no linked source, rather than leaking cross-owner existence via the source-link guard" in {
      val tag = freshTag()

      // A source owned by user B (untagged; irrelevant to A's teardown tag).
      val bSrc = createTaggedSource(userB, None)

      // A DataType owned by A, tagged T, but whose sourceId points at B's
      // source — a state no real create path can produce (every create path
      // links a DataType only to a source the SAME owner just created); built
      // directly via the privileged pool to construct the dangling reference
      // this guard's RLS-scoping must not leak on.
      val danglingId = UUID.randomUUID().toString
      await(ctx.withSystemContext(
        sqlu"""INSERT INTO data_types (id, name, fields, version, owner_id, source_id, tag, created_at, updated_at)
               VALUES ($danglingId, 'Dangling', '[]'::jsonb, 1, $userAId::uuid, ${bSrc.id.value}, $tag, now(), now())"""
      ))

      val resp = teardown(userA, tag)

      // Not blocked: under `withUserContext(A)`, RLS hides B's source from
      // the source-link guard's query entirely, so it is treated as "no
      // linked source" (design.md Decision 3/6) rather than a cross-owner
      // existence leak that would (wrongly) block or (worse) surface B's
      // source's name/id to A.
      resp.blocked shouldBe false
      resp.committed shouldBe true
      resp.conflicts shouldBe empty
      resp.typesDeleted shouldBe 1

      typeExists(DataTypeId(danglingId), userA) shouldBe false
      // B's source itself is never touched.
      sourceExists(bSrc.id, userB) shouldBe true
    }
  }
}
