package com.helio.services

import com.helio.services.proposals.DashboardAuthoringParsing
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** Unit coverage for `DashboardAuthoringParsing`'s defensive brace-matched extraction (HEL-392
 *  design.md D4) — the seam `DashboardAuthoringServiceSpec`'s canned responses exercise
 *  end-to-end, isolated here so the brace/string-depth edge cases (prose wrapping, nested
 *  objects, literal braces inside a quoted string, truncated/unterminated output) are pinned
 *  down directly against the pure function. */
class DashboardAuthoringParsingSpec extends AnyWordSpec with Matchers {

  "DashboardAuthoringParsing.extractJsonObject" should {

    "extract a bare JSON object unchanged" in {
      val text = """{"dashboardName":"Sales","panels":[]}"""
      DashboardAuthoringParsing.extractJsonObject(text) shouldBe Some(text)
    }

    "extract the JSON object out of surrounding prose (despite the prompt's own instruction not to add any)" in {
      val json = """{"dashboardName":"Sales","panels":[]}"""
      val text = s"Sure, here is the dashboard proposal:\n\n$json\n\nLet me know if you'd like changes!"
      DashboardAuthoringParsing.extractJsonObject(text) shouldBe Some(json)
    }

    "match nested braces correctly, not stop at the first inner close" in {
      val json = """{"dashboardName":"Sales","panels":[{"title":"X","fieldMapping":{"value":"revenue"}}]}"""
      DashboardAuthoringParsing.extractJsonObject(json) shouldBe Some(json)
    }

    "ignore a literal '}' character inside a quoted string value" in {
      val json = """{"dashboardName":"Q3 Report {special}","panels":[]}"""
      DashboardAuthoringParsing.extractJsonObject(json) shouldBe Some(json)
    }

    "ignore an escaped quote inside a string when tracking string boundaries" in {
      val json = """{"dashboardName":"Say \"hi\" {ok}","panels":[]}"""
      DashboardAuthoringParsing.extractJsonObject(json) shouldBe Some(json)
    }

    "return None when the text contains no '{' at all" in {
      DashboardAuthoringParsing.extractJsonObject("I cannot build a proposal from this workspace.") shouldBe None
    }

    "return None for a truncated/unterminated object (no matching close)" in {
      DashboardAuthoringParsing.extractJsonObject("""{"dashboardName":"Sales","panels":[""") shouldBe None
    }
  }

  "DashboardAuthoringParsing.parseProposal" should {

    "parse a valid DashboardProposal" in {
      val text = """{"dashboardName":"Sales","panels":[]}"""
      val result = DashboardAuthoringParsing.parseProposal(text)
      result.isRight shouldBe true
      result.map(_.dashboardName) shouldBe Right("Sales")
    }

    "return a Left with a human-readable message when no JSON object is present" in {
      DashboardAuthoringParsing.parseProposal("no json here") shouldBe a[Left[_, _]]
    }

    "return a Left with a human-readable message for JSON that doesn't match the DashboardProposal shape" in {
      val result = DashboardAuthoringParsing.parseProposal("""{"unrelated":"shape"}""")
      result shouldBe a[Left[_, _]]
    }
  }
}
