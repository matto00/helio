package com.helio.services

import com.helio.api.protocols.SqlSourceConfigPayload
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

class SecretFieldSpec extends AnyWordSpec with Matchers {

  final case class FakeConfig(secret: String, other: String)

  private val secretField = SecretField[FakeConfig](
    name = "secret",
    get  = c => if (c.secret.isEmpty) None else Some(c.secret),
    set  = (c, v) => c.copy(secret = v)
  )

  private implicit val hasSecrets: HasSecrets[FakeConfig] = HasSecrets(Set(secretField))

  "SecretRedaction.redact" should {

    "mask a present secret field via the backend" in {
      val cfg     = FakeConfig(secret = "raw-value", other = "keep-me")
      val redacted = SecretRedaction.redact(cfg)
      redacted.secret shouldBe "***"
    }

    "leave an absent secret field untouched" in {
      val cfg     = FakeConfig(secret = "", other = "keep-me")
      val redacted = SecretRedaction.redact(cfg)
      redacted.secret shouldBe ""
    }

    "leave non-secret fields untouched" in {
      val cfg     = FakeConfig(secret = "raw-value", other = "keep-me")
      val redacted = SecretRedaction.redact(cfg)
      redacted.other shouldBe "keep-me"
    }

    "delegate masking to the supplied SecretBackend" in {
      val cfg = FakeConfig(secret = "raw-value", other = "keep-me")
      val customBackend = new SecretBackend {
        override def mask(rawValue: String): String = s"REDACTED(${rawValue.length})"
      }
      val redacted = SecretRedaction.redact(cfg, customBackend)
      redacted.secret shouldBe "REDACTED(9)"
    }
  }

  "InlineSecretBackend.mask" should {
    "always return the literal \"***\"" in {
      InlineSecretBackend.mask("anything") shouldBe "***"
      InlineSecretBackend.mask("")         shouldBe "***"
    }
  }

  // HEL-460: proves the SQL empty-password exemption survives the new `SecretRedaction.redact`
  // path directly (independent of `DataSourceResponse.fromDomain`), using
  // `SqlSourceConfigPayload`'s own `HasSecrets` instance.
  "SecretRedaction.redact applied to SqlSourceConfigPayload" should {

    "leave an empty password as \"\" (no spurious redaction)" in {
      val payload = SqlSourceConfigPayload("postgresql", "host", 5432, "db", "user", "", "SELECT 1")
      SecretRedaction.redact(payload).password shouldBe ""
    }

    "mask a non-empty password to \"***\"" in {
      val payload = SqlSourceConfigPayload("postgresql", "host", 5432, "db", "user", "real-pw", "SELECT 1")
      SecretRedaction.redact(payload).password shouldBe "***"
    }
  }
}
