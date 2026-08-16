package com.helio.api.protocols

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import com.helio.domain.AgentPreferences
import spray.json._

// ── AgentPreferences API types (HEL-472 / 420-A) ─────────────────────────────

/** `GET`/`PUT /api/preferences` response body. Decoupled from the domain `AgentPreferences` case
 *  class (design.md Decision 4a): carries neither `userId` (the caller's identity, never echoed
 *  on the wire) nor `updatedAt` (a repository-internal audit column with no consumer in this
 *  ticket's scope). */
final case class AgentPreferencesResponse(
    defaultSeriesColors: Option[Vector[String]],
    defaultPanelStyle: Option[JsObject],
    namingConventions: Option[JsObject],
    extras: JsObject
)

/** `PUT /api/preferences` body -- a full replace of the caller's stored preferences (design.md
 *  Decision 4). `extras` is `Option[JsObject]` (not a bare `JsObject`) so an absent key
 *  round-trips through spray-json's built-in `Option` handling exactly like an explicit `{}` --
 *  `AgentPreferencesService.put` normalizes both to `JsObject.empty`, clearing any
 *  previously-stored `extras` rather than merging. */
final case class PutAgentPreferencesRequest(
    defaultSeriesColors: Option[Vector[String]],
    defaultPanelStyle: Option[JsObject],
    namingConventions: Option[JsObject],
    extras: Option[JsObject]
)

object AgentPreferencesResponse {
  def fromDomain(prefs: AgentPreferences): AgentPreferencesResponse =
    AgentPreferencesResponse(
      defaultSeriesColors = prefs.defaultSeriesColors,
      defaultPanelStyle   = prefs.defaultPanelStyle,
      namingConventions   = prefs.namingConventions,
      extras              = prefs.extras
    )
}

trait AgentPreferencesProtocol extends SprayJsonSupport with DefaultJsonProtocol {
  implicit val agentPreferencesResponseFormat: RootJsonFormat[AgentPreferencesResponse] = jsonFormat4(AgentPreferencesResponse.apply)
  implicit val putAgentPreferencesRequestFormat: RootJsonFormat[PutAgentPreferencesRequest] = jsonFormat4(PutAgentPreferencesRequest.apply)
}
