package com.helio.services.proposals


import com.helio.services.ServiceError
import com.helio.services.proposals.DashboardProposalService
import com.helio.api.protocols.proposals.{DashboardProposal, ProposalPanel}
import com.helio.domain.model._
import com.helio.infrastructure.persistence.pipelines.OutputRepository
import org.mockito.Mockito.{mock, when}
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
 *  Mocked repo only (`OutputRepository` is a plain, non-final class -- mockable, mirroring
 *  `PanelServiceMetricBindingSpec`'s precedent) — no embedded-Postgres harness, per the ticket
 *  brief. HEL-904 task 4.1: `DataTypeRepository`/`MetricRepository` removed outright -- DataTypes/
 *  metrics no longer exist, and `DashboardProposalService`'s constructor no longer takes either.
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

  private val outputTypeId    = UUID.randomUUID().toString
  private val companionTypeId = UUID.randomUUID().toString

  // HEL-904 task 3.8/3.9: an "output"-kind panel's binding now validates
  // against a real Output, not a DataType.
  private def realOutput(id: OutputId): Output =
    Output(id, "Output", ownerId, NodeRef(PipelineId(UUID.randomUUID().toString), None), OutputKind.Table, now, now)

  private def newService(outputRepo: OutputRepository = mock(classOf[OutputRepository])): DashboardProposalService =
    new DashboardProposalService(null, null, outputRepo)

  private def metricPanel(outputId: String, `type`: String = "output"): ProposalPanel =
    ProposalPanel(
      title        = "Total",
      `type`       = `type`,
      outputId   = Some(outputId),
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
      val outputRepo = mock(classOf[OutputRepository])
      when(outputRepo.findByIdOwned(OutputId(outputTypeId), user)).thenReturn(Future.successful(Some(realOutput(OutputId(outputTypeId)))))

      val proposal = DashboardProposal("Sales", Vector(metricPanel(outputTypeId)))
      val result   = await(newService(outputRepo).validate(proposal, user))

      result shouldBe Right(())
    }

    // The exact AC this locks in: "an NL proposal binding to a non-existent Output is rejected
    // exactly as apply would reject it" — HEL-904 task 3.8/3.9: an "output"-kind panel's binding
    // is now checked against OutputRepository, not DataTypeRepository — there is no "companion"
    // concept for Outputs (that distinction was DataType-only), so the rejection is an ordinary
    // not-found.
    "reject a binding to a nonexistent Output, identically to apply" in {
      val outputRepo = mock(classOf[OutputRepository])
      when(outputRepo.findByIdOwned(OutputId(companionTypeId), user)).thenReturn(Future.successful(None))

      val proposal = DashboardProposal("Sales", Vector(metricPanel(companionTypeId)))
      val result   = await(newService(outputRepo).validate(proposal, user))

      result shouldBe a[Left[_, _]]
      val err = result.swap.toOption.get
      err shouldBe a[ServiceError.BadRequest]
      err.message.toLowerCase should include("not found")
    }

    "reject a blank dashboardName before any repository lookup" in {
      val proposal = DashboardProposal("   ", Vector.empty)

      val result = await(newService().validate(proposal, user))

      result shouldBe a[Left[_, _]]
    }

    "reject an unknown panel type before any repository lookup" in {
      val proposal = DashboardProposal("Sales", Vector(metricPanel(outputTypeId, `type` = "bogus")))

      val result = await(newService().validate(proposal, user))

      result shouldBe a[Left[_, _]]
    }
  }
}
