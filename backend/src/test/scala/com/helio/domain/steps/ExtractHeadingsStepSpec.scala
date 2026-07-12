package com.helio.domain.steps

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** Standalone unit-test spec for the `extractheadings` op's extraction logic
 *  (HEL-220 — second per-step spec file, mirrors `SplitTextStepSpec`'s
 *  standalone structure; see design.md decision 10). Full-engine round-trip
 *  coverage lives alongside the other kinds in `InProcessPipelineEngineSpec`. */
class ExtractHeadingsStepSpec extends AnyWordSpec with Matchers {

  "ExtractHeadingsStep.extractHeadings" should {
    "extract headings of mixed levels in document order" in {
      val content = "# Title\ntext\n## Section\nmore text\n### Sub"
      ExtractHeadingsStep.extractHeadings(content) shouldBe Seq(
        ("Title", 1),
        ("Section", 2),
        ("Sub", 3)
      )
    }

    "normalize \\r\\n to \\n before matching" in {
      val content = "# Title\r\ntext\r\n## Section"
      ExtractHeadingsStep.extractHeadings(content) shouldBe Seq(("Title", 1), ("Section", 2))
    }

    "trim the heading title text" in {
      ExtractHeadingsStep.extractHeadings("##   Padded Title   ") shouldBe Seq(("Padded Title", 2))
    }

    "no heading lines yields zero pairs" in {
      ExtractHeadingsStep.extractHeadings("just plain text\nno headings here") shouldBe empty
    }
  }

  "ExtractHeadingsStep.apply (row-level flatMap semantics)" should {
    "emits one row per heading with passthrough fields" in {
      val rows = Seq(
        Map[String, Any]("content" -> "# Title\ntext\n## Section\nmore text", "filename" -> "doc.md")
      )
      val cfg = ExtractHeadingsConfig(field = "content")
      val result = ExtractHeadingsStep.apply(rows, cfg)
      result shouldBe Seq(
        Map("content" -> "Title", "filename" -> "doc.md", "headingIndex" -> 0, "headingLevel" -> 1),
        Map("content" -> "Section", "filename" -> "doc.md", "headingIndex" -> 1, "headingLevel" -> 2)
      )
    }

    "drops the row when the field value is null" in {
      val rows = Seq(Map[String, Any]("content" -> null, "filename" -> "doc.md"))
      val cfg  = ExtractHeadingsConfig(field = "content")
      ExtractHeadingsStep.apply(rows, cfg) shouldBe empty
    }

    "drops the row when the field is absent entirely" in {
      val rows = Seq(Map[String, Any]("filename" -> "doc.md"))
      val cfg  = ExtractHeadingsConfig(field = "content")
      ExtractHeadingsStep.apply(rows, cfg) shouldBe empty
    }

    "drops the row when the content has no headings" in {
      val rows = Seq(Map[String, Any]("content" -> "no headings here"))
      val cfg  = ExtractHeadingsConfig(field = "content")
      ExtractHeadingsStep.apply(rows, cfg) shouldBe empty
    }

    "uses custom indexField and levelField names" in {
      val rows = Seq(Map[String, Any]("content" -> "## A\n### B"))
      val cfg  = ExtractHeadingsConfig(field = "content", indexField = "idx", levelField = "lvl")
      val result = ExtractHeadingsStep.apply(rows, cfg)
      result shouldBe Seq(
        Map("content" -> "A", "idx" -> 0, "lvl" -> 2),
        Map("content" -> "B", "idx" -> 1, "lvl" -> 3)
      )
    }

    "indexField/levelField collision with existing passthrough fields: metadata wins (last write wins)" in {
      val rows = Seq(
        Map[String, Any]("content" -> "# A", "headingIndex" -> "preexisting", "headingLevel" -> "preexisting")
      )
      val cfg = ExtractHeadingsConfig(field = "content")
      val result = ExtractHeadingsStep.apply(rows, cfg)
      result(0)("headingIndex") shouldBe 0
      result(0)("headingLevel") shouldBe 1
    }
  }
}
