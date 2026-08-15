package com.helio.api.protocols

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import spray.json._

// ── Assistant-conversation persistence API types (HEL-663) ──────────────────
//
// `AssistantConversationRoutes`'s HTTP surface (design.md D5). `firstMessage`/`turns`/`transcript`
// carry the caller-facing Claude tool-message shape as raw `JsValue`, deliberately -- `ClaudeContentBlock`/
// `ClaudeToolMessage` (`com.helio.ai`) get their OWN spray-json formatter, but it's declared
// repository-internal (`AssistantConversationRepository`'s companion object, design.md D3), never
// under `com.helio.api.protocols` (this package would have to depend on `com.helio.infrastructure` to
// reach it, backwards from this codebase's layering). `AssistantConversationRoutes` converts
// `JsValue <-> ClaudeToolMessage` at the route boundary, importing that repository-internal format
// explicitly -- this file only ever sees opaque JSON for those fields.

/** `POST /api/assistant-conversations` request. `firstMessage`, when supplied, seeds the
 *  conversation's initial transcript and (absent an explicit `title`) drives title derivation
 *  (design.md D6). Both are optional -- a call supplying neither still succeeds, with `title`
 *  defaulting to `"New conversation"` (`AssistantConversationService.resolveTitle`). */
final case class CreateAssistantConversationRequest(title: Option[String], firstMessage: Option[JsValue])

/** `POST /api/assistant-conversations/:id/messages` request — appends one or more turns
 *  (design.md D2: the WHOLE blob is re-written, never appended-in-place). */
final case class AppendAssistantConversationTurnRequest(turns: Vector[JsValue])

/** `PATCH /api/assistant-conversations/:id` request — pin/unpin and/or rename (design.md D5/D6).
 *  Both fields are plain `Option` (absent = unchanged); a rename is permanent, never re-derived. */
final case class UpdateAssistantConversationRequest(pinned: Option[Boolean], title: Option[String])

/** List-item shape (`GET /api/assistant-conversations`) — deliberately compact, no transcript
 *  (design.md D5). */
final case class AssistantConversationSummaryResponse(id: String, title: String, pinned: Boolean, updatedAt: String)

/** Get-one shape (`GET /api/assistant-conversations/:id`) — summary fields plus the transcript,
 *  itself opaque JSON (see this file's header comment). */
final case class AssistantConversationResponse(
    id: String,
    title: String,
    pinned: Boolean,
    updatedAt: String,
    transcript: JsValue
)

trait AssistantConversationProtocol extends SprayJsonSupport with DefaultJsonProtocol {
  implicit val createAssistantConversationRequestFormat: RootJsonFormat[CreateAssistantConversationRequest] =
    jsonFormat2(CreateAssistantConversationRequest.apply)

  implicit val appendAssistantConversationTurnRequestFormat: RootJsonFormat[AppendAssistantConversationTurnRequest] =
    jsonFormat1(AppendAssistantConversationTurnRequest.apply)

  implicit val updateAssistantConversationRequestFormat: RootJsonFormat[UpdateAssistantConversationRequest] =
    jsonFormat2(UpdateAssistantConversationRequest.apply)

  implicit val assistantConversationSummaryResponseFormat: RootJsonFormat[AssistantConversationSummaryResponse] =
    jsonFormat4(AssistantConversationSummaryResponse.apply)

  implicit val assistantConversationResponseFormat: RootJsonFormat[AssistantConversationResponse] =
    jsonFormat5(AssistantConversationResponse.apply)
}
