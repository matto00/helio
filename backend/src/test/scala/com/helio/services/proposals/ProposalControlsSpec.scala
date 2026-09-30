package com.helio.services.proposals

import com.helio.api.protocols.proposals.{DashboardProposal, ProposalControl, ProposalPanel}
import com.helio.domain.engine.SchemaField
import com.helio.domain.model._
import com.helio.infrastructure.persistence.pipelines.OutputRepository
import com.helio.services.ServiceError
import com.helio.services.panels.OutputControlsValidator
import org.mockito.Mockito.{mock, when}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json.{JsArray, JsObject, JsString}

import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1193: proposal-declared output-panel controls. Eligibility must come from the SAME
 *  `OutputControlsValidator` the panel write path uses, so the assertions pin the validator's own
 *  message rather than a proposal-specific one. dropdown eligibility (which needs snapshot rows)
 *  is deliberately not exercised here: a null snapshot repo degrades it, and it is covered by
 *  OutputControlsValidator's own specs. */
class ProposalControlsSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global
  private def await[T](f: Future[T]): T     = Await.result(f, 5.seconds)

  private val now      = Instant.parse("2026-01-01T00:00:00Z")
  private val user     = AuthenticatedUser(UserId(UUID.randomUUID().toString))
  private val outputId = OutputId(UUID.randomUUID().toString)

  private val output = Output(
    outputId, "Orders", user.id, NodeRef(PipelineId(UUID.randomUUID().toString), None), OutputKind.Table, now, now,
    schema = Vector(SchemaField("created_at", "timestamp"), SchemaField("region", "string"))
  )

  private val outputRepo = {
    val repo = mock(classOf[OutputRepository])
    when(repo.findByIdOwned(outputId, user)).thenReturn(Future.successful(Some(output)))
    repo
  }
  private val validator = new OutputControlsValidator(outputRepo, null)
  private val service   = new DashboardProposalService(null, null, outputRepo, validator)

  private def panel(
      controls: Option[Vector[ProposalControl]] = None,
      config: Option[JsObject] = None,
      `type`: String = "output",
      bound: String = outputId.value
  ): ProposalPanel =
    ProposalPanel("Orders", `type`, Some(bound), None, None, None, None, None, None, None, None, None, None, None, None, None, config, controls)

  private def control(kind: String, column: String, id: Option[String] = None) =
    ProposalControl(id, kind, column, None, None)

  private def validate(p: ProposalPanel) = await(service.validate(DashboardProposal("D", Vector(p)), user))

  "DashboardProposalService.validate with controls" should {

    "accept an eligible date-range control" in {
      validate(panel(Some(Vector(control("date-range", "created_at"))))) shouldBe Right(())
    }

    "reject an ineligible control with the panel write path's own message" in {
      val err = validate(panel(Some(Vector(control("date-range", "region"))))).swap.toOption.get
      err shouldBe a[ServiceError.BadRequest]
      err.message shouldBe "panel 'Orders': control not eligible: column 'region', kind 'date-range'"
    }

    "reject an ineligible control smuggled through config.controls the same way" in {
      val raw = JsObject("controls" -> JsArray(JsObject(
        "id" -> JsString("c1"), "kind" -> JsString("date-range"), "column" -> JsString("region"), "label" -> JsString("R")
      )))
      val err = validate(panel(config = Some(raw))).swap.toOption.get
      err.message should endWith("control not eligible: column 'region', kind 'date-range'")
    }

    "reject controls on a non-output panel" in {
      val err = validate(panel(Some(Vector(control("text", "region"))), `type` = "text")).swap.toOption.get
      err.message should include("controls are only supported on an output panel")
    }

    "reject supplying both controls and config.controls" in {
      val err = validate(panel(Some(Vector(control("text", "region"))), Some(JsObject("controls" -> JsArray())))).swap.toOption.get
      err.message should include("either controls or config.controls, not both")
    }

    "skip the sentinel-bound panels of a combined proposal (validated at apply instead)" in {
      val sentinel = CombinedProposalService.OutputRefSentinel
      val bad      = panel(Some(Vector(control("date-range", "region"))), bound = sentinel)
      await(service.validateControlsExcludingSentinel(Vector(bad), sentinel, user)) shouldBe Right(())
    }

    "check the real-output-bound panels of a combined proposal at propose time" in {
      val bad = panel(Some(Vector(control("date-range", "region"))))
      await(service.validateControlsExcludingSentinel(Vector(bad), CombinedProposalService.OutputRefSentinel, user)) shouldBe a[Left[_, _]]
    }
  }

  "ProposalPanelSupport.buildCreateRequest" should {

    "map controls into config.controls, minting a missing id and defaulting label to the column" in {
      val req      = ProposalPanelSupport.buildCreateRequest(DashboardId("d"), panel(Some(Vector(control("date-range", "created_at")))))
      val cfg      = req.config.get.asJsObject
      val controls = cfg.fields("controls").asInstanceOf[JsArray].elements.map(_.asJsObject)
      controls should have size 1
      controls.head.fields("kind") shouldBe JsString("date-range")
      controls.head.fields("label") shouldBe JsString("created_at")
      UUID.fromString(controls.head.fields("id").asInstanceOf[JsString].value) should not be null
      cfg.fields("outputId") shouldBe JsString(outputId.value)
    }

    "keep a supplied control id" in {
      val req = ProposalPanelSupport.buildCreateRequest(DashboardId("d"), panel(Some(Vector(control("text", "region", Some("mine"))))))
      req.config.get.asJsObject.fields("controls").asInstanceOf[JsArray].elements.head.asJsObject.fields("id") shouldBe JsString("mine")
    }
  }
}
