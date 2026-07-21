package com.helio.api

import org.apache.pekko.http.scaladsl.server.Directive0
import org.apache.pekko.http.scaladsl.server.Directives._
import com.helio.infrastructure.MdcPropagatingExecutionContext
import org.slf4j.MDC

/** Request-boundary directive that propagates the Cloud Run trace id into the
 *  SLF4J MDC so it surfaces as a searchable field on JSON log lines (HEL-116,
 *  building on HEL-115's `LogstashEncoder`).
 *
 *  Behaviour (design.md D1–D3):
 *   - Reads `X-Cloud-Trace-Context` (Cloud Run format `TRACE_ID/SPAN_ID;o=1`)
 *     and extracts the trace id — the substring before the first `/`. A blank
 *     or absent value is treated as "no trace": the inner route runs untouched
 *     and no MDC key is added.
 *   - Emits the trace under the Cloud Logging canonical key
 *     `logging.googleapis.com/trace`, valued `projects/$PROJECT_ID/traces/$id`
 *     when a project id is configured (`GOOGLE_CLOUD_PROJECT`), else the bare
 *     trace id so local/dev `LOG_FORMAT=json` runs still show it.
 *   - Sets the key on the route-evaluation thread (covering synchronous logs)
 *     and swaps the request's `ExecutionContext` for an
 *     [[MdcPropagatingExecutionContext]] carrying a snapshot of the MDC, so the
 *     request's asynchronous `onComplete` callbacks (the failure-path error
 *     logs in `ApiRoutes`) also carry the trace — Pekko's `onComplete` runs its
 *     inner on `ctx.executionContext`, which this replaces.
 *   - Removes the key from the route-evaluation thread on every exit path
 *     (normal return or thrown exception) so a pooled worker thread never
 *     leaks a stale trace into a later request; async tasks self-restore via
 *     the propagating EC.
 *
 *  @param projectId the Google Cloud project id, read once at construction.
 */
final class TraceContextDirective(
    projectId: Option[String] = TraceContextDirective.projectIdFromEnv
) {

  import TraceContextDirective.{TraceHeaderName, TraceMdcKey}

  /** Extracts the trace id from a raw header value: the substring before the
   *  first `/`, treating a blank result as absent. */
  private[api] def extractTraceId(headerValue: String): Option[String] = {
    val traceId = headerValue.takeWhile(_ != '/')
    if (traceId.isEmpty) None else Some(traceId)
  }

  /** Formats the MDC value for a trace id: fully-qualified resource name when a
   *  project id is configured, else the bare trace id. */
  private[api] def mdcValue(traceId: String): String =
    projectId match {
      case Some(project) => s"projects/$project/traces/$traceId"
      case None          => traceId
    }

  /** Wraps the inner route: extracts the trace id, populates the MDC, swaps in
   *  an MDC-propagating EC for async logs, and guarantees cleanup. */
  val withTraceContext: Directive0 =
    optionalHeaderValueByName(TraceHeaderName).flatMap { headerOpt =>
      headerOpt.flatMap(extractTraceId) match {
        case None          => pass
        case Some(traceId) => applyTrace(mdcValue(traceId))
      }
    }

  private def applyTrace(value: String): Directive0 =
    mapRequestContext { ctx =>
      // Runs on the route-evaluation thread: set the key so synchronous logs
      // carry it, then snapshot the MDC into the EC so async callbacks inherit
      // it regardless of which dispatcher thread they land on.
      MDC.put(TraceMdcKey, value)
      ctx.withExecutionContext(new MdcPropagatingExecutionContext(ctx.executionContext, MDC.getCopyOfContextMap))
    } & mapInnerRoute { inner => wrappedCtx =>
      try inner(wrappedCtx)
      finally MDC.remove(TraceMdcKey)
    }
}

object TraceContextDirective {

  /** Cloud Run request-trace header. */
  val TraceHeaderName: String = "X-Cloud-Trace-Context"

  /** Cloud Logging canonical trace field; emitted verbatim by LogstashEncoder. */
  val TraceMdcKey: String = "logging.googleapis.com/trace"

  /** Reads the Google Cloud project id from the standard Cloud Run env var,
   *  treating an empty value as unset. */
  def projectIdFromEnv: Option[String] =
    sys.env.get("GOOGLE_CLOUD_PROJECT").filter(_.nonEmpty)
}
