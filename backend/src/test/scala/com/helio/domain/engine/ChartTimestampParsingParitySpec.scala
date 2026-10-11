package com.helio.domain.engine

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.nio.file.{Files, Paths}

/** GUARD (HEL-1305, labelled as such): green on a correct tree, red only by mutation. The chart time
 *  axis parses x values with the frontend `parseChartInstant`; `shared-test-fixtures/chart-timestamp-parsing.json`
 *  pins that parser to [[TimestampParsing.parseInstant]] case by case (the frontend half is
 *  `chartTimeAxis.test.ts`). Cases with `backendParseInstant: false` are frontend-only extensions
 *  (`MM/dd/yyyy`); this spec only asserts the backend rejects them (`None`), so the extension stays the
 *  single deliberate divergence. */
class ChartTimestampParsingParitySpec extends AnyWordSpec with Matchers {

  private val cases = JsonParser(Files.readString(Paths.get("../shared-test-fixtures/chart-timestamp-parsing.json")))
    .convertTo[Vector[JsObject]]

  "TimestampParsing.parseInstant" should {
    "agree with every backend-parity case of the shared chart timestamp fixture" in {
      val parity = cases.filter(_.fields("backendParseInstant") == JsTrue)
      parity should not be empty
      parity.foreach { c =>
        val input    = c.fields("input").asInstanceOf[JsString].value
        val expected = c.fields("epochMillis") match {
          case JsNumber(n) => Some(n.toLong)
          case _           => None
        }
        withClue(s"input ${input.toJson.compactPrint}: ") {
          TimestampParsing.parseInstant(input).map(_.toEpochMilli) shouldBe expected
        }
      }
    }

    "leave the frontend-only extension cases to the frontend" in {
      val extension = cases.filter(_.fields("backendParseInstant") == JsFalse)
      extension should not be empty
      extension.foreach { c =>
        TimestampParsing.parseInstant(c.fields("input").asInstanceOf[JsString].value) shouldBe None
      }
    }
  }
}
