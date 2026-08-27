package com.helio.services.auth

import javax.crypto.{AEADBadTagException, Cipher, SecretKey}
import javax.crypto.spec.{GCMParameterSpec, SecretKeySpec}
import java.security.SecureRandom
import java.util.Base64
import scala.util.{Failure, Success, Try}

/** A data key wrapped under a specific master key (identified by `keyId`), per
 *  design.md Decision 3. `ciphertext`/`nonce` are the AES-256-GCM wrapping of
 *  the raw data key bytes -- never the raw data key itself. */
final case class WrappedKey(keyId: String, ciphertext: Array[Byte], nonce: Array[Byte])

/** Failure modes for master-key resolution and wrap/unwrap. Fail-closed is the
 *  whole point of this type: there is no success case that yields plaintext
 *  when a key cannot be resolved (design.md Decision 3). */
sealed trait MasterKeyError
object MasterKeyError {

  /** `CONNECTOR_MASTER_KEY` (and, for unwrap, `CONNECTOR_MASTER_KEY_PREVIOUS`) is
   *  absent, blank, or not valid key material -- no key to wrap/unwrap under. */
  case object NoKeyConfigured extends MasterKeyError

  /** A `WrappedKey.keyId` does not match either the current
   *  `CONNECTOR_MASTER_KEY_ID` or (rotation window only) the previous
   *  `CONNECTOR_MASTER_KEY_PREVIOUS_ID` -- this provider cannot resolve it. */
  case object UnknownKeyId extends MasterKeyError

  /** GCM authentication failed while unwrapping -- wrong key, or the wrapped
   *  bytes were tampered with/corrupted. Never surfaces corrupted plaintext. */
  case object UnwrapFailed extends MasterKeyError
}

/** Seam for wrapping/unwrapping a per-credential data key under the
 *  currently-active master key (design.md Decision 1/3). Deliberately narrow
 *  -- wrap/unwrap a data key, given a key id -- so a future
 *  `KmsMasterKeyProvider` can be substituted with no change to
 *  `EncryptedSecretBackend`, the repository, or any caller. Raw master-key
 *  bytes never cross this boundary; only `WrappedKey` results do. */
trait MasterKeyProvider {

  /** Wraps a freshly-generated data key under the currently-active master key.
   *  `Left(MasterKeyError.NoKeyConfigured)` when `CONNECTOR_MASTER_KEY` is
   *  absent/invalid -- never falls back to an unwrapped/plaintext result. */
  def wrapDataKey(dataKey: Array[Byte]): Either[MasterKeyError, WrappedKey]

  /** Unwraps a data key previously wrapped under `wrapped.keyId` -- resolves
   *  that id against `CONNECTOR_MASTER_KEY_ID` first, then (rotation window
   *  only) `CONNECTOR_MASTER_KEY_PREVIOUS_ID`. `Left(MasterKeyError.UnknownKeyId)`
   *  when `wrapped.keyId` names a key this provider cannot resolve --
   *  never falls through to the current key. */
  def unwrapDataKey(wrapped: WrappedKey): Either[MasterKeyError, Array[Byte]]
}

/** Env-backed `MasterKeyProvider` -- resolves `CONNECTOR_MASTER_KEY`/
 *  `CONNECTOR_MASTER_KEY_ID` (current) and `CONNECTOR_MASTER_KEY_PREVIOUS`/
 *  `CONNECTOR_MASTER_KEY_PREVIOUS_ID` (rotation window only) the *same way in
 *  every environment* -- local dev, CI, and production differ only in which
 *  value they put in these env vars, never in code path (design.md Decision 4;
 *  mirrors `EmailConfig.fromEnv`'s read-from-`sys.env` convention). There is no
 *  baked-in fallback key and no environment-conditional branch here or anywhere
 *  else in this file.
 *
 *  Performs the AES-256-GCM wrap/unwrap itself, since a raw symmetric key is
 *  exactly what a Secret-Manager pepper is; a future `KmsMasterKeyProvider`
 *  would instead call out to KMS's own wrap/unwrap RPCs, with key bytes never
 *  touching application code. */
