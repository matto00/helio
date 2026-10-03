package com.helio.api.protocols.panels

import com.helio.api.protocols.ResourceProtocol
import com.helio.api.protocols.ResourceMetaResponse
import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import com.helio.domain.model._
import com.helio.domain.panels._
import spray.json._


final case class PanelAppearancePayload(
    background: Option[String],
    color: Option[String],
    transparency: Option[Double],
    chart: Option[ChartAppearance]
)
final case class PanelAppearanceResponse(
    background: String,
    color: String,
    transparency: Double,
    chart: Option[ChartAppearance]
)

/** `{x, y, w, h}` — the grid position/size a panel was just placed at.
 *  Populated only by `POST /api/panels` (decision-15 server-owned default
 *  size, HEL-909 CR1); every other `PanelResponse` producer passes `None`
 *  since layout is otherwise a dashboard-owned field
 *  (`dashboards.layout`), not re-echoed per panel. */
final case class PanelLayoutResponse(x: Int, y: Int, w: Int, h: Int)

/** HEL-1071: the item the server stored in EACH breakpoint when it placed a new Output panel
 *  (`POST /api/panels` only). Authoritative: the client adopts these instead of projecting `layout`
 *  (the lg item, kept for compatibility) into md/sm/xs itself. */
final case class PanelLayoutsResponse(lg: PanelLayoutResponse, md: PanelLayoutResponse, sm: PanelLayoutResponse, xs: PanelLayoutResponse)

/** CS2c-3c discriminated wire shape: every panel response carries a `type`
 *  discriminator and a typed `config` payload whose shape is determined by
 *  the discriminator. Per-subtype flat nullable fields at the response root
 *  are gone — readers narrow on `type` and read fields from `config`.
 *
 *  `dataAsOf` (HEL-234, HEL-1177 corrected): populated ONLY by the shared public panel-list
 *  route (`PublicDashboardRoutes`, `GET /api/dashboards/:id/panels`, from the bound pipeline's
 *  `lastRunAt` for an Output panel); every other `PanelResponse.fromDomain` caller
 *  (create/update/dashboard-contents/snapshot/proposals/patchsets) passes `None`. */
final case class PanelResponse(
    id: String,
    dashboardId: String,
    title: String,
    `type`: String,
    meta: ResourceMetaResponse,
    appearance: PanelAppearanceResponse,
    // HEL-1197: `None` (key omitted on the wire) ONLY for the anonymous/share-token-only public
    // panel list (`PublicDashboardRoutes`); every other producer emits `Some(ownerId)`.
    ownerId: Option[String],
    config: JsValue,
    dataAsOf: Option[String],
    layout: Option[PanelLayoutResponse] = None,
    layouts: Option[PanelLayoutsResponse] = None
)
final case class PanelsResponse(items: Vector[PanelResponse])

/** Create request — `{ dashboardId, title?, type, config, appearance? }`.
 *  `config` is a typed JSON object whose shape is determined by `type`; the
 *  per-subtype decoder under `domain/panels` resolves it (tolerant of `{}`).
 *
 *  `appearance` (HEL-305) is an optional creation-time appearance with the same
 *  wire shape as the PATCH appearance (`PanelAppearancePayload`). When present
 *  it is normalized + `chartType`-validated and stored on the created panel in
 *  place of `PanelAppearance.Default`; when absent the default is applied
 *  exactly as before. Additive and non-breaking. */
final case class CreatePanelRequest(
    dashboardId: Option[String],
    title: Option[String],
    `type`: Option[String],
    config: Option[JsValue],
    appearance: Option[PanelAppearancePayload] = None
)

/** Update request — `{ title?, appearance?, type?, config? }`. `config`
 *  (when present) carries a typed patch whose shape matches the request's
 *  `type` (and at the service layer, the stored panel's type — cross-type
 *  PATCH is rejected with 400). Within `config`, fields use absent-vs-null
 *  semantics per the per-subtype `Patch.decode`.
 *
 *  `appearance` (HEL-362) is a raw `JsValue` passthrough — mirroring `config`
 *  — so the service layer can decode it against the stored panel's appearance
 *  with full absent-vs-null merge semantics via `PanelAppearance.applyPatchJson`. */
final case class UpdatePanelRequest(
    title: Option[String],
    appearance: Option[JsValue],
    `type`: Option[String],
    config: Option[JsValue]
)

/** Batch entry mirrors the single-update shape. */
final case class PanelBatchItem(
    id: String,
    title: Option[String],
    appearance: Option[JsValue],
    `type`: Option[String],
    config: Option[JsValue]
)
final case class UpdatePanelsBatchRequest(fields: Vector[String], panels: Vector[PanelBatchItem])
final case class UpdatePanelsBatchResponse(panels: Vector[PanelResponse])

