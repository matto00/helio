package com.helio.api.routes.pipelines

import com.helio.api.routes.pipelines.{PipelineRunHistoryRoutes, PipelineRunRegistry, PipelineRunStatusRoutes, PipelineRunStreamRoutes, PipelineRunSubmitRoutes}
import com.helio.domain.connectors.RestApiConnectorDriver
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.stream.Materializer
import org.apache.pekko.stream.scaladsl.Sink
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.server.Directives.concat
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.api.{ErrorResponse, JsonProtocols, PipelineRunRecord, RunResultResponse, RunStatusResponse}
import com.helio.domain._
import com.helio.domain.model._
import com.helio.domain.steps.{FilterCondition, FilterConfig, RenameConfig}
import com.helio.infrastructure.persistence.alerts.{AlertEventRepository, AlertRuleRepository}
import com.helio.infrastructure.persistence.pipelines.{BinaryRefRepository, NodeSnapshotRepository, OutputRepository, PipelineRepository, PipelineRunRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.alerts.AlertEvaluationService
import com.helio.services.pipelines.PipelineRunService
import com.helio.spark.{PipelineRunCache, RunStatus}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json.{JsArray, JsNumber, JsObject, JsString}

import java.nio.file.Paths
import java.time.Instant
import java.util.UUID
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

/** Route-layer integration tests for the four CS2c-3a run route files
 *  (Submit / Status / History / Stream). The pre-CS2c-3a single
 *  `PipelineRunRoutes` is split; this spec exercises the composed surface end
 *  to end so the wire contract is preserved. */
class PipelineRunRoutesSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                   = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres        = _
  private var db: JdbcBackend.Database                  = _
  private var ctx: DbContext                            = _
  private var pipelineRepo: PipelineRepository          = _
  private var stepRepo: PipelineStepRepository          = _
  private var dataSourceRepo: DataSourceRepository      = _
  private var pipelineRunRepo: PipelineRunRepository    = _
  private var binaryRefRepo: BinaryRefRepository        = _
  private var alertRuleRepo: AlertRuleRepository        = _
  private var alertEventRepo: AlertEventRepository      = _
  private var outputRepo: OutputRepository              = _
  private var nodeSnapshotRepo: NodeSnapshotRepository  = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db               = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    ctx              = new DbContext(db, db)(routeEc)
    dataSourceRepo   = new DataSourceRepository(ctx)(routeEc)
    stepRepo         = new PipelineStepRepository(ctx)(routeEc)
    pipelineRepo     = new PipelineRepository(ctx, dataSourceRepo)(routeEc)
    pipelineRunRepo  = new PipelineRunRepository(ctx)(routeEc)
    binaryRefRepo    = new BinaryRefRepository(ctx)(routeEc)
    alertRuleRepo    = new AlertRuleRepository(ctx)(routeEc)
    alertEventRepo   = new AlertEventRepository(ctx)(routeEc)
    outputRepo       = new OutputRepository(ctx)(routeEc)
    nodeSnapshotRepo = new NodeSnapshotRepository(ctx)(routeEc)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)


  private def seedDsWithData(): String = {
    import PostgresProfile.api._
    val dsId = UUID.randomUUID().toString
    val dsConfig = """{"columns":[{"name":"name","type":"string"},{"name":"score","type":"double"}],"rows":[["alice",42.0],["bob",37.0]]}"""
    await(db.run(sqlu"""INSERT INTO data_sources
      (id, name, source_type, config, owner_id, created_at, updated_at)
      VALUES ($dsId, 'ds-with-data', 'static', $dsConfig,
        '00000000-0000-0000-0000-000000000001', now(), now())"""))
    dsId
  }

  private def seedDs(sourceType: String): String = {
    val dsConfig = if (sourceType == "static") """{"columns":[],"rows":[]}"""
                   else if (sourceType == "csv") """{"filePath":"/tmp/test.csv"}"""
                   else "{}"
    seedDsWithConfig(sourceType, dsConfig)
  }

  /** HEL-758 (design.md D7): `seedDs`'s body, parameterized on `config`
   *  instead of hardcoding it — lets a test seed a `rest_api` source with
   *  `{"url": "$RestSuccessUrl"}`/`{"url": "$RestFailureUrl"}`, or a `sql`
   *  source targeting either this file's own `embeddedPostgres` (reachable)
   *  or an unreachable `host=localhost, port=1`. */
  private def seedDsWithConfig(sourceType: String, config: String): String = {
    import PostgresProfile.api._
    val dsId = UUID.randomUUID().toString
    await(db.run(sqlu"""INSERT INTO data_sources
      (id, name, source_type, config, owner_id, created_at, updated_at)
      VALUES ($dsId, 'ds', $sourceType, $config,
        '00000000-0000-0000-0000-000000000001', now(), now())"""))
    dsId
  }

  private def seedPipeline(dsId: String): PipelineId = seedPipelineWithDtId(dsId)._1

  private def seedPipelineWithDtId(dsId: String): (PipelineId, String) = {
    import PostgresProfile.api._
    val pid  = UUID.randomUUID().toString
    val dtId = UUID.randomUUID().toString
    await(db.run(DBIO.seq(
      
      sqlu"""INSERT INTO pipelines
               (id, name, source_data_source_id, created_at, updated_at)
               VALUES ($pid, 'pipe', $dsId, now(), now())"""
    )))
    (PipelineId(pid), dtId)
  }

  // HEL-904 task 4.5: `seedDsWithMixedTypes` removed outright -- its sole
  // caller (the HEL-891 schema-union test) is deleted above.

  /** HEL-216: seed an `ImageSource` data source backed by a real on-disk PNG
   *  (via `ImageIO`, JDK-standard) so `InProcessPipelineEngine.loadRows`'s
   *  `ImageSource` case can actually decode it end-to-end. */
  private def seedDsImage(): String = {
    import PostgresProfile.api._
    val tmp = java.io.File.createTempFile("helio-pipeline-image-", ".png")
    tmp.deleteOnExit()
    val image = new java.awt.image.BufferedImage(3, 2, java.awt.image.BufferedImage.TYPE_INT_RGB)
    javax.imageio.ImageIO.write(image, "png", tmp)

    val dsId     = UUID.randomUUID().toString
    val dsConfig = s"""{"path":"${tmp.getAbsolutePath}"}"""
    await(db.run(sqlu"""INSERT INTO data_sources
      (id, name, source_type, config, owner_id, created_at, updated_at)
      VALUES ($dsId, 'ds-image', 'image', $dsConfig,
        '00000000-0000-0000-0000-000000000001', now(), now())"""))
    dsId
  }

  /** HEL-904 (task 3.1): `AlertRule` now targets an Output on the
   *  pipeline, not the pipeline's output DataType directly — seeds a
   *  root-node (`node_step_id = None`) Output attached to `pid` so
   *  `PipelineRunService`'s `outputRepo.listByPipelineInternal` hook
   *  (task 3.1) can find it. */
  private def seedOutputForPipeline(pid: PipelineId): OutputId =
    await(outputRepo.insertInternal(pid, None, dummyUser.id, "out", OutputKind.Table)).id

  /** HEL-466: seed an enabled `AlertRule` targeting the pipeline's Output,
   *  for the onRunSuccess -> AlertEvaluationService hook tests below. */
  private def seedAlertRule(pid: PipelineId, metric: String, comparator: String, threshold: Double): AlertRuleId = {
    val now = Instant.now()
    val outputId = seedOutputForPipeline(pid)
    val rule = AlertRule(
      id             = AlertRuleId(UUID.randomUUID().toString),
      ownerId        = dummyUser.id,
      targetOutputId = outputId,
      metric         = metric,
      condition      = JsObject("comparator" -> JsString(comparator), "threshold" -> JsNumber(threshold)),
      name           = "HEL-466 test rule",
      enabled        = true,
      severity       = Severity.Warning,
      createdAt      = now,
      updatedAt      = now
    )
    await(alertRuleRepo.insert(rule, dummyUser)).id
  }


  private val fileSystem = new LocalFileSystem(Paths.get("/"))

  private val dummyUser = AuthenticatedUser(UserId("00000000-0000-0000-0000-000000000001"))

  // HEL-758 (design.md D7, copied verbatim from
  // PipelineApplyProposalSpecBase.scala:63-69): a stub RestApiConnectorDriver keyed
  // on `config.url` so the same connector instance exercises both a
  // successful and a failing REST fetch.
  private val RestSuccessUrl = "https://pipeline-run-routes.test/ok"
  private val RestFailureUrl = "https://pipeline-run-routes.test/fail"
  private val stubConnector = new RestApiConnectorDriver(Some { config =>
    if (config.connectorId == RestFailureUrl) Future.successful(Left("connector: endpoint unreachable"))
    else Future.successful(Right(JsArray(JsObject("name" -> JsString("alice"), "score" -> JsNumber(1)))))
  })

  /** Compose the 4 CS2c-3a run route files into a single route for testing. */
  private def makeRoutes(
      cache: PipelineRunCache,
      runRepo: PipelineRunRepository = null,
      registry: PipelineRunRegistry = null,
      user: AuthenticatedUser = dummyUser,
      binRefRepo: BinaryRefRepository = null,
      alertEvalSvc: AlertEvaluationService = null,
      connector: RestApiConnectorDriver = stubConnector,
      // HEL-904 (task 3.1): alert evaluation now resolves Outputs via
      // `outputRepo` — defaults to this spec's real `outputRepo` (not
      // nullable-default `null` like the other repos above) so every
      // existing `makeRoutes(...)` call site that never mentions Outputs
      // still exercises the real per-Output evaluation hook unchanged.
      outRepo: OutputRepository = outputRepo,
      // HEL-904 task 4.1: replaces the retired `dtRepo`/`rowRepo` params —
      // defaults to this spec's real `nodeSnapshotRepo` (same non-nullable-
      // default convention as `outRepo` above) so every existing
      // `makeRoutes(...)` call site keeps exercising the real
      // node_snapshots write unchanged.
      nodeSnapRepo: NodeSnapshotRepository = nodeSnapshotRepo
  ): Route = {
    implicit val ec: ExecutionContext = routeEc
    val service = new PipelineRunService(
      pipelineRepo, stepRepo, dataSourceRepo, runRepo, cache, registry, fileSystem, binRefRepo, alertEvalSvc, connector,
      outputRepo = outRepo, nodeSnapshotRepo = nodeSnapRepo
    )
    concat(
      new PipelineRunSubmitRoutes(service, user).routes,
      new PipelineRunStatusRoutes(service, user).routes,
      new PipelineRunHistoryRoutes(service, user).routes,
      new PipelineRunStreamRoutes(service, user).routes
    )
  }

  "PipelineRun routes (composed)" should {

    "POST /pipelines/:id/run returns 200 with inline rows for a static pipeline" in {
      val cache = new PipelineRunCache()
      val dsId  = seedDs("static")
      val pid   = seedPipeline(dsId)
      Post(s"/pipelines/${pid.value}/run") ~> makeRoutes(cache) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[RunResultResponse]
        resp.rowCount shouldBe 0
      }
    }

    "POST /pipelines/:id/run returns 404 for unknown pipeline" in {
      val cache = new PipelineRunCache()
      Post("/pipelines/nonexistent/run") ~> makeRoutes(cache) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    // HEL-758: split from "POST /pipelines/:id/run returns 422 for rest_api
    // source type" — rest_api now executes for real (design.md D1/D3).
    "POST /pipelines/:id/run returns 200 with populated rows for a healthy rest_api source" in {
      val cache = new PipelineRunCache()
      val dsId  = seedDsWithConfig("rest_api", s"""{"connectorId":"$RestSuccessUrl"}""")
      val pid   = seedPipeline(dsId)
      Post(s"/pipelines/${pid.value}/run") ~> makeRoutes(cache) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[RunResultResponse]
        resp.rowCount shouldBe 1
        resp.rows.head.fields("name") shouldBe JsString("alice")
      }
    }

    "POST /pipelines/:id/run returns 422 when the rest_api source is unreachable" in {
      val cache = new PipelineRunCache()
      val dsId  = seedDsWithConfig("rest_api", s"""{"connectorId":"$RestFailureUrl"}""")
      val pid   = seedPipeline(dsId)
      Post(s"/pipelines/${pid.value}/run") ~> makeRoutes(cache) ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
      }
    }

    // HEL-758: split from "POST /pipelines/:id/run returns 422 for sql
    // source type" — sql now executes for real (design.md D1/D3).
    "POST /pipelines/:id/run returns 200 with populated rows for a healthy sql source" in {
      val cache = new PipelineRunCache()
      val liveConfig =
        s"""{"dialect":"postgresql","host":"localhost","port":${embeddedPostgres.getPort},
           |"database":"postgres","user":"postgres","password":"postgres","query":"SELECT 1 AS one"}""".stripMargin
      val dsId = seedDsWithConfig("sql", liveConfig)
      val pid  = seedPipeline(dsId)
      Post(s"/pipelines/${pid.value}/run") ~> makeRoutes(cache) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[RunResultResponse]
        resp.rowCount shouldBe 1
      }
    }

    "POST /pipelines/:id/run returns 422 when the sql connection fails" in {
      val cache = new PipelineRunCache()
      // localhost:1 fails fast and deterministically — mirrors
      // PipelineApplyProposalRollbackSpec's existing "fails fast" pattern.
      val unreachableConfig =
        """{"dialect":"postgresql","host":"localhost","port":1,"database":"d","user":"u",
          |"password":"p","query":"SELECT 1"}""".stripMargin
      val dsId = seedDsWithConfig("sql", unreachableConfig)
      val pid  = seedPipeline(dsId)
      Post(s"/pipelines/${pid.value}/run") ~> makeRoutes(cache) ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
      }
    }

    "GET /pipelines/:id/runs/:runId returns 200 with queued status" in {
      val cache = new PipelineRunCache()
      val runId = "test-run-123"
      cache.put(runId, RunStatus.Queued)
      Get(s"/pipelines/any/runs/$runId") ~> makeRoutes(cache) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[RunStatusResponse]
        resp.runId  shouldBe runId
        resp.status shouldBe RunStatus.Queued
        resp.rows   shouldBe None
        resp.error  shouldBe None
      }
    }

    "GET /pipelines/:id/runs/:runId returns 200 with rows when succeeded" in {
      val cache = new PipelineRunCache()
      val runId = "test-run-456"
      cache.update(runId, RunStatus.Succeeded, rows = Some(Seq(Map("x" -> 1.asInstanceOf[Any]))))
      Get(s"/pipelines/any/runs/$runId") ~> makeRoutes(cache) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[RunStatusResponse]
        resp.status shouldBe RunStatus.Succeeded
        resp.rows   shouldBe defined
      }
    }

    "GET /pipelines/:id/runs/:runId returns 404 for unknown runId" in {
      val cache = new PipelineRunCache()
      Get("/pipelines/any/runs/nonexistent") ~> makeRoutes(cache) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "GET /pipelines/:id/run-history returns 200 with empty list when no runs" in {
      val cache = new PipelineRunCache()
      val dsId  = seedDs("static")
      val pid   = seedPipeline(dsId)
      Get(s"/pipelines/${pid.value}/run-history") ~> makeRoutes(cache, pipelineRunRepo) ~> check {
        status shouldBe StatusCodes.OK
        val records = responseAs[Vector[PipelineRunRecord]]
        records shouldBe empty
      }
    }

    "GET /pipelines/:id/run-history returns 200 with run records" in {
      val cache = new PipelineRunCache()
      val dsId  = seedDs("static")
      val pid   = seedPipeline(dsId)
      val runId = PipelineRunId(UUID.randomUUID().toString)
      await(pipelineRunRepo.insertRun(runId, pid, Instant.now(), dummyUser))
      await(pipelineRunRepo.updateRunTerminal(runId, "succeeded", Instant.now(), rowCount = Some(5), errorLog = None, dummyUser))

      Get(s"/pipelines/${pid.value}/run-history") ~> makeRoutes(cache, pipelineRunRepo) ~> check {
        status shouldBe StatusCodes.OK
        val records = responseAs[Vector[PipelineRunRecord]]
        records should have size 1
        records.head.id            shouldBe runId.value
        records.head.status        shouldBe "succeeded"
        records.head.rowCount      shouldBe Some(5)
        records.head.triggerSource shouldBe "manual"
      }
    }

    "GET /pipelines/:id/run-history returns 404 for unknown pipeline" in {
      val cache = new PipelineRunCache()
      Get("/pipelines/nonexistent/run-history") ~> makeRoutes(cache, pipelineRunRepo) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "POST /pipelines/:id/run?dry=true returns rows without updating last_run_status" in {
      import PostgresProfile.api._
      val cache = new PipelineRunCache()
      val dsId  = seedDsWithData()
      val pid   = seedPipeline(dsId)
      Post(s"/pipelines/${pid.value}/run?dry=true") ~> makeRoutes(cache) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[RunResultResponse]
        resp.rowCount shouldBe 2
      }
      val statusOpt = await(db.run(
        sql"SELECT last_run_status FROM pipelines WHERE id = ${pid.value}".as[Option[String]].head
      ))
      statusOpt shouldBe None
    }

    "POST /pipelines/:id/run updates last_run_status to succeeded and writes node_snapshots rows" in {
      import PostgresProfile.api._
      val cache  = new PipelineRunCache()
      val dsId   = seedDsWithData()
      val pid    = seedPipeline(dsId)
      seedOutputForPipeline(pid)
      Post(s"/pipelines/${pid.value}/run") ~> makeRoutes(cache) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[RunResultResponse]
        resp.rowCount shouldBe 2
      }
      val statusOpt = await(db.run(
        sql"SELECT last_run_status FROM pipelines WHERE id = ${pid.value}".as[Option[String]].head
      ))
      statusOpt shouldBe Some("succeeded")
      val rows = await(nodeSnapshotRepo.listRows(pid.value, None))
      rows.flatMap(_.fields.keySet) should contain allOf ("name", "score")
    }


    "GET /pipelines/:id/steps/:stepId/preview returns first 10 rows for a valid step" in {
      val cache = new PipelineRunCache()
      val dsId  = seedDsWithData()
      val pid   = seedPipeline(dsId)
      val step  = await(stepRepo.insert(pid, "select", SelectConfig(Vector("name", "score")), dummyUser))
      Get(s"/pipelines/${pid.value}/steps/${step.id.value}/preview") ~> makeRoutes(cache) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[RunResultResponse]
        resp.rows.size should be <= 10
        resp.rowCount shouldBe resp.rows.size
      }
    }

    "GET /pipelines/:id/steps/:stepId/preview returns 404 for unknown pipeline" in {
      val cache = new PipelineRunCache()
      Get("/pipelines/nonexistent/steps/any-step-id/preview") ~> makeRoutes(cache) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    "GET /pipelines/:id/steps/:stepId/preview returns 404 for unknown step" in {
      val cache = new PipelineRunCache()
      val dsId  = seedDs("static")
      val pid   = seedPipeline(dsId)
      Get(s"/pipelines/${pid.value}/steps/nonexistent-step-id/preview") ~> makeRoutes(cache) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    // HEL-758: reseeded from a 422-rejection test to a success test —
    // rest_api now supports preview, not just full runs (design.md D1/D3).
    "GET /pipelines/:id/steps/:stepId/preview returns 200 with preview rows for a healthy rest_api source" in {
      val cache = new PipelineRunCache()
      val dsId  = seedDsWithConfig("rest_api", s"""{"connectorId":"$RestSuccessUrl"}""")
      val pid   = seedPipeline(dsId)
      val step  = await(stepRepo.insert(pid, "select", SelectConfig(Vector("name")), dummyUser))
      Get(s"/pipelines/${pid.value}/steps/${step.id.value}/preview") ~> makeRoutes(cache) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[RunResultResponse]
        resp.rows should not be empty
        resp.rows.head.fields.keySet shouldBe Set("name")
      }
    }

    "GET /pipelines/:id/steps/:stepId/preview only applies steps up to and including the target step" in {
      val cache = new PipelineRunCache()
      val dsId  = seedDsWithData()
      val pid   = seedPipeline(dsId)
      val selectStep = await(stepRepo.insert(pid, "select", SelectConfig(Vector("name", "score")), dummyUser))
      await(stepRepo.insert(pid, "limit", LimitConfig(1), dummyUser))
      Get(s"/pipelines/${pid.value}/steps/${selectStep.id.value}/preview") ~> makeRoutes(cache) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[RunResultResponse]
        resp.rowCount shouldBe 2
      }
    }

    // HEL-922: `stepRowCounts` is computed at the engine layer and threaded through
    // `PipelineRunService`/`RunResultResponse`, but no test previously asserted the value at the
    // route-response (parsed-JSON) level -- only `PipelineRunServiceSpec`'s Scala-level asserts
    // and the HEL-330 engine-adapter unit test covered it, neither of which crosses the
    // serialization boundary. `stepRowCounts: Map[String, Long] = Map.empty` is a non-`Option`
    // field in a macro-derived `jsonFormat11`, so spray-json's map writer always emits it as a
    // JSON object (never omits it the way `Option = None` would) -- this test proves that by
    // parsing the real response body, not by reading `RunResultResponse` off a service call.
    // The second step is chained onto the first via `insertInternal(..., parentStepId = ...)`
    // (position 0 under its parent) so this is a genuine TRUNK, not two independent root
    // branches -- `stepRepo.insert` (used elsewhere in this file) never sets `parentStepId`,
    // which makes each call a separate root-level branch reading straight from source, not a
    // pipe from one step's output into the next; that shape would NOT exercise the trunk walk
    // this ticket's `previewAtNode`/`pathToRoot` code path is actually about.
    // Two steps with DIFFERENT row counts (filter score > 40: 2 rows -> 1; limit(5): 1 -> 1,
    // a no-op on that 1 row) prove the map is keyed per-step and not just a single collapsed
    // total -- a mutation dropping the filter's entry, swapping the two counts, or zeroing the
    // map fails this.
    "GET /pipelines/:id/steps/:stepId/preview returns per-step row counts keyed by step id" in {
      val cache = new PipelineRunCache()
      val dsId  = seedDsWithData()
      val pid   = seedPipeline(dsId)
      val selectStep = await(stepRepo.insertInternal(
        pid, "select", SelectConfig(Vector("name", "score")), enabled = true
      ))
      val filterStep = await(stepRepo.insertInternal(
        pid, "filter", FilterConfig("and", Vector(FilterCondition("score", ">", Some("40")))), enabled = true,
        parentStepId = Some(selectStep.id)
      ))
      Get(s"/pipelines/${pid.value}/steps/${filterStep.id.value}/preview") ~> makeRoutes(cache) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[RunResultResponse]
        resp.rowCount shouldBe 1
        resp.stepRowCounts shouldBe Map(selectStep.id.value -> 2L, filterStep.id.value -> 1L)
      }
    }

    // HEL-922: same assertion at the `POST /run` (non-dry) route, the OTHER wire-response call
    // site that constructs `RunResultResponse` from `outcome.stepCounts` (PipelineRunService.scala,
    // the run-path construction site, not the preview-path one exercised above) -- covering both
    // call sites closes the gap the ticket's mutation-testing finding identified (94/94 green with
    // a wrong `stepCounts` because NEITHER route-level suite asserted the value). Same chained
    // trunk shape as the preview test above (`insertInternal(..., parentStepId = ...)`).
    "POST /pipelines/:id/run returns per-step row counts keyed by step id in the wire response" in {
      val cache = new PipelineRunCache()
      val dsId  = seedDsWithData()
      val pid   = seedPipeline(dsId)
      val selectStep = await(stepRepo.insertInternal(
        pid, "select", SelectConfig(Vector("name", "score")), enabled = true
      ))
      val filterStep = await(stepRepo.insertInternal(
        pid, "filter", FilterConfig("and", Vector(FilterCondition("score", ">", Some("40")))), enabled = true,
        parentStepId = Some(selectStep.id)
      ))
      Post(s"/pipelines/${pid.value}/run") ~> makeRoutes(cache) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[RunResultResponse]
        resp.rowCount shouldBe 1
        resp.stepRowCounts shouldBe Map(selectStep.id.value -> 2L, filterStep.id.value -> 1L)
      }
    }

    // HEL-412 (design.md Decision 3): the preview prefix skips disabled steps.
    "GET /pipelines/:id/steps/:stepId/preview excludes a disabled step from the executed prefix" in {
      val cache = new PipelineRunCache()
      val dsId  = seedDsWithData()
      val pid   = seedPipeline(dsId)
      await(stepRepo.insert(pid, "limit", LimitConfig(1), dummyUser, enabled = false))
      val selectStep = await(stepRepo.insert(pid, "select", SelectConfig(Vector("name", "score")), dummyUser))
      Get(s"/pipelines/${pid.value}/steps/${selectStep.id.value}/preview") ~> makeRoutes(cache) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[RunResultResponse]
        // The disabled limit(1) never ran, so both source rows survive.
        resp.rowCount shouldBe 2
      }
    }

    // HEL-412 (design.md Decision 3): previewing a disabled step itself is rejected.
    "GET /pipelines/:id/steps/:stepId/preview returns 422 when the target step is disabled" in {
      val cache = new PipelineRunCache()
      val dsId  = seedDsWithData()
      val pid   = seedPipeline(dsId)
      val step  = await(stepRepo.insert(pid, "select", SelectConfig(Vector("name", "score")), dummyUser, enabled = false))
      Get(s"/pipelines/${pid.value}/steps/${step.id.value}/preview") ~> makeRoutes(cache) ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
        val resp = responseAs[ErrorResponse]
        resp.message should include("disabled")
      }
    }

    "POST /pipelines/:id/run (non-dry, success) inserts a pipeline_runs row with status succeeded" in {
      val cache = new PipelineRunCache()
      val dsId  = seedDsWithData()
      val pid   = seedPipeline(dsId)
      Post(s"/pipelines/${pid.value}/run") ~> makeRoutes(cache, pipelineRunRepo) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[RunResultResponse]
        resp.rowCount shouldBe 2
      }
      val runs = await(pipelineRunRepo.listByPipeline(pid, dummyUser))
      runs should have size 1
      runs.head.pipelineId    shouldBe pid.value
      runs.head.status        shouldBe "succeeded"
      runs.head.rowCount      shouldBe Some(2)
      runs.head.errorLog      shouldBe None
      // HEL-417: PipelineRunService.submit's default triggerSource ("manual")
      // applies end to end for the manual API path — no explicit argument
      // is passed by PipelineRunSubmitRoutes.
      runs.head.triggerSource shouldBe "manual"
    }

    // HEL-859 (design.md Decision 3): fan-out surface (c) — the persisted
    // `PipelineRunRecord.errorLog` (returned by `GET /pipelines/:id/run-history`)
    // must be the same step-attributed message as the direct run-failure
    // response: the "DataSource not found for join" text IS an
    // `IllegalArgumentException` message, so per the allowlist it IS
    // forwarded — along with the failing step's id and kind, which the
    // generic HEL-311 prefix alone could never identify.
    "POST /pipelines/:id/run (non-dry, failure via bad join step) inserts a pipeline_runs row with a step-attributed errorLog" in {
      val cache            = new PipelineRunCache()
      val dsId             = seedDsWithData()
      val pid              = seedPipeline(dsId)
      val missingSourceId = "00000000-0000-0000-0000-000000000099"
      val joinStep = await(stepRepo.insert(pid, "join",
        JoinConfig(missingSourceId, "name", "inner"), dummyUser))
      Post(s"/pipelines/${pid.value}/run") ~> makeRoutes(cache, pipelineRunRepo) ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
      }
      val runs = await(pipelineRunRepo.listByPipeline(pid, dummyUser))
      runs should have size 1
      runs.head.pipelineId shouldBe pid.value
      runs.head.status     shouldBe "failed"
      runs.head.errorLog   shouldBe Some(
        s"Pipeline execution failed at step ${joinStep.id.value} (join): DataSource not found for join: $missingSourceId"
      )
    }

    // HEL-859 (tasks.md 5.1, AC1/AC3): the ticket's own repro. A run that
    // fails inside a step returns a 422 whose message names the failing
    // step's id, the string "stringops", the rejected value "regexExtract",
    // and the supported name "extractRegex" — everything the field-test
    // reporter needed to fix their own call without bisecting the pipeline.
    "POST /pipelines/:id/run failure via unsupported stringops operation names the step id, kind, and reason" in {
      val cache = new PipelineRunCache()
      val dsId  = seedDsWithData()
      val pid   = seedPipeline(dsId)
      val badStep = await(stepRepo.insert(pid, "stringops",
        StringOpsConfig("regexExtract", "name", "extracted", None, None, None, None), dummyUser))
      Post(s"/pipelines/${pid.value}/run") ~> makeRoutes(cache, pipelineRunRepo) ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
        val resp = responseAs[ErrorResponse]
        resp.message should include(badStep.id.value)
        resp.message should include("stringops")
        resp.message should include("regexExtract")
        resp.message should include("extractRegex")
      }
    }

    "POST /pipelines/:id/run?dry=true inserts a dry_run row in the repository" in {
      val cache = new PipelineRunCache()
      val dsId  = seedDsWithData()
      val pid   = seedPipeline(dsId)
      Post(s"/pipelines/${pid.value}/run?dry=true") ~> makeRoutes(cache, pipelineRunRepo) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[RunResultResponse]
        resp.rowCount shouldBe 2
      }
      val runs = await(pipelineRunRepo.listByPipeline(pid, dummyUser))
      runs should have size 1
      runs.head.pipelineId    shouldBe pid.value
      runs.head.status        shouldBe "dry_run"
      runs.head.completedAt   shouldBe defined
      runs.head.rowCount      shouldBe Some(2)
      runs.head.triggerSource shouldBe "manual"
    }

    "POST /pipelines/:id/run (non-dry) stores rows in node_snapshots after success" in {
      val cache              = new PipelineRunCache()
      val dsId               = seedDsWithData()
      val pid                = seedPipeline(dsId)
      seedOutputForPipeline(pid)
      Post(s"/pipelines/${pid.value}/run") ~> makeRoutes(cache) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[RunResultResponse]
        resp.rowCount shouldBe 2
      }
      val storedRows = await(nodeSnapshotRepo.listRows(pid.value, None))
      storedRows should have size 2
      storedRows.head.fields.keys should contain allOf ("name", "score")
    }

    "POST /pipelines/:id/run?dry=true does NOT write to node_snapshots" in {
      val cache              = new PipelineRunCache()
      val dsId               = seedDsWithData()
      val pid                = seedPipeline(dsId)
      await(nodeSnapshotRepo.overwriteRows(pid.value, None, Seq.empty))

      Post(s"/pipelines/${pid.value}/run?dry=true") ~> makeRoutes(cache) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[RunResultResponse]
        resp.rowCount shouldBe 2
      }
      val storedRows = await(nodeSnapshotRepo.listRows(pid.value, None))
      storedRows shouldBe empty
    }

    "POST /pipelines/:id/run (non-dry, second run) overwrites previous snapshot" in {
      val cache              = new PipelineRunCache()
      val dsId               = seedDsWithData()
      val pid                = seedPipeline(dsId)
      seedOutputForPipeline(pid)

      Post(s"/pipelines/${pid.value}/run") ~> makeRoutes(cache) ~> check {
        status shouldBe StatusCodes.OK
      }
      await(nodeSnapshotRepo.listRows(pid.value, None)) should have size 2

      Post(s"/pipelines/${pid.value}/run") ~> makeRoutes(cache) ~> check {
        status shouldBe StatusCodes.OK
      }
      await(nodeSnapshotRepo.listRows(pid.value, None)) should have size 2
    }

    // HEL-904 task 4.5: "POST /pipelines/:id/run infers integer type for whole-number column and
    // float for fractional" removed outright -- it exercised the retired
    // `upsertFieldsFromRows`/`DataType.fields` schema-union write; `node_snapshots` stores rows
    // only, never a derived per-column schema.

    // HEL-859 (design.md Decision 3): the response body now names the
    // failing step's id, kind, and reason — "DataSource not found for join"
    // is an `IllegalArgumentException` message, so the allowlist forwards it
    // verbatim, prefixed with the static "Pipeline execution failed" text
    // (still preserved) and the step attribution.
    "POST /pipelines/:id/run failure sets last_run_status to failed and returns 422 naming the failing step" in {
      import PostgresProfile.api._
      val cache          = new PipelineRunCache()
      val dsId           = seedDsWithData()
      val pid            = seedPipeline(dsId)
      val missingSourceId = "00000000-0000-0000-0000-000000000099"
      val joinStep = await(stepRepo.insert(pid, "join",
        JoinConfig(missingSourceId, "name", "inner"), dummyUser))
      Post(s"/pipelines/${pid.value}/run") ~> makeRoutes(cache) ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
        val resp = responseAs[ErrorResponse]
        resp.message shouldBe
          s"Pipeline execution failed at step ${joinStep.id.value} (join): DataSource not found for join: $missingSourceId"
      }
      val statusOpt = await(db.run(
        sql"SELECT last_run_status FROM pipelines WHERE id = ${pid.value}".as[Option[String]].head
      ))
      statusOpt shouldBe Some("failed")
    }


    "GET /pipelines/:id/run-events returns text/event-stream for existing pipeline" in {
      val cache = new PipelineRunCache()
      val dsId  = seedDs("static")
      val pid   = seedPipeline(dsId)
      val reg   = new PipelineRunRegistry()(typedSystem)
      Get(s"/pipelines/${pid.value}/run-events") ~> makeRoutes(cache, registry = reg) ~> check {
        status shouldBe StatusCodes.OK
        contentType.mediaType.mainType shouldBe "text"
        contentType.mediaType.subType  shouldBe "event-stream"
      }
    }

    "GET /pipelines/:id/run-events returns 404 for unknown pipeline" in {
      val cache = new PipelineRunCache()
      val reg   = new PipelineRunRegistry()(typedSystem)
      Get("/pipelines/nonexistent-sse/run-events") ~> makeRoutes(cache, registry = reg) ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }

    // HEL-299 regression: the SSE guard's grantee branch is the only path that
    // runs `UUID.fromString(caller.id.value)` + the `withUserContext` grant
    // query (the owner path short-circuits on a string compare). It was the
    // prime suspect for the observed 500, so lock it at 200 for a viewer
    // grantee of an existing pipeline.
    "GET /pipelines/:id/run-events returns text/event-stream for a viewer grantee (non-owner)" in {
      import PostgresProfile.api._
      val cache   = new PipelineRunCache()
      val dsId    = seedDs("static")
      val pid     = seedPipeline(dsId)
      val granteeId = UUID.randomUUID().toString
      await(db.run(DBIO.seq(
        sqlu"""INSERT INTO users (id, email, display_name, created_at, updated_at)
                 VALUES ($granteeId::uuid, 'hel299-grantee@test', 'Grantee', now(), now())""",
        sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
                 VALUES ('pipeline', ${pid.value}, $granteeId::uuid, 'viewer', now())"""
      )))
      val reg     = new PipelineRunRegistry()(typedSystem)
      val grantee = AuthenticatedUser(UserId(granteeId))
      Get(s"/pipelines/${pid.value}/run-events") ~> makeRoutes(cache, registry = reg, user = grantee) ~> check {
        status shouldBe StatusCodes.OK
        contentType.mediaType.mainType shouldBe "text"
        contentType.mediaType.subType  shouldBe "event-stream"
      }
    }

    // HEL-299: if the access-check future fails with an unexpected internal
    // exception, the route must return a generic 500 that does NOT leak the
    // exception message (previously it returned `ex.getMessage` in the body).
    "GET /pipelines/:id/run-events returns a generic 500 without leaking the exception message on guard failure" in {
      implicit val ec: ExecutionContext = routeEc
      val secret       = "leaky-internal-detail-should-not-surface"
      val failingRepo  = new PipelineRepository(ctx, dataSourceRepo)(routeEc) {
        override def findByIdShared(id: PipelineId, callerOpt: Option[AuthenticatedUser]): Future[Option[Pipeline]] =
          Future.failed(new RuntimeException(secret))
      }
      val reg          = new PipelineRunRegistry()(typedSystem)
      val service      = new PipelineRunService(
        failingRepo, stepRepo, dataSourceRepo, null, new PipelineRunCache(), reg, fileSystem, null
      )
      val routes: Route = new PipelineRunStreamRoutes(service, dummyUser).routes
      Get("/pipelines/00000000-0000-0000-0000-0000000000aa/run-events") ~> routes ~> check {
        status shouldBe StatusCodes.InternalServerError
        val body = responseAs[String]
        body should not include secret
        body should include("Internal server error")
      }
    }

    "POST /pipelines/:id/run publishes queued -> running -> succeeded via SSE" in {
      val cache = new PipelineRunCache()
      val dsId  = seedDsWithData()
      val pid   = seedPipeline(dsId)
      val reg   = new PipelineRunRegistry()(typedSystem)

      val eventsFuture = reg
        .subscribe(pid.value)
        .runWith(Sink.seq)(Materializer(system))

      Post(s"/pipelines/${pid.value}/run") ~> makeRoutes(cache, registry = reg) ~> check {
        status shouldBe StatusCodes.OK
      }

      val events = Await.result(eventsFuture, 10.seconds)
      // HEL-905 (design.md Decision 6): the tree walk also publishes non-terminal
      // "node-progress" events (one per node completed) -- filtered out here since this test
      // is about the run-level lifecycle sequence, not per-node progress (covered separately).
      events.map(_.status).filterNot(_ == "node-progress") shouldBe Seq("queued", "running", "succeeded")
      events.map(_.status) should contain("node-progress")
      events.last.rowCount shouldBe Some(2)
    }

    // HEL-905 (evaluation-1.md CR8/task 6.6): a tail's own "node-progress" event, carrying that
    // tail's own nodeId and its own row count -- not merely inferred from trunk behavior -- must
    // arrive over the real SSE wire, and must never disturb the run-level status/rowCount fields
    // (design.md Decision 6's "do not gold-plate" contract).
    "POST /pipelines/:id/run publishes a node-progress event carrying a TAIL's own nodeId and row count over SSE" in {
      val cache = new PipelineRunCache()
      val dsId  = seedDsWithData()
      val pid   = seedPipeline(dsId)
      // A trunk step (position 0) first, so the second sibling below actually lands at
      // position 1 -- a genuine tail, not the trunk's own first child (`insertInternal`
      // auto-assigns position by sibling count: the FIRST child under a parent always gets
      // position 0, so a lone "tail" with no trunk sibling would incorrectly BE the trunk).
      await(stepRepo.insertInternal(pid, "rename", RenameConfig(Map("name" -> "renamedTrunk")), enabled = true, parentStepId = None))
      // The tail rooted off the pipeline root (now position 1): filters down to "alice" alone
      // -- a row count (1) that provably differs from the trunk's own (2), so a naive
      // "any node-progress event" assertion could not accidentally pass.
      val tailStep = await(stepRepo.insertInternal(
        pid, "filter", FilterConfig("AND", Vector(FilterCondition("name", "=", Some("alice")))),
        enabled = true, parentStepId = None
      ))
      val reg = new PipelineRunRegistry()(typedSystem)

      val eventsFuture = reg
        .subscribe(pid.value)
        .runWith(Sink.seq)(Materializer(system))

      Post(s"/pipelines/${pid.value}/run") ~> makeRoutes(cache, registry = reg) ~> check {
        status shouldBe StatusCodes.OK
      }

      val events = Await.result(eventsFuture, 10.seconds)
      val tailEvent = events.find(e => e.status == "node-progress" && e.nodeId.contains(tailStep.id.value))
      tailEvent shouldBe defined
      tailEvent.get.rowCount shouldBe Some(1)

      // The run-level lifecycle/status/rowCount must be untouched by any node-progress event --
      // the terminal "succeeded" event still reports the TRUNK's row count (2), not the tail's
      // (1). Locate it by status rather than `events.last`: a node-progress event for the tail
      // can legitimately be published after the terminal event on this stream.
      events.map(_.status).filterNot(_ == "node-progress") shouldBe Seq("queued", "running", "succeeded")
      events.find(_.status == "succeeded").get.rowCount shouldBe Some(2)
    }

    // HEL-859 (design.md Decision 3): fan-out surface (a) — the SSE
    // `errorLog` event published on run failure must be the same
    // step-attributed message as the direct HTTP response and the persisted
    // run record.
    "POST /pipelines/:id/run publishes queued -> running -> failed via SSE naming the failing step" in {
      val cache            = new PipelineRunCache()
      val dsId             = seedDsWithData()
      val pid              = seedPipeline(dsId)
      val reg              = new PipelineRunRegistry()(typedSystem)
      val missingSourceId = "00000000-0000-0000-0000-000000000099"
      val joinStep = await(stepRepo.insert(pid, "join",
        JoinConfig(missingSourceId, "name", "inner"), dummyUser))

      val eventsFuture = reg
        .subscribe(pid.value)
        .runWith(Sink.seq)(Materializer(system))

      Post(s"/pipelines/${pid.value}/run") ~> makeRoutes(cache, registry = reg) ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
      }

      val events = Await.result(eventsFuture, 10.seconds)
      // HEL-905: see the succeeded-path test above for why node-progress is filtered here.
      events.map(_.status).filterNot(_ == "node-progress") shouldBe Seq("queued", "running", "failed")
      events.last.errorLog shouldBe Some(
        s"Pipeline execution failed at step ${joinStep.id.value} (join): DataSource not found for join: $missingSourceId"
      )
    }


    "POST /pipelines/:id/run over an ImageSource populates binary_refs" in {
      val cache       = new PipelineRunCache()
      val dsId        = seedDsImage()
      val pid         = seedPipeline(dsId)
      seedOutputForPipeline(pid)
      Post(s"/pipelines/${pid.value}/run") ~> makeRoutes(cache, binRefRepo = binaryRefRepo) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[RunResultResponse]
        resp.rowCount shouldBe 1
      }
      val refs = await(binaryRefRepo.findByNode(pid.value, None))
      refs should have size 1
      refs.head.fieldName shouldBe "content"
      refs.head.rowIndex   shouldBe 0

      // Matches what actually landed in node_snapshots.data.content.
      val storedRows = await(nodeSnapshotRepo.listRows(pid.value, None))
      storedRows should have size 1
      val contentJs = storedRows.head.fields("content").asJsObject
      contentJs.fields("storageKey").convertTo[String] shouldBe refs.head.storageKey
      contentJs.fields("mimeType").convertTo[String]   shouldBe refs.head.mimeType
    }

    "POST /pipelines/:id/run (second run over an ImageSource) replaces the prior binary_refs snapshot" in {
      val cache       = new PipelineRunCache()
      val dsId        = seedDsImage()
      val pid         = seedPipeline(dsId)

      Post(s"/pipelines/${pid.value}/run") ~> makeRoutes(cache, binRefRepo = binaryRefRepo) ~> check {
        status shouldBe StatusCodes.OK
      }
      await(binaryRefRepo.findByNode(pid.value, None)) should have size 1

      Post(s"/pipelines/${pid.value}/run") ~> makeRoutes(cache, binRefRepo = binaryRefRepo) ~> check {
        status shouldBe StatusCodes.OK
      }
      await(binaryRefRepo.findByNode(pid.value, None)) should have size 1
    }

    "POST /pipelines/:id/run over a StaticSource (no binary-ref fields) writes no binary_refs rows" in {
      val cache       = new PipelineRunCache()
      val dsId        = seedDsWithData()
      val pid         = seedPipeline(dsId)
      Post(s"/pipelines/${pid.value}/run") ~> makeRoutes(cache, binRefRepo = binaryRefRepo) ~> check {
        status shouldBe StatusCodes.OK
      }
      await(binaryRefRepo.findByNode(pid.value, None)) shouldBe empty
    }


    "POST /pipelines/:id/run (non-dry, failure) invokes no alert evaluation and creates no events" in {
      val cache            = new PipelineRunCache()
      val dsId             = seedDsWithData()
      val pid              = seedPipeline(dsId)
      val ruleId           = seedAlertRule(pid, "score", "gt", 0)
      val missingSourceId = "00000000-0000-0000-0000-000000000099"
      await(stepRepo.insert(pid, "join", JoinConfig(missingSourceId, "name", "inner"), dummyUser))
      val alertEvalSvc = new AlertEvaluationService(alertRuleRepo, alertEventRepo)(routeEc)

      Post(s"/pipelines/${pid.value}/run") ~> makeRoutes(cache, alertEvalSvc = alertEvalSvc) ~> check {
        status shouldBe StatusCodes.UnprocessableEntity
      }

      await(alertEventRepo.findActiveByRule(ruleId)) shouldBe None
    }

    "POST /pipelines/:id/run (non-dry, success) invokes evaluation and fires a breaching rule" in {
      val cache        = new PipelineRunCache()
      val dsId         = seedDsWithData()
      val pid          = seedPipeline(dsId)
      val ruleId       = seedAlertRule(pid, "score", "gt", 50) // sum(42.0, 37.0) = 79 > 50
      val alertEvalSvc = new AlertEvaluationService(alertRuleRepo, alertEventRepo)(routeEc)

      Post(s"/pipelines/${pid.value}/run") ~> makeRoutes(cache, alertEvalSvc = alertEvalSvc) ~> check {
        status shouldBe StatusCodes.OK
      }

      val active = await(alertEventRepo.findActiveByRule(ruleId))
      active shouldBe defined
      active.get.state shouldBe AlertEventState.Firing
    }

    // HEL-466 acceptance criterion: "evaluation raising an exception logs and
    // never fails or rolls back the run" — a failing AlertRuleRepository
    // (not a mocked AlertEvaluationService, which is `final`) drives a real
    // `evaluateForDataType` failure, exercising onRunSuccess's `recoverWith`.
    "POST /pipelines/:id/run (non-dry, success) still succeeds and records the run as succeeded when evaluation fails" in {
      import PostgresProfile.api._
      val cache       = new PipelineRunCache()
      val dsId        = seedDsWithData()
      val pid         = seedPipeline(dsId)
      val failingRuleRepo = new AlertRuleRepository(ctx)(routeEc) {
        override def listEnabledByOutputInternal(outputId: OutputId): Future[Vector[AlertRule]] =
          Future.failed(new RuntimeException("boom: evaluation should never fail the run"))
      }
      val alertEvalSvc = new AlertEvaluationService(failingRuleRepo, alertEventRepo)(routeEc)

      Post(s"/pipelines/${pid.value}/run") ~> makeRoutes(cache, pipelineRunRepo, alertEvalSvc = alertEvalSvc) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[RunResultResponse]
        resp.rowCount shouldBe 2
      }
      val statusOpt = await(db.run(
        sql"SELECT last_run_status FROM pipelines WHERE id = ${pid.value}".as[Option[String]].head
      ))
      statusOpt shouldBe Some("succeeded")
      val runs = await(pipelineRunRepo.listByPipeline(pid, dummyUser))
      runs.head.status shouldBe "succeeded"
    }

    // HEL-905 (evaluation-1.md CR3): an Output whose node key has NO NodeOutcome (e.g. an
    // orphaned Output left pointing at a step id the tree walk never actually evaluated -- not
    // reachable via any production write path, but exactly the defensive case the old
    // `getOrElse(resultRows)` silently mishandled) must be SKIPPED, never evaluated against a
    // DIFFERENT node's rows. The run must still succeed and no alert event may be created for
    // that rule.
    "POST /pipelines/:id/run (non-dry, success) skips alert evaluation for an Output with no matching NodeOutcome, rather than falling back to another node's rows" in {
      val cache  = new PipelineRunCache()
      val dsId   = seedDsWithData()
      val pid    = seedPipeline(dsId)
      // An orphaned node key -- no such step exists, so the tree walk will never produce a
      // NodeOutcome for it (unreachable via any real production write path today, since
      // `outputs.node_step_id` is `ON DELETE CASCADE`; simulated here via a stubbed repository
      // rather than a raw FK-violating insert). This is exactly the shape the old
      // `.getOrElse(resultRows)` fallback silently mishandled by evaluating against the
      // TRUNK's rows instead.
      // A real Output row (satisfying the `alert_rules.target_output_id` FK), rooted at the
      // pipeline root (node_step_id = NULL) so the insert itself succeeds -- but the stub below
      // reports it to `alertEvaluation` as pointing at a fabricated node key that the tree walk
      // will never produce a NodeOutcome for.
      val realOutput   = await(outputRepo.insertInternal(pid, None, dummyUser.id, "orphan-out", OutputKind.Table))
      val orphanStepId = PipelineStepId(UUID.randomUUID().toString)
      val stubOutputRepo = new OutputRepository(ctx)(routeEc) {
        override def listByPipelineInternal(pipelineId: PipelineId): Future[Vector[Output]] =
          Future.successful(Vector(realOutput.copy(node = NodeRef(pid, Some(orphanStepId)))))
      }
      val rule = AlertRule(
        id             = AlertRuleId(UUID.randomUUID().toString),
        ownerId        = dummyUser.id,
        targetOutputId = realOutput.id,
        metric         = "score",
        condition      = JsObject("comparator" -> JsString("gt"), "threshold" -> JsNumber(0)),
        name           = "HEL-905 CR3 orphan-node rule",
        enabled        = true,
        severity       = Severity.Warning,
        createdAt      = Instant.now(),
        updatedAt      = Instant.now()
      )
      val ruleId       = await(alertRuleRepo.insert(rule, dummyUser)).id
      val alertEvalSvc = new AlertEvaluationService(alertRuleRepo, alertEventRepo)(routeEc)

      Post(s"/pipelines/${pid.value}/run") ~> makeRoutes(cache, alertEvalSvc = alertEvalSvc, outRepo = stubOutputRepo) ~> check {
        status shouldBe StatusCodes.OK
      }

      // The run succeeds (skip, never a crash), and no alert event is created -- proving the
      // rule was never evaluated against the trunk's (or any other node's) rows.
      await(alertEventRepo.findActiveByRule(ruleId)) shouldBe None
    }
  }
}
