package com.helio.api.protocols.agents

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import com.helio.domain.model.AgentPreferences
import spray.json._

// ── AgentPreferences API types (HEL-472 / 420-A) ─────────────────────────────

/** `GET`/`PUT /api/preferences` response body. Decoupled from the domain `AgentPreferences` case
 *  class (design.md Decision 4a): carries neither `userId` (the caller's identity, never echoed
 *  on the wire) nor `updatedAt` (a repository-internal audit column with no consumer in this
 *  ticket's scope).
 *
 *  `memoryEnabled` (HEL-531 / 420-E design.md Decision 1) -- always present, read-only via this
 *  response; written only through the dedicated `PUT /api/preferences/memory-enabled` (see
 *  `PutMemoryEnabledRequest` below), never through `PutAgentPreferencesRequest`. */
final case class AgentPreferencesResponse(
    defaultSeriesColors: Option[Vector[String]],
    defaultPanelStyle: Option[JsObject],
    namingConventions: Option[JsObject],
    extras: JsObject,
    memoryEnabled: Boolean
)

/** `PUT /api/preferences` body -- a full replace of the caller's stored preferences (design.md
 *  Decision 4). `extras` is `Option[JsObject]` (not a bare `JsObject`) so an absent key
 *  round-trips through spray-json's built-in `Option` handling exactly like an explicit `{}` --
 *  `AgentPreferencesService.put` normalizes both to `JsObject.empty`, clearing any
 *  previously-stored `extras` rather than merging.
 *
 *  Deliberately carries NO `memoryEnabled` field (HEL-531 / 420-E design.md Decision 1) -- see
 *  `PutMemoryEnabledRequest`'s own dedicated endpoint below. */
final case class PutAgentPreferencesRequest(
    defaultSeriesColors: Option[Vector[String]],
    defaultPanelStyle: Option[JsObject],
    namingConventions: Option[JsObject],
    extras: Option[JsObject]
)

/** `PUT /api/preferences/memory-enabled` body (HEL-531 / 420-E design.md Decision 1) -- a new,
 *  minimal, single-field wire type, deliberately separate from `PutAgentPreferencesRequest` so an
 *  already-shipped, memoryEnabled-unaware caller of the general full-replace endpoint can never
 *  accidentally reset this flag. */
final case class PutMemoryEnabledRequest(memoryEnabled: Boolean)

object AgentPreferencesResponse {
  def fromDomain(prefs: AgentPreferences): AgentPreferencesResponse =
    AgentPreferencesResponse(
      defaultSeriesColors = prefs.defaultSeriesColors,
      defaultPanelStyle   = prefs.defaultPanelStyle,
      namingConventions   = prefs.namingConventions,
      extras              = prefs.extras,
      memoryEnabled       = prefs.memoryEnabled
    )
}

trait AgentPreferencesProtocol extends SprayJsonSupport with DefaultJsonProtocol {
  implicit val agentPreferencesResponseFormat: RootJsonFormat[AgentPreferencesResponse] = jsonFormat5(AgentPreferencesResponse.apply)
  implicit val putAgentPreferencesRequestFormat: RootJsonFormat[PutAgentPreferencesRequest] = jsonFormat4(PutAgentPreferencesRequest.apply)
  implicit val putMemoryEnabledRequestFormat: RootJsonFormat[PutMemoryEnabledRequest] = jsonFormat1(PutMemoryEnabledRequest.apply)
}
