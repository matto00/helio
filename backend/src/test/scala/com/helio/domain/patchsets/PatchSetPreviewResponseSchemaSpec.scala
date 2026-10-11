package com.helio.domain.patchsets

import com.helio.api.protocols.patchsets.{EditPreview, PatchSetPreviewProtocol, PatchSetPreviewResponse}
import com.helio.testsupport.JsonSchemaValidation
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** HEL-1459: the backend previews `output` edits (HEL-1239) but `patch-set-preview-response.schema.json`'s
 *  `EditPreview.kind` enum omitted `output`. Serialises through the real protocol writer and validates
 *  against the schema file for every target kind. */
class PatchSetPreviewResponseSchemaSpec extends AnyWordSpec with Matchers with PatchSetPreviewProtocol {

  private val schema = JsonSchemaValidation.compile("patch-sets/patch-set-preview-response.schema.json")

  private def previewJson(kind: String): String =
    PatchSetPreviewResponse(
      Vector(
        EditPreview(
          0,
          kind,
          "update",
          Some(JsObject("id" -> JsString("x"), "name" -> JsString("before"))),
          Some(JsObject("id" -> JsString("x"), "name" -> JsString("after"))),
          Vector.empty
        )
      )
    ).toJson.compactPrint

  "patch-set-preview-response.schema.json" should {
    PatchSetTargetKinds.All.foreach { kind =>
      s"accept an EditPreview of kind '$kind'" in {
        JsonSchemaValidation.validationErrors(schema, previewJson(kind)) shouldBe empty
      }
    }

    "reject the removed 'dataType' kind" in {
      JsonSchemaValidation.validationErrors(schema, previewJson("dataType")) should not be empty
    }
  }
}
