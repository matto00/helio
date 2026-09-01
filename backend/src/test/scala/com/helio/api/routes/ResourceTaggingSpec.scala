package com.helio.api.routes

import com.helio.api.routes.pipelines.PipelineRoutes
import com.helio.api.routes.sources.DataSourceRoutes
import com.helio.api.routes.workspace.WorkspaceRoutes
import com.helio.services.dashboards.DashboardService
import com.helio.services.pipelines.PipelineService
import com.helio.services.sources.DataSourceService
import com.helio.services.workspace.{WorkspaceContextService, WorkspaceTeardownService}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ResourcePermissionRepository
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputRepository, PipelineRepository, PipelineRunRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.workspace.WorkspaceTeardownRepository
import com.helio.infrastructure.storage.LocalFileSystem
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, StatusCodes}
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.api.http.{AccessCheckerImpl, ResourceTypeRegistry}
import com.helio.api.{DataSourceResponse, JsonProtocols, PipelineSummaryResponse, TeardownResponse}
import com.helio.domain.model._
import com.helio.spark.PipelineRunCache
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.nio.file.Files
import java.time.Instant
import java.util.UUID
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

/** HEL-366 tasks.md 6.1 / 6.2 / 6.11 — tag persistence through create -> read,
 *  `?tag=` list filtering (owner-scoped), and wire-format absent-vs-null
 *  parity for `tag`/`dryRun` (design.md Decision 8's spray-json gotcha).
 *
 *  Uses the same simplified `DbContext(db, db)` pattern `DataTypeDataSourceAclSpec`
 *  does (not the real-RLS dual-pool harness `WorkspaceTeardownServiceSpec` uses)
 *  — every assertion here is about wire marshalling / the already-owner-scoped
 *  `findAll(ownerId, ...)` Scala query, not about the RLS-only-scoped teardown
 *  guards, so the simpler pool is the right tool (mirrors this repo's existing
 *  convention for that class of test). */
class ResourceTaggingSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                  = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var dataSourceRepo: DataSourceRepository = _
  private var pipelineRepo: PipelineRepository     = _
  private var pipelineStepRepo: PipelineStepRepository = _
  private var pipelineRunRepo: PipelineRunRepository = _
  private var outputRepo: OutputRepository = _
  private var nodeSnapshotRepo: NodeSnapshotRepository = _

  private val userAId = UUID.randomUUID().toString
  private val userBId = UUID.randomUUID().toString
  private val userA   = AuthenticatedUser(UserId(userAId))
  private val userB   = AuthenticatedUser(UserId(userBId))

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db               = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx          = new DbContext(db, db)(routeEc)
    dataSourceRepo   = new DataSourceRepository(ctx)(routeEc)
    pipelineRepo     = new PipelineRepository(ctx, dataSourceRepo)(routeEc)
    pipelineStepRepo = new PipelineStepRepository(ctx)(routeEc)
    pipelineRunRepo  = new PipelineRunRepository(ctx)(routeEc)
    outputRepo       = new OutputRepository(ctx)(routeEc)
    nodeSnapshotRepo = new NodeSnapshotRepository(ctx)(routeEc)
    seedUsers()
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)
  private def freshTag(): String = s"t-${UUID.randomUUID().toString.take(8)}"

  private def seedUsers(): Unit = {
    import PostgresProfile.api._
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($userAId::uuid, ${s"a-$userAId@test.local"}, now())""",
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($userBId::uuid, ${s"b-$userBId@test.local"}, now())"""
    )))
  }


  private def dataSourceRoutesFor(user: AuthenticatedUser): Route = {
    implicit val ec: ExecutionContext = routeEc
    val tmpDir = Files.createTempDirectory("helio-tag-spec")
    val fs     = new LocalFileSystem(tmpDir)
    val svc    = new DataSourceService(dataSourceRepo, fs)
    new DataSourceRoutes(svc, user)(typedSystem).routes
  }

  private def pipelineRoutesFor(user: AuthenticatedUser): Route = {
    implicit val ec: ExecutionContext = routeEc
    val svc = new PipelineService(pipelineRepo, pipelineStepRepo, dataSourceRepo)
    new PipelineRoutes(svc, user)(routeEc).routes
  }

  private def workspaceRoutesFor(user: AuthenticatedUser): Route = {
    implicit val ec: ExecutionContext = routeEc
    val tmpDir = Files.createTempDirectory("helio-tag-spec-workspace")
    val fs     = new LocalFileSystem(tmpDir)
    val ctx    = new DbContext(db, db)(routeEc)
    val teardownRepo = new WorkspaceTeardownRepository(ctx)(routeEc)
    val teardownSvc   = new WorkspaceTeardownService(teardownRepo, fs)(routeEc)
    // HEL-371: WorkspaceContextService's four dependencies, built the same
    // way `dataSourceRoutesFor`/`pipelineRoutesFor` above build theirs —
    // "dashboard" is the only ACL resource type any of this fixture's calls
    // actually resolve (mirrors BoundPanelRoutesSpec's identical registry
    // carve-out comment).
    val dashboardRepo  = new DashboardRepository(ctx)(routeEc)
    val registry        = new ResourceTypeRegistry()
    val accessChecker    = new AccessCheckerImpl(new ResourcePermissionRepository(ctx)(routeEc), registry)
    val dashboardService = new DashboardService(dashboardRepo, accessChecker)
    val dataSourceService = new DataSourceService(dataSourceRepo, fs)
    val pipelineService   = new PipelineService(pipelineRepo, pipelineStepRepo, dataSourceRepo)
    // HEL-904 task 3.12: WorkspaceContextService takes an OutputRepository now.
    val outputRepo = new OutputRepository(ctx)(routeEc)
    val contextSvc = new WorkspaceContextService(dashboardService, dataSourceService, outputRepo, pipelineService)
    new WorkspaceRoutes(Some(teardownSvc), contextSvc, user)(routeEc).routes
  }

  private def createStaticSourceJson(name: String, tagField: String): String =
    s"""{"name":"$name","type":"static","columns":[{"name":"value","type":"string"}],"rows":[["x"]]$tagField}"""


  "tag (6.1 persists create -> read)" should {
    "round-trip through a tagged data source create + list" in {
      val tag = freshTag()
      val body = createStaticSourceJson("Tagged Source", s""","tag":"$tag"""")
      Post("/data-sources", HttpEntity(ContentTypes.`application/json`, body)) ~> dataSourceRoutesFor(userA) ~> check {
        status shouldBe StatusCodes.Created
        responseAs[DataSourceResponse].tag shouldBe Some(tag)
      }
      Get("/data-sources") ~> dataSourceRoutesFor(userA) ~> check {
        val items = responseAs[JsObject].fields("items").convertTo[Vector[DataSourceResponse]]
        items.find(_.name == "Tagged Source").flatMap(_.tag) shouldBe Some(tag)
      }
    }

    "leave tag null (and behavior otherwise unchanged) when omitted at create time" in {
      val body = createStaticSourceJson("Untagged Source", "")
      Post("/data-sources", HttpEntity(ContentTypes.`application/json`, body)) ~> dataSourceRoutesFor(userA) ~> check {
        status shouldBe StatusCodes.Created
        responseAs[DataSourceResponse].tag shouldBe None
      }
    }

    "round-trip through a tagged pipeline create + list" in {
      val tag = freshTag()
      val src = await(dataSourceRepo.insert(
        StaticSource(DataSourceId(UUID.randomUUID().toString), s"src-${UUID.randomUUID()}", userA.id,
          Instant.now(), Instant.now()),
        userA
      ))
      val body = s"""{"name":"Tagged Pipeline","sourceDataSourceId":"${src.id.value}","outputDataTypeName":"Out","tag":"$tag"}"""
      Post("/pipelines", HttpEntity(ContentTypes.`application/json`, body)) ~> pipelineRoutesFor(userA) ~> check {
        status shouldBe StatusCodes.Created
        responseAs[PipelineSummaryResponse].tag shouldBe Some(tag)
      }
      Get("/pipelines") ~> pipelineRoutesFor(userA) ~> check {
        val summaries = responseAs[Vector[PipelineSummaryResponse]]
        summaries.find(_.name == "Tagged Pipeline").flatMap(_.tag) shouldBe Some(tag)
      }
    }

    // HEL-904 (4.1/4.3): `POST /data-sources` no longer auto-creates a companion DataType at
    // all — the source's inferred schema lives inline on `data_sources.inferred_schema`, so
    // there is no longer a companion resource for a tag to propagate to. Removed outright
    // (not skipped) per the retired-scenario convention this ticket's other cycles used.
  }


  "tag (6.2 list filtering)" should {
    "GET /data-sources?tag= returns exactly the tagged set" in {
      val tag = freshTag()
      Post("/data-sources", HttpEntity(ContentTypes.`application/json`, createStaticSourceJson("Filter A", s""","tag":"$tag""""))) ~>
        dataSourceRoutesFor(userA) ~> check { status shouldBe StatusCodes.Created }
      Post("/data-sources", HttpEntity(ContentTypes.`application/json`, createStaticSourceJson("Filter B", ""))) ~>
        dataSourceRoutesFor(userA) ~> check { status shouldBe StatusCodes.Created }

      Get(s"/data-sources?tag=$tag") ~> dataSourceRoutesFor(userA) ~> check {
        val items = responseAs[JsObject].fields("items").convertTo[Vector[DataSourceResponse]]
        items.map(_.name) shouldBe Vector("Filter A")
      }
    }

    "GET /pipelines?tag= returns exactly the tagged set" in {
      val tag = freshTag()
      val src = await(dataSourceRepo.insert(
        StaticSource(DataSourceId(UUID.randomUUID().toString), s"src-${UUID.randomUUID()}", userA.id,
          Instant.now(), Instant.now()),
        userA
      ))
      await(pipelineRepo.create("Tagged", src.id, userA, Some(tag)))
      await(pipelineRepo.create("Untagged", src.id, userA, None))

      Get(s"/pipelines?tag=$tag") ~> pipelineRoutesFor(userA) ~> check {
        val summaries = responseAs[Vector[PipelineSummaryResponse]]
        summaries.map(_.name) shouldBe Vector("Tagged")
      }
    }

    // HEL-904 (4.1/4.3): `POST /data-sources` no longer auto-creates a companion DataType, so
    // there is nothing left for `GET /types?tag=` to owner-scope in this scenario. Removed
    // outright, matching the companion-propagation test above.
  }

  // ── 6.11 Wire-format: absent field behaves identically to explicit null/false ─

  "tag (6.11 wire-format absent-vs-null/false)" should {
    "an entirely-absent `tag` key and an explicit `tag: null` create identically-untagged sources" in {
      val absentBody = createStaticSourceJson("Absent Tag", "")
      val nullBody    = createStaticSourceJson("Null Tag", ""","tag":null""")

      val absentTag = Post("/data-sources", HttpEntity(ContentTypes.`application/json`, absentBody)) ~>
        dataSourceRoutesFor(userA) ~> check {
          status shouldBe StatusCodes.Created
          responseAs[DataSourceResponse].tag
        }
      val nullTag = Post("/data-sources", HttpEntity(ContentTypes.`application/json`, nullBody)) ~>
        dataSourceRoutesFor(userA) ~> check {
          status shouldBe StatusCodes.Created
          responseAs[DataSourceResponse].tag
        }

      absentTag shouldBe None
      nullTag shouldBe None
      absentTag shouldBe nullTag
    }

    "an entirely-absent `dryRun` key on a teardown request behaves as `dryRun: false` " +
      "(a real, verifiable delete happens, not a silently-skipped preview)" in {
      val tag = freshTag()
      Post("/data-sources", HttpEntity(ContentTypes.`application/json`, createStaticSourceJson("Teardown Wire", s""","tag":"$tag""""))) ~>
        dataSourceRoutesFor(userA) ~> check { status shouldBe StatusCodes.Created }

      // Raw JSON with `dryRun` entirely absent — not the typed TeardownRequest
      // case class (which would always carry the field, defeating the point).
      val rawBody = s"""{"tag":"$tag"}"""
      Post("/workspace/teardown", HttpEntity(ContentTypes.`application/json`, rawBody)) ~> workspaceRoutesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[TeardownResponse]
        resp.dryRun shouldBe false
        resp.committed shouldBe true
        resp.sourcesDeleted shouldBe 1
      }

      // Actually deleted -- proves this was a real call, not a dry run that
      // silently no-op'd.
      Get(s"/data-sources?tag=$tag") ~> dataSourceRoutesFor(userA) ~> check {
        responseAs[JsObject].fields("items").convertTo[Vector[JsObject]] shouldBe empty
      }
    }
  }
}
