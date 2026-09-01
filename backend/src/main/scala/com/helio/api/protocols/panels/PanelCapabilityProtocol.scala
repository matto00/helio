package com.helio.api.protocols.panels

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import spray.json._

//
// Internal shape used by `PanelCapabilityService`'s callers (`RefinementGrounding`,
// `DashboardAuthoringService`, `AssistantToolExecutor`) — the route this originally backed
// (`GET /api/types/:id/panel-capabilities`) was already deleted alongside `DataTypeRoutes` in
// HEL-904 task 4.1 (HEL-904 cycle 29: this file's own comment had gone stale claiming otherwise).
// See `com.helio.services.panels.PanelCapabilityService` for how these are built and
// `com.helio.domain.panels.OutputBindingSpec` for the slot/eligibility source of truth this
// response reports on.

/** One column of an Output's shape — name, wire-string `dataType`
 *  (`DataFieldType.asString`), and nullability. */
final case class PanelCapabilityColumnResponse(name: String, dataType: String, nullable: Boolean)

/** Capability report for one bindable panel kind.
 *
 *  `eligibleColumns` maps every slot in `requiredSlots ++ optionalSlots` to
 *  the column names that satisfy that slot's column-type eligibility
 *  (`PanelBindingSpec`) — advisory, not a bind-time guarantee (a bind
 *  against a column absent from this list still succeeds today; no backend
 *  validator rejects it).
 *
 *  `reason`/`message` are present only when `bindable` is `false`:
 *  `reason = "not-pipeline-output"` carries the exact V41 rejection text
 *  (`PanelService.rejectCompanionBinding`) as `message`; any other
 *  `bindable: false` (a pipeline-output type missing a required slot's
 *  column type) carries a generic `reason = "missing-required-column-type"`.
 *
 *  `eligibleColumns` is type-aliased (not inlined as `Map[String,
 *  Vector[String]]`): a literal top-level `Map[K, V]` field trips
 *  `scripts/check-schema-drift.mjs`'s naive comma-split case-class parser
 *  (it has no bracket-depth tracking), which would misread this one field
 *  as two. */
final case class PanelCapabilityResponse(
    bindable: Boolean,
    requiredSlots: Vector[String],
    optionalSlots: Vector[String],
    eligibleColumns: PanelCapabilityResponse.EligibleColumns,
    reason: Option[String],
    message: Option[String]
)

object PanelCapabilityResponse {
  type EligibleColumns = Map[String, Vector[String]]
}

/** Panel-capability report for one Output — shape signals
 *  (`columns`/`rowCount`/`singleRow`/`isPipelineOutput`) plus one
 *  [[PanelCapabilityResponse]] per bindable Output kind, keyed by
 *  `OutputKind.asString`. `capabilities` is type-aliased for the same
 *  reason as [[PanelCapabilityResponse.eligibleColumns]] above. */
final case class PanelCapabilitiesResponse(
    outputId: String,
    isPipelineOutput: Boolean,
    columns: Vector[PanelCapabilityColumnResponse],
    rowCount: Int,
    singleRow: Boolean,
    capabilities: PanelCapabilitiesResponse.Capabilities
)

object PanelCapabilitiesResponse {
  type Capabilities = Map[String, PanelCapabilityResponse]
}

trait PanelCapabilityProtocol extends SprayJsonSupport with DefaultJsonProtocol {
  implicit val panelCapabilityColumnResponseFormat: RootJsonFormat[PanelCapabilityColumnResponse] =
    jsonFormat3(PanelCapabilityColumnResponse.apply)
  implicit val panelCapabilityResponseFormat: RootJsonFormat[PanelCapabilityResponse] =
    jsonFormat6(PanelCapabilityResponse.apply)
  implicit val panelCapabilitiesResponseFormat: RootJsonFormat[PanelCapabilitiesResponse] =
    jsonFormat6(PanelCapabilitiesResponse.apply)
}
