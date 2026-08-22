package com.helio.services.patchsets

import com.helio.api.protocols.pipelines.{ComputedFieldPayload, CreatePipelineStepRequest, DataFieldPayload, DataTypeResponse, PipelineStepConfigCodec, UpdateDataTypeRequest, UpdatePipelineRequest, UpdatePipelineStepRequest}
import com.helio.api.protocols.panels.{CreatePanelRequest, PanelAppearancePayload, PanelResponse, UpdatePanelRequest}
import com.helio.api.protocols.dashboards.{DashboardAppearancePayload, DashboardLayoutItemPayload, DashboardLayoutPayload, DashboardResponse, UpdateDashboardRequest}
import com.helio.api.protocols.sources.{DataSourceResponse, UpdateDataSourceRequest}
import com.helio.api.protocols.patchsets.EditOutcome
import com.helio.domain.model._
import com.helio.domain.panels._
import PatchSetApplyServiceJson._
import org.slf4j.LoggerFactory
import spray.json.{JsNull, JsNumber, JsObject, JsString, JsValue, JsonParser}

import scala.concurrent.{ExecutionContext, Future}
import scala.util.control.NonFatal

/** Reverse-order compensation walk (design.md D3/D3a/D1, tasks.md 5.1/5.2/5.3):
 *  `create` -> delete via the same kind's existing delete method; `update` ->
 *  reapply the captured full prior state as a full-overwrite inverse
 *  `Update*Request` (every field populated, never a partial patch) through
 *  the SAME service method; `delete` -> per the per-kind matrix, either
 *  recreate under a NEW id (panel/pipelineStep) or mark `unrecoverable`
 *  (dashboard/dataSource/dataType/pipeline — cascades or a duplicative
 *  multi-step composition this ticket does not reimplement). A compensating
 *  action that itself fails is logged and marks that edit `unrecoverable`
 *  too — never throws past the original failure. */
