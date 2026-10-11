package com.helio.domain.steps

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** HEL-1316: write-time validation of the rolling frame keys (companion `validateRawConfig`), draft
 *  acceptance, and the unchanged wire shape of legacy window configs. */
class WindowRollingValidationSpec extends AnyWordSpec with Matchers {

  private def window(extra: String, order: String = """[{"field":"day","direction":"asc"}]""") =
    s"""{"partitionBy":[],"orderBy":$order,"outputColumn":"o",$extra}"""
  private val c = WindowStep.companion

  "validateRawConfig" should {
    "reject frameSize 0, negative, 1001, fractional and not-an-int32" in {
      for (size <- Seq("0", "-1", "1001", "7.5", "5000000000")) {
        val msg = c.validateRawConfig(window(s""""function":"rolling_avg","field":"v","frameSize":$size""")).getOrElse(fail(size))
        msg should include("frameSize")
      }
    }
    "accept frameSize 1 and 1000, and an explicit null frameSize (a draft)" in {
      c.validateRawConfig(window(""""function":"rolling_avg","field":"v","frameSize":1""")) shouldBe None
      c.validateRawConfig(window(""""function":"rolling_avg","field":"v","frameSize":1000""")) shouldBe None
      c.validateRawConfig(window(""""function":"rolling_avg","field":"v","frameSize":null""")) shouldBe None
    }
    "reject an unknown frameUnit" in {
      val msg = c.validateRawConfig(window(""""function":"rolling_sum","field":"v","frameSize":3,"frameUnit":"weeks"""")).getOrElse(fail("x"))
      msg should include("weeks")
    }
    "reject days with two orderBy keys or a descending key, accept one ascending (any case)" in {
      val two  = """[{"field":"a","direction":"asc"},{"field":"b","direction":"asc"}]"""
      val desc = """[{"field":"a","direction":"desc"}]"""
      val days = """"function":"rolling_sum","field":"v","frameSize":3,"frameUnit":"days""""
      c.validateRawConfig(window(days, two)) should not be empty
      c.validateRawConfig(window(days, desc)) should not be empty
      c.validateRawConfig(window(days, """[{"field":"a","direction":"ASC"}]""")) shouldBe None
    }
    "accept drafts: no frameSize, no field, empty orderBy, even with days" in {
      c.validateRawConfig(window(""""function":"rolling_avg","field":"v"""")) shouldBe None
      c.validateRawConfig(window(""""function":"rolling_avg","frameSize":3""")) shouldBe None
      c.validateRawConfig(window(""""function":"rolling_avg","field":"v","frameSize":3,"frameUnit":"days"""", "[]")) shouldBe None
    }
    "ignore frame keys on a non-rolling function" in {
      c.validateRawConfig(window(""""function":"row_number","frameSize":0,"frameUnit":"weeks"""")) shouldBe None
    }
    "accept every supported function name" in {
      WindowStep.SupportedFunctions should contain allOf ("rolling_avg", "rolling_sum", "rolling_min", "rolling_max", "rolling_count")
    }
  }

  "a legacy window config" should {
    "decode, and re-encode without frame keys" in {
      val raw = """{"partitionBy":["category"],"orderBy":[{"field":"day","direction":"asc"}],"function":"lag","field":"amount","outputColumn":"prev","offset":2}"""
      val cfg = WindowConfig.decode(raw)
      cfg.frameSize shouldBe None
      cfg.frameUnit shouldBe None
      val encoded = c.encodeConfig(cfg).parseJson.asJsObject
      encoded.fields.keySet should not contain "frameSize"
      encoded.fields.keySet should not contain "frameUnit"
      encoded shouldBe raw.parseJson
    }
    "round-trip a rolling config" in {
      val cfg = WindowConfig(Vector.empty, Vector(SortKey("d", "asc")), "rolling_avg", Some("v"), "o", None, Some(7), Some("days"))
      WindowConfig.decode(c.encodeConfig(cfg)) shouldBe cfg
    }
  }
}
