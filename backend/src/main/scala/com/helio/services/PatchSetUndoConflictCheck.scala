package com.helio.services

import com.helio.api.protocols.{DashboardResponse, DataSourceResponse, DataTypeResponse, PanelResponse, PipelineStepConfigCodec, PipelineSummaryResponse}
import com.helio.domain.{AuthenticatedUser, DashboardId, DataSourceId, DataTypeId, PanelId, PipelineId, PipelineStep, PipelineStepId}
import com.helio.infrastructure.PatchSetApplicationRepository
import PatchSetApplicationRepository.JournaledEdit
import PatchSetApplyServiceJson._
import org.slf4j.LoggerFactory
import spray.json.{JsObject, JsValue, JsonParser}

import scala.concurrent.{ExecutionContext, Future}
import scala.util.control.NonFatal

/** Phase-1 pass over every journaled edit (design.md D4/D4a, tasks.md 2.2) — fetches each
 *  `update`/`create` edit's target's CURRENT live state and compares ONLY the fields that edit
 *  kind's [[PatchSetUndoInverse]] would restore against the state captured immediately after the
 *  original apply (`JournaledEdit.resultingState`) — never a whole-JSON diff, which would false-
 *  positive on server-materialized/dynamic fields no edit here ever touches (a pipeline's
 *  `lastRunStatus`/`lastRunAt`/`lastRunRowCount`, updated by every run regardless of any
 *  patch-set edit). A `panel`/`pipelineStep` `delete` edit's undo (recreate) is always eligible —
 *  no live state to compare, nothing captured post-apply since the resource no longer exists. A
 *  `dashboard`/`dataSource`/`dataType`/`pipeline` `delete` edit is ALWAYS flagged: structurally
 *  unrecoverable (no restoring create API — design.md D1/D5), not a conflict, but it can never
 *  satisfy undo's all-or-nothing guarantee either way, so it fails the same Phase-1 gate. */
