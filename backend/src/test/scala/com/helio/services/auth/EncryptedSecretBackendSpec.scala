package com.helio.services.auth

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.security.SecureRandom
import java.util.Base64

/** HEL-536 — `EncryptedSecretBackend`/`EnvMasterKeyProvider` fail-closed and round-trip behavior.
 *  Task 3.2 ("no master key configured") is, per the ticket's own emphasis, the single most
 *  important negative test in this ticket. */
class EncryptedSecretBackendSpec extends AnyWordSpec with Matchers {

  private def randomKeyB64(): String = {
    val bytes = new Array[Byte](32)
    new SecureRandom().nextBytes(bytes)
    Base64.getEncoder.encodeToString(bytes)
  }

  private def envWith(pairs: (String, String)*): Map[String, String] = pairs.toMap

  private def flippedByte(bytes: Array[Byte]): Array[Byte] = {
    val copy = bytes.clone()
    copy(0) = (copy(0) ^ 0xff).toByte
    copy
  }

  "EncryptedSecretBackend.encrypt" should {

    "return Left(NoKeyConfigured), never a plaintext-shaped success, when CONNECTOR_MASTER_KEY is unset" in {
      val provider = new EnvMasterKeyProvider(env = Map.empty)
      val backend  = new EncryptedSecretBackend(provider)

      val result = backend.encrypt("super-secret-api-key")

      result shouldBe Left(MasterKeyError.NoKeyConfigured)
    }

    "return Left(NoKeyConfigured) when CONNECTOR_MASTER_KEY is set but CONNECTOR_MASTER_KEY_ID is missing" in {
      val provider = new EnvMasterKeyProvider(env = envWith("CONNECTOR_MASTER_KEY" -> randomKeyB64()))
      val backend  = new EncryptedSecretBackend(provider)

      backend.encrypt("super-secret-api-key") shouldBe Left(MasterKeyError.NoKeyConfigured)
    }

    "round-trip encrypt then decrypt under the same key" in {
      val keyB64 = randomKeyB64()
      val env    = envWith("CONNECTOR_MASTER_KEY" -> keyB64, "CONNECTOR_MASTER_KEY_ID" -> "env-test-1")
      val provider = new EnvMasterKeyProvider(env)
      val backend  = new EncryptedSecretBackend(provider)

      val plaintext = "sk_live_abcdef1234567890"
      val encrypted = backend.encrypt(plaintext)
      encrypted.isRight shouldBe true

      val decrypted = backend.decrypt(encrypted.toOption.get)
      decrypted shouldBe Right(plaintext)
    }

    "produce ciphertext bytes that never equal the plaintext bytes" in {
      val keyB64 = randomKeyB64()
      val env    = envWith("CONNECTOR_MASTER_KEY" -> keyB64, "CONNECTOR_MASTER_KEY_ID" -> "env-test-1")
      val backend = new EncryptedSecretBackend(new EnvMasterKeyProvider(env))

      val plaintext = "sk_live_abcdef1234567890"
      val payload   = backend.encrypt(plaintext).toOption.get

      new String(payload.ciphertext, "UTF-8") should not include plaintext
    }
  }

