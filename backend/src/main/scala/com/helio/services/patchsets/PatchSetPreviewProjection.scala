package com.helio.services.patchsets

import com.helio.services.dashboards.DashboardServiceValidation
import com.helio.services.panels.PanelServiceHelpers
import com.helio.services.ServiceError
import com.helio.domain.engine.ExpressionEvaluator
import com.helio.api.http.RequestValidation
import com.helio.api.protocols.dashboards.{CreateDashboardRequest, DashboardResponse, UpdateDashboardRequest}
import com.helio.api.protocols.panels.{CreatePanelRequest, PanelResponse, UpdatePanelRequest}
import com.helio.api.protocols.pipelines.{CreatePipelineRequest, DataTypeResponse, PipelineStepConfigCodec, PipelineStepResponse, PipelineSummaryResponse, UpdateDataTypeRequest, UpdatePipelineRequest, UpdatePipelineStepRequest}
import com.helio.api.protocols.sources.{DataSourceResponse, StaticDataSourceRequest, UpdateDataSourceRequest}
import com.helio.api.protocols.patchsets.EditPreview
import com.helio.domain.model._
import com.helio.domain.panels._
import com.helio.infrastructure.persistence.pipelines.PipelineRepository.PipelineSummary
import PatchSetApplyServiceJson._
import spray.json._

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Failure, Success}

/** Pure(-ish) after-state projection for one resolved edit (design.md D2/D3/
 *  D1a, tasks.md 2.2) -- the read-only diff half of HEL-408's preview.
 *  `before` is `ResolvedEdit.priorStateJson` reused verbatim (design.md D2,
 *  HEL-406's own D4a field). `after` composes each kind's own PURE
 *  sub-computations (`PanelServiceHelpers.resolvePatch`, `PanelConfigCodec.
 *  applyConfigPatch`, `PanelAppearance.applyPatchJson`,
 *  `DashboardServiceValidation.validateDashboardUpdateRequest`,
 *  `PipelineStepConfigCodec.decode`) wherever one already exists -- never
 *  re-deriving logic those functions already own (design.md Context/Risks).
 *
 *  A handful of genuinely-extra content checks (design.md D1/D1a) run here
 *  too -- panel-update's blank-title/cross-type-PATCH + scatter+aggregation
 *  conflict (both free, via the reused functions above), pipeline-rename's
 *  blank-name check, dataType-update's computed-field expression validation,
 *  and dataType-delete's two conflict checks (genuine extra READs, not
 *  writes). A `Left` from ANY of these fails the WHOLE `preview` call
 *  (design.md D1a), never silently dropped or per-edit-only.
 *
 *  Extracted to its own file from the start (design.md Impact -- learning
 *  from HEL-406/HEL-668's file-size lesson); the pipelineStep-specific
 *  22-arm `.copy` dispatch lives in `PatchSetPreviewProjectionSteps.scala`
 *  for the identical reason. */
