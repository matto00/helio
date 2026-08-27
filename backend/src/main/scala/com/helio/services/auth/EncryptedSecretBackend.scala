package com.helio.services.auth

import java.security.SecureRandom
import javax.crypto.spec.SecretKeySpec
import scala.util.{Failure, Success}

/** The wrapped-data-key + ciphertext shape produced by [[EncryptedSecretBackend.encrypt]] --
 *  exactly the four BYTEA-ish columns `connector_credentials` persists (design.md Decision 2):
 *  `keyId`/`wrappedDataKey`/`nonceDek` identify and recover the per-row data key, `ciphertext`/
 *  `nonceValue` is the credential value encrypted under that data key.
 *
 *  `toString` is overridden to redact -- this type transiently holds nothing plaintext itself,
 *  but is deliberately given the same redacted-`toString` treatment as `EmailConfig` so a future
 *  refactor that adds a plaintext field here doesn't silently start leaking it via an incidental
 *  `log.info`/string-interpolation call site. */
final case class EncryptedPayload(
    keyId: String,
    wrappedDataKey: Array[Byte],
    nonceDek: Array[Byte],
    ciphertext: Array[Byte],
    nonceValue: Array[Byte]
) {
  override def toString: String = s"EncryptedPayload(keyId=$keyId, <redacted>)"
}

/** Storage-time counterpart to `SecretBackend.mask` (`SecretField.scala`) -- a reversible,
 *  envelope-encrypted representation of a secret value, for connector credentials that must later
 *  be recovered to make an outbound call, not merely masked for display. Deliberately NOT a
 *  `SecretBackend` implementation: `mask` is total/infallible (always returns a displayable
 *  string), while encryption must be able to fail (no master key configured, unresolvable key id)
 *  -- see design.md Decision 3a. Lives beside `SecretField.scala` in the same package as the
 *  sibling seam it builds on, not inside it.
 *
 *  Constructor takes a [[MasterKeyProvider]], never a raw key -- every `encrypt`/`decrypt` call
 *  re-resolves the master key through it, so a provider that fails today fails every call today,
 *  including the very first one after a bad deploy (design.md Decision 3). AES-256-GCM is used for
 *  both the data-key wrapping layer (delegated to `provider`) and the value layer (done here). */
final class EncryptedSecretBackend(provider: MasterKeyProvider) {

  import EncryptedSecretBackend._

  private val random = new SecureRandom()

  /** Generates a fresh 256-bit data key, wraps it under the currently-active master key via
   *  `provider.wrapDataKey`, then encrypts `plaintext` under the (unwrapped, in-memory-only) data
   *  key. `Left` (never a plaintext-shaped success) when `provider.wrapDataKey` fails -- e.g. no
   *  master key configured -- so there is no code path from "no key" to a persisted row. */
  def encrypt(plaintext: String): Either[MasterKeyError, EncryptedPayload] = {
    val dataKey = new Array[Byte](DataKeyLength)
    random.nextBytes(dataKey)
    for {
      wrapped <- provider.wrapDataKey(dataKey)
      nonceValue = randomNonce()
      ciphertext <- EnvMasterKeyProvider
        .gcmEncrypt(asSecretKey(dataKey), nonceValue, plaintext.getBytes("UTF-8"))
        .toEither
        .left
        .map(_ => MasterKeyError.UnwrapFailed)
    } yield EncryptedPayload(
      keyId          = wrapped.keyId,
      wrappedDataKey = wrapped.ciphertext,
      nonceDek       = wrapped.nonce,
      ciphertext     = ciphertext,
      nonceValue     = nonceValue
    )
  }

  /** Unwraps `payload`'s data key via `provider.unwrapDataKey`, then decrypts `payload.ciphertext`
   *  under it. `Left` on any failure -- wrong/rotated master key, unknown `keyId`, or a corrupted
   *  ciphertext (GCM tag mismatch) -- never a corrupted/partial plaintext. */
  def decrypt(payload: EncryptedPayload): Either[MasterKeyError, String] = {
    val wrapped = WrappedKey(payload.keyId, payload.wrappedDataKey, payload.nonceDek)
    for {
      dataKey <- provider.unwrapDataKey(wrapped)
      plaintext <- EnvMasterKeyProvider
        .gcmDecrypt(asSecretKey(dataKey), payload.nonceValue, payload.ciphertext)
        .toEither
        .left
        .map(_ => MasterKeyError.UnwrapFailed)
    } yield new String(plaintext, "UTF-8")
  }

  private def randomNonce(): Array[Byte] = {
    val nonce = new Array[Byte](EnvMasterKeyProvider.GcmNonceLength)
    random.nextBytes(nonce)
    nonce
  }
}

object EncryptedSecretBackend {
  private val DataKeyLength: Int = 32 // 256 bits

  private def asSecretKey(bytes: Array[Byte]) =
    new SecretKeySpec(bytes, "AES")

  implicit private class TryEither[A](private val t: scala.util.Try[A]) extends AnyVal {
    def toEither: Either[Throwable, A] = t match {
      case Success(v) => Right(v)
      case Failure(e) => Left(e)
    }
  }
}
