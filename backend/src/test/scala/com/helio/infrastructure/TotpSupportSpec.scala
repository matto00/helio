package com.helio.infrastructure

import com.helio.infrastructure.persistence.auth.TotpSupport
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.time.Instant

/** RFC 6238 Appendix B publishes 8-digit test vectors for the ASCII secret
 *  `"12345678901234567890"`. HOTP truncation is `DT mod 10^Digits` on the
 *  SAME 31-bit dynamic-truncation value regardless of `Digits`, so the
 *  6-digit code `java-otp`'s default generator produces is just the last 6
 *  digits of the published 8-digit vector (`X mod 10^8 mod 10^6 == X mod
 *  10^6` since `10^6` divides `10^8`) — verified independently against a
 *  from-scratch HMAC-SHA1 HOTP implementation, not just arithmetic on the
 *  published values. */
class TotpSupportSpec extends AnyWordSpec with Matchers {

  // Base32 of the ASCII bytes "12345678901234567890" (RFC 6238 Appendix B's
  // SHA1 test key).
  private val Rfc6238Secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"

  "verify" should {

    "accept RFC 6238 Appendix B vector: T=59 -> 287082" in {
      TotpSupport.verify(Rfc6238Secret, "287082", lastUsedStep = -1L, now = Instant.ofEpochSecond(59)) shouldBe Some(1L)
    }

    "accept RFC 6238 Appendix B vector: T=1111111109 -> 081804" in {
      TotpSupport.verify(Rfc6238Secret, "081804", lastUsedStep = -1L, now = Instant.ofEpochSecond(1111111109L)) shouldBe
        Some(1111111109L / 30)
    }

    "accept RFC 6238 Appendix B vector: T=1111111111 -> 050471" in {
      TotpSupport.verify(Rfc6238Secret, "050471", lastUsedStep = -1L, now = Instant.ofEpochSecond(1111111111L)) shouldBe
        Some(1111111111L / 30)
    }

    "accept RFC 6238 Appendix B vector: T=1234567890 -> 005924" in {
      TotpSupport.verify(Rfc6238Secret, "005924", lastUsedStep = -1L, now = Instant.ofEpochSecond(1234567890L)) shouldBe
        Some(1234567890L / 30)
    }

    "accept RFC 6238 Appendix B vector: T=2000000000 -> 279037" in {
      TotpSupport.verify(Rfc6238Secret, "279037", lastUsedStep = -1L, now = Instant.ofEpochSecond(2000000000L)) shouldBe
        Some(2000000000L / 30)
    }

    "reject a wrong code for a valid step" in {
      TotpSupport.verify(Rfc6238Secret, "000000", lastUsedStep = -1L, now = Instant.ofEpochSecond(59)) shouldBe None
    }

    "reject input that isn't 6 numeric digits (dispatched to the backup-code path instead)" in {
      TotpSupport.verify(Rfc6238Secret, "12345", lastUsedStep = -1L, now = Instant.ofEpochSecond(59)) shouldBe None
      TotpSupport.verify(Rfc6238Secret, "abcdef", lastUsedStep = -1L, now = Instant.ofEpochSecond(59)) shouldBe None
      TotpSupport.verify(Rfc6238Secret, "A1B2C3D4E5", lastUsedStep = -1L, now = Instant.ofEpochSecond(59)) shouldBe None
    }

    "accept a code from one step behind 'now' (clock skew tolerance)" in {
      val secret     = TotpSupport.generateSecret()
      val now        = Instant.ofEpochSecond(1_700_000_000L)
      val priorStep  = now.getEpochSecond / 30 - 1
      val priorCode  = codeForStep(secret, priorStep)
      TotpSupport.verify(secret, priorCode, lastUsedStep = -1L, now = now) shouldBe Some(priorStep)
    }

    "accept a code from one step ahead of 'now' (clock skew tolerance)" in {
      val secret    = TotpSupport.generateSecret()
      val now       = Instant.ofEpochSecond(1_700_000_000L)
      val nextStep  = now.getEpochSecond / 30 + 1
      val nextCode  = codeForStep(secret, nextStep)
      TotpSupport.verify(secret, nextCode, lastUsedStep = -1L, now = now) shouldBe Some(nextStep)
    }

    "reject a code two steps outside the window" in {
      val secret = TotpSupport.generateSecret()
      val now    = Instant.ofEpochSecond(1_700_000_000L)
      val farStep = now.getEpochSecond / 30 - 2
      val farCode = codeForStep(secret, farStep)
      TotpSupport.verify(secret, farCode, lastUsedStep = -1L, now = now) shouldBe None
    }

    "reject a code whose step is not strictly greater than lastUsedStep (replay guard)" in {
      val secret       = TotpSupport.generateSecret()
      val now          = Instant.ofEpochSecond(1_700_000_000L)
      val currentStep  = now.getEpochSecond / 30
      val code         = codeForStep(secret, currentStep)

      TotpSupport.verify(secret, code, lastUsedStep = currentStep, now = now) shouldBe None
      TotpSupport.verify(secret, code, lastUsedStep = currentStep - 1, now = now) shouldBe Some(currentStep)
    }
  }

  "generateSecret" should {
    "produce a 32-character Base32 string with no padding" in {
      val secret = TotpSupport.generateSecret()
      secret should have length 32
      secret should fullyMatch regex "^[A-Z2-7]+$"
    }

    "produce distinct secrets across calls" in {
      TotpSupport.generateSecret() should not equal TotpSupport.generateSecret()
    }
  }

  "generateBackupCode" should {
    "produce a 10-character Base32-alphabet string" in {
      val code = TotpSupport.generateBackupCode()
      code should have length 10
      code should fullyMatch regex "^[A-Z2-7]+$"
    }
  }

  "otpauthUri" should {
    "carry the secret, an otpauth://totp/ scheme, and the issuer" in {
      val uri = TotpSupport.otpauthUri("ABCD1234", "user@example.com", issuer = "Helio")
      uri should startWith("otpauth://totp/")
      uri should include("secret=ABCD1234")
      uri should include("issuer=Helio")
      uri should include("Helio%3Auser%40example.com")
    }
  }

  "looksLikeTotpCode" should {
    "accept exactly 6 digits and reject everything else" in {
      TotpSupport.looksLikeTotpCode("123456") shouldBe true
      TotpSupport.looksLikeTotpCode("12345") shouldBe false
      TotpSupport.looksLikeTotpCode("1234567") shouldBe false
      TotpSupport.looksLikeTotpCode("ABCDEFGHIJ") shouldBe false
    }
  }

  /** Computes the expected TOTP code for an arbitrary step directly via
   *  `java-otp` — independent of `TotpSupport.verify`'s own window search,
   *  so the window/skew tests above are genuine round-trips against a
   *  fresh code, not tautologies. Local, single-use imports (CONTRIBUTING's
   *  documented exception) rather than widening this file's top-level
   *  import scope for a test-only helper. */
  private def codeForStep(secret: String, step: Long): String = {
    import com.eatthepath.otp.TimeBasedOneTimePasswordGenerator
    import org.apache.commons.codec.binary.Base32
    import javax.crypto.spec.SecretKeySpec

    val totp = new TimeBasedOneTimePasswordGenerator()
    val key  = new SecretKeySpec(new Base32().decode(secret), totp.getAlgorithm)
    totp.generateOneTimePasswordString(key, Instant.ofEpochSecond(step * 30))
  }
}
