package com.helio.api

import ch.qos.logback.classic.{Logger => LogbackLogger, LoggerContext}
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.OutputStreamAppender
import net.logstash.logback.encoder.LogstashEncoder
import net.logstash.logback.fieldnames.LogstashFieldNames
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.model.headers.RawHeader
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import org.slf4j.{Logger, MDC}
import spray.json._

import java.io.ByteArrayOutputStream
import java.nio.charset.StandardCharsets
import java.util.concurrent.Executors
import scala.concurrent.{ExecutionContext, Future}

/** HEL-116 — coverage for [[TraceContextDirective]] and the async propagation
 *  mechanism it wires ([[com.helio.infrastructure.MdcPropagatingExecutionContext]]).
 *
 *  The async cases double as the systematic-debugging probe: they log from an
 *  `onComplete` callback whose upstream `Future` completes on a *foreign*
 *  single-thread executor with an empty MDC — the same shape as `ApiRoutes`'s
 *  DB-completed failure-path logs. The "naive" control (MDC set at the boundary
 *  but no EC swap) confirms the trace is LOST on that async line (root cause);
 *  the real directive confirms it is PRESENT (fix), verified against an actual
 *  `LogstashEncoder` JSON line per verification-before-completion. */
class TraceContextDirectiveSpec extends AnyWordSpec with Matchers with ScalatestRouteTest {

  private val TraceKey    = TraceContextDirective.TraceMdcKey
  private val TraceHeader = TraceContextDirective.TraceHeaderName

  // A dedicated executor with an empty MDC that completes the "DB" future —
  // callbacks registered by onComplete run on ctx.executionContext, not here.
  private val foreignEc: ExecutionContext =
    ExecutionContext.fromExecutor(Executors.newSingleThreadExecutor())

  /** Attach a JSON (LogstashEncoder) capturing appender to a fresh logger, run
   *  `body` with that logger's SLF4J handle, and return everything written. The
   *  LoggerContext reuses the global MDC adapter so `MDC.setContextMap` from the
   *  propagating EC is visible to emitted events (mirrors StructuredJsonLoggingSpec). */
  private def captureJson(loggerName: String)(body: Logger => Unit): String = {
    val context = new LoggerContext()
    context.setMDCAdapter(MDC.getMDCAdapter)
    val out     = new ByteArrayOutputStream()
    val encoder = new LogstashEncoder()
    val names   = new LogstashFieldNames()
    names.setLevel("severity")
    encoder.setFieldNames(names)
    encoder.setContext(context)
    encoder.start()
    val appender = new OutputStreamAppender[ILoggingEvent]()
    appender.setContext(context)
    appender.setEncoder(encoder)
    appender.setOutputStream(out)
    appender.start()
    val logbackLogger: LogbackLogger = context.getLogger(loggerName)
    logbackLogger.addAppender(appender)
    logbackLogger.setAdditive(false)
    try body(logbackLogger)
    finally {
      appender.stop()
      encoder.stop()
      context.stop()
    }
    new String(out.toByteArray, StandardCharsets.UTF_8)
  }

  /** Splits captured multi-line output into parsed JSON objects. */
  private def jsonLines(output: String): Seq[JsObject] =
    output.split("\n").toSeq.filter(_.trim.nonEmpty).map(_.parseJson.asJsObject)

  "TraceContextDirective.extractTraceId" should {
    val directive = new TraceContextDirective(projectId = None)

    "extract only the trace id before the first slash" in {
      directive.extractTraceId("TRACE/SPAN;o=1") shouldBe Some("TRACE")
    }
    "extract the whole value when there is no slash" in {
      directive.extractTraceId("bare-trace") shouldBe Some("bare-trace")
    }
    "treat a blank value (leading slash) as no trace" in {
      directive.extractTraceId("/SPAN;o=1") shouldBe None
      directive.extractTraceId("") shouldBe None
    }
  }

  "TraceContextDirective.mdcValue" should {
    "produce the fully-qualified resource name when a project id is set" in {
      new TraceContextDirective(projectId = Some("my-proj")).mdcValue("abc123") shouldBe
        "projects/my-proj/traces/abc123"
    }
    "produce the bare trace id when no project id is set" in {
      new TraceContextDirective(projectId = None).mdcValue("abc123") shouldBe "abc123"
    }
  }

