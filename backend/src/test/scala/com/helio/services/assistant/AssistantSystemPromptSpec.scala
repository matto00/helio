package com.helio.services.assistant

import com.helio.domain.model.PanelType
import com.helio.services.assistant.AssistantSystemPrompt
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-700 tasks.md 3.2 (design.md D1/D3, assistant-conversation-loop spec's "The system prompt's
 *  shaping guidance is present and placeholder-safe" scenario) — string-presence assertions against
 *  `AssistantSystemPrompt.text`, mirroring `DashboardAuthoringPromptSpec`'s own `should include`
 *  style. Not exhaustive prose-matching: exercises the section's presence and the specific shaping
 *  traps design.md calls out (sentinel, patch-set target/op/patch shape, source exclusivity,
 *  placeholder-id statement). */
class AssistantSystemPromptSpec extends AnyWordSpec with Matchers {

  "AssistantSystemPrompt.text" should {

    "contain a worked-examples/shaping-guidance section" in {
      AssistantSystemPrompt.text should include("Worked examples / shaping guidance")
    }

    "state explicitly that example ids are placeholders and real ids must come from find/get_resource" in {
      AssistantSystemPrompt.text should include("ids below are placeholders")
      AssistantSystemPrompt.text should include("ids you actually received from find/get_resource")
    }

    "cover the propose_combined \"$pipelineOutput\" sentinel" in {
      AssistantSystemPrompt.text should include("\"$pipelineOutput\"")
    }

    "cover the propose_patch_set target/op/patch shape and target.id requirement" in {
      AssistantSystemPrompt.text should include("propose_patch_set")
      AssistantSystemPrompt.text should include("target.id is REQUIRED for update/")
    }

    "cover pipeline source existing-vs-inline branch exclusivity" in {
      AssistantSystemPrompt.text should include("existing-source branch")
      AssistantSystemPrompt.text should include("inline-source branch")
      AssistantSystemPrompt.text should include("never both in the same call")
    }

    "show well-formed propose_dashboard call structure via a mini-transcript" in {
      AssistantSystemPrompt.text should include("propose_dashboard({")
      AssistantSystemPrompt.text should include("outputId")
    }

    // HEL-756 tasks.md 1.7/2.9 (design.md D2) — the tool is documented, the "verify before
    // finalizing" hard rule is present, and the hop count reflects the D3 raise from 3 to 4.
    "document the test_connection tool" in {
      AssistantSystemPrompt.text should include("test_connection(type, config)")
    }

    "state the hard rule that an inline rest_api/sql source must be verified before finalizing" in {
      AssistantSystemPrompt.text should include("test_connection")
      AssistantSystemPrompt.text should include("in its own hop")
      AssistantSystemPrompt.text should include("never finalize a propose_pipeline/propose_combined call for a config that hasn't been " +
        "successfully tested")
    }

    "state the updated 4-hop cap" in {
      AssistantSystemPrompt.text should include("at most 4 hops")
    }

    // HEL-904 cycle-10 fix (round-7 skeptic, deletion-sweep CR1): the worked propose_dashboard
    // example, the find tool's resource-type list, and the "never fabricate an id" rule must never
    // regress to a deleted panel kind or a retired Metrics/DataType resource concept — pinned the
    // same way DashboardAuthoringPromptSpec pins its own sibling prompt.
    "never mentions deleted panel kinds or retired Metrics/DataType resource ids" in {
      Vector("\"metric\"", "\"chart\"", "\"table\"", "\"collection\"", "\"timeline\"", "metricId", "and metrics").foreach {
        deletedLiteral =>
          AssistantSystemPrompt.text should not include deletedLiteral
      }
      // Every kind actually mentioned in the worked example really is one `PanelType.fromString`
      // accepts.
      Vector("text", "markdown", "image", "output").foreach { kind =>
        PanelType.fromString(kind) shouldBe a[Right[_, _]]
      }
    }

    "retargets the worked propose_dashboard example to the output panel kind" in {
      AssistantSystemPrompt.text should include("\"type\": \"output\"")
    }

    // HEL-904 cycle-11 fix (round-7 skeptic, deletion-sweep CR1 lower-severity item): the
    // propose_patch_set tool description must not offer DataType as an editable target --
    // PatchSetProtocol.recognizedKinds no longer accepts "dataType" (task 3.3 removed it outright).
    "does not offer DataType as a propose_patch_set edit target" in {
      AssistantSystemPrompt.text should not include "data source, DataType, pipeline"
    }
  }
}
