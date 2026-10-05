package com.helio.domain.history

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.time.Duration

/** HEL-1273 task 4.1: the `config.compare` grammar, every valid token and every rejected shape. */
class OutputCompareSpec extends AnyWordSpec with Matchers {

  "OutputCompare.parse" should {
    "accept the fixed tokens" in {
      OutputCompare.parse("previous_run") shouldBe Right(OutputCompare.PreviousRun)
      OutputCompare.parse("1d") shouldBe Right(OutputCompare.Window(Duration.ofDays(1)))
      OutputCompare.parse("7d") shouldBe Right(OutputCompare.Window(Duration.ofDays(7)))
      OutputCompare.parse("30d") shouldBe Right(OutputCompare.Window(Duration.ofDays(30)))
    }

    "accept custom ISO-8601 day/time durations" in {
      OutputCompare.parse("custom:PT6H") shouldBe Right(OutputCompare.Window(Duration.ofHours(6)))
      OutputCompare.parse("custom:P2D") shouldBe Right(OutputCompare.Window(Duration.ofDays(2)))
      OutputCompare.parse("custom:P1DT12H30M") shouldBe Right(OutputCompare.Window(Duration.ofHours(36).plusMinutes(30)))
      OutputCompare.parse("custom:PT90S") shouldBe Right(OutputCompare.Window(Duration.ofSeconds(90)))
      OutputCompare.parse("custom:PT0.5S") shouldBe Right(OutputCompare.Window(Duration.ofMillis(500)))
    }

    "accept exactly 365 days and reject anything longer" in {
      OutputCompare.parse("custom:P365D") shouldBe Right(OutputCompare.Window(Duration.ofDays(365)))
      OutputCompare.parse("custom:P365DT1S").isLeft shouldBe true
      OutputCompare.parse("custom:P400D").isLeft shouldBe true
    }

    "reject every invalid shape" in {
      val invalid = Seq(
        "2d", "7D", "1D", "30 d", "", " 7d", "7d ", "previous_run ", "Previous_Run", "custom:", "custom",
        "custom:P1W", "custom:P1M", "custom:P1Y", "custom:PT1M1H", "custom:-PT1H", "custom:+PT1H", "custom:-P1D",
        "custom:pt6h", "custom:p1d", "custom:P", "custom:PT", "custom:P1DT", "custom:P0D", "custom:PT0S",
        "custom:P99999999999999999999D", "custom:PT99999999999999999999H", "custom:1d", "custom:PT-1H", "CUSTOM:PT6H"
      )
      invalid.foreach(t => withClue(s"token '$t': ")(OutputCompare.parse(t).isLeft shouldBe true))
    }
  }

  "OutputCompare.fromConfig" should {
    "treat absent and JSON null as no comparison" in {
      OutputCompare.fromConfig(JsObject.empty) shouldBe Right(None)
      OutputCompare.fromConfig(JsObject("compare" -> JsNull)) shouldBe Right(None)
    }

    "parse a string value" in {
      OutputCompare.fromConfig(JsObject("compare" -> JsString("7d"))) shouldBe Right(Some(OutputCompare.Window(Duration.ofDays(7))))
    }

    "reject a non-string value" in {
      OutputCompare.fromConfig(JsObject("compare" -> JsNumber(7))).isLeft shouldBe true
      OutputCompare.fromConfig(JsObject("compare" -> JsBoolean(true))).isLeft shouldBe true
      OutputCompare.fromConfig(JsObject("compare" -> JsObject.empty)).isLeft shouldBe true
      OutputCompare.fromConfig(JsObject("compare" -> JsArray(JsString("7d")))).isLeft shouldBe true
    }
  }
}
