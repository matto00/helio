package com.helio.services

import com.helio.api.RequestValidation
import com.helio.api.protocols.{CreatePanelRequest, PanelAppearancePayload, PanelBatchItem, UpdatePanelRequest}
import com.helio.domain._
import com.helio.domain.panels._
import spray.json.{JsObject, JsString, JsValue}

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
      // D5 parity — validate `chartType` on the single-item PATCH path too, so
      // an invalid value (e.g. "donut") is rejected identically to create.
      appearanceOpt <- request.appearance match {
                         case None    => Right(None)
                         case Some(p) => normalizeAppearancePayload(p).map(Some(_))
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
   *  transactional update never runs — no partial write. */
  private[services] def validateBatchChartTypes(
      items: Vector[PanelBatchItem]
  ): Either[String, Unit] =
    items.foldLeft[Either[String, Unit]](Right(())) {
      case (Left(err), _) => Left(err)
      case (Right(_), item) =>
        RequestValidation.validateChartType(item.appearance.flatMap(_.chart).flatMap(_.chartType)).map(_ => ())
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
   *  Only the "bound trio" (Metric / Chart / Table) carry a binding; the
   *  empty-string sentinel (`decodeCreate` default) means "not set" and is
   *  treated as unbound, mirroring `Panel.dataTypeId`'s own convention. */
  private[services] def dataTypeIdFromCreateConfig(config: PanelConfigCodec.CreateConfig): Option[DataTypeId] =
    config match {
      case PanelConfigCodec.MetricCreate(c)     => Option(c.dataTypeId).filter(_.value.nonEmpty)
      case PanelConfigCodec.ChartCreate(c)      => Option(c.dataTypeId).filter(_.value.nonEmpty)
      case PanelConfigCodec.TableCreate(c)      => Option(c.dataTypeId).filter(_.value.nonEmpty)
      case PanelConfigCodec.CollectionCreate(c) => Option(c.dataTypeId).filter(_.value.nonEmpty)
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
}