  "EncryptedSecretBackend.decrypt" should {

    "fail closed (Left) when only a different (unrelated) key is configured than the one that encrypted the payload" in {
      val keyAB64 = randomKeyB64()
      val keyBB64 = randomKeyB64()

      val providerA = new EnvMasterKeyProvider(
        envWith("CONNECTOR_MASTER_KEY" -> keyAB64, "CONNECTOR_MASTER_KEY_ID" -> "env-key-a")
      )
      val backendA = new EncryptedSecretBackend(providerA)
      val payload  = backendA.encrypt("sk_live_abcdef1234567890").toOption.get

      // Only key B is configured now — key A is not resolvable via unwrapDataKey at all.
      val providerB = new EnvMasterKeyProvider(
        envWith("CONNECTOR_MASTER_KEY" -> keyBB64, "CONNECTOR_MASTER_KEY_ID" -> "env-key-b")
      )
      val backendB = new EncryptedSecretBackend(providerB)

      val result = backendB.decrypt(payload)

      result.isLeft shouldBe true
      result should not be Right("sk_live_abcdef1234567890")
    }

    "return Left(UnwrapFailed) when the key id resolves but the key bytes differ (GCM tag verification failure)" in {
      // Same key_id both times so unwrapDataKey resolves the id and hands the wrong bytes to GCM —
      // this is the only test that actually exercises the tag-check itself, not id resolution.
      val keyAB64 = randomKeyB64()
      val keyBB64 = randomKeyB64()

      val providerA = new EnvMasterKeyProvider(
        envWith("CONNECTOR_MASTER_KEY" -> keyAB64, "CONNECTOR_MASTER_KEY_ID" -> "env-same")
      )
      val backendA = new EncryptedSecretBackend(providerA)
      val payload  = backendA.encrypt("sk_live_abcdef1234567890").toOption.get

      val providerB = new EnvMasterKeyProvider(
        envWith("CONNECTOR_MASTER_KEY" -> keyBB64, "CONNECTOR_MASTER_KEY_ID" -> "env-same")
      )
      val backendB = new EncryptedSecretBackend(providerB)

      backendB.decrypt(payload) shouldBe Left(MasterKeyError.UnwrapFailed)
    }

    "return Left, never a partial/garbled plaintext, when ciphertext is tampered" in {
      val keyB64 = randomKeyB64()
      val provider = new EnvMasterKeyProvider(
        envWith("CONNECTOR_MASTER_KEY" -> keyB64, "CONNECTOR_MASTER_KEY_ID" -> "env-tamper")
      )
      val backend = new EncryptedSecretBackend(provider)
      val payload = backend.encrypt("sk_live_abcdef1234567890").toOption.get

      val tampered = payload.copy(ciphertext = flippedByte(payload.ciphertext))

      backend.decrypt(tampered).isLeft shouldBe true
    }

    "return Left, never a partial/garbled plaintext, when wrappedDataKey is tampered" in {
      val keyB64 = randomKeyB64()
      val provider = new EnvMasterKeyProvider(
        envWith("CONNECTOR_MASTER_KEY" -> keyB64, "CONNECTOR_MASTER_KEY_ID" -> "env-tamper-dek")
      )
      val backend = new EncryptedSecretBackend(provider)
      val payload = backend.encrypt("sk_live_abcdef1234567890").toOption.get

      val tampered = payload.copy(wrappedDataKey = flippedByte(payload.wrappedDataKey))

      backend.decrypt(tampered).isLeft shouldBe true
    }

    "succeed via CONNECTOR_MASTER_KEY_PREVIOUS during a rotation window" in {
      val oldKeyB64 = randomKeyB64()
      val newKeyB64 = randomKeyB64()

      val providerOld = new EnvMasterKeyProvider(
        envWith("CONNECTOR_MASTER_KEY" -> oldKeyB64, "CONNECTOR_MASTER_KEY_ID" -> "env-old")
      )
      val payload = new EncryptedSecretBackend(providerOld).encrypt("rotated-secret").toOption.get

      val providerDuringRotation = new EnvMasterKeyProvider(
        envWith(
          "CONNECTOR_MASTER_KEY"           -> newKeyB64,
          "CONNECTOR_MASTER_KEY_ID"        -> "env-new",
          "CONNECTOR_MASTER_KEY_PREVIOUS"    -> oldKeyB64,
          "CONNECTOR_MASTER_KEY_PREVIOUS_ID" -> "env-old"
        )
      )
      val backend = new EncryptedSecretBackend(providerDuringRotation)

      backend.decrypt(payload) shouldBe Right("rotated-secret")
    }

    "return Left(UnknownKeyId) when the payload's key_id matches neither the current nor previous id" in {
      val provider = new EnvMasterKeyProvider(
        envWith("CONNECTOR_MASTER_KEY" -> randomKeyB64(), "CONNECTOR_MASTER_KEY_ID" -> "env-current")
      )
      val backend = new EncryptedSecretBackend(provider)

      val bogusPayload = EncryptedPayload(
        keyId          = "env-neither-current-nor-previous",
        wrappedDataKey = Array.fill(32)(1: Byte),
        nonceDek       = Array.fill(12)(2: Byte),
        ciphertext     = Array.fill(16)(3: Byte),
        nonceValue     = Array.fill(12)(4: Byte)
      )

      backend.decrypt(bogusPayload) shouldBe Left(MasterKeyError.UnknownKeyId)
    }

    "not fall through to the current key when the previous key id does not resolve" in {
      // unwrapDataKey must resolve wrapped.keyId strictly against current then previous ids —
      // never silently attempt decryption under the current key when keyId doesn't match either.
      val provider = new EnvMasterKeyProvider(
        envWith("CONNECTOR_MASTER_KEY" -> randomKeyB64(), "CONNECTOR_MASTER_KEY_ID" -> "env-current")
      )

      val wrapped = WrappedKey(
        keyId      = "env-some-other-id",
        ciphertext = Array.fill(32)(9: Byte),
        nonce      = Array.fill(12)(9: Byte)
      )

      provider.unwrapDataKey(wrapped) shouldBe Left(MasterKeyError.UnknownKeyId)
    }
  }
}
