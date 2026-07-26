package com.helio.services

import com.helio.api.RequestValidation
import com.helio.api.protocols.{CreatePanelRequest, ProposalPanel}
import com.helio.domain.{AuthenticatedUser, DashboardId, DataTypeId, PanelType}
import com.helio.domain.panels.ChartPanel
import com.helio.infrastructure.DataTypeRepository
import spray.json.{JsObject, JsString, JsValue}

import scala.concurrent.{ExecutionContext, Future}

/** Panel validation + create-request construction shared by every write path
 *  that turns a [[ProposalPanel]] into a real panel (HEL-363).
 *
 *  Extracted from [[DashboardProposalService]] as a behavior-preserving
 *  refactor — `DashboardProposalService` now calls through to these exact
 *  same methods (verified against its own pre-existing test suite), and
 *  `DashboardContentsService`'s atomic replace-contents path (HEL-363) reuses
 *  them identically instead of duplicating the logic. Reads
 *  [[DashboardProposalService]]'s `DataPanelKinds`/`MetricKind`/`TimelineKind`
 *  constants (package-private) rather than redefining them, so the two
 *  callers can never silently drift apart on which panel types are
 *  data-bound. */
object ProposalPanelSupport {

  /** Per-panel structural checks, run before ANY creation: type, title,
   *  data-panel binding presence, and — for a chart panel's `chartType`, a
   *  divider panel's `orientation`, or a timeline panel's `sort` — value
   *  validity. */
  def validatePanel(where: String, panel: ProposalPanel): Either[String, Unit] =
    for {
      _ <- PanelType.fromString(panel.`type`).left.map(msg => s"$where: $msg")
      _ <- if (panel.title.trim.isEmpty) Left(s"$where: title is required") else Right(())
      _ <- if (DashboardProposalService.DataPanelKinds.contains(panel.`type`) && panel.dataTypeId.isEmpty)
             Left(s"$where: a ${panel.`type`} panel requires a dataTypeId")
           else Right(())
      _ <- if (panel.`type` == "chart")
             RequestValidation.validateChartType(panel.chartType).left.map(msg => s"$where: $msg")
           else Right(())
      _ <- if (panel.`type` == "divider")
             RequestValidation.validateDividerOrientation(panel.orientation).left.map(msg => s"$where: $msg")
           else Right(())
      _ <- if (panel.`type` == DashboardProposalService.TimelineKind)
             RequestValidation.validateTimelineSort(panel.sort).left.map(msg => s"$where: $msg")
           else Right(())
      _ <- if (panel.`type` == "chart")
             ChartPanel.rejectsAggregation(panel.chartType, mergedAggregationPresent(panel))
               .toLeft(()).left.map(msg => s"$where: $msg")
           else Right(())
    } yield ()

  /** Whether the panel's ACTUALLY-RESOLVED create-side config (the same JSON
   *  `ChartPanelConfig.decodeCreate` will read) carries an `aggregation` key
   *  — not `panel.aggregation` directly, which the generic HEL-316 `config`
   *  passthrough can bypass (a proposal can supply `aggregation` via
   *  `config: {"aggregation": {...}}` instead of the flat field, and the
   *  decoder reads either identically). `buildCreateRequest` is pure and
   *  side-effect-free; the `dashboardId` it takes has no bearing on the
   *  resolved `config` (it only sets `CreatePanelRequest.dashboardId`), so a
   *  placeholder is safe to pass here, before any real dashboard exists. */
  private def mergedAggregationPresent(panel: ProposalPanel): Boolean =
    buildCreateRequest(DashboardId(""), panel).config match {
      case Some(JsObject(fields)) => fields.get("aggregation").exists(_.isInstanceOf[JsObject])
      case _                      => false
    }

