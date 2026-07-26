package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, StatusCodes}
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.api.{DataSourceResponse, JsonProtocols, PipelineSummaryResponse, TeardownResponse}
import com.helio.domain._
import com.helio.infrastructure._
import com.helio.services._
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
  private var dataTypeRepo: DataTypeRepository     = _
  private var dataTypeRowRepo: DataTypeRowRepository = _
  private var pipelineRepo: PipelineRepository     = _
  private var pipelineStepRepo: PipelineStepRepository = _

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
    dataTypeRepo     = new DataTypeRepository(ctx)(routeEc)
    dataTypeRowRepo  = new DataTypeRowRepository(ctx)(routeEc)
    pipelineRepo     = new PipelineRepository(ctx, dataTypeRepo, dataSourceRepo)(routeEc)
    pipelineStepRepo = new PipelineStepRepository(ctx)(routeEc)
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

  // ── Route fixtures ──────────────────────────────────────────────────────

  private def dataSourceRoutesFor(user: AuthenticatedUser): Route = {
    implicit val ec: ExecutionContext = routeEc
    val tmpDir = Files.createTempDirectory("helio-tag-spec")
    val fs     = new LocalFileSystem(tmpDir)
    val svc    = new DataSourceService(dataSourceRepo, dataTypeRepo, fs)
    new DataSourceRoutes(svc, user)(typedSystem).routes
  }

  private def pipelineRoutesFor(user: AuthenticatedUser): Route = {
    implicit val ec: ExecutionContext = routeEc
    val svc = new PipelineService(pipelineRepo, pipelineStepRepo, dataSourceRepo, dataTypeRepo)
    new PipelineRoutes(svc, user)(routeEc).routes
  }

  private def dataTypeRoutesFor(user: AuthenticatedUser): Route = {
    implicit val ec: ExecutionContext = routeEc
    val svc           = new DataTypeService(dataTypeRepo, dataTypeRowRepo, dataSourceRepo)
    val capabilitySvc = new PanelCapabilityService(dataTypeRepo, dataTypeRowRepo)
    new DataTypeRoutes(svc, capabilitySvc, user)(typedSystem).routes
  }

  private def workspaceRoutesFor(user: AuthenticatedUser): Route = {
    implicit val ec: ExecutionContext = routeEc
    val tmpDir = Files.createTempDirectory("helio-tag-spec-workspace")
    val fs     = new LocalFileSystem(tmpDir)
    val ctx    = new DbContext(db, db)(routeEc)
    val teardownRepo = new WorkspaceTeardownRepository(ctx, dataTypeRepo)(routeEc)
    val svc           = new WorkspaceTeardownService(teardownRepo, fs)(routeEc)
    new WorkspaceRoutes(svc, user)(routeEc).routes
  }

  private def createStaticSourceJson(name: String, tagField: String): String =
    s"""{"name":"$name","type":"static","columns":[{"name":"value","type":"string"}],"rows":[["x"]]$tagField}"""

  // ── 6.1 Tag persists through create -> read ────────────────────────────

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

    "propagate the owning DataSource's tag to its auto-created companion DataType, readable via GET /types" in {
      val tag  = freshTag()
      val body = createStaticSourceJson("Companion Source", s""","tag":"$tag"""")
      Post("/data-sources", HttpEntity(ContentTypes.`application/json`, body)) ~> dataSourceRoutesFor(userA) ~> check {
        status shouldBe StatusCodes.Created
      }
      Get(s"/types?tag=$tag") ~> dataTypeRoutesFor(userA) ~> check {
        status shouldBe StatusCodes.OK
        val items = responseAs[JsObject].fields("items").convertTo[Vector[JsObject]]
        items.map(_.fields("name").convertTo[String]) should contain("Companion Source")
      }
    }
  }

  // ── 6.2 ?tag= list filtering, owner-scoped ─────────────────────────────

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
      await(pipelineRepo.create("Tagged", src.id, "Out1", userA, Some(tag)))
      await(pipelineRepo.create("Untagged", src.id, "Out2", userA, None))

      Get(s"/pipelines?tag=$tag") ~> pipelineRoutesFor(userA) ~> check {
        val summaries = responseAs[Vector[PipelineSummaryResponse]]
        summaries.map(_.name) shouldBe Vector("Tagged")
      }
    }

    "GET /types?tag= is owner-scoped: another owner's same-tagged DataType is not returned" in {
      val tag = freshTag()
      Post("/data-sources", HttpEntity(ContentTypes.`application/json`, createStaticSourceJson("A's tagged", s""","tag":"$tag""""))) ~>
        dataSourceRoutesFor(userA) ~> check { status shouldBe StatusCodes.Created }
      Post("/data-sources", HttpEntity(ContentTypes.`application/json`, createStaticSourceJson("B's tagged", s""","tag":"$tag""""))) ~>
        dataSourceRoutesFor(userB) ~> check { status shouldBe StatusCodes.Created }

      Get(s"/types?tag=$tag") ~> dataTypeRoutesFor(userA) ~> check {
        val items = responseAs[JsObject].fields("items").convertTo[Vector[JsObject]]
        val names = items.map(_.fields("name").convertTo[String])
        names should contain("A's tagged")
        names should not contain "B's tagged"
      }
    }
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
