package com.helio.services.proposals

import com.helio.ai.TokenUsage
import com.helio.infrastructure.concurrency.MdcPropagatingExecutionContext
import org.slf4j.{Logger, LoggerFactory, MDC}

import java.security.MessageDigest
import java.util.{Map => JMap}
import scala.concurrent.{ExecutionContextExecutor, Future}

/** Structured JSON telemetry for the NL-authoring funnel (HEL-401 design.md D3/D4) — one
 *  `authoring_outcome` log line per `author`/`authorStreaming` terminal result (`generated`/
 *  `failed`), and one `authoring_apply_outcome` line per accept/reject correlation call
 *  (design.md D4's two-event realization of the ticket's literal `{accepted,rejected,failed}`
 *  enum — JSON log lines are append-only, so there is no "one record updated in place"). HEL-115's
 *  `LogstashEncoder` surfaces MDC entries as top-level JSON fields, so every telemetry field below
 *  is set via MDC (never string-interpolated into the log message) around one fixed `log.info`
 *  call, mirroring `TraceContextDirective`'s own MDC put/remove convention.
 *
 *  Trace-id propagation is explicit (design.md D3), never ambient: every `emit*` call takes the
 *  MDC snapshot captured at the ORIGINATING request's route-evaluation instant
 *  (`DashboardAuthoringRoutes`, `MDC.getCopyOfContextMap()`, while `TraceContextDirective` still has
 *  the trace id set on that thread) and always logs via `new MdcPropagatingExecutionContext(ec,
 *  mdcSnapshot)` — regardless of which pool thread the triggering `Future`/stream callback actually
 *  completes on. This is the ONE call site in the authoring capability that needs an MDC-aware EC;
 *  every other `Future` in `DashboardAuthoringService` keeps using the plain class-level `ec`.
 *  Emission is fire-and-forget (a discarded `Future`) — a telemetry failure must never affect the
 *  request it describes.
 *
 *  Never logs raw goal text (privacy — only `goalLength` + a truncated hash) or the API key (never
 *  held by this object in the first place — only a `modelId` string ever reaches here). */
object AuthoringTelemetry {
  private val log: Logger = LoggerFactory.getLogger("com.helio.services.AuthoringTelemetry")

  private val GoalHashPrefixLength = 12

  /** First 12 hex chars of the goal's SHA-256 — a de-duplication/correlation aid without ever
   *  persisting or logging the raw text (design.md's own stated privacy trade-off). */
  private[services] def goalHash(goal: String): String =
    MessageDigest.getInstance("SHA-256").digest(goal.getBytes("UTF-8")).map(b => f"$b%02x").mkString.take(GoalHashPrefixLength)

  /** `outcome=generated` — a successful `author`/`authorStreaming` terminal result. */
  def emitGenerated(
      mdcSnapshot: JMap[String, String],
      authoringRequestId: String,
      modelId: String,
      panelCount: Int,
      tokens: TokenUsage,
      goal: String
  )(implicit ec: ExecutionContextExecutor): Unit =
    emit(
      mdcSnapshot,
      "authoring_outcome",
      Vector(
        "event"              -> "authoring_outcome",
        "outcome"            -> "generated",
        "authoringRequestId" -> authoringRequestId,
        "modelId"            -> modelId,
        "panelCount"         -> panelCount.toString,
        "inputTokens"        -> tokens.inputTokens.toString,
        "outputTokens"       -> tokens.outputTokens.toString,
        "goalLength"         -> goal.length.toString,
        "goalHash"           -> goalHash(goal)
      )
    )

  /** `outcome=failed` — a failed `author`/`authorStreaming` terminal result. `kind` is `None` for a
   *  failure outside the ticket's four defined categories (e.g. a missing conversation `NotFound`)
   *  — the `kind` field is simply omitted from the log line in that case, never a placeholder. */
  def emitFailed(
      mdcSnapshot: JMap[String, String],
      kind: Option[AuthoringErrorKind],
      modelId: String,
      tokens: TokenUsage,
      goal: String
  )(implicit ec: ExecutionContextExecutor): Unit =
    emit(
      mdcSnapshot,
      "authoring_outcome",
      Vector(
        Some("event"         -> "authoring_outcome"),
        Some("outcome"       -> "failed"),
        kind.map(k => "kind" -> AuthoringErrorKind.wireName(k)),
        Some("modelId"       -> modelId),
        Some("inputTokens"   -> tokens.inputTokens.toString),
        Some("outputTokens"  -> tokens.outputTokens.toString),
        Some("goalLength"    -> goal.length.toString),
        Some("goalHash"      -> goalHash(goal))
      ).flatten
    )

  /** `POST /api/authoring/requests/:id/outcome` (design.md D4, tasks.md 3.1) — a DISTINCT event
   *  name from `authoring_outcome` above: `outcome` is `accepted`/`rejected`, correlated back to
   *  the originating request purely via `authoringRequestId`. Never touches `apply-proposal`'s own
   *  persistence path — this object only ever logs. */
  def emitApplyOutcome(
      mdcSnapshot: JMap[String, String],
      authoringRequestId: String,
      outcome: String
  )(implicit ec: ExecutionContextExecutor): Unit =
    emit(
      mdcSnapshot,
      "authoring_apply_outcome",
      Vector(
        "event"              -> "authoring_apply_outcome",
        "outcome"            -> outcome,
        "authoringRequestId" -> authoringRequestId
      )
    )

  private def emit(mdcSnapshot: JMap[String, String], message: String, fields: Vector[(String, String)])(
      implicit ec: ExecutionContextExecutor
  ): Unit = {
    val _ = Future {
      fields.foreach { case (k, v) => MDC.put(k, v) }
      try log.info(message)
      finally fields.foreach { case (k, _) => MDC.remove(k) }
    }(new MdcPropagatingExecutionContext(ec, mdcSnapshot))
  }
}