  "TraceContextDirective.withTraceContext (synchronous)" should {
    val directive = new TraceContextDirective(projectId = None)

    "add no MDC key and pass through when the header is absent" in {
      var seen: Option[String] = Some("unset")
      val route: Route = directive.withTraceContext {
        extractRequest { _ => seen = Option(MDC.get(TraceKey)); complete(StatusCodes.OK) }
      }
      Get("/") ~> route ~> check {
        status shouldBe StatusCodes.OK
        seen shouldBe None
      }
    }

    "expose the trace id in the MDC while handling a traced request" in {
      var seen: Option[String] = None
      val route: Route = directive.withTraceContext {
        extractRequest { _ => seen = Option(MDC.get(TraceKey)); complete(StatusCodes.OK) }
      }
      Get("/").withHeaders(RawHeader(TraceHeader, "abc123/9;o=1")) ~> route ~> check {
        status shouldBe StatusCodes.OK
        seen shouldBe Some("abc123")
      }
    }

    "clear the MDC key after the request so a reused thread does not leak it" in {
      MDC.remove(TraceKey)
      val route: Route = directive.withTraceContext { complete(StatusCodes.OK) }
      Get("/").withHeaders(RawHeader(TraceHeader, "leak-me/9;o=1")) ~> route ~> check {
        status shouldBe StatusCodes.OK
      }
      // The route-evaluation thread's key is removed on the finally path.
      MDC.get(TraceKey) shouldBe null
    }
  }

  // A "naive" directive: sets the MDC at the boundary and cleans it up, but does
  // NOT swap the execution context. This is the probe control — it must LOSE the
  // trace on the async line, proving the EC swap is the actual fix.
  private val naiveDirective =
    mapRequestContext { ctx => MDC.put(TraceKey, "abc123"); ctx } & mapInnerRoute { inner => ctx =>
      try inner(ctx) finally MDC.remove(TraceKey)
    }

  /** Builds a route that logs an ERROR from an onComplete callback whose upstream
   *  future completes on the foreign (empty-MDC) executor. */
  private def asyncLoggingRoute(logger: Logger): Route = {
    val slow: Future[String] = Future { Thread.sleep(20); "done" }(foreignEc)
    onComplete(slow) { _ =>
      logger.error("async failure-path log")
      complete(StatusCodes.OK)
    }
  }

  "The async propagation mechanism" should {

    "(probe control) LOSE the trace on an async onComplete log without the EC swap" in {
      val output = captureJson("trace-probe-naive") { logger =>
        val route = naiveDirective { asyncLoggingRoute(logger) }
        Get("/").withHeaders(RawHeader(TraceHeader, "abc123/9;o=1")) ~> route ~> check {
          status shouldBe StatusCodes.OK
        }
      }
      val lines = jsonLines(output)
      lines should have size 1
      lines.head.fields.get(TraceKey) shouldBe None
    }

    "carry the trace on an async onComplete log via TraceContextDirective (fix)" in {
      val directive = new TraceContextDirective(projectId = Some("my-proj"))
      val output = captureJson("trace-probe-fixed") { logger =>
        val route = directive.withTraceContext { asyncLoggingRoute(logger) }
        Get("/").withHeaders(RawHeader(TraceHeader, "abc123/9;o=1")) ~> route ~> check {
          status shouldBe StatusCodes.OK
        }
      }
      val lines = jsonLines(output)
      lines should have size 1
      lines.head.fields.get(TraceKey) shouldBe Some(JsString("projects/my-proj/traces/abc123"))
    }

    "not leak a trace onto a following untraced request's async log" in {
      val directive = new TraceContextDirective(projectId = None)
      val output = captureJson("trace-probe-noleak") { logger =>
        val traced = directive.withTraceContext { asyncLoggingRoute(logger) }
        Get("/").withHeaders(RawHeader(TraceHeader, "first-trace/9;o=1")) ~> traced ~> check {
          status shouldBe StatusCodes.OK
        }
        val untraced = directive.withTraceContext { asyncLoggingRoute(logger) }
        Get("/") ~> untraced ~> check {
          status shouldBe StatusCodes.OK
        }
      }
      val lines = jsonLines(output)
      lines should have size 2
      lines.head.fields.get(TraceKey) shouldBe Some(JsString("first-trace"))
      lines(1).fields.get(TraceKey) shouldBe None
    }
  }
}
