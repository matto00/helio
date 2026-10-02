package com.helio.services.proposals

import com.helio.services.ServiceError
import com.helio.api.http.RequestValidation
import com.helio.api.protocols.panels.CreatePanelRequest
import com.helio.api.protocols.proposals.ProposalPanel
import com.helio.domain.model.{AuthenticatedUser, DashboardId, OutputId, PanelType}
import com.helio.domain.panels.OutputControlSpec
import com.helio.infrastructure.persistence.pipelines.OutputRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.services.panels.{FormBindingValidator, OutputControlsValidator}
import spray.json.{JsArray, JsObject, JsString, JsValue}

import java.util.UUID
import scala.util.Try

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
      _ <- if (DashboardProposalService.DataPanelKinds.contains(panel.`type`) && panel.outputId.isEmpty)
             Left(s"$where: an ${panel.`type`} panel requires an outputId")
           else Right(())
      _ <- validateSourceBinding(where, panel)
      _ <- validateControlsShape(where, panel)
      _ <- if (panel.`type` == "divider")
             RequestValidation.validateDividerOrientation(panel.orientation).left.map(msg => s"$where: $msg")
           else Right(())
      // HEL-904 task 3.10a: the "chart"/timeline/metric kind-valued predicates
      // that used to gate chartType/aggregation/timeline-sort validation here
      // are deleted outright, along with the code paths they guarded — those
      // panel kinds (and `ChartPanel.rejectsAggregation`) no longer exist.
    } yield ()

  /** HEL-1148: the source-binding shape rules, structural and read-free. A source-bound kind
   *  (`SourceBoundKinds`, today `form`) needs the FLAT `dataSourceId` (a `config.dataSourceId`
   *  passthrough is deliberately not a binding: one source of truth), may not also carry an
   *  `outputId`, and no other kind may carry a `dataSourceId` at all (silently ignoring it would be
   *  the exact unbound-panel failure this change exists to prevent). Existence/ownership/dataset
   *  kind are the DB-backed `preValidateSourceBindings` below. */
  private def validateSourceBinding(where: String, panel: ProposalPanel): Either[String, Unit] = {
    val sourceBound = DashboardProposalService.SourceBoundKinds.contains(panel.`type`)
    if (sourceBound && panel.dataSourceId.forall(_.trim.isEmpty))
      Left(s"$where: a ${panel.`type`} panel requires a dataSourceId (the id of a dataset source; config.dataSourceId is not a binding)")
    else if (sourceBound && panel.outputId.isDefined)
      Left(s"$where: a ${panel.`type`} panel binds a dataSourceId, not an outputId")
    else if (!sourceBound && panel.dataSourceId.isDefined)
      Left(s"$where: dataSourceId is only supported on a ${DashboardProposalService.SourceBoundKinds.toSeq.sorted.mkString("/")} panel")
    else Right(())
  }

  /** HEL-1193: `controls` is an output-panel-only first-class field, and supplying it alongside
   *  `config.controls` would leave two competing sources for the same list — both rejected here,
   *  structurally, before any read or write. Eligibility itself is never decided here. */
  private def validateControlsShape(where: String, panel: ProposalPanel): Either[String, Unit] =
    if (panel.controls.exists(_.nonEmpty) && panel.`type` != "output")
      Left(s"$where: controls are only supported on an output panel")
    else if (panel.controls.isDefined && panel.config.exists(_.fields.contains("controls")))
      Left(s"$where: supply either controls or config.controls, not both")
    else Right(())

  /** The panel's declared controls as `OutputControlSpec`s, from the first-class `controls` field
   *  (a missing `id` is minted here, `label` defaults to the column) or, when that is absent, a
   *  well-formed `config.controls` passthrough. A malformed `config.controls` yields empty here —
   *  the panel-create path that later decodes it owns that error, this is only the propose-time
   *  eligibility input. */
  private[proposals] def controlSpecsOf(panel: ProposalPanel): Vector[OutputControlSpec] =
    panel.controls match {
      case Some(cs) =>
        cs.map(c => OutputControlSpec(c.id.getOrElse(UUID.randomUUID().toString), c.kind, c.column, c.label.getOrElse(c.column), c.defaultValue))
      case None =>
        panel.config.flatMap(_.fields.get("controls")).flatMap {
          case JsArray(items) => Try(items.map(OutputControlSpec.decode)).toOption
          case _              => None
        }.getOrElse(Vector.empty)
    }

  /** HEL-1193: runs the SAME `OutputControlsValidator` the panel write path uses over every
   *  output panel's declared controls (existing controls empty — a proposal panel is always new),
   *  so an ineligible control fails at propose time with `panel '<title>': ` plus the validator's
   *  own message. Panels whose `outputId` is `skipOutputId` (the combined proposal's not-yet-
   *  created `"$pipelineOutput"` sentinel) are skipped: they can only be validated at apply time.
   *  A `null` validator (unwired fixture) skips the whole check. */
  def preValidateControls(
      panels: Vector[ProposalPanel],
      user: AuthenticatedUser,
      controlsValidator: OutputControlsValidator,
      skipOutputId: Option[String] = None
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, Unit]] =
    if (controlsValidator == null) Future.successful(Right(()))
    else
      panels.foldLeft[Future[Either[ServiceError, Unit]]](Future.successful(Right(()))) { (accF, panel) =>
        accF.flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right(_) =>
            val specs = controlSpecsOf(panel)
            if (panel.`type` != "output" || specs.isEmpty || panel.outputId.isEmpty || panel.outputId == skipOutputId)
              Future.successful(Right(()))
            else
              controlsValidator.reject(panel.outputId.map(OutputId(_)), specs, Vector.empty, user).map {
                case Left(ServiceError.BadRequest(msg)) => Left(ServiceError.BadRequest(s"panel '${panel.title}': $msg"))
                case other                              => other
              }
        }
      }

  /** Verify every panel's actual binding target — the flat `outputId` for
   *  `DataPanelKinds`, OR (HEL-316) a non-`DataPanelKinds` panel's
   *  `config.outputId` — resolves to an Output owned by
   *  the caller. Runs BEFORE any write (zero DB writes here — these are
   *  reads only), so a bad binding never reaches the caller's
   *  transactional write. */
  def preValidateBindings(
      panels: Vector[ProposalPanel],
      user: AuthenticatedUser,
      outputRepo: OutputRepository = null,
      dataSourceRepo: DataSourceRepository = null
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, Unit]] =
    panels.foldLeft[Future[Either[ServiceError, Unit]]](Future.successful(Right(()))) {
      (accF, panel) =>
        accF.flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right(_)  =>
            validateDataTypeBinding(panel, user, outputRepo).flatMap {
              case Left(err) => Future.successful(Left(err))
              case Right(_)  => validateSourceBinding(panel, user, dataSourceRepo)
            }
        }
    }

  /** HEL-1148: only the source-bound panels' `dataSourceId` check, over every panel — read-only,
   *  run before any write (the combined-proposal path calls it before the pipeline phase). */
  def preValidateSourceBindings(
      panels: Vector[ProposalPanel],
      user: AuthenticatedUser,
      dataSourceRepo: DataSourceRepository
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, Unit]] =
    panels.foldLeft[Future[Either[ServiceError, Unit]]](Future.successful(Right(()))) { (accF, panel) =>
      accF.flatMap {
        case Left(err) => Future.successful(Left(err))
        case Right(_)  => validateSourceBinding(panel, user, dataSourceRepo)
      }
    }

  /** Runs the SAME `FormBindingValidator` checks a direct `form` panel create runs (ownership,
   *  dataset kind, declared-schema consistency — never weaker), over the create-request this
   *  panel will actually be built with. A `ServiceError.NotFound` is reported as a 400 here (like
   *  the Output binding check above); the message is identical for a foreign and a nonexistent id,
   *  so no existence oracle. A `null` repository (unwired fixture) skips the check. */
  private def validateSourceBinding(
      panel: ProposalPanel,
      user: AuthenticatedUser,
      dataSourceRepo: DataSourceRepository
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, Unit]] =
    if (!DashboardProposalService.SourceBoundKinds.contains(panel.`type`) || dataSourceRepo == null)
      Future.successful(Right(()))
    else
      FormBindingValidator.rejectForCreate(dataSourceRepo, buildCreateRequest(DashboardId(""), panel), user).map {
        case Left(ServiceError.NotFound(msg))   => Left(ServiceError.BadRequest(s"panel '${panel.title}': $msg"))
        case Left(ServiceError.BadRequest(msg)) => Left(ServiceError.BadRequest(s"panel '${panel.title}': $msg"))
        case other                              => other
      }

  /** HEL-904 task 3.8/3.9: an `"output"`-kind panel's binding candidate is a
   *  real Output id, validated against [[OutputRepository.findByIdOwned]].
   *  Task 4.1: the non-`"output"` (Text/Markdown) branch, which used to
   *  validate against the now-deleted `DataTypeRepository`, is removed
   *  outright — `TextPanelConfig`/`MarkdownPanelConfig` no longer carry a
   *  `outputId` at all (the V94 migration converted every data-bound
   *  text/markdown panel into a `markdown`-kind Output + `OutputPanel`
   *  placement, design.md line 76/103), so a non-output panel's
   *  `panel.outputId` is never a real binding to validate. `outputRepo`
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

  /** The outputId that will ACTUALLY end up bound on the created panel, for
   *  pre-validation purposes: the flat field. HEL-904 task 4.1: the
   *  non-`DataPanelKinds` (Text/Markdown) `config.outputId` fallback is
   *  removed outright — those kinds' data-bound "Source mode" no longer
   *  exists, so a `config.outputId` on a text/markdown proposal panel is
   *  inert (silently ignored by `TextPanelConfig.decodeCreate`/
   *  `MarkdownPanelConfig.decodeCreate`), never a real binding to validate. */
  private def bindingCandidate(panel: ProposalPanel): Option[String] =
    panel.outputId

  /** Build the create-side typed `config` JSON from the proposal panel's
   *  fields and merge the generic `config` passthrough over it (HEL-316) —
   *  see `DashboardProposalService`'s original scaladoc (pre-extraction) for
   *  the full field-by-field rationale, preserved verbatim below. */
  def buildCreateRequest(dashboardId: DashboardId, panel: ProposalPanel): CreatePanelRequest = {
    val derived: Option[JsObject] = panel.outputId match {
      case Some(id) => Some(buildDataConfig(id, panel))
      case None     => buildNonDataConfig(panel).map(_.asJsObject)
    }
    val bindingKey = if (panel.`type` == "output") "outputId" else "outputId"
    val withControls = panel.controls.filter(_.nonEmpty).fold(panel.config) { _ =>
      Some(JsObject(panel.config.fold(Map.empty[String, JsValue])(_.fields) + ("controls" -> JsArray(controlSpecsOf(panel).map(OutputControlSpec.format.write)))))
    }
    val configOpt: Option[JsValue] =
      withSourceBinding(mergeConfig(derived, withControls, panel.outputId, bindingKey), panel.dataSourceId)
    CreatePanelRequest(
      dashboardId = Some(dashboardId.value),
      title       = Some(panel.title),
      `type`      = Some(panel.`type`),
      config      = configOpt
    )
  }

  /** HEL-1148: re-applies the flat `dataSourceId` after the config merge, so it stays authoritative
   *  over any `config.dataSourceId` (same rule as `outputId` in `mergeConfig`). */
  private def withSourceBinding(config: Option[JsObject], dataSourceId: Option[String]): Option[JsObject] =
    dataSourceId.fold(config)(id => Some(JsObject(config.fold(Map.empty[String, JsValue])(_.fields) + ("dataSourceId" -> JsString(id)))))

  /** Merge the passthrough `config` over the derived flat-field config: on
   *  key conflict the explicit `config` wins — EXCEPT the panel's flat
   *  `outputId` (an Output id for an `"output"`-kind panel — HEL-904 task
   *  3.8/3.9) is re-applied, under `bindingKey`, after the merge so it
   *  remains authoritative no matter what `config` supplies. */
  private def mergeConfig(
      derived: Option[JsObject],
      passthrough: Option[JsObject],
      outputId: Option[String],
      bindingKey: String
  ): Option[JsObject] = {
    val merged = (derived, passthrough) match {
      case (Some(d), Some(c)) => Some(JsObject(d.fields ++ c.fields))
      case (Some(d), None)    => Some(d)
      case (None, Some(c))    => Some(c)
      case (None, None)       => None
    }
    outputId match {
      case Some(id) => merged.map(m => JsObject(m.fields + (bindingKey -> JsString(id))))
      case None     => merged
    }
  }

  // HEL-904 task 3.10: the Metric/Timeline literal-folding branches
  // (label/unit/aggregation/timelineOptions) were removed along with the
  // bound panel kinds they targeted. `outputId` remains meaningful ONLY
  // for `"output"`-kind panels (it becomes `outputId`, per task 3.8/3.9
  // below). `fieldMapping` is NOT meaningful on any current panel kind --
  // corrected cycle-9 (round-6 skeptic Finding, deletion-sweep CR1):
  // `buildDataConfig` below emits only `{"outputId": ...}` for an `output`
  // panel, never `fieldMapping`; TextPanelConfig and MarkdownPanelConfig
  // carry no data binding of any kind, so `outputId`/`fieldMapping` on a
  // text/markdown proposal panel is inert, never a real binding.
  //
  // HEL-904 task 3.8/3.9 (renamed HEL-910 task 3.2, dataTypeId -> outputId):
  // an `"output"`-kind proposal panel's flat `outputId` field carries a real
  // Output id (populated by
  // `PipelineProposalService.apply`'s Output creation, or by
  // `CombinedProposalService.resolveOutputRefs`'s `"$pipelineOutput"`
  // sentinel substitution). `OutputPanelConfig.decodeCreate` requires
  // `outputId`, not `outputId`/`fieldMapping`, so an output-kind panel's
  // config must carry that key instead.
  private def buildDataConfig(outputId: String, panel: ProposalPanel): JsObject =
    if (panel.`type` == "output")
      JsObject(Map("outputId" -> JsString(outputId)))
    else
      JsObject(Map(
        "outputId"   -> JsString(outputId),
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