private[services] object PatchSetPreviewProjection {

  private val PendingId = "(pending)"

  def project(
      edit: ResolvedEdit,
      user: AuthenticatedUser,
      ctx: PatchSetApplyContext
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, EditPreview]] =
    computeAfter(edit, user, ctx).flatMap {
      case Left(err) => Future.successful(Left(err))
      case Right(afterOpt) =>
        PatchSetPreviewImpact.compute(edit, user, ctx).map { impact =>
          Right(EditPreview(edit.index, edit.kind, edit.op, edit.priorStateJson, afterOpt, impact))
        }
    }


  private def computeAfter(
      edit: ResolvedEdit,
      user: AuthenticatedUser,
      ctx: PatchSetApplyContext
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, Option[JsValue]]] =
    edit.action match {
      case ResolvedAction.PanelUpdate(_, request, prior) =>
        Future.successful(panelUpdateAfter(request, prior))
      case ResolvedAction.PanelDelete(_, _) =>
        Future.successful(Right(None))
      case ResolvedAction.PanelCreate(request) =>
        Future.successful(Right(Some(panelCreateAfter(request, user))))

      case ResolvedAction.DashboardUpdate(_, request, prior) =>
        Future.successful(dashboardUpdateAfter(request, prior))
      case ResolvedAction.DashboardDelete(_, _) =>
        Future.successful(Right(None))
      case ResolvedAction.DashboardCreate(request) =>
        Future.successful(Right(Some(dashboardCreateAfter(request, user))))

      case ResolvedAction.DataSourceUpdate(_, request, prior) =>
        Future.successful(Right(Some(dataSourceUpdateAfter(request, prior))))
      case ResolvedAction.DataSourceDelete(_, _) =>
        Future.successful(Right(None))
      case ResolvedAction.DataSourceCreate(request) =>
        Future.successful(Right(Some(dataSourceCreateAfter(request, user))))

      // ── dataType (no create -- design.md D1) ──────────────────────────
      case ResolvedAction.DataTypeUpdate(_, request, prior) =>
        Future.successful(dataTypeUpdateAfter(request, prior))
      case ResolvedAction.DataTypeDelete(id, prior) =>
        dataTypeDeleteAfter(id, prior, user, ctx)

      case ResolvedAction.PipelineUpdate(_, request, prior) =>
        Future.successful(pipelineRenameAfter(request, prior))
      case ResolvedAction.PipelineDelete(_, _) =>
        Future.successful(Right(None))
      case ResolvedAction.PipelineCreate(request) =>
        pipelineCreateAfter(request, user, ctx)

      // ── pipelineStep (no create -- design.md D1) ──────────────────────
      case ResolvedAction.PipelineStepUpdate(_, request, prior) =>
        Future.successful(pipelineStepUpdateAfter(request, prior))
      case ResolvedAction.PipelineStepDelete(_, _) =>
        Future.successful(Right(None))
    }


  private def panelUpdateAfter(request: UpdatePanelRequest, prior: Panel): Either[ServiceError, Option[JsValue]] =
    PanelServiceHelpers.resolvePatch(request, prior) match {
      case Left(err) => Left(ServiceError.BadRequest(err))
      case Right(spec) =>
        PanelServiceHelpers.validateScatterAggregationConflict(prior, spec) match {
          case Left(err) => Left(ServiceError.BadRequest(err))
          case Right(_) =>
            val titled = withTitleAndAppearance(prior, spec.trimmedTitle, spec.appearance)
            val configured: Either[String, Panel] = spec.configPatch match {
              case None      => Right(titled)
              case Some(cfg) => PanelConfigCodec.applyConfigPatch(titled, cfg)
            }
            configured match {
              case Left(err)    => Left(ServiceError.BadRequest(err))
              case Right(panel) => Right(Some(panelResponseFormat.write(PanelResponse.fromDomain(panel))))
            }
        }
    }

  /** design.md D3's create-side builder reuse -- every field here already
   *  round-tripped through `resolveAll`'s own `resolvePanelCreate` (decode
   *  failures already fail the whole `preview` call before this projection
   *  runs), so the `getOrElse` fallbacks below are unreachable in practice,
   *  not a silent second decode. */
  private def panelCreateAfter(request: CreatePanelRequest, user: AuthenticatedUser): JsValue = {
    val createConfig = PanelServiceHelpers.resolveCreateConfig(request).getOrElse(
      throw new IllegalStateException("panel create config failed to decode after resolveAll already accepted it")
    )
    val appearance = PanelServiceHelpers.resolveCreateAppearance(request.appearance).getOrElse(PanelAppearance.Default)
    val now = Instant.now()
    val panel = PanelServiceHelpers.buildNewPanel(
      id           = PanelId(PendingId),
      dashboardId  = DashboardId(request.dashboardId.map(_.trim).getOrElse("")),
      title        = RequestValidation.normalizePanelTitle(request.title),
      meta         = ResourceMeta(createdBy = user.id.value, createdAt = now, lastUpdated = now),
      appearance   = appearance,
      ownerId      = user.id,
      createConfig = createConfig
    )
    panelResponseFormat.write(PanelResponse.fromDomain(panel))
  }

  /** Generic title/appearance `.copy` across the Panel ADT's 9 registered
   *  kinds (mirrors `PanelServiceHelpers.buildNewPanel`'s own 9-arm
   *  dispatch) -- `PanelPatchApplier`'s real title/appearance write steps
   *  (`panelRepo.updateTitle`/`updateAppearance`), replicated in memory. */
  private def withTitleAndAppearance(panel: Panel, title: Option[String], appearance: Option[PanelAppearance]): Panel = {
    def t(existing: String): String = title.getOrElse(existing)
    def a(existing: PanelAppearance): PanelAppearance = appearance.getOrElse(existing)
    panel match {
      case p: MetricPanel     => p.copy(title = t(p.title), appearance = a(p.appearance))
      case p: ChartPanel      => p.copy(title = t(p.title), appearance = a(p.appearance))
      case p: TablePanel      => p.copy(title = t(p.title), appearance = a(p.appearance))
      case p: TextPanel       => p.copy(title = t(p.title), appearance = a(p.appearance))
      case p: MarkdownPanel   => p.copy(title = t(p.title), appearance = a(p.appearance))
      case p: ImagePanel      => p.copy(title = t(p.title), appearance = a(p.appearance))
      case p: DividerPanel    => p.copy(title = t(p.title), appearance = a(p.appearance))
      case p: CollectionPanel => p.copy(title = t(p.title), appearance = a(p.appearance))
      case p: TimelinePanel   => p.copy(title = t(p.title), appearance = a(p.appearance))
    }
  }


  private def dashboardUpdateAfter(request: UpdateDashboardRequest, prior: Dashboard): Either[ServiceError, Option[JsValue]] =
    DashboardServiceValidation.validateDashboardUpdateRequest(request) match {
      case Left(err) => Left(ServiceError.BadRequest(err))
      case Right((nameOpt, appearanceOpt, layoutOpt)) =>
        // design.md D3's corrected three-field mirror of DashboardService.applyUpdate
        // (DashboardService.scala:147-184) -- name/appearance/layout only,
        // `meta` deliberately left at `prior`'s value (D3's timestamp exclusion).
        val updated = prior.copy(
          name       = nameOpt.getOrElse(prior.name),
          appearance = appearanceOpt.getOrElse(prior.appearance),
          layout     = layoutOpt.getOrElse(prior.layout)
        )
        Right(Some(dashboardResponseFormat.write(DashboardResponse.fromDomain(updated))))
    }

  private def dashboardCreateAfter(request: CreateDashboardRequest, user: AuthenticatedUser): JsValue = {
    val now = Instant.now()
    val dashboard = Dashboard(
      id         = DashboardId(PendingId),
      name       = RequestValidation.normalizeDashboardName(request.name),
      meta       = ResourceMeta(createdBy = user.id.value, createdAt = now, lastUpdated = now),
      appearance = DashboardAppearance.Default,
      layout     = DashboardLayout.Default,
      ownerId    = user.id
    )
    dashboardResponseFormat.write(DashboardResponse.fromDomain(dashboard))
  }


  /** Trivial rename-only `.copy`, mirroring `PatchSetApplyRollback`'s own
   *  `DataSourceUpdate` inverse-request composition style -- `updatedAt` is
   *  deliberately left at `prior`'s value (design.md D3's timestamp
   *  exclusion). */
  private def dataSourceUpdateAfter(request: UpdateDataSourceRequest, prior: DataSource): JsValue = {
    val newName = request.name.map(_.trim).getOrElse(prior.name)
    val updated = prior match {
      case c: CsvSource    => c.copy(name = newName)
      case r: RestSource   => r.copy(name = newName)
      case s: SqlSource    => s.copy(name = newName)
      case s: StaticSource => s.copy(name = newName)
      case t: TextSource   => t.copy(name = newName)
      case p: PdfSource    => p.copy(name = newName)
      case i: ImageSource  => i.copy(name = newName)
    }
    dataSourceResponseFormat.write(DataSourceResponse.fromDomain(updated))
  }

  private def dataSourceCreateAfter(request: StaticDataSourceRequest, user: AuthenticatedUser): JsValue = {
    val now = Instant.now()
    val source = StaticSource(
      id        = DataSourceId(PendingId),
      name      = request.name.trim,
      ownerId   = user.id,
      createdAt = now,
      updatedAt = now,
      tag       = request.tag
    )
    dataSourceResponseFormat.write(DataSourceResponse.fromDomain(source))
  }


  /** Mirrors `DataTypeService.applyUpdate`'s content-level checks exactly
   *  (design.md D1/D1a): `RequestValidation.MaxExpressionLength` per
   *  computed field, then `ExpressionEvaluator.validateTolerant` per
   *  computed field (both public, pure, reused directly). `updatedAt` is
   *  deliberately left at `prior`'s value (design.md D3). */
  private def dataTypeUpdateAfter(request: UpdateDataTypeRequest, prior: DataType): Either[ServiceError, Option[JsValue]] = {
    val incomingComputedFields = request.computedFields.getOrElse(Vector.empty)
    val tooLong = incomingComputedFields.find(_.expression.length > RequestValidation.MaxExpressionLength)
    tooLong match {
      case Some(cf) =>
        Left(ServiceError.BadRequest(
          s"Expression for field '${cf.name}' exceeds maximum length of ${RequestValidation.MaxExpressionLength} characters"
        ))
      case None =>
        val updatedRegularFields = request.fields
          .map(_.map(p => DataField(p.name, p.displayName, p.dataType, p.nullable)))
          .getOrElse(prior.fields)
        val fieldNames = updatedRegularFields.map(_.name).toSet

        val exprError = incomingComputedFields.foldLeft(Option.empty[String]) {
          case (Some(err), _) => Some(err)
          case (None, cf) =>
            ExpressionEvaluator.validateTolerant(cf.expression, fieldNames) match {
              case Left(msg) => Some(s"Invalid expression for computed field '${cf.name}': $msg")
              case Right(_)  => None
            }
        }

        exprError match {
          case Some(msg) => Left(ServiceError.BadRequest(msg))
          case None =>
            val updatedComputedFields = request.computedFields
              .map(_.map(p => ComputedField(p.name, p.displayName, p.expression, p.dataType)))
              .getOrElse(prior.computedFields)
            val updated = prior.copy(
              name           = request.name.getOrElse(prior.name),
              fields         = updatedRegularFields,
              computedFields = updatedComputedFields
            )
            Right(Some(dataTypeResponseFormat.write(DataTypeResponse.fromDomain(updated))))
        }
    }
  }

  /** Mirrors `DataTypeService.delete`'s two content-level conflict checks
   *  (design.md D1/D1a/D4), in the SAME order the real path evaluates them
   *  (`checkSourceLink` first, `existsBoundToAnyOwnedPanel` second --
   *  design.md's own note that the two conditions are mutually exclusive,
   *  so preview's check order cannot produce a different verdict). Both a
   *  genuine extra READ, never a write. */
  private def dataTypeDeleteAfter(
      id: DataTypeId,
      prior: DataType,
      user: AuthenticatedUser,
      ctx: PatchSetApplyContext
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, Option[JsValue]]] =
    checkSourceLink(prior, ctx).flatMap {
      case Left(err) => Future.successful(Left(err))
      case Right(_) =>
        ctx.dataTypeRepo.existsBoundToAnyOwnedPanel(id, user).map {
          case true  => Left(ServiceError.Conflict("Cannot delete DataType: one or more panels are bound to it"))
          case false => Right(None)
        }
    }

  /** Replicates `DataTypeService.checkSourceLink` (`private`, not directly
   *  reusable) -- the same two-line shape: if `prior.sourceId` is defined,
   *  `dataSourceRepo.findByIdInternal` existence. */
  private def checkSourceLink(dt: DataType, ctx: PatchSetApplyContext)(implicit ec: ExecutionContext): Future[Either[ServiceError, Unit]] =
    dt.sourceId match {
      case None => Future.successful(Right(()))
      case Some(srcId) =>
        ctx.dataSourceRepo.findByIdInternal(srcId).map {
          case None => Right(())
          case Some(source) =>
            Left(ServiceError.Conflict(
              s"Cannot delete this DataType: it is the auto-inferred schema of data source '${source.name}'. " +
                s"Refresh the source to re-infer its schema, or delete the source first."
            ))
        }
    }


  /** Mirrors `PipelineService.updateName`'s blank-name check
   *  (`PipelineService.scala:154-155`, design.md D1/D1a) before the trivial
   *  rename `.copy`. */
  private def pipelineRenameAfter(request: UpdatePipelineRequest, prior: PipelineSummary): Either[ServiceError, Option[JsValue]] =
    if (request.name.trim.isEmpty) Left(ServiceError.BadRequest("name must not be empty"))
    else Right(Some(pipelineSummaryResponseFormat.write(toPipelineSummaryResponse(prior.copy(name = request.name.trim)))))

  /** Trivial field-echo of the decoded `CreatePipelineRequest` (design.md
   *  D3) -- `sourceDataSourceName` needs one genuine extra READ (a read, not
   *  a write) since the request only carries the source's id, not its name;
   *  `outputDataTypeId`/`id` are the `"(pending)"` sentinel, nothing exists
   *  yet. */
  private def pipelineCreateAfter(
      request: CreatePipelineRequest,
      user: AuthenticatedUser,
      ctx: PatchSetApplyContext
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, Option[JsValue]]] =
    ctx.dataSourceRepo.findByIdOwned(DataSourceId(request.sourceDataSourceId.trim), user).map {
      case None => Left(ServiceError.NotFound(s"data source not found: ${request.sourceDataSourceId}"))
      case Some(source) =>
        Right(Some(pipelineSummaryResponseFormat.write(PipelineSummaryResponse(
          id                   = PendingId,
          name                 = request.name.trim,
          sourceDataSourceId   = source.id.value,
          sourceDataSourceName = source.name,
          outputDataTypeName   = request.outputDataTypeName.trim,
          outputDataTypeId     = PendingId,
          lastRunStatus        = None,
          lastRunAt            = None,
          lastRunRowCount      = None,
          ownerId              = Some(user.id.value),
          tag                  = request.tag
        ))))
    }

  /** Trivial field-echo -- `PatchSetApplyResolvers.pipelineSummaryResponse`
   *  is `private` to that object, not `private[services]`, so this mirrors
   *  its 1:1 field mapping rather than reaching across the object boundary. */
  private def toPipelineSummaryResponse(s: PipelineSummary): PipelineSummaryResponse =
    PipelineSummaryResponse(
      id                   = s.id,
      name                 = s.name,
      sourceDataSourceId   = s.sourceDataSourceId,
      sourceDataSourceName = s.sourceDataSourceName,
      outputDataTypeName   = s.outputDataTypeName,
      outputDataTypeId     = s.outputDataTypeId,
      lastRunStatus        = s.lastRunStatus,
      lastRunAt            = s.lastRunAt,
      lastRunRowCount      = s.lastRunRowCount,
      ownerId              = if (s.ownerId.nonEmpty) Some(s.ownerId) else None,
      tag                  = s.tag
    )


  private def pipelineStepUpdateAfter(request: UpdatePipelineStepRequest, prior: PipelineStep): Either[ServiceError, Option[JsValue]] = {
    val configuredEither: Either[String, PipelineStep] = request.config match {
      case None => Right(prior)
      case Some(cfgJson) =>
        PipelineStepConfigCodec.decode(prior.kind, cfgJson.compactPrint) match {
          case Failure(_)           => Left(s"Invalid '${prior.kind}' config")
          case Success(typedConfig) => PipelineStepProjectionSupport.withDecodedConfig(prior, typedConfig)
        }
    }
    configuredEither match {
      case Left(err) => Left(ServiceError.BadRequest(err))
      case Right(configured) =>
        val positioned = PipelineStepProjectionSupport.withPosition(configured, request.position.getOrElse(configured.position))
        Right(Some(pipelineStepResponseFormat.write(PipelineStepResponse.fromDomain(positioned))))
    }
  }
}
