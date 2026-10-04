package com.helio.services.sources

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

class DataSourceCsvSupportSpec extends AnyWordSpec with Matchers {

  private val samples: Seq[Array[Byte]] = Seq(
    "plain,ascii\n1,2".getBytes("UTF-8"),
    "Renée,Zürich,東京,😀\n".getBytes("UTF-8"),
    Array.empty[Byte],
    Array[Byte](0x61, 0xC3.toByte),
    Array[Byte](0xFF.toByte, 0x61),
    Array[Byte](0xE2.toByte, 0x82.toByte),
    Array.fill(20000)('a'.toByte) :+ 0xC3.toByte :+ 0xA9.toByte,
    Array.fill(8191)('a'.toByte) :+ 0xC3.toByte :+ 0xA9.toByte
  )

  "DataSourceCsvSupport.isValidUtf8" should {
    "agree with decodeUtf8 on valid, malformed and truncated input" in {
      samples.foreach { bytes =>
        DataSourceCsvSupport.isValidUtf8(bytes) shouldBe DataSourceCsvSupport.decodeUtf8(bytes).isDefined
      }
    }

    "validate a multi-megabyte input and reject it once corrupted" in {
      val big = ("héllo,wörld\n" * 400000).getBytes("UTF-8")
      DataSourceCsvSupport.isValidUtf8(big) shouldBe true
      DataSourceCsvSupport.isValidUtf8(big :+ 0xFF.toByte) shouldBe false
    }
  }
}
