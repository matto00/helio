package com.helio.services

import com.helio.api.protocols.{CombinedProposal, DashboardProposal, PipelineProposal, PipelineProposalSource, ProposalPanel}
import com.helio.domain._
import com.helio.infrastructure.DataSourceRepository
import org.mockito.Mockito.{mock, when}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json.{JsObject, JsString}

import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** Unit coverage for `CombinedProposalService.validate` (HEL-662 tasks.md 6.2) — the new,
 *  non-mutating entry point required by the Hard Boundary (design.md D3).
 *
 *  `dashboardProposalService` is passed `null`: `validate` never calls it (the two structural
 *  dashboard checks it mirrors — blank `dashboardName` and `ProposalPanelSupport.validatePanel` —
 *  are pure/in-memory here, not delegated to `DashboardProposalService.validate`'s own DB-backed
 *  `preValidateBindings`). `pipelineProposalService` is a REAL instance backed by a mocked
 *  `DataSourceRepository` (its own `validate` is separately covered by
 *  `PipelineProposalServiceValidateSpec`) — reused here to prove the delegation actually happens. */
class CombinedProposalServiceValidateSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  private val now     = Instant.parse("2026-01-01T00:00:00Z")
  private val ownerId = UserId(UUID.randomUUID().toString)
  private val user    = AuthenticatedUser(ownerId)

  private def newService(dataSourceRepo: DataSourceRepository): CombinedProposalService = {
    val pipelineProposalService = new PipelineProposalService(null, null, null, null, null, dataSourceRepo, null)
    new CombinedProposalService(pipelineProposalService, null)
  }

  private def existingSource(source: DataSourceId): DataSource =
    StaticSource(source, "Existing", ownerId, now, now)

  private def validPipeline(sourceId: DataSourceId): PipelineProposal =
    PipelineProposal(
      "My Pipeline",
      PipelineProposalSource(Some(sourceId.value), None, None, None, None, None, None),
      "My Output",
      Vector.empty
    )

  private def sentinelMetricPanel(): ProposalPanel =
    ProposalPanel(
      title        = "Total",
      `type`       = "metric",
      dataTypeId   = Some(CombinedProposalService.OutputRefSentinel),
      metricId     = None,
      fieldMapping = Some(JsObject("value" -> JsString("region"))),
      aggregation  = None,
      content      = None,
      url          = None,
      orientation  = None,
      chartType    = None,
      xAxisLabel   = None,
      yAxisLabel   = None,
      seriesColors = None,
      label        = None,
      unit         = None,
      sort         = None,
      layout       = None,
      config       = None
    )

  private def validDashboard(): DashboardProposal =
    DashboardProposal("Sales", Vector(sentinelMetricPanel()))

  "CombinedProposalService.validate" should {

    "accept a structurally valid combined proposal, delegating the pipeline portion" in {
      val sourceId = DataSourceId(UUID.randomUUID().toString)
      val dsRepo   = mock(classOf[DataSourceRepository])
      when(dsRepo.findByIdOwned(sourceId, user)).thenReturn(Future.successful(Some(existingSource(sourceId))))

      val combined = CombinedProposal(validPipeline(sourceId), validDashboard())
      val result   = await(newService(dsRepo).validate(combined, user))

      result shouldBe Right(())
    }

    "reject an invalid pipeline portion (nonexistent source), proving the delegation is enforced" in {
      val sourceId = DataSourceId(UUID.randomUUID().toString)
      val dsRepo   = mock(classOf[DataSourceRepository])
      when(dsRepo.findByIdOwned(sourceId, user)).thenReturn(Future.successful(None))

      val combined = CombinedProposal(validPipeline(sourceId), validDashboard())
      val result   = await(newService(dsRepo).validate(combined, user))

      result shouldBe a[Left[_, _]]
      result.swap.toOption.get shouldBe a[ServiceError.NotFound]
    }

    "reject a structurally invalid dashboard panel (blank title) before reaching the pipeline portion" in {
      val sourceId = DataSourceId(UUID.randomUUID().toString)
      val dsRepo   = mock(classOf[DataSourceRepository])
      // Intentionally NOT stubbed: a reached call would return Mockito's null default and NPE,
      // failing this test loudly if the dashboard check didn't actually short-circuit first.

      val blankTitlePanel = sentinelMetricPanel().copy(title = "   ")
      val combined         = CombinedProposal(validPipeline(sourceId), DashboardProposal("Sales", Vector(blankTitlePanel)))
      val result           = await(newService(dsRepo).validate(combined, user))

      result shouldBe a[Left[_, _]]
      result.swap.toOption.get shouldBe a[ServiceError.BadRequest]
    }

    // Design-gate round 1/2 fix (design.md D3): proves BOTH halves of validateStructure's mirror
    // actually run, not just the per-panel check.
    "reject a blank dashboard.dashboardName before reaching the pipeline portion" in {
      val sourceId = DataSourceId(UUID.randomUUID().toString)
      val dsRepo   = mock(classOf[DataSourceRepository])

      val combined = CombinedProposal(validPipeline(sourceId), DashboardProposal("   ", Vector(sentinelMetricPanel())))
      val result   = await(newService(dsRepo).validate(combined, user))

      result shouldBe a[Left[_, _]]
      result.swap.toOption.get shouldBe a[ServiceError.BadRequest]
      result.swap.toOption.get.message.toLowerCase should include("dashboardname")
    }
  }
}
