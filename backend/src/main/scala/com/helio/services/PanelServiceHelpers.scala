package com.helio.services

import com.helio.api.RequestValidation
import com.helio.api.protocols.{CreatePanelRequest, PanelAppearancePayload, PanelBatchItem, UpdatePanelRequest}
import com.helio.domain._
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
    case PanelConfigCodec.MetricCreate(c)   => MetricPanel(id, dashboardId, title, meta, appearance, ownerId, c)
    case PanelConfigCodec.ChartCreate(c)    => ChartPanel(id, dashboardId, title, meta, appearance, ownerId, c)
    case PanelConfigCodec.TableCreate(c)    => TablePanel(id, dashboardId, title, meta, appearance, ownerId, c)
    case PanelConfigCodec.TextCreate(c)     => TextPanel(id, dashboardId, title, meta, appearance, ownerId, c)
    case PanelConfigCodec.MarkdownCreate(c) => MarkdownPanel(id, dashboardId, title, meta, appearance, ownerId, c)
    case PanelConfigCodec.ImageCreate(c)    => ImagePanel(id, dashboardId, title, meta, appearance, ownerId, c)
    case PanelConfigCodec.DividerCreate(c)  => DividerPanel(id, dashboardId, title, meta, appearance, ownerId, c)
    case PanelConfigCodec.CollectionCreate(c) => CollectionPanel(id, dashboardId, title, meta, appearance, ownerId, c)
    case PanelConfigCodec.TimelineCreate(c)   => TimelinePanel(id, dashboardId, title, meta, appearance, ownerId, c)
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

  /** Extract the bound `dataTypeId` a create-side config targets, if any.
   *  The "bound trio" (Metric / Chart / Table), Collection, Timeline, and —
   *  since HEL-244 gave them their own optional `dataTypeId` binding field —
   *  Text / Markdown all carry a binding; the empty-string sentinel
   *  (`decodeCreate` default) means "not set" and is treated as unbound,
   *  mirroring `Panel.dataTypeId`'s own convention.
   *
   *  HEL-316: Text/Markdown were originally omitted here (falling through to
   *  `case _ => None`), which meant `PanelService.create`'s
   *  `rejectCompanionBinding` never checked their `dataTypeId` — a
   *  source-companion (non-pipeline-output) DataType could be bound to a
   *  text/markdown panel's `config.dataTypeId` on ANY create path (direct
   *  `POST /api/panels`, `create_panel`, or — newly reachable with
   *  attacker-supplied content via this ticket's `config` passthrough —
   *  `apply_proposal`), bypassing the V41 pipeline-only-binding rule. Adding
   *  them here closes the gap at its root for every caller of `create`.
   *  HEL-317: Timeline is added here at creation time (not omitted) for the
   *  same reason — every new bound kind must be covered on day one. */
  private[services] def dataTypeIdFromCreateConfig(config: PanelConfigCodec.CreateConfig): Option[DataTypeId] =
    config match {
      case PanelConfigCodec.MetricCreate(c)     => Option(c.dataTypeId).filter(_.value.nonEmpty)
      case PanelConfigCodec.ChartCreate(c)      => Option(c.dataTypeId).filter(_.value.nonEmpty)
      case PanelConfigCodec.TableCreate(c)      => Option(c.dataTypeId).filter(_.value.nonEmpty)
      case PanelConfigCodec.CollectionCreate(c) => Option(c.dataTypeId).filter(_.value.nonEmpty)
      case PanelConfigCodec.TextCreate(c)       => Option(c.dataTypeId).filter(_.value.nonEmpty)
      case PanelConfigCodec.MarkdownCreate(c)   => Option(c.dataTypeId).filter(_.value.nonEmpty)
      case PanelConfigCodec.TimelineCreate(c)   => Option(c.dataTypeId).filter(_.value.nonEmpty)
      case _                                    => None
    }

  /** Extract the `dataTypeId` an incoming PATCH `config` payload explicitly
   *  sets to a non-null value, if any. Absent fields and explicit `null`
   *  (unbind) both yield `None` — the guard only fires on an actual
   *  re-bind attempt, never on unrelated field edits or unbinding. The wire
   *  field name (`dataTypeId`) is shared verbatim across the bound trio's
   *  `*Config.Patch` shapes, so this reads the raw JSON directly rather than
   *  dispatching per subtype. */
  private[services] def dataTypeIdFromConfigPatch(json: JsValue): Option[DataTypeId] =
    json match {
      case JsObject(fields) =>
        fields.get("dataTypeId").collect { case JsString(s) if s.nonEmpty => DataTypeId(s) }
      case _ => None
    }

  /** Extract the bound `metricId` a create-side config targets, if any
   *  (HEL-500). Only the "bound trio" (Metric/Chart/Table) carries a
   *  `metricId` — mirrors `dataTypeIdFromCreateConfig`'s shape, scoped to
   *  the kinds that actually have the field. */
  private[services] def metricIdFromCreateConfig(config: PanelConfigCodec.CreateConfig): Option[MetricId] =
    config match {
      case PanelConfigCodec.MetricCreate(c) => c.metricId
      case PanelConfigCodec.ChartCreate(c)  => c.metricId
      case PanelConfigCodec.TableCreate(c)  => c.metricId
      case _                                => None
    }

  /** Extract the `metricId` an incoming PATCH `config` payload explicitly
   *  sets to a non-null value, if any (HEL-500). Mirrors
   *  `dataTypeIdFromConfigPatch` exactly: absent and explicit `null` both
   *  yield `None` — only an actual re-bind attempt triggers the create/
   *  update-time validation. */
  private[services] def metricIdFromConfigPatch(json: JsValue): Option[MetricId] =
    json match {
      case JsObject(fields) =>
        fields.get("metricId").collect { case JsString(s) if s.nonEmpty => MetricId(s) }
      case _ => None
    }

  /** Extract the bound `metricId` from a panel's stored config, if any
   *  (HEL-500). Only the "bound trio" carries the field; every other panel
   *  kind returns `None`. Mirrors `Panel.dataTypeId`'s trait-level accessor
   *  without promoting `metricId` onto the `Panel` trait itself — kept as a
   *  service-layer concern since only `PanelService`'s read/validation
   *  paths need it. */
  private[services] def metricIdOf(panel: Panel): Option[MetricId] = panel match {
    case mp: MetricPanel => mp.config.metricId
    case cp: ChartPanel  => cp.config.metricId
    case tp: TablePanel  => tp.config.metricId
    case _               => None
  }

  /** Clear a bound-trio panel's `metricId` only, leaving every other config
   *  field (including the raw `dataTypeId`/`fieldMapping` trio) untouched.
   *  A no-op for any non-bound-trio panel. Distinct from
   *  `Panel.withBindingCleared`, which wipes the *entire* binding — HEL-500
   *  design.md D3 requires an unresolvable `metricId` to clear independently
   *  of the panel's raw fields. */
  private[services] def withMetricCleared(panel: Panel): Panel = panel match {
    case mp: MetricPanel => mp.copy(config = mp.config.copy(metricId = None))
    case cp: ChartPanel  => cp.copy(config = cp.config.copy(metricId = None))
    case tp: TablePanel  => tp.copy(config = tp.config.copy(metricId = None))
    case other           => other
  }

  /** `MetricPanel`-only (HEL-500 design.md D4): materialize the effective
   *  `dataTypeId`/`fieldMapping`/`aggregation`/`unit` from a resolved
   *  `MetricDefinition`, with any raw field the panel's own config already
   *  sets always overriding its metric-derived counterpart. A no-op for
   *  `ChartPanel`/`TablePanel` (and every other kind) — their field mappings
   *  aren't derivable from a single measure field (see `ChartPanelConfig`'s
   *  own scaladoc). */
  private[services] def withMaterializedMetric(panel: Panel, metric: MetricDefinition): Panel = panel match {
    case mp: MetricPanel =>
      val effectiveDataTypeId =
        if (mp.config.dataTypeId.value.nonEmpty) mp.config.dataTypeId else metric.dataTypeId
      val effectiveFieldMapping =
        if (mp.config.fieldMapping.fields.nonEmpty) mp.config.fieldMapping
        else JsObject("value" -> JsString(metric.measureField))
      val effectiveAggregation = mp.config.aggregation.orElse(
        Some(JsObject("value" -> JsString(metric.measureField), "agg" -> JsString(metric.aggregation)))
      )
      val effectiveUnit = mp.config.unit.orElse(metric.format.unit)
      mp.copy(config = mp.config.copy(
        dataTypeId   = effectiveDataTypeId,
        fieldMapping = effectiveFieldMapping,
        aggregation  = effectiveAggregation,
        unit         = effectiveUnit
      ))
    case other => other
  }

  /** Peek an incoming PATCH `config` payload's `aggregation` field, tolerant
   *  raw-JSON style (mirrors `chartTypeFromAppearanceJson`/
   *  `dataTypeIdFromConfigPatch`): `Some(true)` = the patch sets a JsObject
   *  aggregation spec, `Some(false)` = the patch explicitly clears it
   *  (`null`), `None` = the field is absent from this patch (unchanged). */
  private[services] def aggregationPresenceFromConfigPatch(json: JsValue): Option[Boolean] =
    json match {
      case JsObject(fields) =>
        fields.get("aggregation") match {
          case Some(_: JsObject) => Some(true)
          case Some(JsNull)      => Some(false)
          case _                 => None
        }
      case _ => None
    }

  /** D2's single-update enforcement site: reject a PATCH that would result in
   *  a `ChartPanel` combining `chartType: "scatter"` with a present
   *  `aggregation`, accounting for a partial PATCH (only one of the two
   *  fields provided) against the stored panel's other field. A no-op for any
   *  non-`ChartPanel` — `PanelAppearance.chart` is a field every panel kind
   *  structurally carries, so a `TablePanel`'s incidental value must never
   *  trigger this check. */
  private[services] def validateScatterAggregationConflict(
      existing: Panel,
      spec: ResolvedPanelPatch
  ): Either[String, Unit] = existing match {
    case cp: ChartPanel =>
      val effectiveChartType =
        spec.appearance.orElse(Some(cp.appearance)).flatMap(_.chart).flatMap(_.chartType)
      val effectiveAggregationPresent =
        spec.configPatch.flatMap(aggregationPresenceFromConfigPatch).getOrElse(cp.config.aggregation.isDefined)
      ChartPanel.rejectsAggregation(effectiveChartType, effectiveAggregationPresent) match {
        case Some(msg) => Left(msg)
        case None      => Right(())
      }
    case _ => Right(())
  }

  /** D2's batch-update enforcement site: same rule, same type-narrowing
   *  guard, applied per `(item, panel)` pair before the transactional batch
   *  write so one conflicting item 400s the whole batch (no partial write). */
  private[services] def validateBatchAggregationConflict(
      pairs: Vector[(PanelBatchItem, Panel)]
  ): Either[String, Unit] =
    pairs.foldLeft[Either[String, Unit]](Right(())) {
      case (Left(err), _) => Left(err)
      case (Right(_), (item, panel: ChartPanel)) =>
        val effectiveChartType =
          item.appearance.flatMap(chartTypeFromAppearanceJson).orElse(panel.appearance.chart.flatMap(_.chartType))
        val effectiveAggregationPresent =
          item.config.flatMap(aggregationPresenceFromConfigPatch).getOrElse(panel.config.aggregation.isDefined)
        ChartPanel.rejectsAggregation(effectiveChartType, effectiveAggregationPresent) match {
          case Some(msg) => Left(s"panel '${item.id}': $msg")
          case None      => Right(())
        }
      case (Right(_), _) => Right(())
    }
}
