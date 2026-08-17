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

/** `POST /api/assistant-conversations/:id/converse` request (HEL-665 reopened composer ticket,
 *  design.md D7) — the one new user-typed message to send. Reuses the existing
 *  [[AssistantConversationResponse]] shape for the return value; no new response type needed, since
 *  the endpoint returns exactly what `GET /:id` already returns.
 *
 *  `idempotencyKey` (HEL-698 design.md D5) — an optional client-generated retry key. Normalized at
 *  the route boundary (trim, blank → absent, longer than 128 chars → `400`), never here — this
 *  case class carries whatever the client sent, unnormalized. spray-json omits `None` on the wire,
 *  so a keyless request is byte-identical to before this change. */
final case class ConverseRequest(message: String, idempotencyKey: Option[String] = None)

/** List-item shape (`GET /api/assistant-conversations`) — deliberately compact, no transcript
 *  (design.md D5). */
final case class AssistantConversationSummaryResponse(id: String, title: String, pinned: Boolean, updatedAt: String)

/** Get-one shape (`GET /api/assistant-conversations/:id`) — summary fields plus the transcript,
 *  itself opaque JSON (see this file's header comment). `hopBudgetExhausted`/`searchedWithNoResults`
 *  (HEL-667 design.md D1) are ephemeral, converse-response-only signals describing the turn that
 *  JUST completed: populated (`Some(...)`, whatever the boolean value) only by `POST /:id/converse`,
 *  always `None` on `GET /:id` — never persisted facts about the conversation as a whole, and never
 *  retrofitted onto a historical turn.
 *
 *  `lastIdempotencyKey` (HEL-698 design.md D5) — UNLIKE the two ephemeral signals above, this IS a
 *  persisted fact about the conversation (the key of the most recent keyed append), so it's populated
 *  on BOTH `GET /:id` and converse responses — exactly what client-side reconciliation needs. `None`
 *  until the first keyed append ever occurs. */
final case class AssistantConversationResponse(
    id: String,
    title: String,
    pinned: Boolean,
    updatedAt: String,
    transcript: JsValue,
    hopBudgetExhausted: Option[Boolean] = None,
    searchedWithNoResults: Option[Boolean] = None,
    lastIdempotencyKey: Option[String] = None
)

/** Tier-gate failure body (HEL-703, design.md D7) -- rendered by `AssistantConversationRoutes`'s
 *  own bespoke completion helper for EVERY endpoint in this family, never `ServiceResponse.run`'s
 *  generic `ErrorResponse` (mirrors `AuthoringErrorResponse`'s reasoning exactly). `code` (not
 *  `kind`, deliberately -- this is a new cross-feature client contract, and `code` is the
 *  conventional axios-side name) is one of `TIER_FORBIDDEN` (403, `free`-tier, every endpoint) or
 *  `CHAT_LIMIT_REACHED` (429, `beta`-tier over the daily cap, converse only) -- `limit` is `Some`
 *  only for the latter. */
final case class TierErrorResponse(code: String, message: String, limit: Option[Int])

trait AssistantConversationProtocol extends SprayJsonSupport with DefaultJsonProtocol {
  implicit val createAssistantConversationRequestFormat: RootJsonFormat[CreateAssistantConversationRequest] =
    jsonFormat2(CreateAssistantConversationRequest.apply)

  implicit val appendAssistantConversationTurnRequestFormat: RootJsonFormat[AppendAssistantConversationTurnRequest] =
    jsonFormat1(AppendAssistantConversationTurnRequest.apply)

  implicit val updateAssistantConversationRequestFormat: RootJsonFormat[UpdateAssistantConversationRequest] =
    jsonFormat2(UpdateAssistantConversationRequest.apply)

  implicit val converseRequestFormat: RootJsonFormat[ConverseRequest] =
    jsonFormat2(ConverseRequest.apply)

  implicit val assistantConversationSummaryResponseFormat: RootJsonFormat[AssistantConversationSummaryResponse] =
    jsonFormat4(AssistantConversationSummaryResponse.apply)

  implicit val assistantConversationResponseFormat: RootJsonFormat[AssistantConversationResponse] =
    jsonFormat8(AssistantConversationResponse.apply)

  implicit val tierErrorResponseFormat: RootJsonFormat[TierErrorResponse] =
    jsonFormat3(TierErrorResponse.apply)
}
