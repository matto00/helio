package com.helio.infrastructure

import ch.qos.logback.classic.{Logger, LoggerContext}
import ch.qos.logback.classic.encoder.PatternLayoutEncoder
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.OutputStreamAppender
import ch.qos.logback.core.encoder.Encoder
import net.logstash.logback.encoder.LogstashEncoder
import net.logstash.logback.fieldnames.LogstashFieldNames
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import org.slf4j.MDC
import spray.json._

import java.io.ByteArrayOutputStream
import java.nio.charset.StandardCharsets

/** HEL-115: verifies the two logback encoder paths directly (no process-level
 *  env flipping). Drives the `json` appender's LogstashEncoder and the `plain`
 *  PatternLayoutEncoder against a fresh LoggerContext, asserting the JSON path
 *  emits parseable JSON with a top-level `severity` field plus MDC entries, and
 *  the plain path emits the human-readable pattern (not JSON). Exercising the
 *  encoder reflectively also confirms the encoder/Jackson/logback linkage holds
 *  at runtime (a NoSuchMethodError/NoClassDefFoundError would surface here). */
class StructuredJsonLoggingSpec extends AnyWordSpec with Matchers {

  /** Attach `encoder` to a fresh logger via an OutputStreamAppender, run
   *  `logAction`, and return everything written as a UTF-8 string. */
  private def capture(encoder: Encoder[ILoggingEvent], loggerName: String)(
      logAction: Logger => Unit
  ): String = {
    val context = new LoggerContext()
    // A bare LoggerContext has a null MDCAdapter (normally wired by the slf4j
    // static binding); without it LoggingEvent.getMDCPropertyMap NPEs on append.
    // Reusing the global slf4j adapter also makes MDC.put visible to events here.
    context.setMDCAdapter(MDC.getMDCAdapter)
    val out = new ByteArrayOutputStream()
    encoder.setContext(context)
    encoder.start()
    val appender = new OutputStreamAppender[ILoggingEvent]()
    appender.setContext(context)
    appender.setEncoder(encoder)
    appender.setOutputStream(out)
    appender.start()
    val logger = context.getLogger(loggerName)
    logger.addAppender(appender)
    logger.setAdditive(false)
    try logAction(logger)
    finally {
      appender.stop()
      encoder.stop()
      context.stop()
    }
    new String(out.toByteArray, StandardCharsets.UTF_8)
  }

  private def jsonEncoder(): LogstashEncoder = {
    val encoder = new LogstashEncoder()
    val fieldNames = new LogstashFieldNames()
    fieldNames.setLevel("severity")
    encoder.setFieldNames(fieldNames)
    encoder
  }

  private def plainEncoder(): PatternLayoutEncoder = {
    val encoder = new PatternLayoutEncoder()
    encoder.setPattern("%d{HH:mm:ss.SSS} %-5level [%thread] %logger{36} - %msg%n")
    encoder
  }

  "The json appender (LogstashEncoder)" should {

    "emit a parseable JSON object per log line" in {
      val output = capture(jsonEncoder(), "json-parse")(_.info("hello structured world"))
      val fields = output.trim.parseJson.asJsObject.fields
      fields("message") shouldBe JsString("hello structured world")
    }

    "include the message, logger name, and thread as distinct fields" in {
      val output = capture(jsonEncoder(), "com.helio.example")(_.info("standard fields"))
      val fields = output.trim.parseJson.asJsObject.fields
      fields("message") shouldBe JsString("standard fields")
      fields("logger_name") shouldBe JsString("com.helio.example")
      fields.keySet should contain("thread_name")
      fields.keySet should contain("@timestamp")
    }

    "map the log level to a top-level `severity` field" in {
      val output = capture(jsonEncoder(), "json-severity")(_.error("boom"))
      val fields = output.trim.parseJson.asJsObject.fields
      fields("severity") shouldBe JsString("ERROR")
      // The default `level` key must not also be present -- it was renamed.
      fields.keySet should not contain "level"
    }

    "include MDC entries as searchable fields" in {
      val output = capture(jsonEncoder(), "json-mdc") { logger =>
        MDC.put("requestId", "req-abc-123")
        MDC.put("userId", "user-42")
        try logger.info("with context")
        finally {
          MDC.remove("requestId")
          MDC.remove("userId")
        }
      }
      val fields = output.trim.parseJson.asJsObject.fields
      fields("requestId") shouldBe JsString("req-abc-123")
      fields("userId") shouldBe JsString("user-42")
    }
  }

  "The plain appender (PatternLayoutEncoder)" should {

    "emit the human-readable pattern, not JSON" in {
      val output = capture(plainEncoder(), "com.helio.plain")(_.info("plain text line"))
      output should include("plain text line")
      output should include("INFO")
      output should include("com.helio.plain")
      // Confirm it is NOT JSON.
      a[JsonParser.ParsingException] should be thrownBy output.trim.parseJson
    }
  }
}
