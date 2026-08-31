package com.helio.api.routes.pipelines

import com.helio.api.routes.pipelines.PipelineRoutes
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, StatusCodes}
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.api.{ErrorResponse, JsonProtocols}
import com.helio.api.protocols.pipelines.{CreatePipelineStepRequest, PipelineAnalyzeProposalResponse, PipelineProposal, PipelineProposalSource, SchemaFieldResponse, SelectAnalyzeStepResponse}
import com.helio.api.protocols.sources.{CsvSourceConfigPayload, SqlSourceConfigPayload, StaticColumnPayload, StaticDataPayload}
import com.helio.domain.model.{AuthenticatedUser, UserId}
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.domain.{CastConfig, SelectConfig, StepConfigTypeMismatch}
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
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

/** Route-level coverage for `POST /pipelines/analyze-proposal` (HEL-381) — mirrors
 *  `PipelineAnalyzeRoutesSpec`'s embedded-Postgres integration-test convention.
 *  `PipelineService` has no standalone `*ServiceSpec`; `analyzeProposal` is tested
 *  entirely through this route-level spec. */
class PipelineAnalyzeProposalRoutesSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with JsonProtocols
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc                                    = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres       = _
  private var db: JdbcBackend.Database                 = _
  private var pipelineRepo: PipelineRepository         = _
  private var pipelineStepRepo: PipelineStepRepository = _
  private var dataTypeRepo: DataTypeRepository         = _
  private var dataSourceRepo: DataSourceRepository     = _

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

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  // DB helpers

  private def cleanAll(): Unit = {
    import PostgresProfile.api._
    await(db.run(sqlu"DELETE FROM pipeline_steps"))
    await(db.run(sqlu"DELETE FROM pipelines"))
    await(db.run(sqlu"DELETE FROM data_types"))
    await(db.run(sqlu"DELETE FROM data_sources"))
  }

  private def dataSourceCount(): Int = {
    import PostgresProfile.api._
    await(db.run(sql"SELECT COUNT(*) FROM data_sources".as[Int])).head
  }
  private def pipelineCount(): Int = {
    import PostgresProfile.api._
    await(db.run(sql"SELECT COUNT(*) FROM pipelines".as[Int])).head
  }
  private def pipelineStepCount(): Int = {
    import PostgresProfile.api._
    await(db.run(sql"SELECT COUNT(*) FROM pipeline_steps".as[Int])).head
  }

  /** Projects a `DataField`-shaped JSON array (`{name,displayName,dataType,nullable}`, this
   *  spec's existing literal shape) into the `SchemaField`-shaped array (`{name,type}`)
   *  `data_sources.inferred_schema` actually stores (HEL-904). */
  private def toSchemaFieldsJson(dataFieldsJson: String): String =
    dataFieldsJson.parseJson match {
      case JsArray(items) =>
        JsArray(items.map { item =>
          val obj = item.asJsObject
          JsObject("name" -> obj.fields("name"), "type" -> obj.fields("dataType"))
        }).compactPrint
      case other => other.compactPrint
    }

  /** Seeds a caller-owned DataSource with its own `inferred_schema` populated directly
   *  (HEL-904 — there is no companion DataType anymore). Returns the DataSource id. */
  private def seedDataSource(ownerId: String, name: String, fields: String): String = {
    import PostgresProfile.api._
    val dsId = UUID.randomUUID().toString
    val schemaFieldsJson = toSchemaFieldsJson(fields)
    await(db.run(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, inferred_schema, created_at, updated_at)
             VALUES ($dsId, $name, 'rest_api', '{}', $ownerId::uuid, $schemaFieldsJson::jsonb, now(), now())"""
    ))
    dsId
  }

  // Route wiring

  /** A `RestApiConnectorDriver` that never actually reaches the network — the
   *  static/sql-only tests below never exercise it; the "no connector call"
   *  assertion (3.3) swaps in `countingConnector` instead. */
  private def noNetworkConnector: RestApiConnectorDriver =
    new RestApiConnectorDriver(Some(_ => Future.successful(Left("no HTTP in tests"))))

  private def countingConnector(counter: AtomicInteger): RestApiConnectorDriver =
    new RestApiConnectorDriver(Some { _ =>
      counter.incrementAndGet()
      Future.successful(Left("should not be called"))
    })

  private def routesWith(connector: RestApiConnectorDriver): Route = {
    implicit val ec: ExecutionContext = routeEc
    val service = new PipelineService(pipelineRepo, pipelineStepRepo, dataSourceRepo, dataTypeRepo, connector)
    new PipelineRoutes(service, dummyUser).routes
  }

  private def routes: Route = routesWith(noNetworkConnector)

  /** A SQL config that queries the embedded Postgres instance itself — same
   *  pattern `SourceServiceSpec.sqlConfig`/`SqlConnectorSpec.liveConfig` use. */
  private def sqlConfigPayload(query: String, port: Int = embeddedPostgres.getPort): SqlSourceConfigPayload =
    SqlSourceConfigPayload(
      dialect  = "postgresql",
      host     = "localhost",
      port     = port,
      database = "postgres",
      user     = "postgres",
      password = "postgres",
      query    = query
    )

  private val noInlineSource = PipelineProposalSource(
    sourceId = None, `type` = None, name = None,
    csvConfig = None, restConfig = None, sqlConfig = None, staticConfig = None
  )

  // Tests

  "POST /pipelines/analyze-proposal" should {

    "return the projected schema for a proposal referencing an existing, accessible sourceId, creating nothing (3.2)" in {
      cleanAll()
      val fields =
        """[{"name":"order_id","displayName":"Order ID","dataType":"string","nullable":false},
          | {"name":"amount","displayName":"Amount","dataType":"number","nullable":false}]""".stripMargin
      val dsId = seedDataSource(dummyUser.id.value, "orders-source", fields)
      val (beforeSources, beforePipelines, beforeSteps) = (dataSourceCount(), pipelineCount(), pipelineStepCount())

      val proposal = PipelineProposal(
        pipelineName       = "Orders pipeline",
        source              = noInlineSource.copy(sourceId = Some(dsId)),
        outputDataTypeName = "Orders Output",
        steps = Vector(CreatePipelineStepRequest(
          `type` = "select",
          config = JsObject("fields" -> JsArray(JsString("order_id")))
        ))
      )

      Post("/pipelines/analyze-proposal", proposal) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[PipelineAnalyzeProposalResponse]
        resp.sourceName shouldBe "orders-source"
        resp.outputDataTypeName shouldBe "Orders Output"
        resp.sourceSchema.map(_.name) should contain allOf ("order_id", "amount")
        resp.steps should have size 1
        resp.steps.head.`type` shouldBe "select"
        resp.steps.head.outputSchema.map(_.name) shouldBe Vector("order_id")
        resp.steps.head.validationError shouldBe None
      }

      dataSourceCount() shouldBe beforeSources
      pipelineCount() shouldBe beforePipelines
      pipelineStepCount() shouldBe beforeSteps
    }

    // HEL-412 (design.md Decision 3, boundary iv): a proposal step definition
    // carrying `enabled: false` is excluded exactly as a persisted disabled
    // step is — the response contains no entry for it, and later steps see
    // the schema as if it never ran.
    "excludes a proposal step definition carrying enabled: false" in {
      cleanAll()
      val fields =
        """[{"name":"order_id","displayName":"Order ID","dataType":"string","nullable":false},
          | {"name":"amount","displayName":"Amount","dataType":"number","nullable":false}]""".stripMargin
      val dsId = seedDataSource(dummyUser.id.value, "orders-source", fields)

      val proposal = PipelineProposal(
        pipelineName       = "Orders pipeline",
        source              = noInlineSource.copy(sourceId = Some(dsId)),
        outputDataTypeName = "Orders Output",
        steps = Vector(
          CreatePipelineStepRequest(
            `type`  = "select",
            config  = JsObject("fields" -> JsArray(JsString("order_id"))),
            enabled = Some(false)
          ),
          CreatePipelineStepRequest(
            `type` = "select",
            config = JsObject("fields" -> JsArray(JsString("order_id"), JsString("amount")))
          )
        )
      )

      Post("/pipelines/analyze-proposal", proposal) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[PipelineAnalyzeProposalResponse]
        // Only the enabled second step appears; its input schema is the full
        // source schema, proving the disabled first step never ran.
        resp.steps should have size 1
        resp.steps.head.inputSchema.map(_.name) should contain allOf ("order_id", "amount")
        resp.steps.head.outputSchema.map(_.name) should contain allOf ("order_id", "amount")
      }
    }

    "return the schema derived from an inline static source's declared columns, with no connector call (3.3)" in {
      cleanAll()
      val counter = new AtomicInteger(0)
      val proposal = PipelineProposal(
        pipelineName       = "Static pipeline",
        source              = noInlineSource.copy(
          `type` = Some("static"),
          name   = Some("Inline Static"),
          staticConfig = Some(StaticDataPayload(
            columns = Vector(StaticColumnPayload("id", "string"), StaticColumnPayload("count", "integer")),
            rows    = Vector.empty
          ))
        ),
        outputDataTypeName = "Static Output",
        steps               = Vector.empty
      )

      Post("/pipelines/analyze-proposal", proposal) ~> routesWith(countingConnector(counter)) ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[PipelineAnalyzeProposalResponse]
        resp.sourceName shouldBe "Inline Static"
        resp.sourceSchema.map(f => (f.name, f.`type`)) shouldBe Vector(("id", "string"), ("count", "integer"))
      }
      counter.get() shouldBe 0
    }

    "return the inferred schema for an inline sql source whose query is a SELECT (3.4)" in {
      cleanAll()
      val proposal = PipelineProposal(
        pipelineName       = "SQL pipeline",
        source              = noInlineSource.copy(
          `type`    = Some("sql"),
          name      = Some("Inline SQL"),
          sqlConfig = Some(sqlConfigPayload("SELECT 1 AS one, 'x' AS label"))
        ),
        outputDataTypeName = "SQL Output",
        steps               = Vector.empty
      )

      Post("/pipelines/analyze-proposal", proposal) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[PipelineAnalyzeProposalResponse]
        resp.sourceName shouldBe "Inline SQL"
        resp.sourceSchema.map(_.name) should contain theSameElementsAs Seq("one", "label")
      }
    }

    "reject an inline sql source with a DDL/DML query with 400, never invoking the connector (3.5)" in {
      cleanAll()
      val proposal = PipelineProposal(
        pipelineName       = "Bad SQL pipeline",
        // Deliberately paired with an unreachable port: if checkQuery were
        // skipped and the connector actually invoked, the result would still
        // be a BadGateway (502), not BadRequest (400) — mirrors
        // DataSourceRoutesSpec's checkQuery short-circuit test pattern.
        source              = noInlineSource.copy(
          `type`    = Some("sql"),
          sqlConfig = Some(sqlConfigPayload(query = "DROP TABLE users", port = 1))
        ),
        outputDataTypeName = "Output",
        steps               = Vector.empty
      )

      Post("/pipelines/analyze-proposal", proposal) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }

    "reject an inline csv source with 400 and a clear message (3.6)" in {
      cleanAll()
      val proposal = PipelineProposal(
        pipelineName       = "CSV pipeline",
        source              = noInlineSource.copy(
          `type`    = Some("csv"),
          csvConfig = Some(CsvSourceConfigPayload(path = "uploads/some-file.csv"))
        ),
        outputDataTypeName = "Output",
        steps               = Vector.empty
      )

      Post("/pipelines/analyze-proposal", proposal) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse].message.toLowerCase should include("csv")
      }
    }

    "surface a per-step validationError (not a 500) for a step with an invalid config (3.7)" in {
      cleanAll()
      val proposal = PipelineProposal(
        pipelineName       = "Bad step pipeline",
        source              = noInlineSource.copy(
          `type` = Some("static"),
          staticConfig = Some(StaticDataPayload(columns = Vector(StaticColumnPayload("id", "string")), rows = Vector.empty))
        ),
        outputDataTypeName = "Output",
        // Missing "expression"/"type" -- inferCompute's try/catch flags a
        // per-step validationError instead of throwing.
        steps = Vector(CreatePipelineStepRequest(`type` = "compute", config = JsObject("column" -> JsString("total"))))
      )

      Post("/pipelines/analyze-proposal", proposal) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[PipelineAnalyzeProposalResponse]
        resp.steps should have size 1
        resp.steps.head.validationError shouldBe defined
        // identity fallback: output schema == input schema when a step fails
        resp.steps.head.outputSchema shouldBe resp.steps.head.inputSchema
      }
    }

    "reject a proposal step whose type is not a registered PipelineStepKind with 400, never a 500 (evaluation-1.md CR1)" in {
      cleanAll()
      val proposal = PipelineProposal(
        pipelineName       = "Unknown step pipeline",
        source              = noInlineSource.copy(
          `type` = Some("static"),
          staticConfig = Some(StaticDataPayload(columns = Vector(StaticColumnPayload("id", "string")), rows = Vector.empty))
        ),
        outputDataTypeName = "Output",
        // "sql.pipeline-proposal.schema.json" deliberately leaves step `type` unconstrained
        // (checked at apply time, not by the schema) -- an unregistered kind is a
        // proven-reachable dry-analyze input, not a hypothetical one.
        steps = Vector(CreatePipelineStepRequest(`type` = "not-a-real-step-kind", config = JsObject()))
      )

      Post("/pipelines/analyze-proposal", proposal) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
        responseAs[ErrorResponse].message should include("not-a-real-step-kind")
      }
    }

    "reject a structurally invalid proposal (missing a required top-level field) with 400 (3.8)" in {
      val body = JsObject(
        "source" -> JsObject("sourceId" -> JsString("nonexistent")),
        "steps"  -> JsArray()
        // "pipelineName" and "outputDataTypeName" are both omitted -- required per the reader.
      )
      Post("/pipelines/analyze-proposal", HttpEntity(ContentTypes.`application/json`, body.compactPrint)) ~> Route.seal(routes) ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }

    "return 404 for a sourceId owned by a different user, leaking no schema (3.9)" in {
      cleanAll()
      val otherUserId = UUID.randomUUID().toString
      val fields = """[{"name":"secret_field","displayName":"Secret","dataType":"string","nullable":false}]"""
      val dsId = seedDataSource(otherUserId, "other-user-source", fields)

      val proposal = PipelineProposal(
        pipelineName       = "Nosy pipeline",
        source              = noInlineSource.copy(sourceId = Some(dsId)),
        outputDataTypeName = "Output",
        steps               = Vector.empty
      )

      Post("/pipelines/analyze-proposal", proposal) ~> routes ~> check {
        status shouldBe StatusCodes.NotFound
        responseAs[String] should not include "secret_field"
      }
    }

    "return 400 (not 500) when an inline sql source's type is recognized but its config is entirely absent (3.10)" in {
      val body = """{"pipelineName":"X","source":{"type":"sql"},"outputDataTypeName":"Y","steps":[]}"""
      Post("/pipelines/analyze-proposal", HttpEntity(ContentTypes.`application/json`, body)) ~> routes ~> check {
        status shouldBe StatusCodes.BadRequest
      }
    }

    "resolve via the existing-source branch when both sourceId and an inline type/config are present (3.12)" in {
      cleanAll()
      val fields = """[{"name":"real_field","displayName":"Real","dataType":"string","nullable":false}]"""
      val dsId = seedDataSource(dummyUser.id.value, "existing-source", fields)

      val proposal = PipelineProposal(
        pipelineName       = "Precedence pipeline",
        source = noInlineSource.copy(
          sourceId = Some(dsId),
          `type`   = Some("static"),
          name     = Some("Ignored inline name"),
          staticConfig = Some(StaticDataPayload(columns = Vector(StaticColumnPayload("bogus_field", "string")), rows = Vector.empty))
        ),
        outputDataTypeName = "Output",
        steps               = Vector.empty
      )

      Post("/pipelines/analyze-proposal", proposal) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[PipelineAnalyzeProposalResponse]
        resp.sourceName shouldBe "existing-source"
        resp.sourceSchema.map(_.name) shouldBe Vector("real_field")
      }
    }

    // HEL-860 task 2.1/AC7: the raw-config-string contract (HEL-859 Decision
    // 7) holds on THIS surface — PipelineService.analyzeProposal passes
    // req.config.compactPrint straight through, never round-tripped, so a
    // list-shaped `casts` that CastConfig.decode would reduce to Map.empty
    // reaches inferCast intact and surfaces as a validationError.
    "surface a validationError for a proposal cast step with a list-shaped casts config that CastConfig.decode reduces to Map.empty (AC7)" in {
      cleanAll()
      val rawCasts = """[{"field":"amount","to":"double"}]"""
      // HEL-814 task 2.7 — PROOF that D1 took effect. This assertion used to
      // read `CastConfig.decode(...).casts shouldBe empty`, confirming the
      // premise that the typed decoder silently DROPS this shape. Under D1 a
      // present key of the wrong JSON type no longer drops — it raises, and
      // the message names the offending key and the shape it expected, so
      // this now confirms the opposite premise: the decoder can no longer
      // produce the degraded empty map at all.
      //
      // The surrounding assertions below are unchanged and still hold: the
      // PROPOSAL analyze surface is driven from the caller-supplied RAW
      // config text, never a decoded typed config, so it still reports the
      // offending key as a validationError rather than failing opaquely.
      // That contrast — decoder raises, proposal analyze still reports — is
      // exactly the "reports a key the typed decoder would discard" property
      // the shipped spec requires of this surface.
      val decodeFailure = intercept[StepConfigTypeMismatch] {
        CastConfig.decode(s"""{"casts":$rawCasts}""")
      }
      decodeFailure.getMessage should include("casts")

      val proposal = PipelineProposal(
        pipelineName       = "Cast pipeline",
        source              = noInlineSource.copy(
          `type` = Some("static"),
          staticConfig = Some(StaticDataPayload(columns = Vector(StaticColumnPayload("amount", "string")), rows = Vector.empty))
        ),
        outputDataTypeName = "Output",
        steps = Vector(CreatePipelineStepRequest(
          `type` = "cast",
          config = s"""{"casts":$rawCasts}""".parseJson.asJsObject
        ))
      )

      Post("/pipelines/analyze-proposal", proposal) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val resp = responseAs[PipelineAnalyzeProposalResponse]
        resp.steps should have size 1
        resp.steps.head.validationError shouldBe defined
        // HEL-814: the message is now the SPECIFIC one — it names the
        // offending key and describes the shape that key expects — where it
        // used to be the generic "cast config error" the downstream
        // `parseConfig` catch produced. The shipped requirement asks this
        // surface to report "the offending key"; it now literally does.
        // Asserted on content, not merely on `defined`, so a future change
        // that reports SOME error for a different reason cannot pass this.
        resp.steps.head.validationError.get should include("casts")
        resp.steps.head.validationError.get should include("must be an object mapping field name to type name")
      }
    }
  }

  "pipelineAnalyzeProposalResponseFormat output" should {
    "validate cleanly against schemas/pipelines/pipeline-analyze-proposal-response.schema.json (3.11)" in {
      val response = PipelineAnalyzeProposalResponse(
        sourceName         = "Orders",
        outputDataTypeName = "Orders Output",
        sourceSchema        = Vector(SchemaFieldResponse("order_id", "string")),
        steps = Vector(SelectAnalyzeStepResponse(
          id              = "step-0",
          position        = 0,
          config          = SelectConfig(Vector("order_id")),
          inputSchema     = Vector(SchemaFieldResponse("order_id", "string")),
          outputSchema    = Vector(SchemaFieldResponse("order_id", "string")),
          validationError = None
        ))
      )

      val schema = JsonSchemaValidation.compile("pipelines/pipeline-analyze-proposal-response.schema.json")
      val errors = JsonSchemaValidation.validationErrors(schema, response.toJson.compactPrint)
      errors shouldBe empty
    }
  }
}
