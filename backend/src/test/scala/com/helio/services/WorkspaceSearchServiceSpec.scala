package com.helio.services

import com.helio.services.dashboards.DashboardService
import com.helio.services.metrics.MetricService
import com.helio.services.pipelines.{DataTypeService, PipelineService}
import com.helio.services.sources.DataSourceService
import com.helio.services.workspace.{WorkspaceContextService, WorkspaceSearchService}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ResourcePermissionRepository
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.metrics.MetricRepository
import com.helio.infrastructure.persistence.pipelines.{DataTypeRepository, DataTypeRowRepository, PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.api.http.{AccessCheckerImpl, ResourceTypeRegistry, ResourceType => AclResourceType}
import com.helio.api.protocols.sources.{StaticColumnPayload, StaticDataSourceRequest}
import com.helio.api.protocols.workspace.WorkspaceResourceDetail
import com.helio.domain.model._
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json.{JsNumber, JsObject, JsString}

import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-661 tasks.md section 5 — `WorkspaceSearchService.find`/`getResource` coverage. Uses the same
 *  simplified `DbContext(db, db)` single-pool harness `WorkspaceContextServiceSpec` uses (design.md
 *  D1 — this service performs no direct DB access of its own; every read it composes already
 *  owner-scopes explicitly in its own Slick query or app-level check, not via RLS, so the real
 *  dual-pool RLS harness isn't needed here — task 5.3b's pipeline-sharing check is itself an
 *  app-level `ownerId` comparison, not an RLS assertion). */
class WorkspaceSearchServiceSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _

  private var dataSourceRepo: DataSourceRepository         = _
  private var dataTypeRepo: DataTypeRepository             = _
  private var dataTypeRowRepo: DataTypeRowRepository       = _
  private var pipelineRepo: PipelineRepository             = _
  private var pipelineStepRepo: PipelineStepRepository     = _
  private var dashboardRepo: DashboardRepository           = _
  private var metricRepo: MetricRepository                 = _
  private var permissionRepo: ResourcePermissionRepository = _

  private var dashboardService: DashboardService             = _
  private var dataSourceService: DataSourceService           = _
  private var dataTypeService: DataTypeService               = _
  private var pipelineService: PipelineService               = _
  private var metricService: MetricService                   = _
  private var workspaceContextService: WorkspaceContextService = _
  private var service: WorkspaceSearchService                 = _

  private val userAId = UUID.randomUUID().toString
  private val userBId = UUID.randomUUID().toString
  private val userA   = AuthenticatedUser(UserId(userAId))
  private val userB   = AuthenticatedUser(UserId(userBId))

  override def beforeAll(): Unit = {
    implicit val ec: ExecutionContext = typedSystem.executionContext

    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()

    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx = new DbContext(db, db)

    dataSourceRepo   = new DataSourceRepository(ctx)
    dataTypeRepo     = new DataTypeRepository(ctx)
    dataTypeRowRepo  = new DataTypeRowRepository(ctx)
    pipelineRepo     = new PipelineRepository(ctx, dataTypeRepo, dataSourceRepo)
    pipelineStepRepo = new PipelineStepRepository(ctx)
    dashboardRepo    = new DashboardRepository(ctx)
    metricRepo       = new MetricRepository(ctx)
    permissionRepo   = new ResourcePermissionRepository(ctx)

    val tmpDir = java.nio.file.Files.createTempDirectory("helio-workspace-search-spec")
    val fs     = new LocalFileSystem(tmpDir)
    dataSourceService = new DataSourceService(dataSourceRepo, dataTypeRepo, fs)
    dataTypeService   = new DataTypeService(dataTypeRepo, dataTypeRowRepo, dataSourceRepo)
    pipelineService   = new PipelineService(pipelineRepo, pipelineStepRepo, dataSourceRepo, dataTypeRepo)
    metricService     = new MetricService(metricRepo, dataTypeRepo)

    val registry = new ResourceTypeRegistry(
      AclResourceType("dashboard", id => dashboardRepo.findByIdInternal(DashboardId(id)).map(_.map(_.ownerId.value)))
    )
    val accessChecker = new AccessCheckerImpl(permissionRepo, registry)
    dashboardService  = new DashboardService(dashboardRepo, accessChecker)

    workspaceContextService = new WorkspaceContextService(dashboardService, dataSourceService, dataTypeService, pipelineService)
    service = new WorkspaceSearchService(dashboardService, dataSourceService, dataTypeService, pipelineService, metricService, workspaceContextService)

    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($userAId::uuid, ${s"a-$userAId@test.local"}, now())""",
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($userBId::uuid, ${s"b-$userBId@test.local"}, now())"""
    )))
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  // ── Fixtures ────────────────────────────────────────────────────────────

  private def createSource(user: AuthenticatedUser, name: String = s"src-${UUID.randomUUID()}"): DataSource = {
    val req = StaticDataSourceRequest(
      name    = name,
      `type`  = "static",
      columns = Vector(StaticColumnPayload("value", "string")),
      rows    = Vector(Vector(JsString("x"))),
      tag     = None
    )
    await(dataSourceService.createStatic(req, user)) match {
      case Right(ds) => ds
      case Left(err) => fail(s"createStatic failed: $err")
    }
  }

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

  /** A pipeline-output DataType (`sourceId = None`, matching `MetricService.create`'s own binding
   *  rule) + a metric bound to it, inserted directly via the repository (not `MetricService.create`)
   *  — this spec only needs a well-formed, owned `MetricDefinition` to search/fetch, not a
   *  re-exercise of `MetricService`'s own binding validation (already covered elsewhere). */
  private def createMetric(
      user: AuthenticatedUser,
      name: String = s"metric-${UUID.randomUUID()}",
      description: Option[String] = Some("A test metric")
  ): MetricDefinition = {
    val now = Instant.now()
    val dt = DataType(
      id        = DataTypeId(UUID.randomUUID().toString),
      sourceId  = None,
      name      = s"metric-dt-${UUID.randomUUID()}",
      fields    = Vector(DataField("revenue", "Revenue", "float", nullable = false)),
      version   = 1,
      createdAt = now,
      updatedAt = now,
      ownerId   = user.id
    )
    await(dataTypeRepo.insert(dt, user))

    val metric = MetricDefinition(
      id                = MetricId(UUID.randomUUID().toString),
      ownerId           = user.id,
      dataTypeId        = dt.id,
      name              = name,
      description       = description,
      measureField      = "revenue",
      aggregation       = "sum",
      allowedDimensions = Vector.empty,
      format            = MetricFormat(None, None, None, None),
      deprecated        = false,
      createdAt         = now,
      updatedAt         = now
    )
    await(metricRepo.insert(metric, user)) match {
      case Right(m)  => m
      case Left(err) => fail(s"metric insert failed: $err")
    }
  }

  private def setDataTypeFields(id: DataTypeId, user: AuthenticatedUser, fields: Vector[DataField]): Unit = {
    val existing = await(dataTypeRepo.findByIdOwned(id, user)).getOrElse(fail("DataType not found"))
    await(dataTypeRepo.update(existing.copy(fields = fields), user)).getOrElse(fail("DataType update failed"))
  }

  private def grantPipelineRole(pipelineId: String, granteeId: UserId, role: Role): Unit =
    await(permissionRepo.insert(ResourcePermission(
      resourceType = "pipeline",
      resourceId   = pipelineId,
      granteeId    = Some(granteeId),
      role         = role,
      createdAt    = Instant.now()
    )))

  // ── 5.1 find matches an owned resource's name, per resource type ────────

  "find (5.1 per-type name match)" should {
    "return a summary for a query matching an owned data source's name" in {
      val ds = createSource(userA, "find-51-datasource-alpha")
      val results = await(service.find(userA, "find-51-datasource-alpha"))
      val hit = results.find(_.id == ds.id.value).getOrElse(fail("data source summary missing"))
      hit.resourceType shouldBe "dataSource"
      hit.name shouldBe "find-51-datasource-alpha"
      hit.description should not be empty
    }

    "return a summary for a query matching an owned DataType's name (the source-companion type)" in {
      val ds = createSource(userA, "find-51-datatype-alpha")
      val results = await(service.find(userA, "find-51-datatype-alpha", Some(Set(WorkspaceResourceType.DataType))))
      val hit = results.find(_.name == ds.name).getOrElse(fail("DataType summary missing"))
      hit.resourceType shouldBe "dataType"
      hit.description shouldBe "source-companion type"
    }

    "return a summary for a query matching an owned pipeline's name" in {
      val source   = createSource(userA, "find-51-pipeline-source")
      val pipeline = createPipeline(userA, source.id, "find-51-pipeline-alpha")
      val results  = await(service.find(userA, "find-51-pipeline-alpha"))
      val hit = results.find(_.id == pipeline.id).getOrElse(fail("pipeline summary missing"))
      hit.resourceType shouldBe "pipeline"
      hit.description should include(pipeline.sourceDataSourceName)
      hit.description should include(pipeline.outputDataTypeName)
    }

    "return a summary for a query matching an owned dashboard's name" in {
      val dash = createDashboard(userA, "find-51-dashboard-alpha")
      val results = await(service.find(userA, "find-51-dashboard-alpha"))
      val hit = results.find(_.id == dash.id.value).getOrElse(fail("dashboard summary missing"))
      hit.resourceType shouldBe "dashboard"
      hit.name shouldBe "find-51-dashboard-alpha"
      hit.description should not be empty
    }

    "return a summary for a query matching an owned metric's name" in {
      val metric = createMetric(userA, "find-51-metric-alpha")
      val results = await(service.find(userA, "find-51-metric-alpha"))
      val hit = results.find(_.id == metric.id.value).getOrElse(fail("metric summary missing"))
      hit.resourceType shouldBe "metric"
      hit.description shouldBe "A test metric"
    }
  }

  // ── 5.2 find on a query matching nothing ─────────────────────────────────

  "find (5.2 no match)" should {
    "return an empty result, not an error, for a query matching no owned resource" in {
      createDashboard(userA, "find-52-real-dashboard")
      val results = await(service.find(userA, "find-52-nonexistent-query-xyz"))
      results shouldBe empty
    }
  }

  // ── 5.3 resourceTypes restricts which types are searched ────────────────

  "find (5.3 resourceTypes filter)" should {
    "restrict results to the requested type when a query matches both a metric and a dashboard" in {
      val metric = createMetric(userA, "find-53-shared-token")
      val dash   = createDashboard(userA, "find-53-shared-token")

      val results = await(service.find(userA, "find-53-shared-token", Some(Set(WorkspaceResourceType.Metric))))

      results.map(_.id) should contain(metric.id.value)
      results.map(_.id) should not contain dash.id.value
      results.foreach(_.resourceType shouldBe "metric")
    }
  }

  // ── 5.3a find's result set is bounded ────────────────────────────────────

  "find (5.3a MaxFindResults bound)" should {
    "cap the result set at MaxFindResults (20) even when more owned resources match, deterministically" in {
      (0 until 25).foreach(i => createDashboard(userA, f"find-53a-cap-dashboard-$i%02d"))

      val first  = await(service.find(userA, "find-53a-cap-dashboard", Some(Set(WorkspaceResourceType.Dashboard))))
      val second = await(service.find(userA, "find-53a-cap-dashboard", Some(Set(WorkspaceResourceType.Dashboard))))

      first should have size 20
      first shouldBe second // deterministic across repeated calls over the same data
    }
  }

  // ── 5.3b getResource pipeline sharing is NOT honored (owner-only) ───────

  "getResource (5.3b pipeline shared-but-not-owned)" should {
    "return Left(NotFound) for a pipeline shared with the caller as editor, not the shared pipeline's detail" in {
      val source   = createSource(userA, "getresource-53b-source")
      val pipeline = createPipeline(userA, source.id, "getresource-53b-pipeline")
      grantPipelineRole(pipeline.id, userB.id, Role.Editor)

      val result = await(service.getResource(userB, pipeline.id, WorkspaceResourceType.Pipeline))
      result shouldBe a[Left[_, _]]
      result.left.getOrElse(fail("expected Left")) shouldBe a[ServiceError.NotFound]
    }

    "return the pipeline's own detail for its actual owner (control case)" in {
      val source   = createSource(userA, "getresource-53b-owner-source")
      val pipeline = createPipeline(userA, source.id, "getresource-53b-owner-pipeline")

      val result = await(service.getResource(userA, pipeline.id, WorkspaceResourceType.Pipeline))
      result match {
        case Right(WorkspaceResourceDetail.PipelineDetail(detail)) => detail.id shouldBe pipeline.id
        case other => fail(s"expected Right(PipelineDetail), got $other")
      }
    }
  }

  // ── 5.4 getResource DataType detail matches assemble's own detail ───────

  "getResource (5.4 DataType detail parity with assemble)" should {
    "return the same columns/sampleRows/columnStats assemble would produce for that DataType" in {
      val source   = createSource(userA, "getresource-54-source")
      val pipeline = createPipeline(userA, source.id, "getresource-54-pipeline", "getresource-54-output")
      val outputId = DataTypeId(pipeline.outputDataTypeId)

      setDataTypeFields(outputId, userA, Vector(
        DataField("status", "Status", "string", nullable = false),
        DataField("amount", "Amount", "float", nullable = false)
      ))
      await(dataTypeRowRepo.overwriteRows(pipeline.outputDataTypeId, Seq(
        JsObject("status" -> JsString("active"), "amount" -> JsNumber(10)),
        JsObject("status" -> JsString("inactive"), "amount" -> JsNumber(20))
      )))

      val assembled  = await(workspaceContextService.assemble(userA))
      val fromAssemble = assembled.dataTypes.find(_.id == pipeline.outputDataTypeId).getOrElse(fail("assemble entry missing"))

      val result = await(service.getResource(userA, pipeline.outputDataTypeId, WorkspaceResourceType.DataType))
      result match {
        case Right(WorkspaceResourceDetail.DataTypeDetail(detail)) =>
          detail.columns shouldBe fromAssemble.columns
          detail.sampleRows shouldBe fromAssemble.sampleRows
          detail.columnStats shouldBe fromAssemble.columnStats
        case other => fail(s"expected Right(DataTypeDetail), got $other")
      }
    }
  }

  // ── 5.5 getResource on a nonexistent/unowned id, per resource type ──────

  "getResource (5.5 NotFound, not an exception)" should {
    "return Left(NotFound) for a nonexistent data source id" in {
      await(service.getResource(userA, UUID.randomUUID().toString, WorkspaceResourceType.DataSource)) shouldBe a[Left[_, _]]
    }

    "return Left(NotFound) for a data source owned by a different user" in {
      val ds = createSource(userB, "getresource-55-unowned-source")
      val result = await(service.getResource(userA, ds.id.value, WorkspaceResourceType.DataSource))
      result shouldBe a[Left[_, _]]
    }

    "return Left(NotFound) for a nonexistent DataType id" in {
      await(service.getResource(userA, UUID.randomUUID().toString, WorkspaceResourceType.DataType)) shouldBe a[Left[_, _]]
    }

    "return Left(NotFound) for a nonexistent pipeline id" in {
      await(service.getResource(userA, UUID.randomUUID().toString, WorkspaceResourceType.Pipeline)) shouldBe a[Left[_, _]]
    }

    "return Left(NotFound) for a nonexistent dashboard id" in {
      await(service.getResource(userA, UUID.randomUUID().toString, WorkspaceResourceType.Dashboard)) shouldBe a[Left[_, _]]
    }

    "return Left(NotFound) for a dashboard owned by a different user" in {
      val dash = createDashboard(userB, "getresource-55-unowned-dashboard")
      val result = await(service.getResource(userA, dash.id.value, WorkspaceResourceType.Dashboard))
      result shouldBe a[Left[_, _]]
    }

    "return Left(NotFound) for a nonexistent metric id" in {
      await(service.getResource(userA, UUID.randomUUID().toString, WorkspaceResourceType.Metric)) shouldBe a[Left[_, _]]
    }

    "return Left(NotFound) for a metric owned by a different user" in {
      val metric = createMetric(userB, "getresource-55-unowned-metric")
      val result = await(service.getResource(userA, metric.id.value, WorkspaceResourceType.Metric))
      result shouldBe a[Left[_, _]]
    }
  }

  // ── 5.6 getResource on a metric returns its full definition ─────────────

  "getResource (5.6 metric detail)" should {
    "return the metric's full definition" in {
      val dt = DataType(
        id        = DataTypeId(UUID.randomUUID().toString),
        sourceId  = None,
        name      = "getresource-56-dt",
        fields    = Vector(DataField("revenue", "Revenue", "float", nullable = false)),
        version   = 1,
        createdAt = Instant.now(),
        updatedAt = Instant.now(),
        ownerId   = userA.id
      )
      await(dataTypeRepo.insert(dt, userA))

      val now = Instant.now()
      val metric = MetricDefinition(
        id                = MetricId(UUID.randomUUID().toString),
        ownerId           = userA.id,
        dataTypeId        = dt.id,
        name              = "getresource-56-metric",
        description       = Some("Full detail metric"),
        measureField      = "revenue",
        aggregation       = "avg",
        allowedDimensions = Vector("region", "channel"),
        format            = MetricFormat(unit = Some("USD"), decimals = Some(2), prefix = None, suffix = Some("/mo")),
        deprecated        = true,
        createdAt         = now,
        updatedAt         = now
      )
      await(metricRepo.insert(metric, userA)) match {
        case Right(_)  => ()
        case Left(err) => fail(s"metric insert failed: $err")
      }

      val result = await(service.getResource(userA, metric.id.value, WorkspaceResourceType.Metric))
      result match {
        case Right(WorkspaceResourceDetail.MetricDetail(detail)) =>
          detail.id shouldBe metric.id.value
          detail.name shouldBe "getresource-56-metric"
          detail.description shouldBe Some("Full detail metric")
          detail.measureField shouldBe "revenue"
          detail.aggregation shouldBe "avg"
          detail.allowedDimensions shouldBe Vector("region", "channel")
          detail.format shouldBe MetricFormat(Some("USD"), Some(2), None, Some("/mo"))
          detail.deprecated shouldBe true
        case other => fail(s"expected Right(MetricDetail), got $other")
      }
    }
  }

  // ── 5.9 DashboardService.findById / DataSourceService.findById ──────────

  "DashboardService.findById (5.9)" should {
    "return Right for an owned dashboard" in {
      // Field-by-field, not whole-object equality (mirrors MetricRepositorySpec's convention):
      // Postgres' microsecond `timestamp` precision can round `Instant.now()`'s nanosecond value
      // on round-trip, so comparing the freshly-constructed `dash` to the read-back result via
      // `shouldBe` is flaky on `ResourceMeta`'s `createdAt`/`lastUpdated` — not a real defect.
      val dash = createDashboard(userA, "findbyid-59-dashboard")
      val found = await(dashboardService.findById(dash.id, userA)).getOrElse(fail("expected Right"))
      found.id shouldBe dash.id
      found.name shouldBe dash.name
      found.ownerId shouldBe dash.ownerId
    }

    "return Left(NotFound) for a nonexistent dashboard" in {
      await(dashboardService.findById(DashboardId(UUID.randomUUID().toString), userA)) shouldBe a[Left[_, _]]
    }

    "return Left(NotFound) for a dashboard owned by a different user" in {
      val dash = createDashboard(userB, "findbyid-59-other-dashboard")
      await(dashboardService.findById(dash.id, userA)) shouldBe a[Left[_, _]]
    }
  }

  "DataSourceService.findById (5.9)" should {
    "return Right for an owned data source" in {
      // Field-by-field for the same timestamp-precision reason as the dashboard case above.
      val ds = createSource(userA, "findbyid-59-source")
      val found = await(dataSourceService.findById(ds.id, userA)).getOrElse(fail("expected Right"))
      found.id shouldBe ds.id
      found.name shouldBe ds.name
      found.ownerId shouldBe ds.ownerId
    }

    "return Left(NotFound) for a nonexistent data source" in {
      await(dataSourceService.findById(DataSourceId(UUID.randomUUID().toString), userA)) shouldBe a[Left[_, _]]
    }

    "return Left(NotFound) for a data source owned by a different user" in {
      val ds = createSource(userB, "findbyid-59-other-source")
      await(dataSourceService.findById(ds.id, userA)) shouldBe a[Left[_, _]]
    }
  }
}
