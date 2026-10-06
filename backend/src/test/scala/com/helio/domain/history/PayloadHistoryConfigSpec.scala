package com.helio.domain.history

import com.helio.domain.model.UserTier
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.time.Duration

/** HEL-1276 tasks 2.1/2.2: env-driven caps with WARN-fallback, and the opt-in flag's validation. */
class PayloadHistoryConfigSpec extends AnyWordSpec with Matchers {

  "PayloadHistoryConfig.fromEnv" should {
    "default to the owner-ruled caps and tier limits (free 0, beta 10/7d, owner 30/30d)" in {
      val c = PayloadHistoryConfig.fromEnv(Map.empty)
      c.maxRows shouldBe 1000
      c.maxBytes shouldBe 1048576
      c.limitFor(UserTier.Free) shouldBe PayloadTierLimit(0, Duration.ZERO)
      c.limitFor(UserTier.Beta) shouldBe PayloadTierLimit(10, Duration.ofDays(7))
      c.limitFor(UserTier.Owner) shouldBe PayloadTierLimit(30, Duration.ofDays(30))
      c.limitFor(UserTier.Free).allowsPayloads shouldBe false
      c.limitFor(UserTier.Beta).allowsPayloads shouldBe true
    }

    "read every variable" in {
      val c = PayloadHistoryConfig.fromEnv(Map(
        "PAYLOAD_HISTORY_MAX_ROWS" -> "5", "PAYLOAD_HISTORY_MAX_BYTES" -> "99",
        "PAYLOAD_HISTORY_MAX_RUNS_FREE" -> "1", "PAYLOAD_HISTORY_MAX_AGE_DAYS_FREE" -> "2",
        "PAYLOAD_HISTORY_MAX_RUNS_BETA" -> "3", "PAYLOAD_HISTORY_MAX_AGE_DAYS_BETA" -> "4",
        "PAYLOAD_HISTORY_MAX_RUNS_OWNER" -> "5", "PAYLOAD_HISTORY_MAX_AGE_DAYS_OWNER" -> "6"
      ))
      (c.maxRows, c.maxBytes) shouldBe ((5, 99))
      c.free shouldBe PayloadTierLimit(1, Duration.ofDays(2))
      c.beta shouldBe PayloadTierLimit(3, Duration.ofDays(4))
      c.owner shouldBe PayloadTierLimit(5, Duration.ofDays(6))
    }

    "fall back to the default for a non-numeric, negative, and (for the row/byte caps) zero value" in {
      val c = PayloadHistoryConfig.fromEnv(Map(
        "PAYLOAD_HISTORY_MAX_ROWS" -> "0", "PAYLOAD_HISTORY_MAX_BYTES" -> "-5",
        "PAYLOAD_HISTORY_MAX_RUNS_BETA" -> "abc", "PAYLOAD_HISTORY_MAX_AGE_DAYS_OWNER" -> "-1"
      ))
      c shouldBe PayloadHistoryConfig.Defaults
    }

    "accept 0 for a tier's runs or age, meaning that tier stores nothing" in {
      val c = PayloadHistoryConfig.fromEnv(Map("PAYLOAD_HISTORY_MAX_RUNS_OWNER" -> "0", "PAYLOAD_HISTORY_MAX_AGE_DAYS_BETA" -> "0"))
      c.owner.allowsPayloads shouldBe false
      c.beta.allowsPayloads shouldBe false
    }
  }

  "PayloadOptIn" should {
    def cfg(v: JsValue) = JsObject("historyPayloads" -> v)

    "accept an absent key, null and booleans" in {
      PayloadOptIn.validateConfig(JsObject.empty) shouldBe Right(())
      Seq(JsNull, JsTrue, JsFalse).foreach(v => PayloadOptIn.validateConfig(cfg(v)) shouldBe Right(()))
    }
    "reject every other type" in {
      Seq(JsString("yes"), JsNumber(1), JsArray(), JsObject.empty).foreach(v => PayloadOptIn.validateConfig(cfg(v)).isLeft shouldBe true)
    }
    "enable only on an explicit true" in {
      PayloadOptIn.enabled(cfg(JsTrue)) shouldBe true
      Seq(JsFalse, JsNull, JsString("true"), JsNumber(1)).foreach(v => PayloadOptIn.enabled(cfg(v)) shouldBe false)
      PayloadOptIn.enabled(JsObject.empty) shouldBe false
    }
  }
}
