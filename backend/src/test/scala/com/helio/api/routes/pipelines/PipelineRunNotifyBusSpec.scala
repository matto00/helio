package com.helio.api.routes.pipelines

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.nio.charset.StandardCharsets

/** Unit tests for [[PipelineRunNotifyBus]]'s pure UTF-8 byte-length truncation logic
 *  (HEL-1168 design.md D9). Deliberately does NOT construct a `PipelineRunNotifyBus` instance
 *  (its constructor opens a real Postgres connection) -- `truncateUtf8` is tested directly off
 *  the companion object, no database required. Live pg_notify round-trip coverage (encodePayload
 *  size guard against real 8000-byte enforcement, self-echo, cross-instance delivery) lives in
 *  `PipelineRunCrossInstanceSpec`, which needs `EmbeddedPostgres` anyway. */
class PipelineRunNotifyBusSpec extends AnyWordSpec with Matchers {

  "PipelineRunNotifyBus.truncateUtf8" should {

    "return the input unchanged when it is already within the byte budget" in {
      PipelineRunNotifyBus.truncateUtf8("short message", 4000) shouldBe "short message"
    }

    // HEL-1168 design.md D9 skeptic-round-1 correction: truncation must be BYTE-length based,
    // not String.length/char-count -- this is the actual regression that correction guards
    // against. "x" * 10 is exactly 10 ASCII bytes; a char-count-based truncateUtf8(s, 7) would
    // also produce a 7-character result, so this alone would not distinguish the two
    // implementations -- the multi-byte test below is the one that actually would.
    "truncate ASCII content to the requested byte budget plus the trailing marker" in {
      // Input (30 bytes) exceeds maxBytes (19) -> budget = 19 - 14 (marker "...[truncated]" is
      // 14 ASCII bytes) = 5 usable content bytes.
      val truncated = PipelineRunNotifyBus.truncateUtf8("x" * 30, 19)
      truncated shouldBe ("x" * 5 + "...[truncated]")
    }

    // The regression case: "漢" is 3 bytes in UTF-8 but ONE UTF-16 code unit (String.length == 1).
    // A char-count-based truncation of 10 such characters to "7 characters" would keep all 7
    // requested characters (21 bytes) -- silently blowing past a 7-BYTE budget by 3x. Byte-based
    // truncation must instead back off to the nearest COMPLETE character within the byte budget.
    "back off to the nearest complete UTF-8 character rather than splitting a multi-byte sequence" in {
      val s = "漢" * 10 // 30 bytes total, 3 bytes/char
      // budget = 21 - 14 (marker "...[truncated]" is 14 ASCII bytes) = 7 usable bytes, which
      // falls in the middle of the third "漢" character (bytes 6,7,8) -- forcing the back-off
      // path to drop that partial character rather than emit a corrupt/replacement char.
      val truncated = PipelineRunNotifyBus.truncateUtf8(s, 21)
      truncated shouldBe ("漢" * 2 + "...[truncated]")
      // The result must itself be valid, decodable UTF-8 -- if a multi-byte sequence had been
      // split, re-encoding/decoding would not round-trip to the same string.
      new String(truncated.getBytes(StandardCharsets.UTF_8), StandardCharsets.UTF_8) shouldBe truncated
    }

    "truncate emoji (surrogate-pair / 4-byte UTF-8) content without splitting a code point" in {
      val s = "🎉" * 10 // "🎉" x10, 4 bytes/char in UTF-8, 40 bytes total
      // budget = 23 - 14 = 9 usable bytes -- not a multiple of 4 (falls mid-third-emoji),
      // forcing the back-off path down to the 2 complete emoji it can fit (8 bytes).
      val truncated = PipelineRunNotifyBus.truncateUtf8(s, 23)
      truncated shouldBe ("🎉" * 2 + "...[truncated]")
    }
  }
}
