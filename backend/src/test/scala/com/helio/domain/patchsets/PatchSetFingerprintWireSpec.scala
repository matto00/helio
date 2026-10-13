package com.helio.domain.patchsets

import com.helio.api.{PatchSetStaleResponse, StaleTargetResponse}
import com.helio.api.JsonProtocols
import com.helio.api.protocols.patchsets.{EditPreview, PatchSet, PatchSetPreviewResponse}
import com.helio.testsupport.JsonSchemaValidation
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** HEL-1458 seam: the fingerprint carrier decodes in the backend protocol and validates against the schema files
 *  that clients (the review page, helio-mcp) are built from. */
class PatchSetFingerprintWireSpec extends AnyWordSpec with Matchers with JsonProtocols {

  private val patchSetSchema = JsonSchemaValidation.compile("patch-sets/patch-set.schema.json")
  private val previewSchema  = JsonSchemaValidation.compile("patch-sets/patch-set-preview-response.schema.json")
  private val staleSchema    = JsonSchemaValidation.compile("shared/patch-set-stale-response.schema.json")

  private val stampedPatchSet: String =
    """{"edits":[{"target":{"kind":"panel","id":"p1","fingerprint":"v1:abc"},"op":"update","patch":{"title":"T"}}]}"""

  "a patch set whose target carries a fingerprint" should {
    "validate against patch-set.schema.json" in {
      JsonSchemaValidation.validationErrors(patchSetSchema, stampedPatchSet) shouldBe empty
    }

    "decode in the backend protocol and round-trip the fingerprint" in {
      val decoded = stampedPatchSet.parseJson.convertTo[PatchSet]
      decoded.edits.head.target.fingerprint shouldBe Some("v1:abc")
      decoded.toJson.compactPrint.parseJson.convertTo[PatchSet] shouldBe decoded
    }

    "decode without a fingerprint as before" in {
      val plain = """{"edits":[{"target":{"kind":"panel","id":"p1"},"op":"update","patch":{"title":"T"}}]}"""
      plain.parseJson.convertTo[PatchSet].edits.head.target.fingerprint shouldBe None
    }

    "decode a fingerprint on a create edit (rejection is the resolver's job, not the reader's)" in {
      val create = """{"edits":[{"target":{"kind":"panel","fingerprint":"v1:x"},"op":"create","patch":{"type":"divider"}}]}"""
      create.parseJson.convertTo[PatchSet].edits.head.target.fingerprint shouldBe Some("v1:x")
    }
  }

  "patch-set-preview-response.schema.json" should {
    "accept an EditPreview carrying a fingerprint" in {
      val json = PatchSetPreviewResponse(Vector(EditPreview(0, "panel", "update", None, None, Vector.empty, Some("v1:abc")))).toJson.compactPrint
      JsonSchemaValidation.validationErrors(previewSchema, json) shouldBe empty
      json should include("\"fingerprint\":\"v1:abc\"")
    }
  }

  "patch-set-stale-response.schema.json" should {
    "accept the 409 body the backend writes" in {
      val json = PatchSetStaleResponse("m", "PATCH_SET_STALE", Vector(StaleTargetResponse(1, "panel", "p1"))).toJson.compactPrint
      JsonSchemaValidation.validationErrors(staleSchema, json) shouldBe empty
    }
  }
}
