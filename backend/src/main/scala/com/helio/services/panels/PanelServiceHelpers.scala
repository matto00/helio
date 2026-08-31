package com.helio.services.panels

import com.helio.api.http.RequestValidation
import com.helio.api.protocols.panels.{CreatePanelRequest, PanelAppearancePayload, PanelBatchItem, UpdatePanelRequest}
import com.helio.domain.model._
import com.helio.domain.panels._
import spray.json.{JsNull, JsObject, JsString, JsValue}

/** Static helpers extracted from the [[PanelService]] companion to keep
 *  that file within the 300-line budget. Methods retain their original
 *  visibility; `validatePanelTypeOpt` is promoted from `private` (companion
 *  scope) to `private[services]` so [[PanelService]] can call it. */
object PanelServiceHelpers {

  /** Validate + normalize an `UpdatePanelRequest`. The `config` patch JsValue
   *  is preserved as-is and decoded against the stored panel's typed shape
   *  at apply-time (via [[PanelConfigCodec.applyConfigPatch]]).
   *
   *  Cross-type PATCH lock: if the request carries an explicit `type` that
   *  differs from the stored panel's `kind`, return 400 here. */
  def resolvePatch(request: UpdatePanelRequest, existing: Panel): Either[String, ResolvedPanelPatch] = {
    val trimmedTitle = request.title.map(_.trim)
    for {
      _            <- if (trimmedTitle.contains("")) Left("title must not be blank") else Right(())
      panelTypeOpt <- validatePanelTypeOpt(request.`type`)
      _            <- panelTypeOpt match {
                        case Some(pt) if PanelType.asString(pt) != existing.kind =>
                          Left(s"cannot change panel type: stored type is '${existing.kind}', request type is '${PanelType.asString(pt)}'")
                        case _ => Right(())
                      }
      // HEL-362: merge the payload over the stored appearance rather than
      // rebuilding from defaults — a field absent from the payload preserves
      // `existing.appearance`'s value; `chartType` is still validated
      // (RequestValidation.validateChartType, via ChartAppearance.Patch.decode)
      // so an invalid value (e.g. "donut") is rejected identically to create.
      appearanceOpt <- request.appearance match {
                         case None       => Right(None)
                         case Some(json) => PanelAppearance.applyPatchJson(json, existing.appearance).map(Some(_))
                       }
      resolved = ResolvedPanelPatch(
                   trimmedTitle = trimmedTitle,
                   appearance   = appearanceOpt,
                   panelType    = panelTypeOpt,
                   configPatch  = request.config
                 )
      _ <- if (resolved.hasAnyField) Right(()) else Left("at least one field is required")
    } yield resolved
  }

  /** Normalize a wire appearance payload into a domain `PanelAppearance`,
   *  validating `chart.chartType` against the allowed set (HEL-305 D1/D5).
   *  Shared by the create path (`resolveCreateAppearance`) and the single-item
   *  PATCH path (`resolvePatch`) so both reject invalid chart types identically. */
  private[services] def normalizeAppearancePayload(
      p: PanelAppearancePayload
  ): Either[String, PanelAppearance] =
    RequestValidation.validateChartType(p.chart.flatMap(_.chartType)).map { _ =>
      PanelAppearance(
        background   = RequestValidation.normalizePanelBackground(p.background),
        color        = RequestValidation.normalizePanelColor(p.color),
        transparency = RequestValidation.normalizeTransparency(p.transparency),
        chart        = p.chart
      )
    }

  /** Resolve the create-time appearance: normalize + validate a provided
   *  payload, or fall back to `PanelAppearance.Default` when absent (HEL-305). */
  private[services] def resolveCreateAppearance(
      payloadOpt: Option[PanelAppearancePayload]
  ): Either[String, PanelAppearance] =
    payloadOpt.fold[Either[String, PanelAppearance]](Right(PanelAppearance.Default))(normalizeAppearancePayload)

  /** Validate every batch item's `appearance.chart.chartType` before any write
   *  (HEL-305 D5). An invalid value on any item fails the whole batch so the
   *  transactional update never runs — no partial write.
   *
   *  HEL-362: `item.appearance` is now a raw patch `JsValue` (absent-vs-null
   *  merge semantics), so this reads the `chart.chartType` field directly off
   *  the wire JSON rather than through the old typed `PanelAppearancePayload`
   *  — the actual merge + full validation happens later, in
   *  `PanelAppearance.applyPatchJson` inside `PanelMutationRepository.batchUpdate`;
   *  this is a pre-write check so an invalid value 400s before any write runs. */
  private[services] def validateBatchChartTypes(
      items: Vector[PanelBatchItem]
  ): Either[String, Unit] =
    items.foldLeft[Either[String, Unit]](Right(())) {
      case (Left(err), _) => Left(err)
      case (Right(_), item) =>
        RequestValidation.validateChartType(item.appearance.flatMap(chartTypeFromAppearanceJson)).map(_ => ())
    }

  /** Extract a provided (non-null) `chart.chartType` string from a raw
   *  appearance patch `JsValue`, if any. Absent `chart`, absent `chartType`,
   *  and explicit `null` all yield `None` — those are not validation
   *  failures, only an actual provided string is checked. */
  private def chartTypeFromAppearanceJson(json: JsValue): Option[String] = json match {
    case JsObject(fields) =>
      fields.get("chart") match {
        case Some(JsObject(chartFields)) =>
          chartFields.get("chartType").collect { case JsString(s) => s }
        case _ => None
      }
    case _ => None
  }

