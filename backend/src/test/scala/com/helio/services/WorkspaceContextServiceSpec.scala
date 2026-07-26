package com.helio.services

import com.helio.api.{AccessCheckerImpl, JsonProtocols, ResourceTypeRegistry, ResourceType => AclResourceType}
import com.helio.api.protocols.{StaticColumnPayload, StaticDataSourceRequest, WorkspaceContextCounts, WorkspaceContextResponse}
import com.helio.api.routes.WorkspaceRoutes
import com.helio.domain._
import com.helio.infrastructure._
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, StatusCodes}
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.fasterxml.jackson.databind.ObjectMapper
import com.networknt.schema.{JsonSchemaFactory, SpecVersion}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json.{JsBoolean, JsObject, JsString}

import java.io.File
import java.nio.file.Files
import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.jdk.CollectionConverters._

/** HEL-371 tasks.md section 4 — `WorkspaceContextService.assemble` coverage.
 *
 *  Uses the same simplified `DbContext(db, db)` pattern `PipelineAnalyzeRoutesSpec`
 *  / `ResourceTaggingSpec` use (not the real-RLS dual-pool harness
 *  `WorkspaceTeardownServiceSpec` uses) — every read this service composes
 *  (`DataSourceService.findAll`, `DataTypeRepository.findAll`,
 *  `DashboardService.findAll`, `PipelineService.listSummaries`/`analyze`)
 *  already filters explicitly by `owner_id` in its own Slick query (not via
 *  RLS), so the simpler single-pool harness is the right tool here (design.md
 *  D1 — this service performs no direct DB access of its own). */
class WorkspaceContextServiceSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                   = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _

  private var dataSourceRepo: DataSourceRepository     = _
  private var dataTypeRepo: DataTypeRepository         = _
  private var pipelineRepo: PipelineRepository         = _
  private var pipelineStepRepo: PipelineStepRepository = _
  private var dashboardRepo: DashboardRepository       = _

  private var dataSourceService: DataSourceService = _
  private var pipelineService: PipelineService     = _
  private var service: WorkspaceContextService     = _

  private val userAId = UUID.randomUUID().toString
  private val userBId = UUID.randomUUID().toString
  private val userEmptyId = UUID.randomUUID().toString
  private val userA   = AuthenticatedUser(UserId(userAId))
  private val userB   = AuthenticatedUser(UserId(userBId))
  // Dedicated to the 4.1 "empty workspace" scenario so that test's exact-zero
  // assertions never depend on running before every other test in this file
  // that creates resources for userA/userB.
  private val userEmpty = AuthenticatedUser(UserId(userEmptyId))

  override def beforeAll(): Unit = {
    // Local (method-scoped), not a class-level field — shadows RouteTest's
    // inherited `executor` cleanly instead of competing with it (a
    // class-level `implicit val ec` is ambiguous with a trait member at the
    // same scope depth; mirrors BoundPanelRoutesSpec's identical local-scope
    // pattern).
    implicit val ec: ExecutionContext = routeEc

    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()

    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx = new DbContext(db, db)

    dataSourceRepo   = new DataSourceRepository(ctx)
    dataTypeRepo     = new DataTypeRepository(ctx)
    pipelineRepo     = new PipelineRepository(ctx, dataTypeRepo, dataSourceRepo)
    pipelineStepRepo = new PipelineStepRepository(ctx)
    dashboardRepo    = new DashboardRepository(ctx)

    val tmpDir = Files.createTempDirectory("helio-workspace-context-spec")
    val fs     = new LocalFileSystem(tmpDir)
    dataSourceService = new DataSourceService(dataSourceRepo, dataTypeRepo, fs)
    pipelineService   = new PipelineService(pipelineRepo, pipelineStepRepo, dataSourceRepo, dataTypeRepo)

    // Only "dashboard" is exercised by DashboardService's own AccessChecker
    // call in this fixture (mirrors BoundPanelRoutesSpec's identical carve-out).
    val registry        = new ResourceTypeRegistry(
      AclResourceType("dashboard", id => dashboardRepo.findByIdInternal(DashboardId(id)).map(_.map(_.ownerId.value)))
    )
    val permissionRepo   = new ResourcePermissionRepository(ctx)
    val accessChecker    = new AccessCheckerImpl(permissionRepo, registry)
    val dashboardService = new DashboardService(dashboardRepo, accessChecker)

    service = new WorkspaceContextService(dashboardService, dataSourceService, dataTypeRepo, pipelineService)

    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($userAId::uuid, ${s"a-$userAId@test.local"}, now())""",
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($userBId::uuid, ${s"b-$userBId@test.local"}, now())""",
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($userEmptyId::uuid, ${s"empty-$userEmptyId@test.local"}, now())"""
    )))
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  // ── HEL-371 cycle-2: real JSON Schema validation (design.md/evaluation-1.md
  // change request 1/2) ───────────────────────────────────────────────────

  /** Locates `schemas/workspace-context.schema.json` by walking up from the
   *  test JVM's working directory — robust to whether sbt forks tests with
   *  cwd `backend/` (the normal case) or the repo root. */
  private def workspaceContextSchemaFile: File = {
    def search(dir: File, depthRemaining: Int): File = {
      val candidate = new File(dir, "schemas/workspace-context.schema.json")
      if (candidate.exists()) candidate
      else if (depthRemaining <= 0 || dir.getParentFile == null)
        fail(s"could not locate schemas/workspace-context.schema.json searching upward from " +
          new File(".").getCanonicalPath)
      else search(dir.getParentFile, depthRemaining - 1)
    }
    search(new File(".").getCanonicalFile, 5)
  }

  private val jsonMapper = new ObjectMapper()
  private val workspaceContextJsonSchema =
    JsonSchemaFactory.getInstance(SpecVersion.VersionFlag.V202012).getSchema(jsonMapper.readTree(workspaceContextSchemaFile))

  /** Real ajv-equivalent validation (networknt/json-schema-validator, JSON
   *  Schema 2020-12) of an assembled response against
   *  `schemas/workspace-context.schema.json` — not just a Scala-side
   *  round-trip deserialization, which cannot catch a schema `required` list
   *  disagreeing with spray-json's omit-`None`-fields wire behavior (the
   *  exact bug this closes; see evaluation-1.md change request 1). */
  private def schemaValidationErrors(body: WorkspaceContextResponse): Vector[String] = {
    val json = workspaceContextResponseFormat.write(body).compactPrint
    workspaceContextJsonSchema.validate(jsonMapper.readTree(json)).asScala.map(_.getMessage).toVector
  }

  // ── Fixtures ────────────────────────────────────────────────────────────

  /** A `static` DataSource (+ its auto-created companion DataType, `sourceId`
   *  set — the source-companion / non-pipeline-output case). `tag` defaults
   *  to `None` (the common case exercised by most tests below); pass
   *  `Some(...)` to cover the tag-present wire case (schema validity 4.6b). */
  private def createSource(
      user: AuthenticatedUser,
      name: String = s"src-${UUID.randomUUID()}",
      tag: Option[String] = None
  ): DataSource = {
    val req = StaticDataSourceRequest(
      name    = name,
      `type`  = "static",
      columns = Vector(StaticColumnPayload("value", "string")),
      rows    = Vector(Vector(JsString("x"))),
      tag     = tag
    )
    await(dataSourceService.createStatic(req, user)) match {
      case Right(ds) => ds
      case Left(err) => fail(s"createStatic failed: $err")
    }
  }

  /** A Pipeline over `sourceId` (+ its freshly-inserted output DataType,
   *  `sourceId` absent — the pipeline-output / panel-bindable case). */
  private def createPipeline(
      user: AuthenticatedUser,
      sourceId: DataSourceId,
      name: String = s"pipe-${UUID.randomUUID()}",
      outputName: String = s"out-${UUID.randomUUID()}"
  ): PipelineRepository.PipelineSummary =
    await(pipelineRepo.create(name, sourceId, outputName, user)) match {
      case Right(summary) => summary
      case Left(err)       => fail(s"pipeline create failed: $err")
    }

  private def createDashboard(user: AuthenticatedUser, name: String = s"dash-${UUID.randomUUID()}"): Dashboard = {
    val now = Instant.now()
    val dash = Dashboard(
      id         = DashboardId(UUID.randomUUID().toString),
      name       = name,
      meta       = ResourceMeta(user.id.value, now, now),
      appearance = DashboardAppearance.Default,
      layout     = DashboardLayout.Default,
      ownerId    = user.id
    )
    await(dashboardRepo.insert(dash))
  }

  // ── 4.1 Empty workspace ─────────────────────────────────────────────────

  "assemble (4.1 empty workspace)" should {
    "return all-zero counts and empty collections for a user with nothing" in {
      val resp = await(service.assemble(userEmpty))
      resp.counts shouldBe WorkspaceContextCounts(0, 0, 0, 0)
      resp.dataSources shouldBe empty
      resp.dataTypes shouldBe empty
      resp.pipelines shouldBe empty
      resp.dashboards shouldBe empty
    }
  }

  // ── 4.2 Owner-scoping ───────────────────────────────────────────────────

  "assemble (4.2 owner-scoping)" should {
    "never surface another user's resources, and counts reflect only the caller's own" in {
      val bSource = createSource(userB, "b-source")
      createPipeline(userB, bSource.id, "b-pipeline")
      createDashboard(userB, "b-dash")

      createSource(userA, "a-source")
      createDashboard(userA, "a-dash")

      val resp = await(service.assemble(userA))

      resp.dataSources.map(_.name) shouldBe Vector("a-source")
      resp.dashboards.map(_.name) shouldBe Vector("a-dash")
      resp.pipelines shouldBe empty
      resp.dataTypes.map(_.name) should contain("a-source") // companion DataType
      resp.dataTypes.map(_.name) should not contain "b-source"

      resp.counts.dataSources shouldBe 1
      resp.counts.dashboards shouldBe 1
      resp.counts.pipelines shouldBe 0

      // Independently confirm B's response is unaffected (not just that A's is right).
      val respB = await(service.assemble(userB))
      respB.dataSources.map(_.name) shouldBe Vector("b-source")
      respB.pipelines.map(_.name) shouldBe Vector("b-pipeline")
      respB.dashboards.map(_.name) shouldBe Vector("b-dash")
    }
  }

  // ── 4.3 pipelineOutput classification ──────────────────────────────────

  "assemble (4.3 pipelineOutput classification)" should {
    "flag a source-companion DataType false and a pipeline-output DataType true" in {
      val source   = createSource(userA, "classify-source")
      val pipeline = createPipeline(userA, source.id, "classify-pipeline", "classify-output")

      val resp = await(service.assemble(userA))

      val companion = resp.dataTypes.find(_.name == "classify-source").getOrElse(fail("companion DataType missing"))
      companion.pipelineOutput shouldBe false
      companion.sourceId shouldBe Some(source.id.value)

      val output = resp.dataTypes.find(_.id == pipeline.outputDataTypeId).getOrElse(fail("output DataType missing"))
      output.pipelineOutput shouldBe true
      output.sourceId shouldBe None
    }
  }

  // ── 4.4 Per-step output columns, in order ──────────────────────────────

  "assemble (4.4 per-step output columns)" should {
    "report each step's outputColumns in step order, from the analyze path" in {
      val source   = createSource(userA, "steps-source")
      val pipeline = createPipeline(userA, source.id, "steps-pipeline", "steps-output")

      // Companion source schema is [value] (from createSource's static payload).
      // A select then a rename step give distinct, order-verifiable outputs.
      await(pipelineStepRepo.insert(PipelineId(pipeline.id), "select", SelectConfig(Vector("value")), userA))
      await(pipelineStepRepo.insert(PipelineId(pipeline.id), "rename", RenameConfig(Map("value" -> "renamed")), userA))

      val resp  = await(service.assemble(userA))
      val entry = resp.pipelines.find(_.id == pipeline.id).getOrElse(fail("pipeline missing"))

      entry.stepsError shouldBe None
      entry.steps.map(_.position) shouldBe Vector(0, 1)
      entry.steps(0).outputColumns shouldBe Vector("value")
      entry.steps(1).outputColumns shouldBe Vector("renamed")
    }
  }

  // ── 4.5 One pipeline's analyze failure degrades gracefully ─────────────

  "buildPipeline (4.5 analyze-failure degrade)" should {
    "degrade to steps: [] + stepsError for a summary whose pipeline no longer exists, " +
      "without affecting a sibling pipeline's own successful entry" in {
      implicit val ec: ExecutionContext = routeEc
      val goodSource    = createSource(userA, "degrade-good-source")
      val goodPipeline  = createPipeline(userA, goodSource.id, "degrade-good-pipeline", "degrade-good-output")
      val goodSummaries = await(pipelineService.listSummaries(userA)).filter(_.id == goodPipeline.id)
      goodSummaries should have size 1

      val brokenSource    = createSource(userA, "degrade-broken-source")
      val brokenPipeline  = createPipeline(userA, brokenSource.id, "degrade-broken-pipeline", "degrade-broken-output")
      val brokenSummaries = await(pipelineService.listSummaries(userA)).filter(_.id == brokenPipeline.id)
      brokenSummaries should have size 1

      // Delete the "broken" pipeline out from under its already-fetched summary —
      // reproduces the real race `analyze` degrades against (design.md D5):
      // listSummaries succeeded, but by the time analyze runs the pipeline is gone.
      await(pipelineRepo.delete(PipelineId(brokenPipeline.id), userA))

      val results = await(Future.traverse(goodSummaries ++ brokenSummaries)(service.buildPipeline(_, userA)))

      val goodEntry   = results.find(_.id == goodPipeline.id).getOrElse(fail("good pipeline entry missing"))
      val brokenEntry = results.find(_.id == brokenPipeline.id).getOrElse(fail("broken pipeline entry missing"))

      goodEntry.steps shouldBe empty // no steps added in this fixture
      goodEntry.stepsError shouldBe None

      brokenEntry.steps shouldBe empty
      brokenEntry.stepsError shouldBe defined
      brokenEntry.stepsError.get should not be empty
    }
  }

  // ── 4.6 Route-level: 200 with a schema-valid body ───────────────────────

  "GET /workspace/context (4.6 route-level)" should {
    "return 200 with a body that is BOTH a valid WorkspaceContextResponse round-trip " +
      "AND validates against schemas/workspace-context.schema.json" in {
      implicit val ec: ExecutionContext = routeEc
      createSource(userA, "route-source") // untagged — every Optional field on this
      createDashboard(userA, "route-dash") // entry is absent-from-wire, not null

      val routes = new WorkspaceRoutes(None, service, userA).routes

      Get("/workspace/context") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val body = responseAs[WorkspaceContextResponse]
        body.dataSources.map(_.name) should contain("route-source")
        body.dashboards.map(_.name) should contain("route-dash")
        body.generatedAt should not be empty

        // Real JSON Schema validation, not just the Scala-side deserialization
        // above — this is what actually caught evaluation-1.md's finding
        // (schema `required` listing fields spray-json omits when `None`).
        schemaValidationErrors(body) shouldBe empty
      }
    }
  }

  // ── 4.6b Schema validity — explicit present-field coverage ─────────────
  //
  // 4.6/4.1-4.5's fixtures are mostly untagged/never-run, so every Optional
  // field on those responses is absent (not present-with-a-value) — the
  // schema validator trivially can't distinguish "field correctly omitted"
  // from "field wrongly required but happens to always be absent in tests".
  // This test forces the PRESENT branch for the exact fields
  // evaluation-1.md demonstrated broken live: DataSourceEntry.tag,
  // DataTypeEntry.sourceId/tag, PipelineEntry.stepsError.

  "assemble (4.6b schema validity — present-field coverage)" should {
    "validate against the schema when tag/sourceId are present" in {
      implicit val ec: ExecutionContext = routeEc
      val taggedSource = createSource(userA, "schema-tagged-source", tag = Some("prod"))

      val resp = await(service.assemble(userA))
      val sourceEntry = resp.dataSources.find(_.name == "schema-tagged-source").getOrElse(fail("tagged source missing"))
      sourceEntry.tag shouldBe Some("prod")
      val companionEntry = resp.dataTypes.find(_.name == "schema-tagged-source").getOrElse(fail("companion DataType missing"))
      companionEntry.tag shouldBe Some("prod")
      companionEntry.sourceId shouldBe Some(taggedSource.id.value)

      schemaValidationErrors(resp) shouldBe empty
    }

    "validate against the schema when stepsError is present (the degraded-pipeline case)" in {
      implicit val ec: ExecutionContext = routeEc
      val baseline = await(service.assemble(userA))

      val brokenSource   = createSource(userA, "schema-broken-source")
      val brokenPipeline = createPipeline(userA, brokenSource.id, "schema-broken-pipeline", "schema-broken-output")
      val brokenSummary = await(pipelineService.listSummaries(userA))
        .find(_.id == brokenPipeline.id).getOrElse(fail("broken pipeline summary missing"))
      await(pipelineRepo.delete(PipelineId(brokenPipeline.id), userA))
      val brokenEntry = await(service.buildPipeline(brokenSummary, userA))
      brokenEntry.stepsError shouldBe defined

      schemaValidationErrors(baseline.copy(pipelines = baseline.pipelines :+ brokenEntry)) shouldBe empty
    }
  }

  // ── Non-blocking suggestion (evaluation-1.md) ───────────────────────────
  // Pins the exact rejection behavior of `.../teardown` now that
  // `WorkspaceRoutes` mounts unconditionally and gates `workspaceTeardownServiceOpt`
  // internally (design.md D2) rather than at the `ApiRoutes` call site. Pekko's
  // default rejection handling (no custom `RejectionHandler` in `ApiRoutes`,
  // confirmed by the evaluator via grep) resolves a bare `reject()` to 404 —
  // this test locks that down so a future refactor can't silently change it.

  "POST /workspace/teardown when workspaceTeardownServiceOpt is None" should {
    "reject with 404 (Pekko's default handling of an unmatched reject()), " +
      "while GET /workspace/context on the same routes instance still succeeds" in {
      implicit val ec: ExecutionContext = routeEc

      val routes = new WorkspaceRoutes(None, service, userA).routes
      val body = HttpEntity(
        ContentTypes.`application/json`,
        JsObject("tag" -> JsString("t"), "dryRun" -> JsBoolean(false)).compactPrint
      )

      // Route.seal applies Pekko's default RejectionHandler so the raw
      // reject() the fold produces resolves to an actual HTTP response
      // instead of leaving `check` with an unrealized rejection.
      Post("/workspace/teardown", body) ~> Route.seal(routes) ~> check {
        status shouldBe StatusCodes.NotFound
      }

      // The Option split is per-branch, not a whole-router outage: `.../context`
      // on this exact same (teardown-less) routes instance is unaffected.
      Get("/workspace/context") ~> routes ~> check {
        status shouldBe StatusCodes.OK
      }
    }
  }
}
