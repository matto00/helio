package com.helio.services

import com.helio.api.RequestValidation
import com.helio.api.protocols.{
  DashboardLayoutItemPayload,
  DashboardLayoutPayload,
  DashboardProposal,
  PanelAppearancePayload,
  ProposalPanel,
  UpdateDashboardRequest,
  UpdatePanelRequest
}
import com.helio.api.protocols.CreatePanelRequest
import com.helio.domain.{AuthenticatedUser, ChartAppearance, Dashboard, DashboardId, DataTypeId, Panel, PanelType}
import com.helio.domain.panels.ChartPanel
import com.helio.infrastructure.DataTypeRepository
import spray.json.{JsObject, JsString, JsValue}

import scala.concurrent.{ExecutionContext, Future}

/** Applies a reviewed dashboard proposal (HEL-225).
 *
 *  Turns a `DashboardProposal` (name + panels, no ids) into a real dashboard by
 *  composing the EXISTING services — `DashboardService.create`,
 *  `PanelService.create`, `DashboardService.update` for layout. It holds no
 *  persistence logic of its own and never touches the DB directly, so every
 *  write runs under the caller's RLS context and the V41 pipeline-only binding
 *  rule is enforced by `PanelService` exactly as for any other panel create.
 *
 *  Atomicity: all panel bindings are validated up front, so a bad proposal
 *  creates nothing. If a later panel create still fails unexpectedly, the
 *  partially-created dashboard is deleted (cascade) before returning the error.
 */