  /** Decode the create-side typed config from the request. Discriminator is
   *  required; an absent or empty `config` falls back to the subtype's
   *  `Empty` defaults (codec read-path tolerance rule). */
  private[services] def resolveCreateConfig(request: CreatePanelRequest): Either[String, PanelConfigCodec.CreateConfig] =
    validatePanelType(request.`type`).flatMap { pt =>
      PanelConfigCodec.decodeCreateConfig(PanelType.asString(pt), request.config)
    }

  /** Cross-type batch lock: every entry's request `type` (when present) must
   *  match the stored panel's `kind`. */
  private[services] def validateBatchTypeMatch(
      pairs: Vector[(PanelBatchItem, Panel)]
  ): Either[String, Unit] =
    pairs.foldLeft[Either[String, Unit]](Right(())) {
      case (Left(err), _) => Left(err)
      case (Right(_), (item, panel)) =>
        item.`type` match {
          case Some(t) if t != panel.kind =>
            Left(s"cannot change panel type for '${item.id}': stored type is '${panel.kind}', request type is '$t'")
          case _ => Right(())
        }
    }

  /** Construct a brand-new `Panel` from the decoded typed create-config. */
  private[services] def buildNewPanel(
      id: PanelId,
      dashboardId: DashboardId,
      title: String,
      meta: ResourceMeta,
      appearance: PanelAppearance,
      ownerId: UserId,
      createConfig: PanelConfigCodec.CreateConfig
  ): Panel = createConfig match {
    case PanelConfigCodec.TextCreate(c)     => TextPanel(id, dashboardId, title, meta, appearance, ownerId, c)
    case PanelConfigCodec.MarkdownCreate(c) => MarkdownPanel(id, dashboardId, title, meta, appearance, ownerId, c)
    case PanelConfigCodec.ImageCreate(c)    => ImagePanel(id, dashboardId, title, meta, appearance, ownerId, c)
    case PanelConfigCodec.DividerCreate(c)  => DividerPanel(id, dashboardId, title, meta, appearance, ownerId, c)
    case PanelConfigCodec.OutputCreate(c)     => OutputPanel(id, dashboardId, title, meta, appearance, ownerId, c)
  }

  private[services] def validateCreatePanelRequest(request: CreatePanelRequest): Either[String, DashboardId] =
    request.dashboardId.map(_.trim).filter(_.nonEmpty) match {
      case Some(id) => Right(DashboardId(id))
      case None     => Left("dashboardId is required")
    }

  private[services] def validatePanelType(typeOpt: Option[String]): Either[String, PanelType] =
    typeOpt match {
      case None    => Right(PanelType.Default)
      case Some(t) => PanelType.fromString(t)
    }

  private[services] def validatePanelTypeOpt(typeOpt: Option[String]): Either[String, Option[PanelType]] =
    typeOpt match {
      case None    => Right(None)
      case Some(t) => PanelType.fromString(t).map(Some(_))
    }

  /** Extract the `outputId` an `"output"`-kind create-side config targets, if
   *  any. HEL-904 follow-up (flagged in cycle 17): `buildForCreate`/
   *  `batchCreate` previously never resolved an `"output"`-kind panel's
   *  `outputId` at all — a nonexistent/cross-user id reached `panelRepo.insert`
   *  unchecked and hit the raw `panels.output_id` FK violation as a 500
   *  instead of a clean 400/404. Mirrors `dataTypeIdFromCreateConfig`'s
   *  empty-string-is-unset convention (`OutputPanelConfig.decodeCreate`'s own
   *  default). */
  private[services] def outputIdFromCreateConfig(config: PanelConfigCodec.CreateConfig): Option[OutputId] =
    config match {
      case PanelConfigCodec.OutputCreate(c) => Option(c.outputId).filter(_.value.nonEmpty)
      case _                                => None
    }

  /** Extract the `outputId` an incoming PATCH `config` payload explicitly
   *  sets to a non-null value, if any — same absent-vs-null convention as
   *  `dataTypeIdFromConfigPatch`. */
  private[services] def outputIdFromConfigPatch(json: JsValue): Option[OutputId] =
    json match {
      case JsObject(fields) =>
        fields.get("outputId").collect { case JsString(s) if s.nonEmpty => OutputId(s) }
      case _ => None
    }

  // HEL-904 task 3.9/4.1: metric-binding resolution (metricIdFromCreateConfig/
  // metricIdFromConfigPatch/metricIdOf/withMetricCleared/withMaterializedMetric),
  // the ChartPanel-scatter-aggregation-conflict validators
  // (validateScatterAggregationConflict/validateBatchAggregationConflict/
  // aggregationPresenceFromConfigPatch), and the DataType-binding resolvers
  // (dataTypeIdFromCreateConfig/dataTypeIdFromConfigPatch/
  // rejectCompanionBinding) were removed here — all were scoped exclusively
  // to the now-deleted bound trio (MetricPanel/ChartPanel/TablePanel) or to
  // Text/Markdown's now-removed data-bound "Source mode" (task 4.1); metrics
  // no longer exist and Outputs carry no `aggregation` field on the panel
  // placement side (design.md: everything those configs carried now lives
  // on the Output itself).
}
