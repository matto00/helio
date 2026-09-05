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
      AssistantSystemPrompt.text should include("never both branches on the SAME root")
    }

    // HEL-914 task 9.5: anchors the roots[]/rootClientId/parentId/per-root-test_connection
    // corrections so a future change cannot silently regress to the singular-source prose.
    "describes roots as a non-empty array with per-root branch exclusivity, never a singular source object" in {
      AssistantSystemPrompt.text should include("roots is a non-empty array")
      AssistantSystemPrompt.text should include("rootClientId")
      AssistantSystemPrompt.text should not include "propose_pipeline/propose_combined source is"
    }

    "requires test_connection for EVERY inline root, not only the first" in {
      AssistantSystemPrompt.text should include("for EVERY inline rest_api/sql root in roots[]")
      AssistantSystemPrompt.text should include("a verified first root does NOT exempt an unverified second")
      AssistantSystemPrompt.text should include("for EVERY root in roots[]")
    }

    // HEL-914 task 9.3 (third bullet)/9.4: `target.parentId` was deliberately deferred while
    // task 5 (EditTarget.parentId) was unimplemented, then restored once 5.1 landed -- this
    // anchors it so a future change can't silently drop it again.
    "names target.parentId as required for a propose_patch_set create targeting a child kind" in {
      AssistantSystemPrompt.text should include("target.parentId")
      AssistantSystemPrompt.text should include("REQUIRED for a create targeting a child kind")
      AssistantSystemPrompt.text should include("must be OMITTED for update/delete")
    }

    // HEL-914 (found during the 6b conformance sweep): `attachAsTail: true` is what actually
    // produces a SIBLING lane -- omitting it splices the new step in and reparents the anchor's
    // existing children onto it instead (HEL-908's pre-existing trunk-insert semantic). An agent
    // following ONLY the target.parentId guidance above would author a trunk insertion by
    // mistake when it meant to add a lane.
    "requires attachAsTail: true for a pipelineStep create to add a lane, not a trunk insertion" in {
      AssistantSystemPrompt.text should include("\"attachAsTail\": true")
      AssistantSystemPrompt.text should include("SIBLING lane")
      AssistantSystemPrompt.text should include("SPLICES the new step")
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