private[services] object PatchSetUndoConflictCheck {

  private val log = LoggerFactory.getLogger(getClass)

  private val UnrecoverableDeleteKinds = Set("dashboard", "dataSource", "dataType", "pipeline")

  def checkAll(
      edits: Vector[JournaledEdit],
      user: AuthenticatedUser,
      ctx: PatchSetUndoContext
  )(implicit ec: ExecutionContext): Future[Vector[String]] =
    Future.sequence(edits.map(checkOne(_, user, ctx))).map(_.flatten)

  private def checkOne(
      edit: JournaledEdit,
      user: AuthenticatedUser,
      ctx: PatchSetUndoContext
  )(implicit ec: ExecutionContext): Future[Option[String]] =
    (edit.targetKind, edit.op) match {
      case ("panel", "delete") | ("pipelineStep", "delete") =>
        Future.successful(None)
      case (kind, "delete") if UnrecoverableDeleteKinds.contains(kind) =>
        Future.successful(Some(
          s"edit ${edit.index} ($kind delete): structurally unrecoverable — no restoring create API exists for this resource kind"
        ))
      case ("panel", "update" | "create")     => checkPanel(edit, ctx)
      case ("dashboard", "update" | "create") => checkDashboard(edit, user, ctx)
      case ("dataSource", "update" | "create")=> checkDataSource(edit, user, ctx)
      case ("dataType", "update")             => checkDataType(edit, user, ctx)
      case ("pipeline", "update" | "create")  => checkPipeline(edit, user, ctx)
      case ("pipelineStep", "update")         => checkPipelineStep(edit, ctx)
      case (kind, op)                          =>
        Future.successful(Some(s"edit ${edit.index}: no undo path for target.kind '$kind' op '$op'"))
    }

  private def missing(edit: JournaledEdit): String =
    s"edit ${edit.index} (${edit.targetKind} ${edit.op}): journal is missing its captured resulting state"

  private def changed(edit: JournaledEdit, detail: String): String =
    s"edit ${edit.index} (${edit.targetKind} ${edit.op}): $detail"

  // ── panel ────────────────────────────────────────────────────────────────

  /** `config` is compared with `metricDeprecated` stripped from both sides unconditionally (it
   *  is server-materialized, never patch-decodable). For the rest of `config`, this prefers
   *  `rawResultingConfig` (design.md D2a) over the journaled `resultingState.config` as the
   *  comparison baseline whenever it was captured (every panel `update` edit) — `resultingState`
   *  is `resolveSingleBinding`'s MATERIALIZED read, which for a bound `MetricPanel` can show
   *  metric-derived `dataTypeId`/`fieldMapping`/`aggregation`/`unit` that are byte-identical to a
   *  genuine raw override once present (the exact false-negative round 3 of this design's review
   *  found); `rawResultingConfig` is the SAME unmaterialized shape `findByIdInternal` returns
   *  below for `live`, so comparing raw-vs-raw here catches a real independent raw-field edit
   *  while never flagging the metric's own current effective value as a conflict. For a panel
   *  `create` edit `rawResultingConfig` is never captured (`PanelService.create` never
   *  materializes, so `resultingState.config` is ALREADY raw) — the `getOrElse` fallback is exactly
   *  as sound there. Every OTHER config field (title/appearance's own siblings aside) is
   *  unaffected by materialization for any panel kind, so using one baseline for the whole
   *  `config` object rather than special-casing four field names individually is behaviorally
   *  identical to the field-by-field description, with far less duplicated field-name bookkeeping
   *  to keep in sync. */
  private def checkPanel(edit: JournaledEdit, ctx: PatchSetUndoContext)(implicit ec: ExecutionContext): Future[Option[String]] =
    edit.resultingState match {
      case None => Future.successful(Some(missing(edit)))
      case Some(json) =>
        val journaled = json.convertTo[PanelResponse]
        ctx.panelRepo.findByIdInternal(PanelId(journaled.id)).map {
          case None => Some(changed(edit, s"panel ${journaled.id} no longer exists"))
          case Some(livePanel) =>
            val live = PanelResponse.fromDomain(livePanel)
            val baselineConfig = edit.rawResultingConfig.getOrElse(journaled.config)
            val titleMatches      = live.title == journaled.title
            val appearanceMatches = live.appearance == journaled.appearance
            val configMatches     = stripMetricDeprecated(live.config) == stripMetricDeprecated(baselineConfig)
            if (titleMatches && appearanceMatches && configMatches) None
            else Some(changed(edit, s"panel ${journaled.id} was changed since the patch set was applied"))
        }
    }

  private def stripMetricDeprecated(config: JsValue): JsValue = config match {
    case obj: JsObject => JsObject(obj.fields - "metricDeprecated")
    case other          => other
  }

  // ── dashboard ────────────────────────────────────────────────────────────

  private def checkDashboard(edit: JournaledEdit, user: AuthenticatedUser, ctx: PatchSetUndoContext)(implicit ec: ExecutionContext): Future[Option[String]] =
    edit.resultingState match {
      case None => Future.successful(Some(missing(edit)))
      case Some(json) =>
        val journaled = json.convertTo[DashboardResponse]
        ctx.dashboardRepo.findById(DashboardId(journaled.id), Some(user)).map {
          case None => Some(changed(edit, s"dashboard ${journaled.id} no longer exists"))
          case Some(liveDashboard) =>
            val live = DashboardResponse.fromDomain(liveDashboard)
            if (live.name == journaled.name && live.appearance == journaled.appearance && live.layout == journaled.layout) None
            else Some(changed(edit, s"dashboard ${journaled.id} was changed since the patch set was applied"))
        }
    }

  // ── dataSource ───────────────────────────────────────────────────────────

  private def checkDataSource(edit: JournaledEdit, user: AuthenticatedUser, ctx: PatchSetUndoContext)(implicit ec: ExecutionContext): Future[Option[String]] =
    edit.resultingState match {
      case None => Future.successful(Some(missing(edit)))
      case Some(json) =>
        val journaled = json.convertTo[DataSourceResponse]
        ctx.dataSourceRepo.findByIdOwned(DataSourceId(journaled.id), user).map {
          case None => Some(changed(edit, s"data source ${journaled.id} no longer exists"))
          case Some(live) =>
            if (live.name == journaled.name) None
            else Some(changed(edit, s"data source ${journaled.id} was renamed since the patch set was applied"))
        }
    }

  // ── dataType ─────────────────────────────────────────────────────────────

  private def checkDataType(edit: JournaledEdit, user: AuthenticatedUser, ctx: PatchSetUndoContext)(implicit ec: ExecutionContext): Future[Option[String]] =
    edit.resultingState match {
      case None => Future.successful(Some(missing(edit)))
      case Some(json) =>
        val journaled = json.convertTo[DataTypeResponse]
        ctx.dataTypeRepo.findByIdOwned(DataTypeId(journaled.id), user).map {
          case None => Some(changed(edit, s"data type ${journaled.id} no longer exists"))
          case Some(liveDataType) =>
            val live = DataTypeResponse.fromDomain(liveDataType)
            if (live.name == journaled.name && live.fields == journaled.fields && live.computedFields == journaled.computedFields) None
            else Some(changed(edit, s"data type ${journaled.id} was changed since the patch set was applied"))
        }
    }

  // ── pipeline ─────────────────────────────────────────────────────────────
  //
  // design.md D4a: `PipelineSummaryResponse.lastRunStatus`/`lastRunAt`/`lastRunRowCount` update
  // on every pipeline run (scheduled, manual, or hook-triggered — HEL-340) independent of any
  // patch-set edit, so the comparison below never includes them — only `name`, the one field
  // `PatchSetApplyRollback`'s own `PipelineUpdate` case restores.

  private def checkPipeline(edit: JournaledEdit, user: AuthenticatedUser, ctx: PatchSetUndoContext)(implicit ec: ExecutionContext): Future[Option[String]] =
    edit.resultingState match {
      case None => Future.successful(Some(missing(edit)))
      case Some(json) =>
        val journaled = json.convertTo[PipelineSummaryResponse]
        ctx.pipelineRepo.findByIdOwned(PipelineId(journaled.id), user).map {
          case None => Some(changed(edit, s"pipeline ${journaled.id} no longer exists"))
          case Some(live) =>
            if (live.name == journaled.name) None
            else Some(changed(edit, s"pipeline ${journaled.id} was renamed since the patch set was applied"))
        }
    }

  // ── pipelineStep ─────────────────────────────────────────────────────────

  private def checkPipelineStep(edit: JournaledEdit, ctx: PatchSetUndoContext)(implicit ec: ExecutionContext): Future[Option[String]] =
    edit.resultingState match {
      case None => Future.successful(Some(missing(edit)))
      case Some(json) =>
        val fields    = json.asJsObject.fields
        val stepIdStr = fields.get("id").map(_.convertTo[String]).getOrElse("")
        val journaledType     = fields.get("type").map(_.convertTo[String])
        val journaledConfig   = fields.get("config").map(_.asJsObject)
        val journaledPosition = fields.get("position").map(_.convertTo[Int])
        ctx.pipelineStepRepo.findByIdInternal(PipelineStepId(stepIdStr)).map {
          case None => Some(changed(edit, s"pipeline step $stepIdStr no longer exists"))
          case Some(live) =>
            encodedStepConfig(live) match {
              case None =>
                log.error(s"pipelineStep conflict-check: failed to encode current config for step ${live.id.value}")
                Some(changed(edit, s"pipeline step $stepIdStr could not be compared"))
              case Some(liveConfig) =>
                val matches =
                  Some(live.kind) == journaledType &&
                    Some(liveConfig) == journaledConfig &&
                    Some(live.position) == journaledPosition
                if (matches) None
                else Some(changed(edit, s"pipeline step $stepIdStr was changed since the patch set was applied"))
            }
        }
    }

  private def encodedStepConfig(step: PipelineStep): Option[JsObject] =
    try Some(JsonParser(PipelineStepConfigCodec.encode(step)).asJsObject)
    catch { case NonFatal(_) => None }
}
