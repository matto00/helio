package com.helio.testsupport

import ch.qos.logback.classic.{Logger => LogbackLogger, LoggerContext}
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.OutputStreamAppender
import net.logstash.logback.encoder.LogstashEncoder
import net.logstash.logback.fieldnames.LogstashFieldNames
import org.slf4j.LoggerFactory
import spray.json._

import java.io.ByteArrayOutputStream
import java.nio.charset.StandardCharsets

/** Shared JSON (LogstashEncoder) log-capture helper for backend tests (HEL-401) — attaches a real
 *  `LogstashEncoder` appender directly to the ACTUAL global Logback logger a production
 *  `LOG_FORMAT=json` deployment would use (HEL-115), so a test asserts on the real structured-JSON
 *  fields a genuine `log.info(...)` call produces, not a mock of the logging call.
 *
 *  Unlike `TraceContextDirectiveSpec`'s own `captureJson` (which constructs a brand-new, uniquely-
 *  named, fully isolated `LoggerContext` — safe there because that test controls the exact SLF4J
 *  `Logger` instance the code under test logs through), `AuthoringTelemetry` resolves its logger
 *  once via a FIXED name against SLF4J's real global factory — there is no per-call injection point
 *  to redirect it to an isolated context. This helper therefore attaches to (and detaches from) the
 *  REAL global logger by name. Because `sbt test` runs suites in parallel by default, a capture
 *  window can pick up interleaved lines from unrelated concurrently-running tests — callers MUST
 *  filter `jsonLines` by a discriminator unique to their own call (e.g. a distinct `modelId`) rather
 *  than assume the capture contains exactly one line. */
object JsonLogCapture {

  /** Keeps the capturing appender attached for the ENTIRE duration of `body`, which receives a
   *  `() => String` "read what's been captured so far" accessor — needed because
   *  `AuthoringTelemetry`'s emission is fire-and-forget (a discarded `Future`): the log line can
   *  land strictly AFTER the HTTP call that triggered it already returned, so callers poll the
   *  accessor (e.g. via `Eventually`) from inside `body` rather than reading a single snapshot
   *  taken immediately after a synchronous call returns. */
  def withCapture[T](loggerName: String)(body: (() => String) => T): T = {
    val loggerContext = LoggerFactory.getILoggerFactory.asInstanceOf[LoggerContext]
    val out     = new ByteArrayOutputStream()
    val encoder = new LogstashEncoder()
    val names   = new LogstashFieldNames()
    names.setLevel("severity")
    encoder.setFieldNames(names)
    encoder.setContext(loggerContext)
    encoder.start()
    val appender = new OutputStreamAppender[ILoggingEvent]()
    appender.setContext(loggerContext)
    appender.setEncoder(encoder)
    appender.setOutputStream(out)
    appender.start()
    val logbackLogger: LogbackLogger = loggerContext.getLogger(loggerName)
    logbackLogger.addAppender(appender)
    try body(() => new String(out.toByteArray, StandardCharsets.UTF_8))
    finally {
      logbackLogger.detachAppender(appender)
      appender.stop()
      encoder.stop()
    }
  }

  /** Splits captured multi-line output into parsed JSON objects. */
  def jsonLines(output: String): Seq[JsObject] =
    output.split("\n").toSeq.filter(_.trim.nonEmpty).map(_.parseJson.asJsObject)
}
