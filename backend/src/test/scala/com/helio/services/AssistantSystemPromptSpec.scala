package com.helio.services

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
      AssistantSystemPrompt.text should include("dataTypeId")
    }
  }
}
