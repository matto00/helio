package com.helio.api.protocols

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import org.apache.pekko.util.ByteString
import spray.json._

// ── NL → dashboard-proposal authoring API types (HEL-392) ───────────────────
//
// POST /api/authoring/dashboard's wire shape. See
// `com.helio.services.DashboardAuthoringService` for how these are built —
// grounding context (HEL-371) + panel-capability menu (HEL-365) into a
// prompt, a Claude call (HEL-390), parse, and validation via the SAME checks
// `DashboardProposalService.apply` uses. The endpoint never applies the
// returned proposal.

/** `contextOptions.budgetBytes` mirrors `GET /api/workspace/context`'s own `budgetBytes` query
 *  param (HEL-377) — an optional override of `WorkspaceContextBudget.DefaultBudgetBytes` for the
 *  grounding context this authoring call assembles. Omitted (or the whole `contextOptions` object
 *  omitted) falls back to the default. */
final case class AuthoringContextOptions(budgetBytes: Option[Int])

/** `conversationId` (HEL-397 design.md D1) is the only new field the multi-turn conversation-state
 *  capability adds: absent → today's single-shot behavior, unchanged; present → continues that
 *  (owner-scoped, persisted) conversation, re-using `goal` as "this turn's message." History and
 *  the working proposal are entirely server-owned (design.md D2) — the client never re-sends
 *  either. */
final case class DashboardAuthoringRequest(
    goal: String,
    contextOptions: Option[AuthoringContextOptions],
    conversationId: Option[String] = None
)

/** `warnings` carries degrade-not-fail notices collected while assembling the grounding context
 *  (design.md D3 — e.g. a per-DataType panel-capability fetch that failed) — never a reason the
 *  call itself failed; a non-empty `warnings` still accompanies a real, validated `proposal`.
 *  `conversationId` (HEL-397) identifies the persisted conversation this turn belongs to — pass it
 *  back on the next call's `DashboardAuthoringRequest.conversationId` to continue refining the same
 *  proposal. */
final case class DashboardAuthoringResponse(proposal: DashboardProposal, warnings: Vector[String], conversationId: String)

trait DashboardAuthoringProtocol extends SprayJsonSupport with DefaultJsonProtocol with DashboardProposalProtocol {
  implicit val authoringContextOptionsFormat: RootJsonFormat[AuthoringContextOptions] =
    jsonFormat1(AuthoringContextOptions.apply)
  implicit val dashboardAuthoringRequestFormat: RootJsonFormat[DashboardAuthoringRequest] =
    jsonFormat3(DashboardAuthoringRequest.apply)
  implicit val dashboardAuthoringResponseFormat: RootJsonFormat[DashboardAuthoringResponse] =
    jsonFormat3(DashboardAuthoringResponse.apply)
}

/** SSE event ADT for `POST /api/authoring/dashboard?stream=true` (design.md D7) — mirrors
 *  `com.helio.api.routes.RunStatusEvent`'s `toSseBytes` shape. `Progress` forwards a Claude
 *  text delta as it streams in; `Status("repairing")` is emitted once, before the single buffered
 *  repair attempt (design.md D5), if the first attempt fails to parse/validate; exactly one
 *  terminal `Result` or `Error` event ends the stream — never zero, never two. */
sealed trait AuthoringStreamEvent

object AuthoringStreamEvent extends DashboardProposalProtocol {
  final case class Progress(text: String) extends AuthoringStreamEvent
  final case class Status(label: String) extends AuthoringStreamEvent
  /** `conversationId` (HEL-397) — same additive meaning as `DashboardAuthoringResponse`'s own
   *  field; the streaming terminal event carries it so the client can persist it for a follow-up
   *  turn exactly like the buffered response does. */
  final case class Result(proposal: DashboardProposal, warnings: Vector[String], conversationId: String) extends AuthoringStreamEvent
  final case class Error(message: String) extends AuthoringStreamEvent

  def toSseBytes(event: AuthoringStreamEvent): ByteString = event match {
    case Progress(text) =>
      frame("authoring-progress", JsObject("text" -> JsString(text)))
    case Status(label) =>
      frame("authoring-status", JsObject("label" -> JsString(label)))
    case Result(proposal, warnings, conversationId) =>
      frame("authoring-result", JsObject(
        "proposal" -> proposal.toJson,
        "warnings" -> JsArray(warnings.map(JsString(_))),
        "conversationId" -> JsString(conversationId)
      ))
    case Error(message) =>
      frame("authoring-error", JsObject("message" -> JsString(message)))
  }

  private def frame(eventName: String, data: JsObject): ByteString =
    ByteString(s"event: $eventName\ndata: ${data.compactPrint}\n\n")
}
