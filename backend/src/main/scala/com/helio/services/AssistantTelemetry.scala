package com.helio.services

import com.helio.ai.TokenUsage
import com.helio.infrastructure.MdcPropagatingExecutionContext
import org.slf4j.{Logger, LoggerFactory, MDC}

import java.util.{Map => JMap}
import scala.concurrent.{ExecutionContextExecutor, Future}

/** Structured JSON telemetry for HEL-659's top-level assistant tool loop (HEL-667 design.md D6) —
 *  one `assistant_tool_loop_outcome` log line per successful `POST /:id/converse` call. Sibling to
 *  `AuthoringTelemetry` (same MDC/`MdcPropagatingExecutionContext`/fire-and-forget pattern), NOT a
 *  merge into it: `AuthoringTelemetry`'s own doc comment scopes it to `DashboardAuthoringService`'s
 *  single-shot goal->proposal->apply funnel, a genuinely different code path from the multi-hop tool
 *  loop this object covers.
 *
 *  Trace-id propagation is explicit, never ambient (mirrors `AuthoringTelemetry`'s identical
 *  discipline): `emitToolLoopOutcome` takes the MDC snapshot captured at the ORIGINATING request's
 *  route-evaluation instant (`AssistantConversationRoutes.converseFlow`, `MDC.getCopyOfContextMap()`,
 *  while `TraceContextDirective` still has the trace id set on that thread) and always logs via
 *  `new MdcPropagatingExecutionContext(ec, mdcSnapshot)`, regardless of which pool thread the
 *  triggering `Future` chain actually completes on. Emission is fire-and-forget (a discarded
 *  `Future`) — a telemetry failure must never affect the request it describes.
 *
 *  Never logs the user's typed message text — only `conversationId`/`toolCallCount`/
 *  `hopBudgetExhausted`/`searchedWithNoResults`/`modelId`/token usage ever reach here. */
object AssistantTelemetry {
  private val log: Logger = LoggerFactory.getLogger("com.helio.services.AssistantTelemetry")

  /** `event=assistant_tool_loop_outcome` — emitted once per successful `POST /:id/converse` call
   *  (design.md D6). Callers MUST guard this on `AssistantService.converse` having resolved to
   *  `Right(result)` — never call for a `Left(ClaudeError)`, since no turn actually completed
   *  (design.md's own explicit non-goal: no telemetry line for a failed call). */
  def emitToolLoopOutcome(
      mdcSnapshot: JMap[String, String],
      conversationId: String,
      toolCallCount: Int,
      hopBudgetExhausted: Boolean,
      searchedWithNoResults: Boolean,
      modelId: String,
      tokens: TokenUsage
  )(implicit ec: ExecutionContextExecutor): Unit =
    emit(
      mdcSnapshot,
      Vector(
        "event"                 -> "assistant_tool_loop_outcome",
        "conversationId"        -> conversationId,
        "toolCallCount"         -> toolCallCount.toString,
        "hopBudgetExhausted"    -> hopBudgetExhausted.toString,
        "searchedWithNoResults" -> searchedWithNoResults.toString,
        "modelId"               -> modelId,
        "inputTokens"           -> tokens.inputTokens.toString,
        "outputTokens"          -> tokens.outputTokens.toString,
        "cacheReadInputTokens"     -> tokens.cacheReadInputTokens.toString,
        "cacheCreationInputTokens" -> tokens.cacheCreationInputTokens.toString
      )
    )

  private def emit(mdcSnapshot: JMap[String, String], fields: Vector[(String, String)])(
      implicit ec: ExecutionContextExecutor
  ): Unit = {
    val _ = Future {
      fields.foreach { case (k, v) => MDC.put(k, v) }
      try log.info("assistant_tool_loop_outcome")
      finally fields.foreach { case (k, _) => MDC.remove(k) }
    }(new MdcPropagatingExecutionContext(ec, mdcSnapshot))
  }
}
