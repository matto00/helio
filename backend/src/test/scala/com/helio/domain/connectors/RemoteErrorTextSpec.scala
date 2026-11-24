package com.helio.domain.connectors

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-1841: the shared cap. The dry run re-applies it to text the driver already capped, so it must be idempotent. */
class RemoteErrorTextSpec extends AnyWordSpec with Matchers {

  private val Marker = " … [truncated]"
  private val Astral = new String(Character.toChars(0x1f600))

  "RemoteErrorText.cap" should {
    "leave text of exactly 500 code points unchanged" in {
      val s = "y" * 500
      RemoteErrorText.cap(s) shouldBe s
    }
    "cut longer text to 500 code points plus the marker" in {
      RemoteErrorText.cap("y" * 501) shouldBe ("y" * 500) + Marker
    }
    "count code points, never splitting a surrogate pair" in {
      val s = ("a" * 499) + Astral + "tail"
      RemoteErrorText.cap(s) shouldBe ("a" * 499) + Astral + Marker
    }
    "not throw when UTF-16 length exceeds 500 but code points do not" in {
      val s = Astral * 300 // 600 units, 300 code points
      RemoteErrorText.cap(s) shouldBe s
    }
    "be idempotent" in {
      val inputs = Seq("short", "y" * 500, "y" * 100000, ("a" * 499) + Astral + "tail", Astral * 700)
      inputs.foreach(x => RemoteErrorText.cap(RemoteErrorText.cap(x)) shouldBe RemoteErrorText.cap(x))
    }
  }
}