  /** Verify every panel's actual binding target — the flat `dataTypeId` for
   *  `DataPanelKinds`, OR (HEL-316) a non-`DataPanelKinds` panel's
   *  `config.dataTypeId` — resolves to a pipeline-output DataType owned by
   *  the caller. Runs BEFORE any write (zero DB writes here — these are
   *  reads only), so a bad binding never reaches the caller's transactional
   *  write. */
  def preValidateBindings(
      panels: Vector[ProposalPanel],
      user: AuthenticatedUser,
      dataTypeRepo: DataTypeRepository
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, Unit]] =
    panels.foldLeft[Future[Either[ServiceError, Unit]]](Future.successful(Right(()))) {
      (accF, panel) =>
        accF.flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right(_) => bindingCandidate(panel) match {
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

  /** The dataTypeId that will ACTUALLY end up bound on the created panel, for
   *  pre-validation purposes: the flat field when present; otherwise, for a
   *  panel type OUTSIDE `DataPanelKinds` only, a `config.dataTypeId`. */
  private def bindingCandidate(panel: ProposalPanel): Option[String] =
    panel.dataTypeId.orElse(nonFlatConfigDataTypeId(panel))

  private def nonFlatConfigDataTypeId(panel: ProposalPanel): Option[String] =
    if (DashboardProposalService.DataPanelKinds.contains(panel.`type`)) None
    else
      panel.config.flatMap(_.fields.get("dataTypeId")).collect {
        case JsString(s) if s.nonEmpty => s
      }

  /** Build the create-side typed `config` JSON from the proposal panel's
   *  fields and merge the generic `config` passthrough over it (HEL-316) —
   *  see `DashboardProposalService`'s original scaladoc (pre-extraction) for
   *  the full field-by-field rationale, preserved verbatim below. */
  def buildCreateRequest(dashboardId: DashboardId, panel: ProposalPanel): CreatePanelRequest = {
    val derived: Option[JsObject] = panel.dataTypeId match {
      case Some(id) => Some(buildDataConfig(id, panel))
      case None     => buildNonDataConfig(panel).map(_.asJsObject)
    }
    val configOpt: Option[JsValue] = mergeConfig(derived, panel.config, panel.dataTypeId)
    CreatePanelRequest(
      dashboardId = Some(dashboardId.value),
      title       = Some(panel.title),
      `type`      = Some(panel.`type`),
      config      = configOpt
    )
  }

  /** Merge the passthrough `config` over the derived flat-field config: on
   *  key conflict the explicit `config` wins — EXCEPT a `DataPanelKinds`
   *  panel's flat `dataTypeId` is re-applied after the merge so it remains
   *  authoritative no matter what `config` supplies. */
  private def mergeConfig(
      derived: Option[JsObject],
      passthrough: Option[JsObject],
      dataTypeId: Option[String]
  ): Option[JsObject] = {
    val merged = (derived, passthrough) match {
      case (Some(d), Some(c)) => Some(JsObject(d.fields ++ c.fields))
      case (Some(d), None)    => Some(d)
      case (None, Some(c))    => Some(c)
      case (None, None)       => None
    }
    dataTypeId match {
      case Some(id) => merged.map(m => JsObject(m.fields + ("dataTypeId" -> JsString(id))))
      case None     => merged
    }
  }

  private def buildDataConfig(dataTypeId: String, panel: ProposalPanel): JsObject = {
    val baseFields = Map(
      "dataTypeId"   -> JsString(dataTypeId),
      "fieldMapping" -> panel.fieldMapping.getOrElse(JsObject.empty)
    )
    val withAggregation = panel.aggregation.fold(baseFields)(agg => baseFields + ("aggregation" -> agg))
    val withMetricLiteral =
      if (panel.`type` == DashboardProposalService.MetricKind)
        withAggregation ++ panel.label.map("label" -> JsString(_)) ++ panel.unit.map("unit" -> JsString(_))
      else withAggregation
    // HEL-321: fold the flat timeline `sort` into a NESTED `timelineOptions`
    // object — `TimelinePanelConfig.decodeCreate` reads `sort` only from
    // there, never a flat top-level key. An explicit `config.timelineOptions`
    // still wins via `mergeConfig`.
    val withTimelineSort =
      if (panel.`type` == DashboardProposalService.TimelineKind)
        withMetricLiteral ++ panel.sort.map(s =>
          "timelineOptions" -> JsObject("sort" -> JsString(s))
        )
      else withMetricLiteral
    JsObject(withTimelineSort)
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
}
