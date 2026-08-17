package com.helio.services

import com.helio.api.protocols.{AssistantProposal, DashboardProposal, DashboardProposalProtocol, ProposalPanel}
import com.helio.domain._
import com.helio.infrastructure.{DataTypeRepository, DataTypeRowRepository}
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

  /** Builds a real `AssistantToolExecutor` over mocked `dtRepo`/`rowRepo`. `combinedProposalService`/
   *  `patchSetPreviewService` default to `null` — only the decode-before-dispatch tests below (which
   *  never reach either) rely on that; a test that DOES exercise one passes a real instance. */
  private def newExecutor(
      dtRepo: DataTypeRepository,
      rowRepo: DataTypeRowRepository = mock(classOf[DataTypeRowRepository]),
      combinedProposalService: CombinedProposalService = null,
      patchSetPreviewService: PatchSetPreviewService = null
  ): AssistantToolExecutor = {
    val dataTypeService          = new DataTypeService(dtRepo, rowRepo, null)
    val workspaceContextService  = new WorkspaceContextService(null, null, dataTypeService, null)
    val workspaceSearchService   = new WorkspaceSearchService(null, null, dataTypeService, null, null, workspaceContextService)
    val panelCapabilityService   = new PanelCapabilityService(dtRepo, rowRepo)
    val dashboardProposalService = new DashboardProposalService(null, null, dtRepo, null)
    val pipelineProposalService  = new PipelineProposalService(null, null, null, null, null, null, null)
    new AssistantToolExecutor(
      workspaceSearchService,
      panelCapabilityService,
      dashboardProposalService,
      pipelineProposalService,
      combinedProposalService,
      patchSetPreviewService,
      user
    )
  }

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
      val dt       = pipelineOutputDataType(outputId)
      // Plain values (no eq()/any() matcher) for the DataTypeId/AuthenticatedUser args — Mockito's
      // eq() matcher interacts badly with Scala AnyVal-derived case classes (NPE unboxing a null
      // DataTypeId); Mockito auto-equals-matches every arg when NONE of them uses an explicit
      // matcher, which is the same style DashboardProposalServiceValidateSpec already establishes.
      when(dtRepo.findByIdOwned(outputId, user)).thenReturn(Future.successful(Some(dt)))
      when(rowRepo.listRows(meq(outputId.value), any[Option[Int]](), any[Set[String]]())).thenReturn(Future.successful(Vector.empty[JsObject]))

      val executor = newExecutor(dtRepo, rowRepo)
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
      when(dtRepo.findByIdOwned(outputId, user)).thenReturn(Future.successful(Some(pipelineOutputDataType(outputId))))
      val executor = newExecutor(dtRepo)

      val panel    = ProposalPanel(
        title = "Total", `type` = "metric", dataTypeId = Some(outputId.value), metricId = None,
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
      when(dtRepo.findByIdOwned(outputId, user)).thenReturn(Future.successful(None))
      val executor = newExecutor(dtRepo)

      val panel    = ProposalPanel(
        title = "Total", `type` = "metric", dataTypeId = Some(outputId.value), metricId = None,
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

  // HEL-700 tasks.md 3.3 (design.md D4) — find/get_resource dispatch paths never touch the
  // propose-call counters, even across multiple calls.
  "propose-call counters" should {

    "stay at zero across find and get_resource calls" in {
      val dtRepo  = mock(classOf[DataTypeRepository])
      val rowRepo = mock(classOf[DataTypeRowRepository])
      when(dtRepo.findByIdOwned(outputId, user)).thenReturn(Future.successful(Some(pipelineOutputDataType(outputId))))
      when(rowRepo.listRows(meq(outputId.value), any[Option[Int]](), any[Set[String]]())).thenReturn(Future.successful(Vector.empty[JsObject]))
      val executor = newExecutor(dtRepo, rowRepo)
      when(dtRepo.findAll(ownerId, Page.Default, None)).thenReturn(Future.successful(PagedResult(Vector.empty, 0, 0, 200)))

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

  private object executorJson extends DashboardProposalProtocol
}
