package com.helio.services.panels

import com.helio.api.protocols.panels.{CreatePanelRequest, UpdatePanelRequest}
import com.helio.domain.engine.SchemaField
import com.helio.domain.model._
import com.helio.domain.panels.{OutputControlSpec, OutputPanel, OutputPanelConfig}
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.OutputRepository
import com.helio.services.ServiceError
import com.helio.services.auth.AccessChecker
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.{mock, when}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

/** HEL-1189 tasks.md 2.1/4.2 — `PanelService.rejectInvalidControls` (design.md D4) coverage:
 *  the defined 400 naming column+kind for a new/changed invalid entry, a successful add, and the
 *  AC's "an untouched, already-orphaned control does not block an unrelated save" non-blocking
 *  guarantee (design.md D4/D5). Mocked-repository style, mirroring `PanelServiceDefaultLayoutSpec` —
 *  every scenario here exercises only the text/numeric-range/date-range kinds (purely schema/type
 *  driven, per design.md D3), so `nodeSnapshotRepo` is never needed (left `null`, matching this
 *  file's nullable-optional convention) — the `dropdown` kind's cardinality-gated eq/in check is
 *  covered instead by `OutputControlEligibilitySpec`'s pure-function coverage. */
class PanelServiceOutputControlsSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global
  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  private val now         = Instant.parse("2026-01-01T00:00:00Z")
  private val ownerId     = UserId(UUID.randomUUID().toString)
  private val user        = AuthenticatedUser(ownerId)
  private val dashboardId = DashboardId(UUID.randomUUID().toString)

  private val stubAccess: AccessChecker = new AccessChecker {
    def requireOwnerOnly(rt: String, rid: String, u: AuthenticatedUser, msg: String) =
      Future.successful(Right(ResourceAccess.Owner))
    def requireAccess(rt: String, rid: String, uOpt: Option[AuthenticatedUser], msg: String) =
      Future.successful(Right(ResourceAccess.Owner))
  }

  // A timestamp column (date-range-eligible) and a string column (never date-range-eligible,
  // per design.md D3's type gate) — enough to exercise both the reject and accept paths without
  // needing the cardinality-gated dropdown kind.
  private def outputWith(schema: Vector[SchemaField]): Output =
    Output(
      id        = OutputId(UUID.randomUUID().toString),
      name      = "Out",
      ownerId   = ownerId,
      node      = NodeRef(PipelineId(UUID.randomUUID().toString), None),
      kind      = OutputKind.Table,
      createdAt = now,
      updatedAt = now,
      schema    = schema
    )

  private def dateControl(id: String, column: String): OutputControlSpec =
    OutputControlSpec(id, "date-range", column, "Date")

  private def emptyDashboard(): Dashboard =
    Dashboard(
      id         = dashboardId,
      name       = "Dash",
      meta       = ResourceMeta(ownerId.value, now, now),
      appearance = DashboardAppearance.Default,
      layout     = DashboardLayout(lg = Vector.empty, md = Vector.empty, sm = Vector.empty, xs = Vector.empty),
      ownerId    = ownerId
    )

  // `PanelService.create` always places the panel (HEL-909, HEL-1260) — the `insertPlaced` stub here
  // exists only to let that unrelated side effect complete without an NPE; no test in this file
  // asserts on the placed layout itself.
  private def buildService(output: Output, existingPanel: Option[OutputPanel] = None): PanelService = {
    val panelRepo     = mock(classOf[PanelRepository])
    val dashboardRepo = mock(classOf[DashboardRepository])
    val outputRepo    = mock(classOf[OutputRepository])

    when(panelRepo.insertPlaced(any(), any())).thenAnswer { inv =>
      val panel = inv.getArgument[Panel](0)
      Future.successful(Option(CreatePlacement.append(emptyDashboard().layout, Vector(panel.id -> inv.getArgument[PlacementSizes](1)))._2.head))
    }
    when(outputRepo.findByIdOwned(output.id, user)).thenReturn(Future.successful(Some(output)))
    when(outputRepo.findByIdInternal(output.id)).thenReturn(Future.successful(Some(output)))
    existingPanel.foreach { p =>
      when(panelRepo.findByIdInternal(p.id)).thenReturn(Future.successful(Some(p)))
      when(panelRepo.findById(p.id, Some(user))).thenReturn(Future.successful(Some(p)))
      when(panelRepo.replace(any(), any())).thenAnswer { inv =>
        Future.successful(Some(inv.getArgument[Panel](0)))
      }
    }

    new PanelService(panelRepo, stubAccess, dashboardRepo, auditService = null, outputRepo = outputRepo)
  }

  "PanelService.create with controls (design.md D4)" should {
    "rejects a control bound to a column the contract doesn't allow, naming the column and kind" in {
      val output  = outputWith(Vector(SchemaField("name", "string")))
      val service = buildService(output)
      val request = CreatePanelRequest(
        dashboardId = Some(dashboardId.value),
        title       = None,
        `type`      = Some("output"),
        config      = Some(JsObject(
          "outputId" -> JsString(output.id.value),
          "controls" -> JsArray(dateControl("c1", "name").toJson) // "name" is a string column, never date-range-eligible
        ))
      )

      val result = await(service.create(request, user))

      result.isLeft shouldBe true
      val err = result.swap.toOption.get
      err shouldBe a[ServiceError.BadRequest]
      err.message should include("name")
      err.message should include("date-range")
    }

    "accepts a control bound to an eligible column" in {
      val output  = outputWith(Vector(SchemaField("created_at", "timestamp")))
      val service = buildService(output)
      val request = CreatePanelRequest(
        dashboardId = Some(dashboardId.value),
        title       = None,
        `type`      = Some("output"),
        config      = Some(JsObject(
          "outputId" -> JsString(output.id.value),
          "controls" -> JsArray(dateControl("c1", "created_at").toJson)
        ))
      )

      val result = await(service.create(request, user))

      result.isRight shouldBe true
      val (panel, _) = result.toOption.get
      panel.asInstanceOf[OutputPanel].config.controls shouldBe Vector(dateControl("c1", "created_at"))
    }
  }

  "PanelService.update with controls (design.md D4/D5)" should {
    "rejects rebinding an existing control to a column the contract doesn't allow" in {
      val output = outputWith(Vector(SchemaField("created_at", "timestamp"), SchemaField("name", "string")))
      val existing = OutputPanel(
        PanelId(UUID.randomUUID().toString), dashboardId, "t",
        ResourceMeta(ownerId.value, now, now), PanelAppearance.Default, ownerId,
        OutputPanelConfig(output.id, Vector(dateControl("c1", "created_at")))
      )
      val service = buildService(output, Some(existing))

      val request = UpdatePanelRequest(
        title = None, appearance = None, `type` = None,
        config = Some(JsObject("controls" -> JsArray(dateControl("c1", "name").toJson))) // rebound to an ineligible column
      )

      val result = await(service.update(existing.id, request, user))

      result.isLeft shouldBe true
      val err = result.swap.toOption.get
      err shouldBe a[ServiceError.BadRequest]
      err.message should include("name")
      err.message should include("date-range")
    }

    "accepts adding a new eligible control alongside an existing one" in {
      val output = outputWith(Vector(SchemaField("created_at", "timestamp"), SchemaField("updated_at", "timestamp")))
      val existing = OutputPanel(
        PanelId(UUID.randomUUID().toString), dashboardId, "t",
        ResourceMeta(ownerId.value, now, now), PanelAppearance.Default, ownerId,
        OutputPanelConfig(output.id, Vector(dateControl("c1", "created_at")))
      )
      val service = buildService(output, Some(existing))

      val newControl = dateControl("c2", "updated_at")
      val request = UpdatePanelRequest(
        title = None, appearance = None, `type` = None,
        config = Some(JsObject("controls" -> JsArray(dateControl("c1", "created_at").toJson, newControl.toJson)))
      )

      val result = await(service.update(existing.id, request, user))

      result.isRight shouldBe true
      result.toOption.get.asInstanceOf[OutputPanel].config.controls should contain(newControl)
    }

    // AC: "An untouched, already-orphaned control does not block an unrelated save."
    "an untouched, already-orphaned control (id/column/kind unchanged) does not block an unrelated save" in {
      // The Output's schema drifted: "created_at" is now a string column, no longer date-range-eligible.
      val output = outputWith(Vector(SchemaField("created_at", "string"), SchemaField("name", "string")))
      val drifted = dateControl("c1", "created_at")
      val textControl = OutputControlSpec("c2", "text", "name", "Name")
      val existing = OutputPanel(
        PanelId(UUID.randomUUID().toString), dashboardId, "t",
        ResourceMeta(ownerId.value, now, now), PanelAppearance.Default, ownerId,
        OutputPanelConfig(output.id, Vector(drifted, textControl))
      )
      val service = buildService(output, Some(existing))

      // The PATCH resubmits the SAME drifted control (id/column/kind unchanged) alongside an
      // edit to a DIFFERENT control's label — per D4 the drifted entry must not be re-validated.
      val editedText = textControl.copy(label = "Renamed")
      val request = UpdatePanelRequest(
        title = None, appearance = None, `type` = None,
        config = Some(JsObject("controls" -> JsArray(drifted.toJson, editedText.toJson)))
      )

      val result = await(service.update(existing.id, request, user))

      result.isRight shouldBe true
      result.toOption.get.asInstanceOf[OutputPanel].config.controls shouldBe Vector(drifted, editedText)
    }
  }
}
