package com.helio.api.protocols.assistant

import com.helio.api.protocols.assistant.AssistantProtocol
import com.helio.api.protocols.patchsets.{PatchSet, PatchSetProtocol}
import com.helio.api.protocols.pipelines.{PipelineProposal, ProposalRestApiConfig}
import com.helio.api.protocols.proposals.{CombinedProposal, CombinedProposalProtocol, DashboardProposal}
import com.helio.api.protocols.sources.{RestApiConfigPayload, SqlSourceConfigPayload}
import com.helio.domain.model.PanelType
import com.helio.services.proposals.ProposalPanelSupport
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

  // HEL-756 tasks.md 2.1 — decode-pins test_connection's two examples through the SAME `config` ->
  // RestApiConfigPayload/SqlSourceConfigPayload conversion path AssistantToolExecutor.
  // executeTestConnection applies to a real `tool_use.input`.
  "test_connection's schema examples" should {
    "decode a rest_api example's config to RestApiConfigPayload with no DeserializationException" in {
      val examples = examplesOf("test_connection")
      examples should have size 2

      val restExample = examples.find(_.asJsObject.fields.get("type").contains(JsString("rest_api")))
        .getOrElse(fail("no rest_api example in test_connection's schema"))
      val payload = restExample.asJsObject.fields("config").convertTo[RestApiConfigPayload]

      // HEL-822 cycle-2 CR1: the pin must exercise `toDomain` (not just spray-json decode) —
      // that is the boundary that actually broke when `auth` was advertised on a rest_api
      // example while `toDomain` started hard-rejecting it. A `Left` here means the schema's
      // own worked example is unusable by the assistant.
      RestApiConfigPayload.toDomain(payload) shouldBe a[Right[_, _]]
      payload.auth shouldBe None
      payload.connectorId shouldBe defined
    }

    "decode a sql example's config to SqlSourceConfigPayload with no DeserializationException" in {
      val examples = examplesOf("test_connection")

      val sqlExample = examples.find(_.asJsObject.fields.get("type").contains(JsString("sql")))
        .getOrElse(fail("no sql example in test_connection's schema"))
      sqlExample.asJsObject.fields("config").convertTo[SqlSourceConfigPayload]
    }
  }

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

    // HEL-822 cycle-2 CR1: the inline rest_api example's config must itself pass
    // RestApiConfigPayload.toDomain — PipelineService.resolveInlineSourceSchema rejects an
    // `auth`-carrying or url+connectorId-ambiguous config before it ever reaches a connector.
    "the inline rest_api example's config decodes through RestApiConfigPayload.toDomain" in {
      val decoded = examplesOf("propose_pipeline").head.convertTo[PipelineProposal]
      decoded.source.restConfig shouldBe defined
      RestApiConfigPayload.toDomain(ProposalRestApiConfig.toRestApiConfigPayload(decoded.source.restConfig.get)) shouldBe a[Right[_, _]]
    }

    // HEL-948: PipelineProposalStepSchema's inputSchema now advertises `enabled`
    // (type: [boolean, null]), matching create-pipeline-transactional-step-request.schema.json.
    // Decode-pin a step carrying `enabled: false` through the SAME PipelineProposal target type
    // AssistantToolExecutor.decode applies to a real tool_use.input.
    "decodes a step carrying enabled: false with no DeserializationException" in {
      val json =
        """{
          "pipelineName": "Weekly Signups",
          "source": {
            "type": "static",
            "name": "Inline",
            "config": { "columns": [{ "name": "a", "type": "integer" }], "rows": [] }
          },
          "steps": [
            { "clientId": "s1", "type": "cast", "config": { "casts": { "a": "integer" } }, "enabled": false }
          ]
        }""".parseJson

      val decoded = json.convertTo[PipelineProposal]
      decoded.steps should have size 1
      decoded.steps.head.enabled shouldBe Some(false)
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
      decoded.dashboard.panels.map(_.outputId) should contain(Some("$pipelineOutput"))
    }

    // HEL-904 cycle-8 (round-5 skeptic Finding D, wire-contract-diff-5.md):
    // this pin was decode-only, so a stale panel-kind literal in a worked
    // example (e.g. leftover "metric"/"chart"/"table" from before the
    // pipelines-and-outputs remodel) could still decode fine as a plain
    // String and never turn this suite red -- exactly why the defect class
    // recurred across three prior rounds. Every panel in every
    // propose_combined/propose_dashboard example must ALSO pass the real
    // `PanelType.fromString`/`ProposalPanelSupport.validatePanel` checks
    // AssistantToolExecutor's real apply path runs, so a stale-kind example
    // fails HERE, not silently at runtime against a real model's call.
    "every dashboard panel in every example passes PanelType.fromString and ProposalPanelSupport.validatePanel" in {
      val decoded = examplesOf("propose_combined").map(_.convertTo[CombinedProposal])
      decoded should not be empty
      decoded.foreach { proposal =>
        proposal.dashboard.panels.foreach { panel =>
          withClue(s"panel '${panel.title}' (type=${panel.`type`}): ") {
            PanelType.fromString(panel.`type`) shouldBe a[Right[_, _]]
            ProposalPanelSupport.validatePanel("propose_combined example", panel) shouldBe a[Right[_, _]]
          }
        }
      }
    }
  }

  "propose_dashboard's schema examples (panel-kind pin)" should {
    "every panel passes PanelType.fromString and ProposalPanelSupport.validatePanel" in {
      val decoded = examplesOf("propose_dashboard").map(_.convertTo[DashboardProposal])
      decoded should not be empty
      decoded.foreach { proposal =>
        proposal.panels.foreach { panel =>
          withClue(s"panel '${panel.title}' (type=${panel.`type`}): ") {
            PanelType.fromString(panel.`type`) shouldBe a[Right[_, _]]
            ProposalPanelSupport.validatePanel("propose_dashboard example", panel) shouldBe a[Right[_, _]]
          }
        }
      }
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

    // HEL-948: EditTargetSchema's `kind` enum now advertises "output", matching
    // $defs.EditTarget.properties.kind.enum in schemas/patch-sets/patch-set.schema.json.
    // Decode-pin a patch-set edit targeting kind: "output" through the SAME PatchSet target
    // type AssistantToolExecutor.decode applies to a real tool_use.input.
    "decodes an edit targeting kind: \"output\" with no DeserializationException" in {
      val json =
        """{
          "summary": "Rename an output",
          "edits": [
            {
              "target": { "kind": "output", "id": "output_example_from_find" },
              "op": "update",
              "patch": { "name": "Renamed Output" }
            }
          ]
        }""".parseJson

      val decoded = json.convertTo[PatchSet]
      decoded.edits should have size 1
      decoded.edits.head.target.kind shouldBe "output"
    }
  }
}