/** Batch-create entry (HEL-370) — `CreatePanelRequest` minus `dashboardId`,
 *  which is lifted to the envelope (`CreatePanelsBatchRequest`) since every
 *  item in one batch targets the same dashboard (design.md D3). */
final case class CreatePanelBatchItem(
    title: Option[String],
    `type`: Option[String],
    config: Option[JsValue],
    appearance: Option[PanelAppearancePayload] = None
)
final case class CreatePanelsBatchRequest(dashboardId: Option[String], panels: Vector[CreatePanelBatchItem])
final case class CreatePanelsBatchResponse(panels: Vector[PanelResponse])

/** HEL-1087 design.md D2: request body for `POST /api/panels/:id/submit` — `{"values":
 *  {"<sourceField>": <typed JSON>}}`, and NOTHING else. The write target is the panel's own
 *  persisted `dataSourceId`; a request cannot name a source, so any OTHER top-level key (e.g. a
 *  `dataSourceId` the client tried to redirect the write with) is a decode failure, not a
 *  silently-ignored extra field — mirrors `FormPanelConfig.format.read`'s closed-key strictness
 *  (schemas/panels/form-submit-request.schema.json titled `FormSubmitRequest`). */
final case class FormSubmitRequest(values: JsObject)

/** HEL-1087 design.md D2/D5: one field-level validation failure on the wire — `field` names the
 *  offending key, `reason` is one of `FormSubmission.buildRow`'s pinned reasons or
 *  `DatasetRowValidator`'s `"expected <type>, got <kind>"` template
 *  (schemas/shared/field-validation-error-response.schema.json's `$defs` entry). */
final case class FieldValidationError(field: String, reason: String)

/** HEL-1087 design.md D5: the `400` body for a validation-rejected submit — `message` is kept so
 *  `extractErrorMessage` and every existing client-side error-message reader keep working
 *  unchanged; `fieldErrors` is the new, structured addition a form can actually associate per
 *  control (titled `FieldValidationErrorResponse`). */
final case class FieldValidationErrorResponse(message: String, fieldErrors: Vector[FieldValidationError])

object PanelResponse {

  /** Build a discriminated-wire response from the typed `Panel` ADT.
   *
   *  CS2c-3c collapses the prior wide-flat shape (8 nullable subtype fields
   *  at the root) to `type` + typed `config`. Per-subtype `*Config` already
   *  carries a `RootJsonFormat`; this dispatcher selects it and emits the
   *  config payload as the `config` field.
   *
   *  `dataAsOf` (HEL-234, HEL-1177 corrected): only the public panel-list route passes a value
   *  (see the class doc comment above); every other call site passes `None`.
   *
   *  `includeOwnerId` (HEL-1197, widened by HEL-1216 to ALL owner-identifying fields: `ownerId` AND
   *  `meta.createdBy`, which equals the creator's id): defaults `true` so every non-public call site
   *  is byte-identical; the public panel-list route passes `false` for any caller who is neither the
   *  dashboard's owner nor the panel's creator, so the internal owner id never reaches the public
   *  wire. One flag drives both fields so they cannot drift apart.
   *
   *  `orphanedControlIds` (HEL-1189 design.md D5): `None` (every existing call site, unchanged
   *  behavior) emits `config` via the plain `PanelConfigCodec.encodeConfig` — no `orphaned` key on
   *  any control, exactly as before this ticket. `Some(ids)` — passed only by the read path that
   *  has actually computed live orphan status against the Output's CURRENT schema/contract
   *  (`PublicDashboardRoutes`'s panel-list route, `resolveOrphanedControlIds`) — instead emits
   *  `OutputPanelConfig.responseJson`, which bakes `orphaned: Boolean` onto every control. Ignored
   *  for every non-`OutputPanel` kind. */
  def fromDomain(
      panel: Panel,
      dataAsOf: Option[String] = None,
      layout: Option[PanelLayoutResponse] = None,
      layouts: Option[PanelLayoutsResponse] = None,
      orphanedControlIds: Option[Set[String]] = None,
      includeOwnerId: Boolean = true
  ): PanelResponse =
    PanelResponse(
      id          = panel.id.value,
      dashboardId = panel.dashboardId.value,
      title       = panel.title,
      `type`      = panel.kind,
      meta        = ResourceMetaResponse.fromDomain(panel.meta, includeCreatedBy = includeOwnerId),
      appearance  = PanelAppearanceResponse.fromDomain(panel.appearance),
      ownerId     = if (includeOwnerId) Some(panel.ownerId.value) else None,
      config      = configJsonFor(panel, orphanedControlIds),
      dataAsOf    = dataAsOf,
      layout      = layout,
      layouts     = layouts
    )

