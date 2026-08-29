package com.helio.api.protocols.sources

import com.helio.domain.model.CsvSourceConfig
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** Unit tests for [[DataSourceConfigCodec]]'s CSV config encode/decode
 *  (HEL-862): `sourceUrl` must be absent-tolerant — every pre-existing
 *  stored CSV config has no `sourceUrl` key at all (spray-json omits
 *  `Option = None` on the wire), so decoding must treat the key being
 *  ABSENT (not merely `null`) as `sourceUrl = None`, following the exact
 *  idiom `decodeText` already uses. */
class DataSourceConfigCodecSpec extends AnyWordSpec with Matchers {

  "DataSourceConfigCodec.decodeCsv" should {

    "decode a config JSON containing ONLY path (sourceUrl key absent) with sourceUrl = None" in {
      val cfg = DataSourceConfigCodec.decodeCsv("""{"path":"csv/abc.csv"}""")
      cfg shouldBe CsvSourceConfig("csv/abc.csv", None)
    }

    "round-trip a config with a sourceUrl through encode -> decode" in {
      val original = CsvSourceConfig("csv/xyz.csv", Some("https://example.com/data.csv"))
      val roundTripped = DataSourceConfigCodec.decodeCsv(DataSourceConfigCodec.encodeCsv(original))
      roundTripped shouldBe original
    }

    "round-trip a config with no sourceUrl through encode -> decode, omitting the key entirely" in {
      val original = CsvSourceConfig("csv/none.csv", None)
      val encoded  = DataSourceConfigCodec.encodeCsv(original)
      encoded should not include "sourceUrl"
      DataSourceConfigCodec.decodeCsv(encoded) shouldBe original
    }

    "still fall back to the legacy filePath key when path is absent" in {
      val cfg = DataSourceConfigCodec.decodeCsv("""{"filePath":"legacy/old.csv"}""")
      cfg shouldBe CsvSourceConfig("legacy/old.csv", None)
    }
  }
}
