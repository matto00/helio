package com.helio.services.patchsets

import com.helio.services.dashboards.DashboardServiceValidation
import com.helio.services.panels.PanelServiceHelpers
import com.helio.services.ServiceError
import com.helio.domain.engine.ExpressionEvaluator
import com.helio.api.http.RequestValidation
import com.helio.api.protocols.dashboards.{CreateDashboardRequest, DashboardResponse, UpdateDashboardRequest}
import com.helio.api.protocols.panels.{CreatePanelRequest, PanelResponse, UpdatePanelRequest}
import com.helio.api.protocols.pipelines.{CreatePipelineRequest, CreatePipelineRootRequest, PipelineRootSummaryResponse, PipelineStepConfigCodec, PipelineStepResponse, PipelineSummaryResponse, UpdatePipelineRequest, UpdatePipelineStepRequest}
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
 *  too -- panel-update's blank-title/cross-type-PATCH (free, via
 *  `PanelServiceHelpers.resolvePatch` above) and pipeline-rename's
 *  blank-name check. HEL-904 task 3.3 removed the dataType-update/-delete
 *  content checks that used to live here outright -- dataType is no longer a
 *  valid target.kind. The panel-update scatter+aggregation conflict check
 *  (`PanelService.validateScatterAggregationConflict`) is ALSO gone, not just
 *  no-longer-mirrored: that validator, `ChartPanel`, and panel-side
 *  `aggregation` were all deleted by this same ticket (see the `panelUpdateAfter`
 *  comment below) -- there is nothing left for preview to mirror there. A
 *  `Left` from either remaining check fails the WHOLE `preview` call
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

      // HEL-904 task 3.3: the `dataType` update/delete content checks are
      // REMOVED outright -- `dataType` is no longer a valid target.kind.

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
        // HEL-904: the `validateScatterAggregationConflict` gate here was
        // removed along with `ChartPanel` — Outputs carry no panel-side
        // `aggregation` field to conflict with a chart type.
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
      case p: TextPanel       => p.copy(title = t(p.title), appearance = a(p.appearance))
      case p: MarkdownPanel   => p.copy(title = t(p.title), appearance = a(p.appearance))
      case p: ImagePanel      => p.copy(title = t(p.title), appearance = a(p.appearance))
      case p: DividerPanel    => p.copy(title = t(p.title), appearance = a(p.appearance))
      case p: OutputPanel     => p.copy(title = t(p.title), appearance = a(p.appearance))
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
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, Option[JsValue]]] = {
    // HEL-913 task 7.6: `roots` replaces the scalar `sourceDataSourceId` -- resolves EVERY
    // root's DataSource (never just the first) so the preview's `roots[]` echoes what the real
    // create would actually produce, not a single-root approximation.
    // (id, name) pairs -- an inline root (task 7.1a: `sourceId` absent, `type` present) has no
    // real DataSource to look up yet, so it echoes the PENDING sentinel id and the request's own
    // `name`, exactly like the pipeline id itself below (nothing exists until the real apply
    // runs `pipelineService.create`, which re-validates every root, inline branch included).
    def loop(remaining: List[CreatePipelineRootRequest], acc: Vector[(String, String)]): Future[Either[ServiceError, Vector[(String, String)]]] =
      remaining match {
        case Nil => Future.successful(Right(acc))
        case root :: rest =>
          root.sourceId.map(_.trim) match {
            case Some(sid) if sid.isEmpty =>
              Future.successful(Left(ServiceError.BadRequest("roots: sourceId is required and must not be blank")))
            case Some(sid) =>
              ctx.dataSourceRepo.findByIdOwned(DataSourceId(sid), user).flatMap {
                case None     => Future.successful(Left(ServiceError.NotFound(s"data source not found: $sid")))
                case Some(ds) => loop(rest, acc :+ ((ds.id.value, ds.name)))
              }
            case None =>
              loop(rest, acc :+ ((PendingId, root.name.getOrElse("(pending)"))))
          }
      }
    if (request.roots.isEmpty)
      Future.successful(Left(ServiceError.BadRequest("roots must be a non-empty array")))
    else
      loop(request.roots.toList, Vector.empty).map {
        case Left(err) => Left(err)
        case Right(sources) =>
          Right(Some(pipelineSummaryResponseFormat.write(PipelineSummaryResponse(
            id                   = PendingId,
            name                 = request.name.trim,
            roots                = sources.map { case (id, name) => PipelineRootSummaryResponse(PendingId, id, name) },
            lastRunStatus        = None,
            lastRunAt            = None,
            lastRunRowCount      = None,
            ownerId              = Some(user.id.value),
            tag                  = request.tag
          ))))
      }
  }

  /** Trivial field-echo -- `PatchSetApplyResolvers.pipelineSummaryResponse`
   *  is `private` to that object, not `private[services]`, so this mirrors
   *  its 1:1 field mapping rather than reaching across the object boundary. */
  private def toPipelineSummaryResponse(s: PipelineSummary): PipelineSummaryResponse =
    PipelineSummaryResponse(
      id                   = s.id,
      name                 = s.name,
      roots                = s.roots.map(r => PipelineRootSummaryResponse(r.id, r.dataSourceId, r.dataSourceName)),
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
        // HEL-913 task 7.6a-iii: this is a PURE, synchronous preview projection (no DB access --
        // `positioned` is a hypothetical, not-yet-persisted step shape) so it genuinely cannot
        // resolve a root here. `Map.empty` is passed EXPLICITLY (fromDomain has no default,
        // 7.6a-i) rather than silently inherited, and the reason is stated here rather than left
        // for a reader to guess: a config/position preview never changes which root a step
        // belongs to, so this is a narrower gap than "unknown" -- it's "unchanged, just not
        // reflected in this hypothetical projection."
        Right(Some(pipelineStepResponseFormat.write(PipelineStepResponse.fromDomain(positioned, Map.empty))))
    }
  }
}
