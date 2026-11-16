package com.helio.services.workspace

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** HEL-1639 D1 (task 3.7): step configs shown to a model have secret-bearing keys redacted, by exact key name. */
class SecretRedactionSpec extends AnyWordSpec with Matchers {

  "SecretRedaction.redact" should {
    "replace the value of a secret-bearing key at any depth, including inside arrays, keeping the key" in {
      val config = """{"password":"hunter2","nested":{"apiKey":"k","Authorization":"Bearer x","items":[{"token":"t","keep":"v"}]},"columns":["a"]}""".parseJson
      val out = SecretRedaction.redact(config).asJsObject
      out.fields("password") shouldBe SecretRedaction.Redacted
      val nested = out.fields("nested").asJsObject
      nested.fields("apiKey") shouldBe SecretRedaction.Redacted
      nested.fields("Authorization") shouldBe SecretRedaction.Redacted
      nested.fields("items").asInstanceOf[JsArray].elements.head.asJsObject.fields("token") shouldBe SecretRedaction.Redacted
      nested.fields("items").asInstanceOf[JsArray].elements.head.asJsObject.fields("keep") shouldBe JsString("v")
      out.fields("columns") shouldBe JsArray(JsString("a"))
      out.compactPrint should not include "hunter2"
    }

    "match by exact key name, never by substring, so an ordinary key such as maxTokens survives" in {
      val config = """{"maxTokens":512,"tokenizer":"x","secretary":"y","fields":["token"]}""".parseJson
      SecretRedaction.redact(config) shouldBe config
    }
  }
}
