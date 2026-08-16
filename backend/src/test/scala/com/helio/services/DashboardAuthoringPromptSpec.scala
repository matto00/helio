package com.helio.services

import com.helio.api.protocols.{AgentMemoryEntryResponse, AgentPreferencesResponse, WorkspaceContextAgentSection}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json.{JsObject, JsString}

/** HEL-521 (420-C) tasks.md 7.3 — `DashboardAuthoringPrompt.agentContextSection`'s rendering
 *  (design.md Decision 5, spec.md's "prompt includes preferences and memory" /
 *  "prompt omits the section cleanly when agentContext is empty" scenarios). */
class DashboardAuthoringPromptSpec extends AnyWordSpec with Matchers {

  private def memoryEntry(id: String, kind: String, content: String): AgentMemoryEntryResponse =
    AgentMemoryEntryResponse(id = id, kind = kind, content = content, createdAt = "2026-01-01T00:00:00Z", lastUsedAt = None)

  "agentContextSection" should {

    "return an empty string when both preferences and memory are empty" in {
      DashboardAuthoringPrompt.agentContextSection(WorkspaceContextAgentSection.empty) shouldBe ""
    }

    "return an empty string for a caller with an extras-only-empty preferences object and no memory" in {
      val agentContext = WorkspaceContextAgentSection(
        preferences = AgentPreferencesResponse(None, None, None, JsObject.empty, memoryEnabled = true),
        memory      = Vector.empty
      )
      DashboardAuthoringPrompt.agentContextSection(agentContext) shouldBe ""
    }

    "include a rendered preferences summary when preferences are non-empty, and no memory section" in {
      val agentContext = WorkspaceContextAgentSection(
        preferences = AgentPreferencesResponse(
          defaultSeriesColors = Some(Vector("#abcabc", "#123456")),
          defaultPanelStyle   = None,
          namingConventions   = None,
          extras              = JsObject.empty,
          memoryEnabled       = true
        ),
        memory = Vector.empty
      )
      val section = DashboardAuthoringPrompt.agentContextSection(agentContext)
      section should include("User preferences:")
      section should include("#abcabc")
      section should not include "Remembered facts"
    }

    "include a memory bullet list when memory is non-empty, and no preferences section" in {
      val agentContext = WorkspaceContextAgentSection(
        preferences = AgentPreferencesResponse(None, None, None, JsObject.empty, memoryEnabled = true),
        memory      = Vector(memoryEntry("m1", "fact", "user loves Netflix dashboards"), memoryEntry("m2", "goal", "always add sentiment coloring"))
      )
      val section = DashboardAuthoringPrompt.agentContextSection(agentContext)
      section should not include "User preferences:"
      section should include("Remembered facts/goals/preferences about this user:")
      section should include("user loves Netflix dashboards")
      section should include("always add sentiment coloring")
    }

    "include both a preferences summary and a memory bullet list when both are present" in {
      val agentContext = WorkspaceContextAgentSection(
        preferences = AgentPreferencesResponse(Some(Vector("#abcabc")), None, None, JsObject("k" -> JsString("v")), memoryEnabled = true),
        memory      = Vector(memoryEntry("m1", "preference-note", "prefers dark backgrounds"))
      )
      val section = DashboardAuthoringPrompt.agentContextSection(agentContext)
      section should include("User preferences:")
      section should include("Remembered facts/goals/preferences about this user:")
      section should include("prefers dark backgrounds")
    }
  }

  "userMessage" should {

    "not include an agentContext section when agentContext is empty" in {
      val message = DashboardAuthoringPrompt.userMessage(
        goal         = "Build a sales dashboard",
        dataTypes    = Vector.empty,
        capabilities = Map.empty,
        agentContext = WorkspaceContextAgentSection.empty
      )
      message should not include "User preferences:"
      message should not include "Remembered facts/goals/preferences about this user:"
      message should include("User goal: Build a sales dashboard")
    }

    "include the rendered agentContext section after the grounding section when non-empty" in {
      val agentContext = WorkspaceContextAgentSection(
        preferences = AgentPreferencesResponse(Some(Vector("#abcabc")), None, None, JsObject.empty, memoryEnabled = true),
        memory      = Vector(memoryEntry("m1", "fact", "user loves Netflix dashboards"))
      )
      val message = DashboardAuthoringPrompt.userMessage(
        goal         = "Build a sales dashboard",
        dataTypes    = Vector.empty,
        capabilities = Map.empty,
        agentContext = agentContext
      )
      message should include("User preferences:")
      message should include("user loves Netflix dashboards")
      // The agentContext section comes after the grounding section and before the goal.
      val groundingIdx = message.indexOf("Available pipeline-output data types:")
      val agentIdx     = message.indexOf("User preferences:")
      val goalIdx      = message.indexOf("User goal:")
      groundingIdx should be < agentIdx
      agentIdx should be < goalIdx
    }
  }
}