final class DashboardProposalService(
    dashboardService: DashboardService,
    panelService: PanelService,
    dataTypeRepo: DataTypeRepository
)(implicit ec: ExecutionContext) {

  import DashboardProposalService._

  def apply(
      proposal: DashboardProposal,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, (Dashboard, Vector[Panel])]] =
    validateStructure(proposal) match {
      case Left(err) => Future.successful(Left(ServiceError.BadRequest(err)))
      case Right(_) =>
        preValidateBindings(proposal.panels, user).flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right(_)  => createAll(proposal, user)
        }
    }

  /** Structural validation — no side effects; fails on the first bad panel so a
   *  malformed proposal creates nothing. */
  private def validateStructure(proposal: DashboardProposal): Either[String, Unit] =
    if (proposal.dashboardName.trim.isEmpty) Left("dashboardName is required")
    else
      proposal.panels.zipWithIndex.foldLeft[Either[String, Unit]](Right(())) {
        case (Left(e), _) => Left(e)
        case (Right(_), (panel, idx)) =>
          validatePanel(s"panel ${idx + 1} ('${panel.title}')", panel)
      }

  /** Per-panel structural checks, run before ANY creation (Decision 6): type,
   *  title, data-panel binding presence, and — for a chart panel's `chartType`
   *  or a divider panel's `orientation` — value validity. Both value checks
   *  reuse the same allow-lists the manual-edit codec/PATCH paths use, so an
   *  agent-authored proposal is validated no less strictly than a human edit,
   *  and (unlike those paths) rejects BEFORE `createAll` runs. */
  private def validatePanel(where: String, panel: ProposalPanel): Either[String, Unit] =
    for {
      _ <- PanelType.fromString(panel.`type`).left.map(msg => s"$where: $msg")
      _ <- if (panel.title.trim.isEmpty) Left(s"$where: title is required") else Right(())
      _ <- if (DataPanelKinds.contains(panel.`type`) && panel.dataTypeId.isEmpty)
             Left(s"$where: a ${panel.`type`} panel requires a dataTypeId")
           else Right(())
      _ <- if (panel.`type` == "chart")
             RequestValidation.validateChartType(panel.chartType).left.map(msg => s"$where: $msg")
           else Right(())
      _ <- if (panel.`type` == "divider")
             RequestValidation.validateDividerOrientation(panel.orientation).left.map(msg => s"$where: $msg")
           else Right(())
    } yield ()

  /** Verify every data panel's `dataTypeId` resolves to a pipeline-output
   *  DataType owned by the caller — the same rule `PanelService` enforces, run
   *  first so nothing is created when a binding is invalid. */
  private def preValidateBindings(
      panels: Vector[ProposalPanel],
      user: AuthenticatedUser
  ): Future[Either[ServiceError, Unit]] =
    panels.foldLeft[Future[Either[ServiceError, Unit]]](Future.successful(Right(()))) {
      (accF, panel) =>
        accF.flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right(_)  => panel.dataTypeId match {
            case None => Future.successful(Right(()))
            case Some(id) =>
              dataTypeRepo.findByIdOwned(DataTypeId(id), user).map {
                case None =>
                  Left(ServiceError.BadRequest(s"panel '${panel.title}': dataType $id not found"))
                case Some(dt) if dt.sourceId.isDefined =>
                  Left(ServiceError.BadRequest(
                    s"panel '${panel.title}': panels can only bind to pipeline-output data types"
                  ))
                case Some(_) => Right(())
              }
          }
        }
    }

  private def createAll(
      proposal: DashboardProposal,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, (Dashboard, Vector[Panel])]] =
    dashboardService.create(DashboardService.CreateDashboardInput(Some(proposal.dashboardName)), user).flatMap {
      dashboard =>
        createPanels(dashboard.id, proposal.panels, user, Vector.empty).flatMap {
          case Left(err) =>
            // Roll back: delete the partially-created dashboard (cascades panels).
            dashboardService.delete(dashboard.id, user).map(_ => Left(err))
          case Right(panels) =>
            applyAppearance(proposal.panels, panels, user).flatMap { panelsWithAppearance =>
              applyLayout(dashboard, proposal.panels, panelsWithAppearance, user).map(Right(_))
            }
        }
    }

  /** Create panels in proposal order, short-circuiting on the first failure. */
  private def createPanels(
      dashboardId: DashboardId,
      remaining: Vector[ProposalPanel],
      user: AuthenticatedUser,
      acc: Vector[Panel]
  ): Future[Either[ServiceError, Vector[Panel]]] =
    remaining.headOption match {
      case None => Future.successful(Right(acc))
      case Some(panel) =>
        panelService.create(buildCreateRequest(dashboardId, panel), user).flatMap {
          case Left(err)    => Future.successful(Left(err))
          case Right(panel0) => createPanels(dashboardId, remaining.tail, user, acc :+ panel0)
        }
    }

  /** Build the create-side typed `config` JSON from the proposal panel's
   *  fields. Data panels (metric/chart/table) build the bound-trio shape
   *  (`dataTypeId`/`fieldMapping`/`aggregation`), with the metric branch also
   *  threading the literal `label`/`unit` override (Decision 3 — chart/table
   *  configs have no such fields). Non-data panels build their per-type
   *  config straight from the proposal's `content`/`url`/`orientation`
   *  (Decision 1) via the EXISTING `PanelConfigCodec.decodeCreateConfig`
   *  tolerant decoders — no domain/config changes needed. */
  private def buildCreateRequest(dashboardId: DashboardId, panel: ProposalPanel): CreatePanelRequest = {
    val configOpt: Option[JsValue] = panel.dataTypeId match {
      case Some(id) => Some(buildDataConfig(id, panel))
      case None     => buildNonDataConfig(panel)
    }
    CreatePanelRequest(
      dashboardId = Some(dashboardId.value),
      title       = Some(panel.title),
      `type`      = Some(panel.`type`),
      config      = configOpt
    )
  }

  private def buildDataConfig(dataTypeId: String, panel: ProposalPanel): JsObject = {
    val baseFields = Map(
      "dataTypeId"   -> JsString(dataTypeId),
      "fieldMapping" -> panel.fieldMapping.getOrElse(JsObject.empty)
    )
    val withAggregation = panel.aggregation.fold(baseFields)(agg => baseFields + ("aggregation" -> agg))
    val withMetricLiteral =
      if (panel.`type` == MetricKind)
        withAggregation ++ panel.label.map("label" -> JsString(_)) ++ panel.unit.map("unit" -> JsString(_))
      else withAggregation
    JsObject(withMetricLiteral)
  }

  private def buildNonDataConfig(panel: ProposalPanel): Option[JsValue] =
    panel.`type` match {
      case "text" | "markdown" =>
        panel.content.map(c => JsObject("content" -> JsString(c)))
      case "image" =>
        panel.url.map(u => JsObject("imageUrl" -> JsString(u), "imageFit" -> JsString("contain")))
      case "divider" =>
        panel.orientation.map(o => JsObject("orientation" -> JsString(o)))
      case _ => None
    }

  /** Persist per-panel layout (all four breakpoints) for panels that specify
   *  one. Panels without a layout are omitted and the frontend auto-places
   *  them. Returns the updated dashboard (or the original if no layout given). */
  private def applyLayout(
      dashboard: Dashboard,
      proposalPanels: Vector[ProposalPanel],
      createdPanels: Vector[Panel],
      user: AuthenticatedUser
  ): Future[(Dashboard, Vector[Panel])] = {
    val items = proposalPanels.zip(createdPanels).flatMap { case (proposal, created) =>
      proposal.layout.map(l => DashboardLayoutItemPayload(created.id.value, l.x, l.y, l.w, l.h))
    }
    if (items.isEmpty) Future.successful((dashboard, createdPanels))
    else {
      val layout = DashboardLayoutPayload(lg = items, md = items, sm = items, xs = items)
      dashboardService
        .update(dashboard.id, UpdateDashboardRequest(None, None, Some(layout)), user)
        .map {
          case Right(updated) => (updated, createdPanels)
          case Left(_)        => (dashboard, createdPanels) // layout is best-effort; panels already exist
        }
    }
  }

  /** True when the proposal panel carries at least one chart-appearance
   *  field — the trigger for the best-effort follow-up below. */
  private def hasChartAppearanceFields(panel: ProposalPanel): Boolean =
    panel.chartType.isDefined || panel.xAxisLabel.isDefined ||
    panel.yAxisLabel.isDefined || panel.seriesColors.isDefined

  /** Overrides [[ChartAppearance.Default]] field-by-field with whatever the
   *  proposal specifies. Only called after `validateStructure` has already
   *  confirmed `chartType` (if set) is valid (Decision 6), so this performs
   *  no validation of its own. */
  private def buildChartAppearance(panel: ProposalPanel): ChartAppearance = {
    val default = ChartAppearance.Default
    default.copy(
      chartType    = panel.chartType.orElse(default.chartType),
      seriesColors = panel.seriesColors.getOrElse(default.seriesColors),
      axisLabels = default.axisLabels.copy(
        x = default.axisLabels.x.copy(label = panel.xAxisLabel.orElse(default.axisLabels.x.label)),
        y = default.axisLabels.y.copy(label = panel.yAxisLabel.orElse(default.axisLabels.y.label))
      )
    )
  }

  /** Best-effort follow-up (Decision 2): for each created chart panel whose
   *  proposal specifies at least one chart-appearance field, PATCH the
   *  panel's appearance via the existing `PanelService.update`. Mirrors
   *  `applyLayout`'s swallow-on-failure contract — the panel already exists,
   *  so a failure here just leaves it with the default appearance rather than
   *  rejecting the whole proposal. Performs NO validation: by the time this
   *  runs, `chartType` has already been checked in `validateStructure`. */
  private def applyAppearance(
      proposalPanels: Vector[ProposalPanel],
      createdPanels: Vector[Panel],
      user: AuthenticatedUser
  ): Future[Vector[Panel]] =
    proposalPanels.zip(createdPanels).foldLeft(Future.successful(Vector.empty[Panel])) {
      case (accF, (proposal, created)) =>
        accF.flatMap { acc =>
          if (created.kind == ChartPanel.Kind && hasChartAppearanceFields(proposal)) {
            val appearance = buildChartAppearance(proposal)
            val request = UpdatePanelRequest(
              title      = None,
              appearance = Some(PanelAppearancePayload(None, None, None, Some(appearance))),
              `type`     = None,
              config     = None
            )
            panelService.update(created.id, request, user).map {
              case Right(updated) => acc :+ updated
              case Left(_)        => acc :+ created // appearance is cosmetic; panel already exists
            }
          } else Future.successful(acc :+ created)
        }
    }
}

object DashboardProposalService {
  private val DataPanelKinds: Set[String] = Set("metric", "chart", "table")
  private val MetricKind: String          = "metric"
}
