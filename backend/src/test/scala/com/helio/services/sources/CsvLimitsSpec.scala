package com.helio.services.sources

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

class CsvLimitsSpec extends AnyWordSpec with Matchers {

  private def scan(s: String) = CsvLimits.scan(s.getBytes("UTF-8"))

  "CsvLimits.scan" should {
    "exclude the header from the row count and tolerate a trailing newline" in {
      scan("a,b\n1,2\n3,4\n").rows shouldBe 2
      scan("a,b\n1,2\n3,4").rows shouldBe 2
    }

    "count LF, CRLF and bare CR each as one line break" in {
      scan("a\n1\n2\n3").rows shouldBe 3
      scan("a\r\n1\r\n2\r\n3").rows shouldBe 3
      scan("a\r1\r2\r3").rows shouldBe 3
      scan("a\r1\r\n2\n3\r").rows shouldBe 3
    }

    "treat blank lines as rows, matching the run-path loader" in {
      scan("a\n\n\n1").rows shouldBe 3
    }

    "report zero rows for an empty file and a header-only file" in {
      scan("").rows shouldBe 0
      scan("a,b,c").rows shouldBe 0
      scan("a,b,c\n").rows shouldBe 0
    }

    "take the column count from the first line, ignoring commas inside quotes" in {
      scan("a,b,c\n1,2,3").columns shouldBe 3
      scan("\"a,b\",c\n1,2").columns shouldBe 2
    }

    "over-count rows for a quoted multi-line cell (conservative)" in {
      scan("a\n\"x\ny\"\n").rows shouldBe 2
    }
  }

  "CsvLimits.violation" should {
    "accept a file exactly at the row cap and reject one row over" in {
      val atCap = ("a\n" + ("1\n" * CsvLimits.maxRows.toInt)).getBytes("UTF-8")
      CsvLimits.violation(atCap) shouldBe None
      CsvLimits.violation((new String(atCap, "UTF-8") + "1\n").getBytes("UTF-8")) should not be empty
    }

    "reject a file over the cell cap while under the row cap" in {
      val cols = 800
      val row  = Seq.fill(cols)("x").mkString(",")
      val body = ((0 until cols).map(i => s"c$i").mkString(",") + "\n" + (row + "\n") * 1000).getBytes("UTF-8")
      CsvLimits.violation(body) should not be empty
    }

    "reject a file over the byte cap without needing a row or cell breach" in {
      CsvLimits.violation(Array.fill((CsvLimits.maxBytes + 1).toInt)('a'.toByte)) should not be empty
    }

    "name all three limits in its message" in {
      CsvLimits.message should (include(CsvLimits.maxBytes.toString) and include(CsvLimits.maxRows.toString) and include(CsvLimits.maxCells.toString))
    }
  }

  "the entity limit" should {
    "be the byte cap plus the multipart margin, so the wire limit cannot drift from the byte cap" in {
      CsvLimits.entityLimitBytes shouldBe CsvLimits.maxBytes + CsvLimits.multipartMarginBytes
      CsvLimits.multipartMarginBytes should be > 0L
    }

    "share its byte cap with the URL fetch limit" in {
      CsvUrlFetch.maxFileSizeBytes shouldBe CsvLimits.maxBytes
    }
  }
}
