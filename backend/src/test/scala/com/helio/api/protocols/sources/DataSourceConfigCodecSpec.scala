package com.helio.api.protocols.sources

import com.helio.domain.connectors.RestPagination
import com.helio.domain.model.{CsvSourceConfig, RestApiConfig}
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

  // HEL-1013
  "DataSourceConfigCodec.decodeRest pagination" should {

    "decode a stored config with no pagination key unchanged, with pagination = None" in {
      val cfg = DataSourceConfigCodec.decodeRest("""{"connectorId":"c1","endpoint":"/x","method":"GET"}""")
      cfg.map(_.pagination) shouldBe Right(None)
    }

    "round-trip a pagination config through encode -> decode, echoing exactly what was written" in {
      val original = RestApiConfig(
        connectorId = "c1",
        pagination  = Some(RestPagination.Cursor("meta.next", "after"))
      )
      val encoded = DataSourceConfigCodec.encodeRest(original)
      encoded should include(""""cursorPath":"meta.next"""")
      DataSourceConfigCodec.decodeRest(encoded) shouldBe Right(original)
    }

    "omit the key entirely when there is no pagination" in {
      DataSourceConfigCodec.encodeRest(RestApiConfig(connectorId = "c1")) should not include "pagination"
    }

    "refuse a stored config whose pagination is invalid, rather than dropping it" in {
      val cfg = DataSourceConfigCodec.decodeRest("""{"connectorId":"c1","pagination":{"style":"offset"}}""")
      cfg.left.toOption.get should include("pagination.limit")
    }
  }
}