private[services] object PatchSetApplyRollback {

  private val log = LoggerFactory.getLogger(getClass)

  /** `appliedInOrder` is in the ORIGINAL forward-apply order; compensated in
   *  REVERSE, then re-sorted back to ascending `index` order for the
   *  response (order carries no meaning beyond each outcome's own `index`
   *  field). */
  def rollback(
      appliedInOrder: Vector[(ResolvedEdit, EditOutcome)],
      user: AuthenticatedUser,
      services: PatchSetApplyServices
  )(implicit ec: ExecutionContext): Future[Vector[EditOutcome]] = {
    def loop(remaining: Vector[(ResolvedEdit, EditOutcome)], acc: Vector[EditOutcome]): Future[Vector[EditOutcome]] =
      remaining.headOption match {
        case None => Future.successful(acc)
        case Some((edit, forwardOutcome)) =>
          safeCompensate(edit, forwardOutcome, user, services).flatMap(outcome => loop(remaining.tail, acc :+ outcome))
      }
    loop(appliedInOrder.reverse, Vector.empty).map(_.sortBy(_.index))
  }

  private def safeCompensate(
      edit: ResolvedEdit,
      forwardOutcome: EditOutcome,
      user: AuthenticatedUser,
      services: PatchSetApplyServices
  )(implicit ec: ExecutionContext): Future[EditOutcome] =
    compensate(edit, forwardOutcome, user, services).recover { case NonFatal(ex) =>
      logFailure(edit, ex.getMessage)
      edit.toOutcome("unrecoverable")
    }

  private def compensate(
      edit: ResolvedEdit,
      forwardOutcome: EditOutcome,
      user: AuthenticatedUser,
      services: PatchSetApplyServices
  )(implicit ec: ExecutionContext): Future[EditOutcome] =
    edit.action match {

      // ── panel ──────────────────────────────────────────────────────────
      case ResolvedAction.PanelCreate(_) =>
        forwardOutcome.newId match {
          case None => Future.successful(edit.toOutcome("unrecoverable"))
          case Some(idStr) =>
            services.panelService.delete(PanelId(idStr), user).map {
              case Right(_)  => edit.toOutcome("rolledBack")
              case Left(err) => logFailure(edit, err.message); edit.toOutcome("unrecoverable")
            }
        }
      case ResolvedAction.PanelUpdate(id, _, prior) =>
        services.panelService.update(id, fullPanelInverse(prior), user).map {
          case Right(panel) => edit.toOutcome("rolledBack", resultingState = Some(panelResponseFormat.write(PanelResponse.fromDomain(panel))))
          case Left(err)    => logFailure(edit, err.message); edit.toOutcome("unrecoverable")
        }
      case ResolvedAction.PanelDelete(_, prior) =>
        // design.md D3a: recreate under a NEW id — no existing API accepts a
        // caller-specified id; the dashboard's layout entry for the OLD id is
        // NOT repointed (documented v1 limit).
        services.panelService.create(panelCreateRequestFromPrior(prior), user).map {
          case Right(recreated) =>
            edit.toOutcome("recreated", newId = Some(recreated.id.value), resultingState = Some(panelResponseFormat.write(PanelResponse.fromDomain(recreated))))
          case Left(err) => logFailure(edit, err.message); edit.toOutcome("unrecoverable")
        }

      // ── dashboard ──────────────────────────────────────────────────────
      case ResolvedAction.DashboardCreate(_) =>
        forwardOutcome.newId match {
          case None => Future.successful(edit.toOutcome("unrecoverable"))
          case Some(idStr) =>
            services.dashboardService.delete(DashboardId(idStr), user).map {
              case Right(_)  => edit.toOutcome("rolledBack")
              case Left(err) => logFailure(edit, err.message); edit.toOutcome("unrecoverable")
            }
        }
      case ResolvedAction.DashboardUpdate(id, _, prior) =>
        services.dashboardService.update(id, fullDashboardInverse(prior), user).map {
          case Right(dashboard) => edit.toOutcome("rolledBack", resultingState = Some(dashboardResponseFormat.write(DashboardResponse.fromDomain(dashboard))))
          case Left(err)        => logFailure(edit, err.message); edit.toOutcome("unrecoverable")
        }
      case ResolvedAction.DashboardDelete(_, _) =>
        // design.md D1: cascades to panels; recreating would duplicate
        // DashboardProposalService's own composition. Never attempted.
        Future.successful(edit.toOutcome("unrecoverable"))

      // ── dataSource ─────────────────────────────────────────────────────
      case ResolvedAction.DataSourceCreate(_) =>
        forwardOutcome.newId match {
          case None => Future.successful(edit.toOutcome("unrecoverable"))
          case Some(idStr) =>
            services.dataSourceService.delete(DataSourceId(idStr), user).map {
              case Right(_)  => edit.toOutcome("rolledBack")
              case Left(err) => logFailure(edit, err.message); edit.toOutcome("unrecoverable")
            }
        }
      case ResolvedAction.DataSourceUpdate(id, _, prior) =>
        services.dataSourceService.update(id, UpdateDataSourceRequest(name = Some(prior.name)), user).map {
          case Right(ds) => edit.toOutcome("rolledBack", resultingState = Some(dataSourceResponseFormat.write(DataSourceResponse.fromDomain(ds))))
          case Left(err) => logFailure(edit, err.message); edit.toOutcome("unrecoverable")
        }
      case ResolvedAction.DataSourceDelete(_, _) =>
        // design.md D1: cascades to pipelines; ten heterogeneous create paths.
        Future.successful(edit.toOutcome("unrecoverable"))

      // ── dataType (no create — design.md D1) ───────────────────────────
      case ResolvedAction.DataTypeUpdate(id, _, prior) =>
        services.dataTypeService.update(id, fullDataTypeInverse(prior), user).map {
          case Right(dt) => edit.toOutcome("rolledBack", resultingState = Some(dataTypeResponseFormat.write(DataTypeResponse.fromDomain(dt))))
          case Left(err) => logFailure(edit, err.message); edit.toOutcome("unrecoverable")
        }
      case ResolvedAction.DataTypeDelete(_, _) =>
        // design.md D1: no create API to restore via — hard constraint.
        Future.successful(edit.toOutcome("unrecoverable"))

      // ── pipeline ───────────────────────────────────────────────────────
      case ResolvedAction.PipelineCreate(_) =>
        forwardOutcome.newId match {
          case None => Future.successful(edit.toOutcome("unrecoverable"))
          case Some(idStr) =>
            services.pipelineService.delete(PipelineId(idStr), user).map {
              case Right(_)  => edit.toOutcome("rolledBack")
              case Left(err) => logFailure(edit, err.message); edit.toOutcome("unrecoverable")
            }
        }
      case ResolvedAction.PipelineUpdate(id, _, prior) =>
        services.pipelineService.updateName(id, UpdatePipelineRequest(name = prior.name), user).map {
          case Right(summary) => edit.toOutcome("rolledBack", resultingState = Some(pipelineSummaryResponseFormat.write(summary)))
          case Left(err)       => logFailure(edit, err.message); edit.toOutcome("unrecoverable")
        }
      case ResolvedAction.PipelineDelete(_, _) =>
        // design.md D1: cascades to steps/runs; recreate+re-run would
        // duplicate PipelineProposalService's own composition.
        Future.successful(edit.toOutcome("unrecoverable"))

      // ── pipelineStep (no create — design.md D1) ───────────────────────
      case ResolvedAction.PipelineStepUpdate(id, _, prior) =>
        services.pipelineService.updateStep(id, fullPipelineStepInverse(prior), user).map {
          case Right(step) => edit.toOutcome("rolledBack", resultingState = Some(pipelineStepResponseFormat.write(step)))
          case Left(err)   => logFailure(edit, err.message); edit.toOutcome("unrecoverable")
        }
      case ResolvedAction.PipelineStepDelete(_, prior) =>
        compensatePipelineStepDelete(edit, prior, user, services)
    }

  /** design.md D3a: recreate via `addStep`, then `updateStep(position=...)`
   *  if it landed elsewhere (a new step is always appended, so anywhere but
   *  the tail position needs a follow-up reposition). Reports `recreated`
   *  with whichever id ends up correct even if the reposition step itself
   *  fails — content restoration (not position) is the bar this ticket's
   *  Tests section names. */
  private def compensatePipelineStepDelete(
      edit: ResolvedEdit,
      prior: PipelineStep,
      user: AuthenticatedUser,
      services: PatchSetApplyServices
  )(implicit ec: ExecutionContext): Future[EditOutcome] =
    services.pipelineService.addStep(prior.pipelineId, pipelineStepCreateRequestFromPrior(prior), user).flatMap {
      case Left(err) =>
        logFailure(edit, err.message)
        Future.successful(edit.toOutcome("unrecoverable"))
      case Right(created) if created.position == prior.position =>
        Future.successful(edit.toOutcome("recreated", newId = Some(created.id), resultingState = Some(pipelineStepResponseFormat.write(created))))
      case Right(created) =>
        services.pipelineService.updateStep(PipelineStepId(created.id), UpdatePipelineStepRequest(None, None, Some(prior.position)), user).map {
          case Right(repositioned) =>
            edit.toOutcome("recreated", newId = Some(repositioned.id), resultingState = Some(pipelineStepResponseFormat.write(repositioned)))
          case Left(_) =>
            // Content is restored even though the reposition follow-up
            // failed — still `recreated`, not `unrecoverable`.
            edit.toOutcome("recreated", newId = Some(created.id), resultingState = Some(pipelineStepResponseFormat.write(created)))
        }
    }

  private def logFailure(edit: ResolvedEdit, message: String): Unit =
    log.error(s"compensation failed for edit ${edit.index} (kind=${edit.kind}, op=${edit.op}): $message")

  // ── Full-overwrite inverse-request builders ─────────────────────────────
  //
  // Every field is populated from the captured prior state — never just the
  // fields the forward edit changed (design.md D3).

  private def fullPanelAppearancePatch(appearance: PanelAppearance): JsValue =
    JsObject(
      "background"   -> JsString(appearance.background),
      "color"        -> JsString(appearance.color),
      "transparency" -> JsNumber(appearance.transparency),
      // Explicit `chart: null` (not an omitted key) when the prior panel had
      // no chart appearance — PanelAppearance.applyPatchJson treats an
      // ABSENT key as "leave unchanged" (the CURRENT, post-forward-edit
      // value), which would fail to clear a chart the forward edit added.
      "chart" -> appearance.chart.map(chartAppearanceFormat.write).getOrElse(JsNull)
    )

  /** Per-kind set of Option-typed config field names each kind's own
   *  `*Config.Patch.decode`/`applyPatch` actually reads (skeptic-final-1.md
   *  CR1). `metricDeprecated` (Metric/Chart/Table) is deliberately excluded
   *  — it is server-materialized and never decoded from a patch at all (see
   *  `MetricPanelConfig`'s own doc comment). Text/Markdown/Timeline have no
   *  Option-typed Patch field, so they map to the empty set. */
  private def optionalConfigFieldNames(kind: String): Set[String] = kind match {
    case MetricPanel.Kind     => Set("aggregation", "label", "unit", "metricId")
    case ChartPanel.Kind      => Set("aggregation", "chartOptions", "annotation", "metricId")
    case TablePanel.Kind      => Set("density", "columnOrder", "metricId")
    case ImagePanel.Kind      => Set("caption")
    case DividerPanel.Kind    => Set("weight", "color")
    case CollectionPanel.Kind => Set("itemOptions")
    case _                    => Set.empty
  }

  /** design.md D3's "every field populated" full-overwrite contract,
   *  applied to `config` (skeptic-final-1.md CR1 — the identical omitted-
   *  `Option`-field class of bug `fullPanelAppearancePatch` above already
   *  guards against for `chart`, but was missed here originally).
   *  `PanelConfigCodec.encodeConfig`'s plain-`jsonFormatN` writer OMITS a
   *  `None`-valued Option config field entirely rather than writing `null`;
   *  every `*Config.Patch.decode` + `applyPatch` then treats an ABSENT key
   *  as "leave the CURRENT (post-forward-edit) value unchanged" via
   *  `.fold(existing)(identity)` — so a rollback built from the bare
   *  encoded config could never actually clear an Option field the forward
   *  edit had just set. Supplying an explicit `null` default for every
   *  Option-typed field this kind's Patch reader recognizes — overridden by
   *  `encoded`'s real value wherever the prior state actually had one set —
   *  closes that gap without inventing a new per-kind JSON shape. */
  private def fullConfigInverse(prior: Panel): JsValue = {
    val encoded = PanelConfigCodec.encodeConfig(prior).asJsObject
    val nullDefaults = optionalConfigFieldNames(prior.kind).map(_ -> JsNull).toMap
    JsObject(nullDefaults ++ encoded.fields)
  }

  private def fullPanelInverse(prior: Panel): UpdatePanelRequest =
    UpdatePanelRequest(
      title      = Some(prior.title),
      appearance = Some(fullPanelAppearancePatch(prior.appearance)),
      `type`     = None,
      config     = Some(fullConfigInverse(prior))
    )

  private def panelAppearancePayloadFromDomain(appearance: PanelAppearance): PanelAppearancePayload =
    PanelAppearancePayload(
      background   = Some(appearance.background),
      color        = Some(appearance.color),
      transparency = Some(appearance.transparency),
      chart        = appearance.chart
    )

  private def panelCreateRequestFromPrior(prior: Panel): CreatePanelRequest =
    CreatePanelRequest(
      dashboardId = Some(prior.dashboardId.value),
      title       = Some(prior.title),
      `type`      = Some(prior.kind),
      config      = Some(PanelConfigCodec.encodeConfig(prior)),
      appearance  = Some(panelAppearancePayloadFromDomain(prior.appearance))
    )

  private def fullDashboardInverse(prior: Dashboard): UpdateDashboardRequest = {
    def layoutItems(items: Vector[DashboardLayoutItem]): Vector[DashboardLayoutItemPayload] =
      items.map(i => DashboardLayoutItemPayload(i.panelId.value, i.x, i.y, i.w, i.h))
    UpdateDashboardRequest(
      name       = Some(prior.name),
      appearance = Some(DashboardAppearancePayload(Some(prior.appearance.background), Some(prior.appearance.gridBackground))),
      layout = Some(DashboardLayoutPayload(
        lg = layoutItems(prior.layout.lg),
        md = layoutItems(prior.layout.md),
        sm = layoutItems(prior.layout.sm),
        xs = layoutItems(prior.layout.xs)
      ))
    )
  }

  private def fullDataTypeInverse(prior: DataType): UpdateDataTypeRequest =
    UpdateDataTypeRequest(
      name           = Some(prior.name),
      fields         = Some(prior.fields.map(f => DataFieldPayload(f.name, f.displayName, f.dataType, f.nullable))),
      computedFields = Some(prior.computedFields.map(cf => ComputedFieldPayload(cf.name, cf.displayName, cf.expression, cf.dataType)))
    )

  private def fullPipelineStepInverse(prior: PipelineStep): UpdatePipelineStepRequest =
    UpdatePipelineStepRequest(
      `type`   = Some(prior.kind),
      config   = Some(JsonParser(PipelineStepConfigCodec.encode(prior)).asJsObject),
      position = Some(prior.position)
    )

  private def pipelineStepCreateRequestFromPrior(prior: PipelineStep): CreatePipelineStepRequest =
    CreatePipelineStepRequest(`type` = prior.kind, config = JsonParser(PipelineStepConfigCodec.encode(prior)).asJsObject)
}
