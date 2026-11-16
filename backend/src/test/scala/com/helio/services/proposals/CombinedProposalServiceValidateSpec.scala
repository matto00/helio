package com.helio.services.proposals


import com.helio.infrastructure.persistence.pipelines.OutputRepository
import com.helio.services.ratelimit.SourceFetchBudget
import com.helio.services.ServiceError
import com.helio.services.pipelines.PipelineProposalService
import com.helio.services.proposals.CombinedProposalService
import com.helio.api.protocols.proposals.{CombinedProposal, DashboardProposal, ProposalPanel, ProposalPanelLayout}
import com.helio.api.protocols.pipelines.{CreatePipelineTransactionalOutputRequest, PipelineProposal, PipelineProposalSource}
import com.helio.domain.model._
import com.helio.infrastructure.persistence.sources.DataSourceRepository
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
    val pipelineProposalService = new PipelineProposalService(null, null, null, null, dataSourceRepo, null, SourceFetchBudget.default())
    new CombinedProposalService(pipelineProposalService, new DashboardProposalService(null, null, outputRepo = mock(classOf[OutputRepository])))
  }

  private def existingSource(source: DataSourceId): DataSource =
    DatasetSource(source, "Existing", ownerId, now, now)

  private def validPipeline(sourceId: DataSourceId): PipelineProposal =
    PipelineProposal(
      pipelineName = "My Pipeline",
      roots        = Vector(PipelineProposalSource(Some(sourceId.value), None, None, None, None, None, None)),
      steps        = Vector.empty,
      // HEL-1638: the sentinel panel needs exactly one Output (apply 422s otherwise); the old fixture had none.
      outputs      = Vector(CreatePipelineTransactionalOutputRequest(None, "table", "Out"))
    )

  private def sentinelMetricPanel(): ProposalPanel =
    ProposalPanel(
      title        = "Total",
      `type`       = "output",
      outputId   = Some(CombinedProposalService.OutputRefSentinel),
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

    // HEL-1638 task 1.2: apply's pre-write checks that combined validate used to skip.
    "reject a sentinel panel when the pipeline creates two Outputs, with apply's message (HEL-1638)" in {
      val sourceId = DataSourceId(UUID.randomUUID().toString)
      val dsRepo   = mock(classOf[DataSourceRepository])
      when(dsRepo.findByIdOwned(sourceId, user)).thenReturn(Future.successful(Some(existingSource(sourceId))))
      val pipeline = validPipeline(sourceId)
      val two      = pipeline.copy(outputs = pipeline.outputs :+ CreatePipelineTransactionalOutputRequest(None, "table", "Out2"))
      val err = await(newService(dsRepo).validate(CombinedProposal(two, validDashboard()), user)).swap.toOption.getOrElse(fail("accepted"))
      err shouldBe a[ServiceError.UnprocessableEntity]
      err.message should include("created 2 Output(s)")
    }

    "reject overlapping panel layouts, with apply's layout message (HEL-1638)" in {
      val sourceId = DataSourceId(UUID.randomUUID().toString)
      val dsRepo   = mock(classOf[DataSourceRepository])
      when(dsRepo.findByIdOwned(sourceId, user)).thenReturn(Future.successful(Some(existingSource(sourceId))))
      val a = sentinelMetricPanel().copy(layout = Some(ProposalPanelLayout(0, 0, 4, 3)))
      val b = sentinelMetricPanel().copy(title = "Total 2", layout = Some(ProposalPanelLayout(2, 1, 4, 3)))
      val err = await(newService(dsRepo).validate(CombinedProposal(validPipeline(sourceId), DashboardProposal("Sales", Vector(a, b))), user)).swap.toOption.getOrElse(fail("accepted"))
      err.message should include("lg")
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
