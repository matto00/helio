package com.helio.services.proposals


import com.helio.services.ServiceError
import com.helio.services.proposals.DashboardProposalService
import com.helio.api.protocols.proposals.{DashboardProposal, ProposalPanel}
import com.helio.domain.model._
import com.helio.infrastructure.persistence.pipelines.DataTypeRepository
import com.helio.infrastructure.persistence.metrics.MetricRepository
import org.mockito.Mockito.{mock, verifyNoInteractions, when}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json.{JsObject, JsString}

import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** Unit coverage for `DashboardProposalService.validate` (HEL-392 tasks.md 5.1) — the new,
 *  side-effect-free entry point extracted out of `apply` (design.md D1). No unit-level spec for
 *  `DashboardProposalService` existed before this ticket; `apply`'s own route-level regression net
 *  (`DashboardApplyProposal*Spec`, real Postgres/RLS) is left untouched and unmodified.
 *
 *  Mocked repos only (`DataTypeRepository`/`MetricRepository` are plain, non-final classes —
 *  mockable, mirroring `PanelServiceMetricBindingSpec`'s precedent) — no embedded-Postgres harness,
 *  per the ticket brief.
 *
 *  `dashboardService`/`panelService` are passed `null`: `validate` never calls either (by
 *  construction — a NullPointerException would fail these tests loudly if that ever changed), so a
 *  working instance would only obscure that `validate` really creates nothing. */
class DashboardProposalServiceValidateSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  private val now     = Instant.parse("2026-01-01T00:00:00Z")
  private val ownerId = UserId(UUID.randomUUID().toString)
  private val user    = AuthenticatedUser(ownerId)

  private val outputTypeId    = DataTypeId(UUID.randomUUID().toString)
  private val companionTypeId = DataTypeId(UUID.randomUUID().toString)

  private def pipelineOutputDataType(id: DataTypeId): DataType =
    DataType(id, None, "Output", Vector.empty, Vector.empty, 1, now, now, ownerId)

  private def companionDataType(id: DataTypeId): DataType =
    DataType(id, Some(DataSourceId(UUID.randomUUID().toString)), "Companion", Vector.empty, Vector.empty, 1, now, now, ownerId)

  private def newService(dtRepo: DataTypeRepository, metricRepo: MetricRepository = mock(classOf[MetricRepository])): DashboardProposalService =
    new DashboardProposalService(null, null, dtRepo, metricRepo)

  private def metricPanel(dataTypeId: DataTypeId, `type`: String = "output"): ProposalPanel =
    ProposalPanel(
      title        = "Total",
      `type`       = `type`,
      dataTypeId   = Some(dataTypeId.value),
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

  "DashboardProposalService.validate" should {

    "accept a structurally valid proposal bound to a pipeline-output DataType" in {
      val dtRepo = mock(classOf[DataTypeRepository])
      when(dtRepo.findByIdOwned(outputTypeId, user)).thenReturn(Future.successful(Some(pipelineOutputDataType(outputTypeId))))

      val proposal = DashboardProposal("Sales", Vector(metricPanel(outputTypeId)))
      val result   = await(newService(dtRepo).validate(proposal, user))

      result shouldBe Right(())
    }

    // The exact AC this locks in: "an NL proposal binding to a non-pipeline-output type is
    // rejected exactly as apply would reject it" — same ServiceError.BadRequest + "pipeline-output"
    // text DashboardApplyProposalBindingSpec asserts on for the route-level apply path.
    "reject a binding to a non-pipeline-output (source-companion) DataType, identically to apply" in {
      val dtRepo = mock(classOf[DataTypeRepository])
      when(dtRepo.findByIdOwned(companionTypeId, user)).thenReturn(Future.successful(Some(companionDataType(companionTypeId))))

      val proposal = DashboardProposal("Sales", Vector(metricPanel(companionTypeId)))
      val result   = await(newService(dtRepo).validate(proposal, user))

      result shouldBe a[Left[_, _]]
      val err = result.swap.toOption.get
      err shouldBe a[ServiceError.BadRequest]
      err.message.toLowerCase should include("pipeline-output")
    }

    "reject a blank dashboardName before any repository lookup" in {
      val dtRepo   = mock(classOf[DataTypeRepository])
      val proposal = DashboardProposal("   ", Vector.empty)

      val result = await(newService(dtRepo).validate(proposal, user))

      result shouldBe a[Left[_, _]]
      verifyNoInteractions(dtRepo)
    }

    "reject an unknown panel type before any repository lookup" in {
      val dtRepo   = mock(classOf[DataTypeRepository])
      val proposal = DashboardProposal("Sales", Vector(metricPanel(outputTypeId, `type` = "bogus")))

      val result = await(newService(dtRepo).validate(proposal, user))

      result shouldBe a[Left[_, _]]
      verifyNoInteractions(dtRepo)
    }
  }
}