final class EnvMasterKeyProvider(env: Map[String, String] = sys.env) extends MasterKeyProvider {

  import EnvMasterKeyProvider._

  private val random = new SecureRandom()

  private def resolveKeyMaterial(keyEnvVar: String, idEnvVar: String): Option[(String, SecretKey)] =
    for {
      keyB64 <- env.get(keyEnvVar).map(_.trim).filter(_.nonEmpty)
      keyId  <- env.get(idEnvVar).map(_.trim).filter(_.nonEmpty)
      key    <- decodeKey(keyB64)
    } yield (keyId, key)

  private def decodeKey(keyB64: String): Option[SecretKey] =
    Try(Base64.getDecoder.decode(keyB64)) match {
      case Success(bytes) if bytes.length == 32 => Some(new SecretKeySpec(bytes, "AES"))
      case _                                     => None
    }

  override def wrapDataKey(dataKey: Array[Byte]): Either[MasterKeyError, WrappedKey] =
    resolveKeyMaterial(CurrentKeyEnvVar, CurrentKeyIdEnvVar) match {
      case None                  => Left(MasterKeyError.NoKeyConfigured)
      case Some((keyId, key)) =>
        val nonce = new Array[Byte](GcmNonceLength)
        random.nextBytes(nonce)
        gcmEncrypt(key, nonce, dataKey) match {
          case Success(ciphertext) => Right(WrappedKey(keyId, ciphertext, nonce))
          case Failure(_)          => Left(MasterKeyError.UnwrapFailed)
        }
    }

  override def unwrapDataKey(wrapped: WrappedKey): Either[MasterKeyError, Array[Byte]] = {
    val currentKey  = resolveKeyMaterial(CurrentKeyEnvVar, CurrentKeyIdEnvVar)
    val previousKey = resolveKeyMaterial(PreviousKeyEnvVar, PreviousKeyIdEnvVar)

    val resolved: Option[SecretKey] =
      currentKey.collect { case (id, key) if id == wrapped.keyId => key }
        .orElse(previousKey.collect { case (id, key) if id == wrapped.keyId => key })

    resolved match {
      case None => Left(MasterKeyError.UnknownKeyId)
      case Some(key) =>
        gcmDecrypt(key, wrapped.nonce, wrapped.ciphertext) match {
          case Success(dataKey) => Right(dataKey)
          case Failure(_: AEADBadTagException) => Left(MasterKeyError.UnwrapFailed)
          case Failure(_)                       => Left(MasterKeyError.UnwrapFailed)
        }
    }
  }
}

object EnvMasterKeyProvider {
  val CurrentKeyEnvVar: String    = "CONNECTOR_MASTER_KEY"
  val CurrentKeyIdEnvVar: String  = "CONNECTOR_MASTER_KEY_ID"
  val PreviousKeyEnvVar: String   = "CONNECTOR_MASTER_KEY_PREVIOUS"
  val PreviousKeyIdEnvVar: String = "CONNECTOR_MASTER_KEY_PREVIOUS_ID"

  private[auth] val GcmNonceLength: Int = 12
  private[auth] val GcmTagLengthBits: Int = 128

  private[auth] def gcmEncrypt(key: SecretKey, nonce: Array[Byte], plaintext: Array[Byte]): Try[Array[Byte]] =
    Try {
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(GcmTagLengthBits, nonce))
      cipher.doFinal(plaintext)
    }

  private[auth] def gcmDecrypt(key: SecretKey, nonce: Array[Byte], ciphertext: Array[Byte]): Try[Array[Byte]] =
    Try {
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(GcmTagLengthBits, nonce))
      cipher.doFinal(ciphertext)
    }
}
