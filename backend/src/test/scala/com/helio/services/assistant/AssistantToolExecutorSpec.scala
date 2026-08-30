package com.helio.services.assistant

import com.helio.services.assistant.AssistantToolExecutor
import com.helio.services.panels.PanelCapabilityService
import com.helio.services.patchsets.PatchSetPreviewService
import com.helio.services.pipelines.{DataTypeService, PipelineProposalService}
import com.helio.services.proposals.{CombinedProposalService, DashboardProposalService}
import com.helio.services.sources.SourceService
import com.helio.services.workspace.{WorkspaceContextService, WorkspaceSearchService}
import com.helio.api.protocols.assistant.AssistantProposal
import com.helio.api.protocols.proposals.{CombinedProposal, CombinedProposalProtocol, DashboardProposal, ProposalPanel}
import com.helio.api.protocols.sources.{CsvSourceConfigPayload, RestApiConfigPayload, SqlInferRequest, SqlSourceConfigPayload, StaticColumnPayload, StaticDataPayload, TestConnectionResponse}
import com.helio.api.protocols.pipelines.{PipelineProposal, PipelineProposalSource, ProposalRestApiConfig}
import com.helio.domain.engine.SchemaField
import com.helio.domain.model._
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.pipelines.{DataTypeRepository, DataTypeRowRepository, OutputRepository}
import org.mockito.ArgumentMatchers.{any, eq => meq}
import org.mockito.Mockito.{mock, when}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** Unit coverage for `AssistantToolExecutor.execute` (HEL-662 tasks.md section 4), dispatched
 *  directly — no `ClaudeClient`/transport involved, so these tests exercise the dispatch table
 *  itself (parse-error handling, the DataType capability-merge payload) without needing a scripted
 *  Claude loop. Zero real network calls and zero real database: every collaborator below is either a
 *  mocked `DataTypeRepository`/`DataTypeRowRepository` (plain, non-final, Mockito-mockable) or a REAL
 *  service instance built on top of them — mirrors `DashboardProposalServiceValidateSpec`'s
 *  established "mocked repos, real service" style. */
class AssistantToolExecutorSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  private val now      = Instant.parse("2026-01-01T00:00:00Z")
  private val ownerId  = UserId(UUID.randomUUID().toString)
  private val user     = AuthenticatedUser(ownerId)
  private val outputId = DataTypeId(UUID.randomUUID().toString)

  private def pipelineOutputDataType(id: DataTypeId): DataType =
    DataType(id, None, "Orders", Vector(DataField("amount", "amount", "float", nullable = false)), Vector.empty, 1, now, now, ownerId)

  // HEL-904 task 3.8/3.9: a real Output, for tests exercising an "output"-kind proposal
  // panel's binding validation (now against OutputRepository, not DataTypeRepository).
  private def pipelineOutput(id: OutputId): Output =
    Output(
      id, "Orders", ownerId, NodeRef(PipelineId(UUID.randomUUID().toString), None), OutputKind.Table, now, now,
      // HEL-904 task 3.12: matches `pipelineOutputDataType`'s own single "amount" field, so tests
      // asserting on the "detail" half's `columns` see the same shape as before the Output rewire.
      schema = Vector(SchemaField("amount", "float"))
    )

  /** Builds a real `AssistantToolExecutor` over mocked `dtRepo`/`rowRepo`. `combinedProposalService`/
   *  `patchSetPreviewService` default to `null` — only the decode-before-dispatch tests below (which
   *  never reach either) rely on that; a test that DOES exercise one passes a real instance.
   *  `sourceService` defaults to a Mockito mock (HEL-756) — every `execute("test_connection", ...)`
   *  test below stubs its `testRest`/`testSql` directly; the mock default only needs to exist for
   *  every OTHER test's constructor call, never invoked by them. */
  private def newExecutor(
      dtRepo: DataTypeRepository,
      rowRepo: DataTypeRowRepository = mock(classOf[DataTypeRowRepository]),
      combinedProposalService: CombinedProposalService = null,
      patchSetPreviewService: PatchSetPreviewService = null,
      sourceService: SourceService = mock(classOf[SourceService]),
      pipelineProposalServiceOverride: PipelineProposalService = null,
      outputRepo: OutputRepository = null
  ): AssistantToolExecutor = {
    // HEL-904 task 3.12/3.2: WorkspaceContextService/WorkspaceSearchService take the SAME
    // `outputRepo` param this helper already threads through to `dashboardProposalService` --
    // `dataTypeService` is no longer a collaborator of either.
    val workspaceContextService  = new WorkspaceContextService(null, null, outputRepo, null)
    val workspaceSearchService   = new WorkspaceSearchService(null, null, outputRepo, null, null, workspaceContextService)
    val panelCapabilityService   = new PanelCapabilityService(dtRepo, rowRepo)
    val dashboardProposalService = new DashboardProposalService(null, null, dtRepo, null, outputRepo)
    // HEL-756 tasks.md 2.4/2.5/2.7 — the default is a REAL instance whose own collaborators are all
    // null, safe because `PipelineProposalService.validate`'s `validateSourceReference` never
    // touches `dataSourceRepo` for an inline (sourceId = None) source. A test that needs `validate`
    // to fully succeed for a `sourceId` source (which DOES touch `dataSourceRepo`) passes its own
    // working instance via `pipelineProposalServiceOverride`.
    val pipelineProposalService =
      if (pipelineProposalServiceOverride != null) pipelineProposalServiceOverride
      else new PipelineProposalService(null, null, null, null, null, null, null, null)
    new AssistantToolExecutor(
      workspaceSearchService,
      panelCapabilityService,
      dashboardProposalService,
      pipelineProposalService,
      combinedProposalService,
      patchSetPreviewService,
      sourceService,
      user
    )
  }


  private def restConfig(url: String = "https://api.example.com/data"): RestApiConfigPayload =
    RestApiConfigPayload(url = Some(url), method = Some("GET"), auth = None, headers = None)

  private def sqlConfig(database: String = "app"): SqlSourceConfigPayload =
    SqlSourceConfigPayload(dialect = "postgresql", host = "db.example.com", port = 5432, database = database, user = "readonly", password = "", query = "SELECT 1")

  // `restConfig()` above builds the `RestApiConfigPayload` fed to `test_connection` (its own
  // schema is unchanged); `PipelineProposalSource.restConfig` is now `ProposalRestApiConfig`
  // (task 1.1) — this converts the SAME shared fields so `requireVerifiedInlineSource`'s
  // `ProposalRestApiConfig.toRestApiConfigPayload` round-trips back to an equal `RestApiConfigPayload`.
  private def inlineRestSource(config: RestApiConfigPayload): PipelineProposalSource =
    PipelineProposalSource(
      sourceId   = None,
      `type`     = Some("rest_api"),
      name       = Some("Inline REST"),
      csvConfig  = None,
      restConfig = Some(ProposalRestApiConfig(
        connectorId     = config.connectorId,
        url             = config.url,
        endpoint        = config.endpoint,
        method          = config.method,
        queryParams     = config.queryParams,
        headers         = config.headers,
        body            = config.body,
        bodyContentType = config.bodyContentType,
        rootSelector    = config.rootSelector,
        parameters      = config.parameters
      )),
      sqlConfig    = None,
      staticConfig = None
    )

  private def inlineSqlSource(config: SqlSourceConfigPayload): PipelineProposalSource =
    PipelineProposalSource(sourceId = None, `type` = Some("sql"), name = Some("Inline SQL"), csvConfig = None, restConfig = None, sqlConfig = Some(config), staticConfig = None)

  private def sourceIdSource(id: String = "src_existing"): PipelineProposalSource =
    PipelineProposalSource(sourceId = Some(id), `type` = None, name = None, csvConfig = None, restConfig = None, sqlConfig = None, staticConfig = None)

  private def inlineStaticSource(): PipelineProposalSource =
    PipelineProposalSource(
      sourceId = None, `type` = Some(DataSourceKind.Static), name = Some("Inline Static"), csvConfig = None, restConfig = None, sqlConfig = None,
      staticConfig = Some(StaticDataPayload(Vector(StaticColumnPayload("value", "string")), Vector(Vector(JsString("x")))))
    )

  private def pipelineProposalWith(source: PipelineProposalSource, pipelineName: String = "New Pipeline"): PipelineProposal =
    PipelineProposal(pipelineName, source, "New Output", Vector.empty)

  "execute" should {

    "return Left for an unknown tool name" in {
      val executor = newExecutor(mock(classOf[DataTypeRepository]))
      await(executor.execute("delete_dashboard", JsObject.empty)) shouldBe a[Left[_, _]]
    }
  }

  "execute(\"get_resource\", ...)" should {

    // Task 6.9 — an unparseable `type` argument is fed back as an error tool_result, not a thrown
    // exception (the `await` below would itself fail if execute threw instead of resolving Left).
    "return Left, not throw, for an unparseable resourceType" in {
      val executor = newExecutor(mock(classOf[DataTypeRepository]))
      val input     = JsObject("id" -> JsString("abc"), "type" -> JsString("bogus"))

      val result = await(executor.execute("get_resource", input))

      result shouldBe a[Left[_, _]]
    }

    "return Left for a missing id" in {
      val executor = newExecutor(mock(classOf[DataTypeRepository]))
      val input     = JsObject("type" -> JsString("dataType"))

      await(executor.execute("get_resource", input)) shouldBe a[Left[_, _]]
    }

    // Task 6.11 — nests `detail`/`panelCapabilities` under DISTINCT keys, and BOTH `columns` arrays
    // (the DataType detail's semanticRole-bearing columns AND the capability response's columns)
    // survive intact, not just that panelCapabilities is present (design.md D3a).
    "nest detail and panelCapabilities as distinct keys for a DataType, both columns arrays intact" in {
      val dtRepo  = mock(classOf[DataTypeRepository])
      val rowRepo = mock(classOf[DataTypeRowRepository])
      val dt      = pipelineOutputDataType(outputId)
      // HEL-904 task 3.12/3.2: `get_resource(type = "dataType")`'s "detail" half now resolves
      // through `WorkspaceSearchService`'s Output branch (`OutputRepository`) -- but its
      // "panelCapabilities" half still resolves through `PanelCapabilityService`'s pre-existing
      // `DataTypeRepository`/`DataTypeRowRepository` collaborators (task 3.11, NOT yet rewired
      // this cycle) -- so BOTH `dtRepo` and a new `outRepo` need matching same-`id`,
      // same-`"amount"`-field stubs for this one test to keep exercising both halves.
      when(dtRepo.findByIdOwned(outputId, user)).thenReturn(Future.successful(Some(dt)))
      when(rowRepo.listRows(meq(outputId.value), any[Option[Int]](), any[Set[String]]())).thenReturn(Future.successful(Vector.empty[JsObject]))
      val outRepo = mock(classOf[OutputRepository])
      when(outRepo.findByIdOwned(OutputId(outputId.value), user))
        .thenReturn(Future.successful(Some(pipelineOutput(OutputId(outputId.value)))))

      val executor = newExecutor(dtRepo, rowRepo, outputRepo = outRepo)
      val input     = JsObject("id" -> JsString(outputId.value), "type" -> JsString("dataType"))

      val result = await(executor.execute("get_resource", input))

      result shouldBe a[Right[_, _]]
      val payload = result.toOption.get.parseJson.asJsObject
      payload.fields.keySet should contain allOf ("detail", "panelCapabilities")

      val detailColumns = asJsObjectVector(payload.fields("detail").asJsObject.fields("columns"))
      detailColumns should have size 1
      detailColumns.head.fields.keySet should contain("semanticRole")
      detailColumns.head.fields("name") shouldBe JsString("amount")

      val capabilityColumns = asJsObjectVector(payload.fields("panelCapabilities").asJsObject.fields("columns"))
      capabilityColumns should have size 1
      capabilityColumns.head.fields.keySet should not contain "semanticRole"
      capabilityColumns.head.fields("name") shouldBe JsString("amount")
    }
  }

  "execute(\"propose_dashboard\", ...)" should {

    "return Left for unparseable input without touching the proposal service" in {
      val executor = newExecutor(mock(classOf[DataTypeRepository]))
      val input     = JsObject("dashboardName" -> JsNumber(1)) // wrong type, and 'panels' missing

      await(executor.execute("propose_dashboard", input)) shouldBe a[Left[_, _]]
    }

    // HEL-700 tasks.md 3.3 (design.md D4) — decode failure increments proposeDecodeFailures AND
    // proposeAttempts, never proposeValidationFailures.
    "increment proposeAttempts and proposeDecodeFailures (not proposeValidationFailures) for unparseable input" in {
      val executor = newExecutor(mock(classOf[DataTypeRepository]))
      val input     = JsObject("dashboardName" -> JsNumber(1))

      await(executor.execute("propose_dashboard", input))

      executor.proposeAttempts shouldBe 1
      executor.proposeDecodeFailures shouldBe 1
      executor.proposeValidationFailures shouldBe 0
    }

    "validate, capture the proposal on success, and echo it back as the tool_result" in {
      val dtRepo = mock(classOf[DataTypeRepository])
      val outRepo = mock(classOf[OutputRepository])
      when(outRepo.findByIdOwned(OutputId(outputId.value), user)).thenReturn(Future.successful(Some(pipelineOutput(OutputId(outputId.value)))))
      val executor = newExecutor(dtRepo, outputRepo = outRepo)

      val panel    = ProposalPanel(
        title = "Total", `type` = "output", dataTypeId = Some(outputId.value), metricId = None,
        fieldMapping = Some(JsObject("value" -> JsString("amount"))), aggregation = None, content = None,
        url = None, orientation = None, chartType = None, xAxisLabel = None, yAxisLabel = None,
        seriesColors = None, label = None, unit = None, sort = None, layout = None, config = None
      )
      val proposal = DashboardProposal("Sales", Vector(panel))
      val input     = executorJson.dashboardProposalFormat.write(proposal)

      val result = await(executor.execute("propose_dashboard", input))

      result shouldBe a[Right[_, _]]
      executor.proposal shouldBe Some(AssistantProposal.Dashboard(proposal))

      // HEL-700 tasks.md 3.3 — a clean call counts as an attempt with zero failures.
      executor.proposeAttempts shouldBe 1
      executor.proposeDecodeFailures shouldBe 0
      executor.proposeValidationFailures shouldBe 0
    }

    // HEL-700 tasks.md 3.3 (design.md D4) — a decodable but semantically-invalid proposal (its
    // dataTypeId resolves to nothing) increments proposeValidationFailures, never
    // proposeDecodeFailures — decode already succeeded before validate ever ran.
    "increment proposeAttempts and proposeValidationFailures (not proposeDecodeFailures) when validate rejects a decodable proposal" in {
      val dtRepo = mock(classOf[DataTypeRepository])
      val outRepo = mock(classOf[OutputRepository])
      when(outRepo.findByIdOwned(OutputId(outputId.value), user)).thenReturn(Future.successful(None))
      val executor = newExecutor(dtRepo, outputRepo = outRepo)

      val panel    = ProposalPanel(
        title = "Total", `type` = "output", dataTypeId = Some(outputId.value), metricId = None,
        fieldMapping = Some(JsObject("value" -> JsString("amount"))), aggregation = None, content = None,
        url = None, orientation = None, chartType = None, xAxisLabel = None, yAxisLabel = None,
        seriesColors = None, label = None, unit = None, sort = None, layout = None, config = None
      )
      val proposal = DashboardProposal("Sales", Vector(panel))
      val input     = executorJson.dashboardProposalFormat.write(proposal)

      val result = await(executor.execute("propose_dashboard", input))

      result shouldBe a[Left[_, _]]
      executor.proposeAttempts shouldBe 1
      executor.proposeDecodeFailures shouldBe 0
      executor.proposeValidationFailures shouldBe 1
    }
  }

  "execute(\"propose_pipeline\", ...)" should {

    "return Left for unparseable input without touching the proposal service" in {
      val executor = newExecutor(mock(classOf[DataTypeRepository]))
      await(executor.execute("propose_pipeline", JsObject("pipelineName" -> JsNumber(1)))) shouldBe a[Left[_, _]]
    }
  }

  "execute(\"propose_combined\", ...)" should {

    // combinedProposalService is null here — a reached call would NPE. Left proves decode runs
    // (and fails) BEFORE the service is ever touched (task 4.3's "decode -> validate" ordering).
    "return Left for unparseable input without touching the combined proposal service" in {
      val executor = newExecutor(mock(classOf[DataTypeRepository]))
      await(executor.execute("propose_combined", JsObject("pipeline" -> JsNumber(1)))) shouldBe a[Left[_, _]]
    }
  }

  "execute(\"propose_patch_set\", ...)" should {

    // patchSetPreviewService is null here — same "decode before dispatch" proof as propose_combined.
    "return Left for unparseable input without touching the patch-set preview service" in {
      val executor = newExecutor(mock(classOf[DataTypeRepository]))
      await(executor.execute("propose_patch_set", JsObject("edits" -> JsNumber(1)))) shouldBe a[Left[_, _]]
    }
  }

  // HEL-756 tasks.md 2.3 — dispatches to sourceService.testRest/testSql and echoes back the
  // TestConnectionResponse JSON either way (ok = true or ok = false is a normal Right, never a
  // Left — mirrors ConnectionTest.run's own "domain outcome, not HTTP error" framing).
  "execute(\"test_connection\", ...)" should {

    "dispatch a rest_api call to sourceService.testRest and return ok = true on success" in {
      val config         = restConfig()
      val sourceService = mock(classOf[SourceService])
      when(sourceService.testRest(config, user)).thenReturn(Future.successful(Right(TestConnectionResponse(ok = true, error = None))))
      val executor = newExecutor(mock(classOf[DataTypeRepository]), sourceService = sourceService)

      val input  = JsObject("type" -> JsString("rest_api"), "config" -> executorJson.restApiConfigPayloadFormat.write(config))
      val result = await(executor.execute("test_connection", input))

      result shouldBe a[Right[_, _]]
      result.toOption.get.parseJson.asJsObject.fields("ok") shouldBe JsBoolean(true)
    }

    "dispatch a rest_api call to sourceService.testRest and return ok = false (e.g. DNS failure) as a normal Right" in {
      val config         = restConfig("https://lm-api-reads.espn.com/does-not-resolve")
      val sourceService = mock(classOf[SourceService])
      when(sourceService.testRest(config, user)).thenReturn(Future.successful(Right(TestConnectionResponse(ok = false, error = Some("DNS resolution failed")))))
      val executor = newExecutor(mock(classOf[DataTypeRepository]), sourceService = sourceService)

      val input  = JsObject("type" -> JsString("rest_api"), "config" -> executorJson.restApiConfigPayloadFormat.write(config))
      val result = await(executor.execute("test_connection", input))

      result shouldBe a[Right[_, _]]
      result.toOption.get.parseJson.asJsObject.fields("ok") shouldBe JsBoolean(false)
    }

    "dispatch a sql call to sourceService.testSql and return the TestConnectionResponse JSON on success" in {
      val config         = sqlConfig()
      val sourceService = mock(classOf[SourceService])
      when(sourceService.testSql(SqlInferRequest("sql", config))).thenReturn(Future.successful(Right(TestConnectionResponse(ok = true, error = None))))
      val executor = newExecutor(mock(classOf[DataTypeRepository]), sourceService = sourceService)

      val input  = JsObject("type" -> JsString("sql"), "config" -> executorJson.sqlSourceConfigPayloadFormat.write(config))
      val result = await(executor.execute("test_connection", input))

      result shouldBe a[Right[_, _]]
      result.toOption.get.parseJson.asJsObject.fields("ok") shouldBe JsBoolean(true)
    }

    "dispatch a sql call to sourceService.testSql and return ok = false as a normal Right" in {
      val config         = sqlConfig()
      val sourceService = mock(classOf[SourceService])
      when(sourceService.testSql(SqlInferRequest("sql", config))).thenReturn(Future.successful(Right(TestConnectionResponse(ok = false, error = Some("connection refused")))))
      val executor = newExecutor(mock(classOf[DataTypeRepository]), sourceService = sourceService)

      val input  = JsObject("type" -> JsString("sql"), "config" -> executorJson.sqlSourceConfigPayloadFormat.write(config))
      val result = await(executor.execute("test_connection", input))

      result shouldBe a[Right[_, _]]
      result.toOption.get.parseJson.asJsObject.fields("ok") shouldBe JsBoolean(false)
    }

    "return Left for an unrecognized type without touching sourceService" in {
      val sourceService = mock(classOf[SourceService])
      val executor       = newExecutor(mock(classOf[DataTypeRepository]), sourceService = sourceService)

      val input  = JsObject("type" -> JsString("csv"), "config" -> JsObject.empty)
      val result = await(executor.execute("test_connection", input))

      result shouldBe a[Left[_, _]]
    }
  }

  // HEL-756 tasks.md 2.4-2.7 (design.md D1/D4, spec's "must be connection-tested before its
  // proposal finalizes" requirement) — the structural gate `requireVerifiedInlineSource` applies
  // ahead of `propose_pipeline`/`propose_combined`'s underlying `validate` call.
  "the test_connection gate on propose_pipeline/propose_combined" should {

    // Task 2.4 — an untested inline rest_api source is rejected as an isError-bound Left asking for
    // test_connection. If the gate had NOT intercepted, PipelineProposalService.validate would have
    // returned Right (the fixture is otherwise structurally well-formed and touches no null
    // collaborator for an inline source) — a Left here can ONLY be this gate's rejection.
    "reject propose_pipeline for an untested inline rest_api source, never reaching validate's success path" in {
      val executor = newExecutor(mock(classOf[DataTypeRepository]))
      val proposal  = pipelineProposalWith(inlineRestSource(restConfig()))

      val result = await(executor.execute("propose_pipeline", executorJson.pipelineProposalFormat.write(proposal)))

      result shouldBe a[Left[_, _]]
      result.left.toOption.get should include("test_connection")
      executor.proposeValidationFailures shouldBe 1
    }

    "reject propose_pipeline for an untested inline sql source the same way" in {
      val executor = newExecutor(mock(classOf[DataTypeRepository]))
      val proposal  = pipelineProposalWith(inlineSqlSource(sqlConfig()))

      val result = await(executor.execute("propose_pipeline", executorJson.pipelineProposalFormat.write(proposal)))

      result shouldBe a[Left[_, _]]
      result.left.toOption.get should include("test_connection")
    }

    // propose_combined: combinedProposalService is null by default here — a call that actually
    // reached combinedProposalService.validate would NPE; a clean Left proves the gate intercepted
    // (`proposal.pipeline.source`) before that call ever happened.
    "reject propose_combined for an untested inline rest_api pipeline.source, never reaching combinedProposalService" in {
      val executor = newExecutor(mock(classOf[DataTypeRepository]))
      val pipeline  = pipelineProposalWith(inlineRestSource(restConfig()))
      val dashboard = DashboardProposal("Overview", Vector.empty)
      val combined  = CombinedProposal(pipeline, dashboard)

      val result = await(executor.execute("propose_combined", executorJson.combinedProposalFormat.write(combined)))

      result shouldBe a[Left[_, _]]
      result.left.toOption.get should include("test_connection")
    }

    // Task 2.5 — a test_connection success followed by propose_pipeline with the IDENTICAL config
    // proceeds to validate normally (Right), unaffected by the new gate.
    "let propose_pipeline proceed to validate after a prior test_connection success for the identical rest_api config" in {
      val config          = restConfig()
      val sourceServiceM  = mock(classOf[SourceService])
      when(sourceServiceM.testRest(config, user)).thenReturn(Future.successful(Right(TestConnectionResponse(ok = true, error = None))))
      val executor = newExecutor(mock(classOf[DataTypeRepository]), sourceService = sourceServiceM)

      await(executor.execute("test_connection", JsObject("type" -> JsString("rest_api"), "config" -> executorJson.restApiConfigPayloadFormat.write(config))))

      val proposal = pipelineProposalWith(inlineRestSource(config))
      val result    = await(executor.execute("propose_pipeline", executorJson.pipelineProposalFormat.write(proposal)))

      result shouldBe a[Right[_, _]]
      executor.proposeValidationFailures shouldBe 0
    }

    "let propose_combined proceed to validate after a prior test_connection success for the identical sql config" in {
      val config         = sqlConfig()
      val sourceServiceM = mock(classOf[SourceService])
      when(sourceServiceM.testSql(SqlInferRequest("sql", config))).thenReturn(Future.successful(Right(TestConnectionResponse(ok = true, error = None))))
      val realCombined = new CombinedProposalService(
        new PipelineProposalService(null, null, null, null, null, null, null, null),
        new DashboardProposalService(null, null, mock(classOf[DataTypeRepository]), null)
      )
      val executor = newExecutor(mock(classOf[DataTypeRepository]), combinedProposalService = realCombined, sourceService = sourceServiceM)

      await(executor.execute("test_connection", JsObject("type" -> JsString("sql"), "config" -> executorJson.sqlSourceConfigPayloadFormat.write(config))))

      val pipeline  = pipelineProposalWith(inlineSqlSource(config))
      val dashboard = DashboardProposal("Overview", Vector.empty)
      val combined  = CombinedProposal(pipeline, dashboard)
      val result     = await(executor.execute("propose_combined", executorJson.combinedProposalFormat.write(combined)))

      result shouldBe a[Right[_, _]]
    }

    // Task 2.6 — a failed test_connection never verifies the config; a config edited after a
    // successful test is also still rejected (verification is exact-equality, never fuzzy).
    "still reject propose_pipeline after a test_connection call that returned ok = false" in {
      val config         = restConfig()
      val sourceServiceM = mock(classOf[SourceService])
      when(sourceServiceM.testRest(config, user)).thenReturn(Future.successful(Right(TestConnectionResponse(ok = false, error = Some("connection refused")))))
      val executor = newExecutor(mock(classOf[DataTypeRepository]), sourceService = sourceServiceM)

      await(executor.execute("test_connection", JsObject("type" -> JsString("rest_api"), "config" -> executorJson.restApiConfigPayloadFormat.write(config))))

      val proposal = pipelineProposalWith(inlineRestSource(config))
      val result    = await(executor.execute("propose_pipeline", executorJson.pipelineProposalFormat.write(proposal)))

      result shouldBe a[Left[_, _]]
      result.left.toOption.get should include("test_connection")
    }

    "still reject propose_pipeline when the config was edited after a successful test_connection call" in {
      val testedConfig = restConfig("https://api.example.com/v1")
      val editedConfig = restConfig("https://api.example.com/v2")
      val sourceServiceM = mock(classOf[SourceService])
      when(sourceServiceM.testRest(testedConfig, user)).thenReturn(Future.successful(Right(TestConnectionResponse(ok = true, error = None))))
      val executor = newExecutor(mock(classOf[DataTypeRepository]), sourceService = sourceServiceM)

      await(executor.execute("test_connection", JsObject("type" -> JsString("rest_api"), "config" -> executorJson.restApiConfigPayloadFormat.write(testedConfig))))

      val proposal = pipelineProposalWith(inlineRestSource(editedConfig))
      val result    = await(executor.execute("propose_pipeline", executorJson.pipelineProposalFormat.write(proposal)))

      result shouldBe a[Left[_, _]]
      result.left.toOption.get should include("test_connection")
    }

    // Task 2.7 — sourceId and inline csv/static sources bypass the gate entirely; no test_connection
    // call is required for any of them.
    "let propose_pipeline proceed to validate for a sourceId-referenced source with no test_connection call" in {
      val dataSourceRepo = mock(classOf[DataSourceRepository])
      val existing         = RestSource(DataSourceId("src_existing"), "Existing REST", ownerId, now, now, RestApiConfig(connectorId = "conn-1", endpoint = "https://api.example.com", method = "GET", headers = Map.empty))
      when(dataSourceRepo.findByIdOwned(DataSourceId("src_existing"), user)).thenReturn(Future.successful(Some(existing)))
      val realPipelineService = new PipelineProposalService(null, null, null, null, null, dataSourceRepo, null, null)
      val executor              = newExecutor(mock(classOf[DataTypeRepository]), pipelineProposalServiceOverride = realPipelineService)

      val proposal = pipelineProposalWith(sourceIdSource("src_existing"))
      val result    = await(executor.execute("propose_pipeline", executorJson.pipelineProposalFormat.write(proposal)))

      result shouldBe a[Right[_, _]]
    }

    "let propose_pipeline proceed to validate for an inline static source with no test_connection call" in {
      val executor = newExecutor(mock(classOf[DataTypeRepository]))
      val proposal  = pipelineProposalWith(inlineStaticSource())

      val result = await(executor.execute("propose_pipeline", executorJson.pipelineProposalFormat.write(proposal)))

      result shouldBe a[Right[_, _]]
    }

    "let propose_pipeline proceed to validate for an inline csv source with no test_connection call" in {
      val csvSource = PipelineProposalSource(
        sourceId = None, `type` = Some(DataSourceKind.Csv), name = Some("Inline CSV"),
        csvConfig = Some(CsvSourceConfigPayload("uploads/example.csv")), restConfig = None, sqlConfig = None, staticConfig = None
      )
      val executor = newExecutor(mock(classOf[DataTypeRepository]))
      val proposal  = pipelineProposalWith(csvSource)

      val result = await(executor.execute("propose_pipeline", executorJson.pipelineProposalFormat.write(proposal)))

      result shouldBe a[Right[_, _]]
    }
  }

  // HEL-700 tasks.md 3.3 (design.md D4) — find/get_resource dispatch paths never touch the
  // propose-call counters, even across multiple calls.
  "propose-call counters" should {

    "stay at zero across find and get_resource calls" in {
      val dtRepo  = mock(classOf[DataTypeRepository])
      val rowRepo = mock(classOf[DataTypeRowRepository])
      when(dtRepo.findByIdOwned(outputId, user)).thenReturn(Future.successful(Some(pipelineOutputDataType(outputId))))
      when(rowRepo.listRows(meq(outputId.value), any[Option[Int]](), any[Set[String]]())).thenReturn(Future.successful(Vector.empty[JsObject]))
      // HEL-904 task 3.12/3.2: `find`/`get_resource`'s "dataType" resourceType now resolves
      // through `OutputRepository`, not `dataTypeService`.
      val outRepo = mock(classOf[OutputRepository])
      when(outRepo.findByIdOwned(OutputId(outputId.value), user))
        .thenReturn(Future.successful(Some(pipelineOutput(OutputId(outputId.value)))))
      when(outRepo.findAllByOwner(ownerId, Page.Default)).thenReturn(Future.successful(PagedResult(Vector.empty, 0, 0, 200)))
      val executor = newExecutor(dtRepo, rowRepo, outputRepo = outRepo)

      // resourceTypes restricted to "dataType" only — this executor's other 4 WorkspaceSearchService
      // collaborators (dashboard/dataSource/pipeline/metric) are null (mirrors this file's own
      // established null-unused pattern); an unrestricted find would NPE on one of them.
      await(executor.execute("find", JsObject("query" -> JsString("orders"), "resourceTypes" -> JsArray(JsString("dataType")))))
      await(executor.execute("get_resource", JsObject("id" -> JsString(outputId.value), "type" -> JsString("dataType"))))

      executor.proposeAttempts shouldBe 0
      executor.proposeDecodeFailures shouldBe 0
      executor.proposeValidationFailures shouldBe 0
    }
  }

  private def asJsObjectVector(value: JsValue): Vector[JsObject] = value match {
    case JsArray(elements) => elements.map(_.asJsObject)
    case other              => fail(s"expected a JSON array, got $other")
  }

  // HEL-756: `CombinedProposalProtocol` already extends `PipelineProposalProtocol` (transitively
  // `DataSourceProtocol`) `with DashboardProposalProtocol` — one mixin now covers every wire format
  // the tests below need: `restApiConfigPayloadFormat`/`sqlSourceConfigPayloadFormat`/
  // `pipelineProposalFormat`/`combinedProposalFormat`/`dashboardProposalFormat`.
  private object executorJson extends CombinedProposalProtocol
}
