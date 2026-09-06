package com.helio.services.sharing

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.io.File
import java.nio.file.Files
import java.util.Base64

/** HEL-590 task 6.6: entropy/generation properties of `ShareTokenService.generateRawToken` --
 *  uniqueness across many mints, no derivation from any caller-supplied value (there is none to
 *  derive from -- the function takes no arguments), sufficient decoded length, AND a source-grep
 *  that the token path never reaches for `scala.util.Random`/`Math.random` (statistical
 *  uniqueness alone cannot distinguish a CSPRNG from a general-purpose PRNG -- ticket text). */
class ShareTokenGenerationSpec extends AnyWordSpec with Matchers {

  "ShareTokenService.generateRawToken" should {

    "produce unique values across many mints" in {
      val tokens = Vector.fill(2000)(ShareTokenService.generateRawToken())
      tokens.toSet should have size tokens.size
    }

    "decode (base64url, unpadded) to at least 16 bytes" in {
      val decoder = Base64.getUrlDecoder
      val tokens  = Vector.fill(50)(ShareTokenService.generateRawToken())
      tokens.foreach { token =>
        token should not include "="
        val decoded = decoder.decode(token)
        decoded.length should be >= 16
      }
    }

    "produce values with no fixed prefix derived from any input (unlike ApiTokenService's helio_pat_ prefix)" in {
      val tokens = Vector.fill(20)(ShareTokenService.generateRawToken())
      val firstChars = tokens.map(_.take(4)).toSet
      // A CSPRNG-derived value has no shared structural prefix; a derived/sequential
      // scheme (e.g. dashboard-id-based) would collapse this set to size 1.
      firstChars.size should be > 1
    }
  }

  "the share-token generation source" should {

    "never reach for scala.util.Random or Math.random" in {
      def repoRoot(): File = {
        def search(dir: File, depthRemaining: Int): File =
          if (new File(dir, "helio-mcp/src").isDirectory) dir
          else if (depthRemaining <= 0 || dir.getParentFile == null)
            fail(s"could not locate helio-mcp/src searching upward from ${new File(".").getCanonicalPath}")
          else search(dir.getParentFile, depthRemaining - 1)
        search(new File(".").getCanonicalFile, 5)
      }
      val file = new File(repoRoot(), "backend/src/main/scala/com/helio/services/sharing/ShareTokenService.scala")
      val src  = new String(Files.readAllBytes(file.toPath))
      src should not include "scala.util.Random"
      src should not include "Math.random"
      src should include("java.security.SecureRandom")
    }
  }
}
