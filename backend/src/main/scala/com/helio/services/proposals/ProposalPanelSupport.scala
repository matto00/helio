package com.helio.services.proposals

import com.helio.services.ServiceError
import com.helio.api.http.RequestValidation
import com.helio.api.protocols.panels.CreatePanelRequest
import com.helio.api.protocols.proposals.ProposalPanel
import com.helio.domain.model.{AuthenticatedUser, DashboardId, OutputId, PanelType}
import com.helio.infrastructure.persistence.pipelines.OutputRepository
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
      _ <- if (panel.`type` == "divider")
             RequestValidation.validateDividerOrientation(panel.orientation).left.map(msg => s"$where: $msg")
           else Right(())
      // HEL-904 task 3.10a: the "chart"/timeline/metric kind-valued predicates
      // that used to gate chartType/aggregation/timeline-sort validation here
      // are deleted outright, along with the code paths they guarded — those
      // panel kinds (and `ChartPanel.rejectsAggregation`) no longer exist.
    } yield ()

  /** Verify every panel's actual binding target — the flat `dataTypeId` for
   *  `DataPanelKinds`, OR (HEL-316) a non-`DataPanelKinds` panel's
   *  `config.dataTypeId` — resolves to a pipeline-output DataType owned by
   *  the caller, THEN (HEL-549) that a panel carrying a `metricId` resolves
   *  to a caller-owned, non-deprecated metric on a panel type that supports
   *  it. Runs BEFORE any write (zero DB writes here — these are reads
   *  only), so a bad binding never reaches the caller's transactional
   *  write. */
  def preValidateBindings(
      panels: Vector[ProposalPanel],
      user: AuthenticatedUser,
      outputRepo: OutputRepository = null
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, Unit]] =
    panels.foldLeft[Future[Either[ServiceError, Unit]]](Future.successful(Right(()))) {
      (accF, panel) =>
        accF.flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right(_)  => validateDataTypeBinding(panel, user, outputRepo)
        }
    }

  /** HEL-904 task 3.8/3.9: an `"output"`-kind panel's binding candidate is a
   *  real Output id, validated against [[OutputRepository.findByIdOwned]].
   *  Task 4.1: the non-`"output"` (Text/Markdown) branch, which used to
   *  validate against the now-deleted `DataTypeRepository`, is removed
   *  outright — `TextPanelConfig`/`MarkdownPanelConfig` no longer carry a
   *  `dataTypeId` at all (the V94 migration converted every data-bound
   *  text/markdown panel into a `markdown`-kind Output + `OutputPanel`
   *  placement, design.md line 76/103), so a non-output panel's
   *  `panel.dataTypeId` is never a real binding to validate. `outputRepo`
   *  is nullable, mirroring this file's other legacy-optional constructor
   *  params — a caller that never wires it (many test doubles, and any call
   *  site that doesn't yet construct output-kind panels) gets
   *  existence-check skipped rather than an NPE. */
  private def validateDataTypeBinding(
      panel: ProposalPanel,
      user: AuthenticatedUser,
      outputRepo: OutputRepository
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, Unit]] =
    bindingCandidate(panel) match {
      case None => Future.successful(Right(()))
      case Some(_) if panel.`type` == "output" && outputRepo == null =>
        Future.successful(Right(()))
      case Some(id) if panel.`type` == "output" =>
        outputRepo.findByIdOwned(OutputId(id), user).map {
          case None    => Left(ServiceError.BadRequest(s"panel '${panel.title}': output $id not found"))
          case Some(_) => Right(())
        }
      case Some(_) => Future.successful(Right(()))
    }

  // HEL-904 task 3.9: `validateMetricBinding` (HEL-549) removed outright —
  // metrics no longer exist.

  /** The dataTypeId that will ACTUALLY end up bound on the created panel, for
   *  pre-validation purposes: the flat field. HEL-904 task 4.1: the
   *  non-`DataPanelKinds` (Text/Markdown) `config.dataTypeId` fallback is
   *  removed outright — those kinds' data-bound "Source mode" no longer
   *  exists, so a `config.dataTypeId` on a text/markdown proposal panel is
   *  inert (silently ignored by `TextPanelConfig.decodeCreate`/
   *  `MarkdownPanelConfig.decodeCreate`), never a real binding to validate. */
  private def bindingCandidate(panel: ProposalPanel): Option[String] =
    panel.dataTypeId

  /** Build the create-side typed `config` JSON from the proposal panel's
   *  fields and merge the generic `config` passthrough over it (HEL-316) —
   *  see `DashboardProposalService`'s original scaladoc (pre-extraction) for
   *  the full field-by-field rationale, preserved verbatim below. */
  def buildCreateRequest(dashboardId: DashboardId, panel: ProposalPanel): CreatePanelRequest = {
    val derived: Option[JsObject] = panel.dataTypeId match {
      case Some(id) => Some(buildDataConfig(id, panel))
      case None     => buildNonDataConfig(panel).map(_.asJsObject)
    }
    val bindingKey = if (panel.`type` == "output") "outputId" else "dataTypeId"
    val configOpt: Option[JsValue] = mergeConfig(derived, panel.config, panel.dataTypeId, bindingKey)
    CreatePanelRequest(
      dashboardId = Some(dashboardId.value),
      title       = Some(panel.title),
      `type`      = Some(panel.`type`),
      config      = configOpt
    )
  }

  /** Merge the passthrough `config` over the derived flat-field config: on
   *  key conflict the explicit `config` wins — EXCEPT the panel's flat
   *  `dataTypeId` (an Output id for an `"output"`-kind panel — HEL-904 task
   *  3.8/3.9) is re-applied, under `bindingKey`, after the merge so it
   *  remains authoritative no matter what `config` supplies. */
  private def mergeConfig(
      derived: Option[JsObject],
      passthrough: Option[JsObject],
      dataTypeId: Option[String],
      bindingKey: String
  ): Option[JsObject] = {
    val merged = (derived, passthrough) match {
      case (Some(d), Some(c)) => Some(JsObject(d.fields ++ c.fields))
      case (Some(d), None)    => Some(d)
      case (None, Some(c))    => Some(c)
      case (None, None)       => None
    }
    dataTypeId match {
      case Some(id) => merged.map(m => JsObject(m.fields + (bindingKey -> JsString(id))))
      case None     => merged
    }
  }

  // HEL-904 task 3.10: the Metric/Timeline literal-folding branches
  // (label/unit/aggregation/timelineOptions) were removed along with the
  // bound panel kinds they targeted. Only `dataTypeId`/`fieldMapping` remain
  // — still meaningful for Text/Markdown's own binding (design.md: TextPanel
  // carries `dataTypeId`/`fieldMapping` exactly like MarkdownPanel).
  //
  // HEL-904 task 3.8/3.9: an `"output"`-kind proposal panel's flat
  // `dataTypeId` field NAME is unchanged (still `dataTypeId` on the wire —
  // `ProposalPanel`/schema stability, same reasoning as `DataPanelKinds`),
  // but its VALUE is now a real Output id (populated by
  // `PipelineProposalService.apply`'s Output creation, or by
  // `CombinedProposalService.resolveOutputRefs`'s `"$pipelineOutput"`
  // sentinel substitution). `OutputPanelConfig.decodeCreate` requires
  // `outputId`, not `dataTypeId`/`fieldMapping`, so an output-kind panel's
  // config must carry that key instead.
  private def buildDataConfig(dataTypeId: String, panel: ProposalPanel): JsObject =
    if (panel.`type` == "output")
      JsObject(Map("outputId" -> JsString(dataTypeId)))
    else
      JsObject(Map(
        "dataTypeId"   -> JsString(dataTypeId),
        "fieldMapping" -> panel.fieldMapping.getOrElse(JsObject.empty)
      ))

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
