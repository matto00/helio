package com.helio.api.protocols

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** HEL-700 tasks.md 3.1 — decode-pin coverage for the worked `"examples"` array each `propose_*`
 *  tool's `inputSchema` now carries (design.md D2). Every entry is decoded via the SAME spray-json
 *  target type `AssistantToolExecutor.decode` applies to a real `tool_use.input` — an example that
 *  drifts from the protocol (a renamed/removed field, a changed required set) fails this test, not
 *  silently at runtime against a real model's call. Mixes in every proposal protocol trait directly
 *  (same package) rather than reaching into `AssistantToolExecutor`'s private dispatch table. */
class AssistantProposalToolSchemasSpec
    extends AnyWordSpec
    with Matchers
    with CombinedProposalProtocol
    with PatchSetProtocol {

  private def examplesOf(toolName: String): Vector[JsValue] =
    AssistantProtocol.assistantTools
      .find(_.name == toolName)
      .getOrElse(fail(s"no tool named '$toolName' in AssistantProtocol.assistantTools"))
      .inputSchema
      .asJsObject
      .fields
      .getOrElse("examples", fail(s"'$toolName' inputSchema carries no top-level 'examples' array"))
      .asInstanceOf[JsArray]
      .elements

  "propose_dashboard's schema examples" should {
    "each decode to a DashboardProposal with no DeserializationException" in {
      val examples = examplesOf("propose_dashboard")
      examples should not be empty
      examples.foreach(_.convertTo[DashboardProposal])
    }
  }

  "propose_pipeline's schema examples" should {
    "each decode to a PipelineProposal with no DeserializationException" in {
      val examples = examplesOf("propose_pipeline")
      examples should not be empty
      examples.foreach(_.convertTo[PipelineProposal])
    }

    "exercise the inline-source branch (source-branch exclusivity)" in {
      val decoded = examplesOf("propose_pipeline").head.convertTo[PipelineProposal]
      decoded.source.sourceId shouldBe None
      decoded.source.`type` shouldBe defined
    }
  }

  "propose_combined's schema examples" should {
    "each decode to a CombinedProposal with no DeserializationException" in {
      val examples = examplesOf("propose_combined")
      examples should not be empty
      examples.foreach(_.convertTo[CombinedProposal])
    }

    "bind at least one dashboard panel via the literal \"$pipelineOutput\" sentinel, surviving decode" in {
      val decoded = examplesOf("propose_combined").head.convertTo[CombinedProposal]
      decoded.dashboard.panels.map(_.dataTypeId) should contain(Some("$pipelineOutput"))
    }
  }

  "propose_patch_set's schema examples" should {
    "each decode to a PatchSet with no DeserializationException" in {
      val examples = examplesOf("propose_patch_set")
      examples should not be empty
      examples.foreach(_.convertTo[PatchSet])
    }

    "carry an update edit with target.id present" in {
      val decoded = examplesOf("propose_patch_set").head.convertTo[PatchSet]
      val update   = decoded.edits.find(_.op == "update").getOrElse(fail("no update edit in example"))
      update.target.id shouldBe defined
    }
  }
}
