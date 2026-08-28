package com.helio.api.routes.pipelines

import com.helio.api.routes.pipelines.PipelineRoutes
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.api.{AnalyzeStepResponse, ErrorResponse, JsonProtocols, PipelineAnalyzeResponse}
import com.helio.api.protocols.pipelines.{SchemaFieldResponse, SourceSchemaDriftResponse, TypeChangedColumnResponse}
import com.helio.domain.model.{AuthenticatedUser, PipelineId, UserId}
import com.helio.domain.{AggregateConfig, AggregateField, Aggregation, ChunkByTokenCountConfig, ExtractHeadingsConfig, GroupByConfig, JoinConfig, PivotConfig, RenameConfig, SelectConfig, SplitTextConfig, UnionConfig, WindowConfig}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.pipelines.{DataTypeRepository, PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.DbContext
import com.helio.services.pipelines.PipelineService
import com.helio.testsupport.JsonSchemaValidation
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.util.UUID
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

class PipelineAnalyzeRoutesSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc                                    = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres    = _
  private var db: JdbcBackend.Database              = _
  private var pipelineRepo: PipelineRepository      = _
  private var pipelineStepRepo: PipelineStepRepository = _
  private var dataTypeRepo: DataTypeRepository      = _
  private var dataSourceRepo: DataSourceRepository  = _

  private val dummyUser = AuthenticatedUser(UserId("00000000-0000-0000-0000-000000000001"))

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db               = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx          = new DbContext(db, db)(routeEc)
    dataTypeRepo     = new DataTypeRepository(ctx)(routeEc)
    dataSourceRepo   = new DataSourceRepository(ctx)(routeEc)
    pipelineRepo     = new PipelineRepository(ctx, dataTypeRepo, dataSourceRepo)(routeEc)
    pipelineStepRepo = new PipelineStepRepository(ctx)(routeEc)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  // DB helpers

  private def cleanPipelines(): Unit = {
    import PostgresProfile.api._
    await(db.run(sqlu"DELETE FROM pipeline_steps"))
    await(db.run(sqlu"DELETE FROM pipelines"))
  }

  /** Seeds a DataSource + its companion DataType (sourceId = dsId) + a Pipeline.
   *  Returns (pipelineId, dataSourceId). */
  private def seedPipelineWithSchema(fields: String): (String, String) = {
    import PostgresProfile.api._
    val dsId  = UUID.randomUUID().toString
    val dtId  = UUID.randomUUID().toString   // source DataType
    val outId = UUID.randomUUID().toString   // output DataType
    val pid   = UUID.randomUUID().toString
    val ownerId = dummyUser.id.value

    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($dsId, 'test-ds', 'rest_api', '{}', $ownerId::uuid, now(), now())""",
      sqlu"""INSERT INTO data_types (id, source_id, name, fields, version, owner_id, created_at, updated_at)
             VALUES ($dtId, $dsId, 'source-dt', $fields, 1, $ownerId::uuid, now(), now())""",
      sqlu"""INSERT INTO data_types (id, name, fields, version, owner_id, created_at, updated_at)
             VALUES ($outId, 'output-dt', '[]', 1, $ownerId::uuid, now(), now())""",
      sqlu"""INSERT INTO pipelines (id, name, source_data_source_id, output_data_type_id, created_at, updated_at)
             VALUES ($pid, 'test-pipeline', $dsId, $outId, now(), now())"""
    )))
    (pid, dsId)
  }

  private def routes: Route = {
    implicit val ec: ExecutionContext = routeEc
    val service = new PipelineService(pipelineRepo, pipelineStepRepo, dataSourceRepo, dataTypeRepo)
    new PipelineRoutes(service, dummyUser).routes
  }

  // Tests

  "GET /pipelines/:id/analyze" should {

    "return 404 for a non-existent pipeline id" in {
      cleanPipelines()
      Get("/pipelines/nonexistent-pipeline-id/analyze") ~> routes ~> check {
        status shouldBe StatusCodes.NotFound
        responseAs[ErrorResponse].message should include("not found")
      }
    }

    "return 200 with empty steps and sourceSchema for a pipeline with no steps" in {
      cleanPipelines()
      val sourceFields = """[{"name":"order_id","displayName":"Order ID","dataType":"string","nullable":false},{"name":"amount","displayName":"Amount","dataType":"number","nullable":false}]"""
      val (pid, _) = seedPipelineWithSchema(sourceFields)

      Get(s"/pipelines/$pid/analyze") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[PipelineAnalyzeResponse]
        resp.id   shouldBe pid
        resp.name shouldBe "test-pipeline"
        resp.steps shouldBe empty
        resp.sourceSchema.map(_.name) should contain allOf ("order_id", "amount")
      }
    }

    "return 200 with correct schemas for a pipeline with a select step" in {
      cleanPipelines()
      val sourceFields = """[{"name":"order_id","displayName":"Order ID","dataType":"string","nullable":false},{"name":"amount","displayName":"Amount","dataType":"number","nullable":false},{"name":"created_at","displayName":"Created","dataType":"string","nullable":true}]"""
      val (pid, _) = seedPipelineWithSchema(sourceFields)

      // Insert a select step via the repo (CS2c-3a typed config)
      await(pipelineStepRepo.insert(PipelineId(pid), "select", SelectConfig(Vector("order_id", "amount")), dummyUser))

      Get(s"/pipelines/$pid/analyze") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val resp: PipelineAnalyzeResponse = responseAs[PipelineAnalyzeResponse]

        resp.steps should have size 1
        val step: AnalyzeStepResponse = resp.steps(0)
        step.`type` shouldBe "select"
        step.inputSchema.map(_.name)  should contain allOf ("order_id", "amount", "created_at")
        step.outputSchema.map(_.name) shouldBe Vector("order_id", "amount")
        step.validationError shouldBe None
      }
    }

    "return 200 with correct schemas for a pipeline with a splittext step (regression: analyze 500 on splittext)" in {
      cleanPipelines()
      val sourceFields = """[{"name":"content","displayName":"Content","dataType":"string-body","nullable":false},{"name":"order_id","displayName":"Order ID","dataType":"string","nullable":false}]"""
      val (pid, _) = seedPipelineWithSchema(sourceFields)

      await(pipelineStepRepo.insert(PipelineId(pid), "splittext", SplitTextConfig(field = "content", mode = "paragraph"), dummyUser))

      Get(s"/pipelines/$pid/analyze") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val resp: PipelineAnalyzeResponse = responseAs[PipelineAnalyzeResponse]

        resp.steps should have size 1
        val step: AnalyzeStepResponse = resp.steps(0)
        step.`type` shouldBe "splittext"
        step.inputSchema.map(_.name)  should contain allOf ("content", "order_id")
        step.outputSchema.map(_.name) should contain allOf ("content", "order_id", "segmentIndex")
        step.validationError shouldBe None
      }
    }

    "return 200 with correct schemas for a pipeline with an extractheadings step (regression: analyze 500 on extractheadings)" in {
      cleanPipelines()
      val sourceFields = """[{"name":"content","displayName":"Content","dataType":"string-body","nullable":false},{"name":"order_id","displayName":"Order ID","dataType":"string","nullable":false}]"""
      val (pid, _) = seedPipelineWithSchema(sourceFields)

      await(pipelineStepRepo.insert(PipelineId(pid), "extractheadings", ExtractHeadingsConfig(field = "content"), dummyUser))

      Get(s"/pipelines/$pid/analyze") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val resp: PipelineAnalyzeResponse = responseAs[PipelineAnalyzeResponse]

        resp.steps should have size 1
        val step: AnalyzeStepResponse = resp.steps(0)
        step.`type` shouldBe "extractheadings"
        step.inputSchema.map(_.name)  should contain allOf ("content", "order_id")
        step.outputSchema.map(_.name) should contain allOf ("content", "order_id", "headingIndex", "headingLevel")
        step.validationError shouldBe None
      }
    }

    "return 200 with correct schemas for a pipeline with a chunkbytokencount step (regression: analyze 500 on chunkbytokencount)" in {
      cleanPipelines()
      val sourceFields = """[{"name":"content","displayName":"Content","dataType":"string-body","nullable":false},{"name":"order_id","displayName":"Order ID","dataType":"string","nullable":false}]"""
      val (pid, _) = seedPipelineWithSchema(sourceFields)

      await(pipelineStepRepo.insert(PipelineId(pid), "chunkbytokencount", ChunkByTokenCountConfig(field = "content"), dummyUser))

      Get(s"/pipelines/$pid/analyze") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val resp: PipelineAnalyzeResponse = responseAs[PipelineAnalyzeResponse]

        resp.steps should have size 1
        val step: AnalyzeStepResponse = resp.steps(0)
        step.`type` shouldBe "chunkbytokencount"
        step.inputSchema.map(_.name)  should contain allOf ("content", "order_id")
        step.outputSchema.map(_.name) should contain allOf ("content", "order_id", "chunkIndex", "tokenCount")
        step.validationError shouldBe None
      }
    }

    // HEL-412 (design.md Decision 3, boundary iii): the analyze response
    // contains entries for enabled steps only — a disabled step is dropped
    // exactly as if it were absent.
    "return 200 excluding a disabled step from the response entirely" in {
      cleanPipelines()
      val sourceFields = """[{"name":"order_id","displayName":"Order ID","dataType":"string","nullable":false},{"name":"amount","displayName":"Amount","dataType":"number","nullable":false}]"""
      val (pid, _) = seedPipelineWithSchema(sourceFields)

      await(pipelineStepRepo.insert(PipelineId(pid), "rename", RenameConfig(Map("order_id" -> "id")), dummyUser, enabled = false))
      await(pipelineStepRepo.insert(PipelineId(pid), "select", SelectConfig(Vector("order_id", "amount")), dummyUser))

      Get(s"/pipelines/$pid/analyze") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val resp: PipelineAnalyzeResponse = responseAs[PipelineAnalyzeResponse]

        resp.steps should have size 1
        val step: AnalyzeStepResponse = resp.steps(0)
        step.`type` shouldBe "select"
        // The disabled rename never ran, so `order_id` (not `id`) is what
        // flows into the surviving select step's input schema.
        step.inputSchema.map(_.name) should contain allOf ("order_id", "amount")
      }
    }

    "return 200 with empty sourceSchema when no DataType is linked to the DataSource" in {
      cleanPipelines()
      // Seed pipeline without a companion source DataType (empty fields)
      val (pid, _) = seedPipelineWithSchema("[]")

      Get(s"/pipelines/$pid/analyze") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[PipelineAnalyzeResponse]
        resp.sourceSchema shouldBe empty
        resp.steps shouldBe empty
      }
    }


    "(a) omit sourceSchemaDrift when the pipeline has never run successfully (no baseline)" in {
      cleanPipelines()
      val sourceFields = """[{"name":"order_id","displayName":"Order ID","dataType":"string","nullable":false}]"""
      val (pid, _) = seedPipelineWithSchema(sourceFields)

      Get(s"/pipelines/$pid/analyze") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[PipelineAnalyzeResponse]
        resp.sourceSchemaDrift shouldBe None
      }
    }

    "omit sourceSchemaDrift when the current source schema matches the last successful run's baseline" in {
      cleanPipelines()
      val sourceFields = """[{"name":"order_id","displayName":"Order ID","dataType":"string","nullable":false},{"name":"amount","displayName":"Amount","dataType":"number","nullable":false}]"""
      val (pid, _) = seedPipelineWithSchema(sourceFields)
      await(pipelineRepo.updateLastSourceSchema(
        PipelineId(pid),
        """[{"name":"order_id","type":"string"},{"name":"amount","type":"number"}]""",
        dummyUser
      ))

      Get(s"/pipelines/$pid/analyze") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[PipelineAnalyzeResponse]
        resp.sourceSchemaDrift shouldBe None
      }
    }

    "(b)(c) report removed and type-changed columns against the last successful run's baseline" in {
      cleanPipelines()
      // Current source schema: "order_id" (string), "amount" (integer) — no "created_at".
      val sourceFields = """[{"name":"order_id","displayName":"Order ID","dataType":"string","nullable":false},{"name":"amount","displayName":"Amount","dataType":"integer","nullable":false}]"""
      val (pid, _) = seedPipelineWithSchema(sourceFields)
      // Baseline: "order_id" (string), "amount" (number), "created_at" (string).
      await(pipelineRepo.updateLastSourceSchema(
        PipelineId(pid),
        """[{"name":"order_id","type":"string"},{"name":"amount","type":"number"},{"name":"created_at","type":"string"}]""",
        dummyUser
      ))

      Get(s"/pipelines/$pid/analyze") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val resp  = responseAs[PipelineAnalyzeResponse]
        val drift = resp.sourceSchemaDrift
        drift shouldBe defined
        drift.get.addedColumns shouldBe empty
        drift.get.removedColumns shouldBe Vector(SchemaFieldResponse("created_at", "string"))
        drift.get.typeChangedColumns shouldBe Vector(TypeChangedColumnResponse("amount", previousType = "number", currentType = "integer"))
      }
    }

    "(HEL-462 fold-in) omit sourceSchemaDrift and surface no error when the persisted baseline is syntactically-valid but not schema-array-shaped JSON" in {
      cleanPipelines()
      val sourceFields = """[{"name":"order_id","displayName":"Order ID","dataType":"string","nullable":false}]"""
      val (pid, _) = seedPipelineWithSchema(sourceFields)
      // A bare JSON string — valid JSON (the JSONB column would reject truly
      // invalid JSON at write time), but not the `[{name,type}]` shape
      // `parseBaselineSchema` expects. Exercises design D5's tolerant-parse
      // failure branch via a real DB round-trip, not a mock.
      await(pipelineRepo.updateLastSourceSchema(PipelineId(pid), "\"not-json\"", dummyUser))

      Get(s"/pipelines/$pid/analyze") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[PipelineAnalyzeResponse]
        resp.sourceSchemaDrift shouldBe None
      }
    }

    // HEL-860 task 1.2: HEL-859's five uncovered analyze validators, exercised
    // at the real route (design Decision 4 — a unit-level test alone does not
    // satisfy AC6). Each asserts the offending value AND the supported list.

    "return 200 with a validationError naming the unsupported aggregate function" in {
      cleanPipelines()
      val sourceFields = """[{"name":"order_id","displayName":"Order ID","dataType":"string","nullable":false},{"name":"amount","displayName":"Amount","dataType":"number","nullable":false}]"""
      val (pid, _) = seedPipelineWithSchema(sourceFields)
      await(pipelineStepRepo.insert(
        PipelineId(pid), "aggregate",
        AggregateConfig(Vector(AggregateField("order_id", "string")), Vector(Aggregation("total", "bogus_fn", "amount"))),
        dummyUser
      ))

      Get(s"/pipelines/$pid/analyze") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val step = responseAs[PipelineAnalyzeResponse].steps(0)
        step.validationError shouldBe defined
        step.validationError.get should include("bogus_fn")
        step.validationError.get should include("Unsupported aggregation function")
      }
    }

    "return 200 with a validationError naming the unsupported groupby aggregation function" in {
      cleanPipelines()
      val sourceFields = """[{"name":"order_id","displayName":"Order ID","dataType":"string","nullable":false},{"name":"amount","displayName":"Amount","dataType":"number","nullable":false}]"""
      val (pid, _) = seedPipelineWithSchema(sourceFields)
      await(pipelineStepRepo.insert(
        PipelineId(pid), "groupby",
        GroupByConfig(Vector("order_id"), "amount", "bogus_fn"),
        dummyUser
      ))

      Get(s"/pipelines/$pid/analyze") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val step = responseAs[PipelineAnalyzeResponse].steps(0)
        step.validationError shouldBe defined
        step.validationError.get should include("bogus_fn")
        step.validationError.get should include("Unsupported aggregation function")
      }
    }

    "return 200 with a validationError naming the unsupported pivot aggregation function" in {
      cleanPipelines()
      val sourceFields = """[{"name":"order_id","displayName":"Order ID","dataType":"string","nullable":false},{"name":"amount","displayName":"Amount","dataType":"number","nullable":false}]"""
      val (pid, _) = seedPipelineWithSchema(sourceFields)
      await(pipelineStepRepo.insert(
        PipelineId(pid), "pivot",
        PivotConfig(Vector("order_id"), "amount", "amount", "bogus_agg"),
        dummyUser
      ))

      Get(s"/pipelines/$pid/analyze") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val step = responseAs[PipelineAnalyzeResponse].steps(0)
        step.validationError shouldBe defined
        step.validationError.get should include("bogus_agg")
        step.validationError.get should include("Unsupported pivot aggregation function")
      }
    }

    "return 200 with a validationError naming the unsupported union mode" in {
      cleanPipelines()
      val sourceFields = """[{"name":"order_id","displayName":"Order ID","dataType":"string","nullable":false}]"""
      val (pid, dsId) = seedPipelineWithSchema(sourceFields)
      await(pipelineStepRepo.insert(
        PipelineId(pid), "union",
        UnionConfig(dsId, "bogus_mode"),
        dummyUser
      ))

      Get(s"/pipelines/$pid/analyze") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val step = responseAs[PipelineAnalyzeResponse].steps(0)
        step.validationError shouldBe defined
        step.validationError.get should include("bogus_mode")
        step.validationError.get should include("Unsupported union mode")
      }
    }

    "return 200 with a validationError naming the unsupported join type" in {
      cleanPipelines()
      val sourceFields = """[{"name":"order_id","displayName":"Order ID","dataType":"string","nullable":false}]"""
      val (pid, dsId) = seedPipelineWithSchema(sourceFields)
      await(pipelineStepRepo.insert(
        PipelineId(pid), "join",
        JoinConfig(dsId, "order_id", "bogus_type"),
        dummyUser
      ))

      Get(s"/pipelines/$pid/analyze") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val step = responseAs[PipelineAnalyzeResponse].steps(0)
        step.validationError shouldBe defined
        step.validationError.get should include("bogus_type")
        step.validationError.get should include("Unsupported join type")
        // design Decision 7a: `groupby`/`join` have no `inferOutputSchema`
        // dispatch case, so the valid-config (no validationError) path is
        // unassertable for these two kinds — validateStepConfig runs before
        // dispatch and never falls through to the fallback for an invalid
        // enum, so this negative-path coverage is unaffected and honest; the
        // positive path is deliberately not asserted here.
      }
    }

    // HEL-860 task 1.3: the multi-failure join at
    // PipelineAnalyzeService.scala:126 (`validateStepConfig`'s
    // `problems.mkString("; ")`) — one step with two independent validator
    // failures must surface both in a single validationError.
    "return 200 with a single validationError joining two independent failures for one step" in {
      cleanPipelines()
      val sourceFields = """[{"name":"order_id","displayName":"Order ID","dataType":"string","nullable":false},{"name":"amount","displayName":"Amount","dataType":"number","nullable":false}]"""
      val (pid, _) = seedPipelineWithSchema(sourceFields)
      // window: unsupported function AND (for lag/lead) a non-positive offset
      // — WindowConfig.decode both go through validateWindow's two independent
      // problem checks (function support, offset positivity for lag/lead).
      await(pipelineStepRepo.insert(
        PipelineId(pid), "window",
        WindowConfig(
          partitionBy = Vector.empty, orderBy = Vector.empty, function = "lag",
          field = None, outputColumn = "win", offset = Some(-1)
        ),
        dummyUser
      ))

      Get(s"/pipelines/$pid/analyze") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val step = responseAs[PipelineAnalyzeResponse].steps(0)
        step.validationError shouldBe defined
        val msg = step.validationError.get
        msg should include("requires 'field'")
        msg should include("requires a positive 'offset'")
        msg should include(";")
      }
    }

    // HEL-860 task 2.1a: the complementary NEGATIVE proving why the write-path
    // fix (section 3) is necessary — for a PERSISTED step, this surface's
    // raw-config contract does NOT hold (design Decision 5).
    // PipelineService.analyze re-encodes from the tolerantly-decoded typed
    // config (PipelineStepConfigCodec.encode(s)), not from the stored text, so
    // the mistyped shape is destroyed by the read round-trip before inferCast
    // ever runs. Seeding via the typed repository insert would store
    // {"casts":{}} — never mistyped — and this test would assert nothing; the
    // raw sqlu INSERT below is load-bearing, matching the mechanism the
    // pre-assertion below is bound to.
    "does NOT report a validationError for a persisted cast step with a raw list-shaped casts config (2.1a negative — round-trip destroys the mistype)" in {
      cleanPipelines()
      val sourceFields = """[{"name":"amount","displayName":"Amount","dataType":"string","nullable":false}]"""
      val (pid, _) = seedPipelineWithSchema(sourceFields)

      import PostgresProfile.api._
      val stepId = UUID.randomUUID().toString
      val mistypedConfig = """{"casts":[{"field":"amount","to":"double"}]}"""
      await(db.run(sqlu"""
        INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled)
        VALUES ($stepId, $pid, 0, 'cast', $mistypedConfig, true)
      """))

      // Pre-assertion (standing requirement 3): the row really is stored as
      // the mistyped shape, not something the typed repository would ever
      // write — without this the negative below is unbound and vacuous.
      val storedConfig = await(db.run(
        sql"SELECT config FROM pipeline_steps WHERE id = $stepId".as[String]
      )).head
      storedConfig shouldBe mistypedConfig

      Get(s"/pipelines/$pid/analyze") ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[PipelineAnalyzeResponse]
        resp.steps should have size 1
        val step = resp.steps(0)
        step.`type` shouldBe "cast"
        // The tolerant read-path decoder already reduced `casts` to Map.empty
        // by the time this reaches inferCast, which re-encodes to a VALID
        // empty object — no validationError is possible here for a stored
        // row. This is exactly what section 3's write-path check exists to
        // prevent from being created in the first place.
        step.validationError shouldBe None
      }
    }
  }

  "pipelineAnalyzeResponseFormat output (HEL-462 sourceSchemaDrift)" should {

    "validate cleanly against schemas/pipelines/pipeline-analyze-response.schema.json when sourceSchemaDrift is populated" in {
      val response = PipelineAnalyzeResponse(
        id                   = "pipeline-1",
        name                 = "Orders",
        sourceDataSourceName = "orders-source",
        outputDataTypeName   = "Orders Output",
        outputDataTypeId     = "dt-1",
        sourceSchema         = Vector(SchemaFieldResponse("order_id", "string")),
        steps                = Vector.empty,
        sourceSchemaDrift    = Some(SourceSchemaDriftResponse(
          addedColumns       = Vector(SchemaFieldResponse("region", "string")),
          removedColumns     = Vector(SchemaFieldResponse("created_at", "string")),
          typeChangedColumns = Vector(TypeChangedColumnResponse("amount", previousType = "number", currentType = "integer"))
        ))
      )

      val schema = JsonSchemaValidation.compile("pipelines/pipeline-analyze-response.schema.json")
      val errors = JsonSchemaValidation.validationErrors(schema, response.toJson.compactPrint)
      errors shouldBe empty
    }

    "omit sourceSchemaDrift entirely from the serialized JSON when None" in {
      val response = PipelineAnalyzeResponse(
        id                   = "pipeline-1",
        name                 = "Orders",
        sourceDataSourceName = "orders-source",
        outputDataTypeName   = "Orders Output",
        outputDataTypeId     = "dt-1",
        sourceSchema         = Vector.empty,
        steps                = Vector.empty,
        sourceSchemaDrift    = None
      )

      val json = response.toJson.compactPrint
      json should not include "sourceSchemaDrift"

      val schema = JsonSchemaValidation.compile("pipelines/pipeline-analyze-response.schema.json")
      val errors = JsonSchemaValidation.validationErrors(schema, json)
      errors shouldBe empty
    }
  }
}
