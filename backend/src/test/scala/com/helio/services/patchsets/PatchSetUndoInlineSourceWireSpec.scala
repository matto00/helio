package com.helio.services.patchsets

import com.helio.api.protocols.patchsets.{EditUndoOutcome, InlineSourceUndoOutcome, PatchSetUndoProtocol, PatchSetUndoResponse}
import com.helio.testsupport.JsonSchemaValidation
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** HEL-1493 task 4.7: the undo outcome's `inlineSources` is declared by `patch-set-undo-response.schema.json`, is
 *  serialised through the real protocol writer, and is omitted when `None`. */
class PatchSetUndoInlineSourceWireSpec extends AnyWordSpec with Matchers with PatchSetUndoProtocol {

  private val schema = JsonSchemaValidation.compile("patch-sets/patch-set-undo-response.schema.json")

  private def json(edit: EditUndoOutcome): JsObject = PatchSetUndoResponse(Vector(edit)).toJson.asJsObject
  private def errors(body: JsObject): Seq[String] = JsonSchemaValidation.validationErrors(schema, body.compactPrint)

  "an EditUndoOutcome" should {
    "validate against the schema with each inlineSources result" in {
      val sources = Vector(
        InlineSourceUndoOutcome("a", Some("A"), "removed", None),
        InlineSourceUndoOutcome("b", Some("B"), "kept", Some("still referenced")),
        InlineSourceUndoOutcome("c", None, "alreadyGone", None)
      )
      val body = json(EditUndoOutcome(0, "restored", Some("p"), None, Some(sources)))
      errors(body) shouldBe empty
      body.fields("edits").asInstanceOf[JsArray].elements.head.asJsObject.fields("inlineSources").asInstanceOf[JsArray].elements.size shouldBe 3
    }
    "omit inlineSources when None, and still validate" in {
      val body = json(EditUndoOutcome(0, "restored", Some("p"), None))
      body.fields("edits").asInstanceOf[JsArray].elements.head.asJsObject.fields.contains("inlineSources") shouldBe false
      errors(body) shouldBe empty
    }
    "fail the schema for an unknown result value (failable)" in {
      val bad = json(EditUndoOutcome(0, "restored", Some("p"), None, Some(Vector(InlineSourceUndoOutcome("a", None, "deleted", None)))))
      errors(bad) should not be empty
    }
    "fail the schema for an unknown extra property on an inline source (failable)" in {
      val good = json(EditUndoOutcome(0, "restored", Some("p"), None, Some(Vector(InlineSourceUndoOutcome("a", None, "removed", None)))))
      errors(good) shouldBe empty
      val bad = good.compactPrint.replace("""{"id":"a"""", """{"surprise":true,"id":"a"""").parseJson.asJsObject
      errors(bad) should not be empty
    }
  }
}