  private def configJsonFor(panel: Panel, orphanedControlIds: Option[Set[String]]): JsValue =
    (panel, orphanedControlIds) match {
      case (op: OutputPanel, Some(orphanedIds)) => OutputPanelConfig.responseJson(op.config, orphanedIds)
      case _                                    => PanelConfigCodec.encodeConfig(panel)
    }
}

object PanelAppearanceResponse {
  def fromDomain(appearance: PanelAppearance): PanelAppearanceResponse =
    PanelAppearanceResponse(
      background   = appearance.background,
      color        = appearance.color,
      transparency = appearance.transparency,
      chart        = appearance.chart
    )
}

/** `PanelProtocol extends ResourceProtocol` because `PanelResponse` carries a
 *  `ResourceMetaResponse` (and thus `panelResponseFormat`'s `jsonFormatN`
 *  macro needs `resourceMetaResponseFormat` in implicit scope at definition
 *  time). This is a passive structural dependency — `ResourceProtocol`
 *  does not depend on anything panel-related. */
trait PanelProtocol extends SprayJsonSupport with DefaultJsonProtocol with ResourceProtocol {
  // Domain helpers used by panel-scoped JSON blobs (e.g. panels referenced in layout payloads)
  implicit val panelIdFormat: JsonFormat[PanelId] = new JsonFormat[PanelId] {
    def write(id: PanelId): JsValue = JsString(id.value)
    def read(json: JsValue): PanelId = json match {
      case JsString(s) => PanelId(s)
      case x           => deserializationError(s"Expected string for PanelId, got $x")
    }
  }
  implicit val panelTypeFormat: JsonFormat[PanelType] = new JsonFormat[PanelType] {
    def write(t: PanelType): JsValue = JsString(PanelType.asString(t))
    def read(json: JsValue): PanelType = json match {
      case JsString(s) => PanelType.fromString(s).fold(deserializationError(_), identity)
      case x           => deserializationError(s"Expected string for PanelType, got $x")
    }
  }

  implicit val chartLegendFormat: RootJsonFormat[ChartLegend]         = jsonFormat2(ChartLegend.apply)
  implicit val chartTooltipFormat: RootJsonFormat[ChartTooltip]       = jsonFormat1(ChartTooltip.apply)
  implicit val chartAxisLabelFormat: RootJsonFormat[ChartAxisLabel]   = jsonFormat2(ChartAxisLabel.apply)
  implicit val chartAxisLabelsFormat: RootJsonFormat[ChartAxisLabels] = jsonFormat2(ChartAxisLabels.apply)
  implicit val chartAppearanceFormat: RootJsonFormat[ChartAppearance] = jsonFormat5(ChartAppearance.apply)
  implicit val panelAppearanceFormat: RootJsonFormat[PanelAppearance] = jsonFormat4(PanelAppearance.apply)

  implicit val panelAppearancePayloadFormat: RootJsonFormat[PanelAppearancePayload]   = jsonFormat4(PanelAppearancePayload.apply)
  implicit val panelAppearanceResponseFormat: RootJsonFormat[PanelAppearanceResponse] = jsonFormat4(PanelAppearanceResponse.apply)
  implicit val panelLayoutResponseFormat: RootJsonFormat[PanelLayoutResponse]         = jsonFormat4(PanelLayoutResponse.apply)
  implicit val panelLayoutsResponseFormat: RootJsonFormat[PanelLayoutsResponse]       = jsonFormat4(PanelLayoutsResponse.apply)
  implicit val panelResponseFormat: RootJsonFormat[PanelResponse]                     = jsonFormat11(PanelResponse.apply)
  implicit val panelsResponseFormat: RootJsonFormat[PanelsResponse]                   = jsonFormat1(PanelsResponse.apply)

  /** Create request — typed `config` raw `JsValue` field is resolved by
   *  the service via [[PanelConfigCodec.decodeCreateConfig]] once `type`
   *  is validated. The wire is `{ dashboardId?, title?, type?, config? }`. */
  implicit val createPanelRequestFormat: RootJsonFormat[CreatePanelRequest] = jsonFormat5(CreatePanelRequest.apply)

