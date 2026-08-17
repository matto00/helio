package com.helio.infrastructure

import com.eatthepath.otp.TimeBasedOneTimePasswordGenerator
import org.apache.commons.codec.binary.Base32

import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.security.SecureRandom
import java.time.Instant
import javax.crypto.spec.SecretKeySpec
import scala.util.Try

/** RFC 6238 TOTP primitives (HEL-702 design.md D1/D5): secret generation,
 *  `otpauth://` URI construction, and code verification with a ±1-step
 *  (±30s) window and a `lastUsedStep` replay guard. Delegates the one
 *  cryptographically-sensitive operation — HMAC-based code generation — to
 *  `java-otp`; owns only the window/replay logic around it, which is
 *  testable against RFC 6238 Appendix B vectors (`TotpSupportSpec`). */
object TotpSupport {

  private val rng    = new SecureRandom()
  private val totp   = new TimeBasedOneTimePasswordGenerator()
  private val base32 = new Base32()

  /** RFC 4226 §4: 20 random bytes (160 bits), the standard TOTP secret
   *  length — a multiple of 5, so the Base32 encoding is exactly 32
   *  characters with no padding. */
  val SecretByteLength: Int = 20

  /** Recovery-code length (design.md D5: "10 chars, Base32 alphabet, 50
   *  bits"). */
  val BackupCodeLength: Int = 10

  private val StepSeconds: Long = totp.getTimeStep.getSeconds

  /** ±1 step either side of "now" — matches common authenticator-app clock
   *  skew tolerance (design.md "Risks / Trade-offs"). */
  private val WindowSteps: Long = 1

  private val Base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

  /** A fresh Base32-encoded secret. */
  def generateSecret(): String = {
    val bytes = new Array[Byte](SecretByteLength)
    rng.nextBytes(bytes)
    base32.encodeToString(bytes)
  }

  /** A single-use recovery code: characters drawn directly from the Base32
   *  alphabet (5 bits of entropy each), not a byte-array encoding — which
   *  would need padding at this length. */
  def generateBackupCode(): String =
    new String(Array.fill(BackupCodeLength)(Base32Alphabet.charAt(rng.nextInt(Base32Alphabet.length))))

  /** `otpauth://totp/{issuer}:{email}?secret=...&issuer=...` (design.md D6)
   *  — SHA1/6-digit/30s defaults are all omitted; every authenticator app
   *  assumes them. */
  def otpauthUri(secret: String, email: String, issuer: String = "Helio"): String = {
    val label         = URLEncoder.encode(s"$issuer:$email", StandardCharsets.UTF_8.name())
    val encodedIssuer = URLEncoder.encode(issuer, StandardCharsets.UTF_8.name())
    s"otpauth://totp/$label?secret=$secret&issuer=$encodedIssuer"
  }

  /** `true` iff `code` is shaped like a TOTP code (6 digits) rather than a
   *  backup code (design.md D5 code-shape dispatch). */
  def looksLikeTotpCode(code: String): Boolean = code.matches("^[0-9]{6}$")

  /** Verifies `code` against `secret` for the current step and its
   *  immediate neighbours (±1), rejecting any step not strictly greater
   *  than `lastUsedStep` (RFC 6238 §5.2 replay guard). Returns the accepted
   *  step (to persist as the new `lastUsedStep`) on success, `None`
   *  otherwise — including for malformed input, so a corrupt/legacy secret
   *  never crashes the caller. */
  def verify(secret: String, code: String, lastUsedStep: Long, now: Instant = Instant.now()): Option[Long] =
    if (!looksLikeTotpCode(code)) None
    else
      Try {
        val key         = keyFor(secret)
        val currentStep = stepOf(now)
        ((currentStep - WindowSteps) to (currentStep + WindowSteps))
          .filter(_ > lastUsedStep)
          .find { step =>
            totp.generateOneTimePasswordString(key, Instant.ofEpochSecond(step * StepSeconds)) == code
          }
      }.getOrElse(None)

  private def keyFor(secret: String): SecretKeySpec =
    new SecretKeySpec(base32.decode(secret), totp.getAlgorithm)

  private def stepOf(instant: Instant): Long = instant.getEpochSecond / StepSeconds
}
