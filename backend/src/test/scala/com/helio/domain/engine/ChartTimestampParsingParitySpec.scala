package com.helio.domain.engine

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.nio.file.{Files, Paths}

/** GUARD (HEL-1305, labelled as such): green on a correct tree, red only by mutation. The chart time
 *  axis parses x values with the frontend `parseChartInstant`; `shared-test-fixtures/chart-timestamp-parsing.json`
 *  pins that parser to [[TimestampParsing.parseInstant]] case by case (the frontend half is
 *  `chartTimeAxis.test.ts`). HEL-1502: there is no frontend-only extension any more (`MM/dd/yyyy` is a
 *  shared shape), so every fixture case is pure parity and both halves iterate all of them. Both halves
 *  also assert a minimum case count so a truncated fixture cannot pass. */
class ChartTimestampParsingParitySpec extends AnyWordSpec with Matchers {

  private val cases = JsonParser(Files.readString(Paths.get("../shared-test-fixtures/chart-timestamp-parsing.json")))
    .convertTo[Vector[JsObject]]

  "TimestampParsing.parseInstant" should {
    "agree with every case of the shared chart timestamp fixture" in {
      cases.size should be >= 99
      cases.foreach { c =>
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
  }
}