  /** Custom format for `UpdatePanelRequest` — `config` and `appearance` are
   *  both preserved as raw `JsValue` so the service can decode them against
   *  the stored panel's type/appearance with full absent-vs-null semantics. */
  implicit val updatePanelRequestFormat: RootJsonFormat[UpdatePanelRequest] =
    new RootJsonFormat[UpdatePanelRequest] {
      def write(r: UpdatePanelRequest): JsValue = {
        val fields = scala.collection.mutable.Map.empty[String, JsValue]
        r.title.foreach(v => fields("title") = JsString(v))
        r.appearance.foreach(v => fields("appearance") = v)
        r.`type`.foreach(v => fields("type") = JsString(v))
        r.config.foreach(v => fields("config") = v)
        JsObject(fields.toMap)
      }

      def read(json: JsValue): UpdatePanelRequest = {
        val obj = json.asJsObject
        UpdatePanelRequest(
          title      = obj.fields.get("title").map(_.convertTo[String]),
          appearance = obj.fields.get("appearance"),
          `type`     = obj.fields.get("type").map(_.convertTo[String]),
          config     = obj.fields.get("config")
        )
      }
    }

  implicit val panelBatchItemFormat: RootJsonFormat[PanelBatchItem] =
    new RootJsonFormat[PanelBatchItem] {
      def write(item: PanelBatchItem): JsValue = {
        val fields = scala.collection.mutable.Map.empty[String, JsValue]
        fields("id") = JsString(item.id)
        item.title.foreach(v => fields("title") = JsString(v))
        item.appearance.foreach(v => fields("appearance") = v)
        item.`type`.foreach(v => fields("type") = JsString(v))
        item.config.foreach(v => fields("config") = v)
        JsObject(fields.toMap)
      }

      def read(json: JsValue): PanelBatchItem = {
        val obj = json.asJsObject
        val id = obj.fields.get("id") match {
          case Some(JsString(s)) => s
          case _                 => deserializationError("PanelBatchItem.id is required")
        }
        PanelBatchItem(
          id         = id,
          title      = obj.fields.get("title").map(_.convertTo[String]),
          appearance = obj.fields.get("appearance"),
          `type`     = obj.fields.get("type").map(_.convertTo[String]),
          config     = obj.fields.get("config")
        )
      }
    }
  implicit val updatePanelsBatchRequestFormat: RootJsonFormat[UpdatePanelsBatchRequest]   = jsonFormat2(UpdatePanelsBatchRequest.apply)
  implicit val updatePanelsBatchResponseFormat: RootJsonFormat[UpdatePanelsBatchResponse] = jsonFormat1(UpdatePanelsBatchResponse.apply)

  /** Batch-create (HEL-370) — mirrors `createPanelRequestFormat`'s plain
   *  `jsonFormatN` derivation (no absent-vs-null merge semantics needed here,
   *  unlike the PATCH batch formats above: every field is create-time only). */
  implicit val createPanelBatchItemFormat: RootJsonFormat[CreatePanelBatchItem] = jsonFormat4(CreatePanelBatchItem.apply)
  implicit val createPanelsBatchRequestFormat: RootJsonFormat[CreatePanelsBatchRequest] = jsonFormat2(CreatePanelsBatchRequest.apply)
  implicit val createPanelsBatchResponseFormat: RootJsonFormat[CreatePanelsBatchResponse] = jsonFormat1(CreatePanelsBatchResponse.apply)

  /** HEL-1087 design.md D2: hand-rolled, strict — `values` is the ONLY recognized key; any other
   *  top-level key (e.g. a `dataSourceId` attempting to redirect the write) is a decode failure,
   *  mirroring `FormPanelConfig.format.read`'s closed-key strictness (tasks.md 1.6). */
  implicit val formSubmitRequestFormat: RootJsonFormat[FormSubmitRequest] = new RootJsonFormat[FormSubmitRequest] {
    def write(r: FormSubmitRequest): JsValue = JsObject("values" -> r.values)

    def read(json: JsValue): FormSubmitRequest = json match {
      case JsObject(fields) =>
        val unknown = fields.keySet - "values"
        if (unknown.nonEmpty)
          deserializationError(s"Unrecognized submit attribute(s): ${unknown.toSeq.sorted.mkString(", ")}")
        fields.get("values") match {
          case Some(v: JsObject) => FormSubmitRequest(v)
          case Some(x)           => deserializationError(s"values must be an object, got $x")
          case None              => deserializationError("values is required")
        }
      case x => deserializationError(s"submit request must be an object, got $x")
    }
  }

  implicit val fieldValidationErrorFormat: RootJsonFormat[FieldValidationError] = jsonFormat2(FieldValidationError.apply)
  implicit val fieldValidationErrorResponseFormat: RootJsonFormat[FieldValidationErrorResponse] =
    jsonFormat2(FieldValidationErrorResponse.apply)
}
