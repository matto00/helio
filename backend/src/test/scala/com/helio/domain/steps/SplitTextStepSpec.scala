package com.helio.domain.steps

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** Standalone unit-test spec for the `splittext` op's split logic (HEL-219 —
 *  first per-step spec file; see design.md decision 10). No `CastStepSpec`/
 *  `GroupByStepSpec` precedent exists — those kinds' behavior is only
 *  exercised inside `InProcessPipelineEngineSpec`'s `makeStep` fixtures. This
 *  spec is intentionally standalone (not engine-wired) so the split
 *  functions and row-shaping logic can be tested in isolation; full-engine
 *  round-trip coverage lives alongside the other 10 kinds in
 *  `InProcessPipelineEngineSpec`. */
class SplitTextStepSpec extends AnyWordSpec with Matchers {

  "SplitTextStep.splitParagraphs" should {
    "split on one-or-more blank lines, trimming each segment" in {
      val content = "Para one.\n\nPara two.\n\nPara three."
      SplitTextStep.splitParagraphs(content) shouldBe Seq("Para one.", "Para two.", "Para three.")
    }

    "collapse multiple consecutive blank lines into a single break" in {
      val content = "A.\n\n\n\nB."
      SplitTextStep.splitParagraphs(content) shouldBe Seq("A.", "B.")
    }

    "normalize \\r\\n to \\n before splitting" in {
      val content = "A.\r\n\r\nB."
      SplitTextStep.splitParagraphs(content) shouldBe Seq("A.", "B.")
    }

    "drop empty segments and trim whitespace" in {
      val content = "  A.  \n\n   \n\n  B.  "
      SplitTextStep.splitParagraphs(content) shouldBe Seq("A.", "B.")
    }

    "single paragraph with no blank line yields one segment" in {
      SplitTextStep.splitParagraphs("just one paragraph") shouldBe Seq("just one paragraph")
    }
  }

  "SplitTextStep.splitHeadings" should {
    "split at each level-2 ATX heading line" in {
      val content = "## Intro\ntext a\n## Body\ntext b"
      val result  = SplitTextStep.splitHeadings(content, headingLevel = 2)
      result should have size 2
      result(0) shouldBe "## Intro\ntext a"
      result(1) shouldBe "## Body\ntext b"
    }

    "drops preamble content before the first matching heading" in {
      val content = "some preamble\n## Section\nbody"
      val result  = SplitTextStep.splitHeadings(content, headingLevel = 2)
      result shouldBe Seq("## Section\nbody")
    }

    "does not match a heading of a different level" in {
      val content = "### Deep\nbody\n## Shallow\nbody2"
      val result  = SplitTextStep.splitHeadings(content, headingLevel = 2)
      result shouldBe Seq("## Shallow\nbody2")
    }

    "no matching heading of the target level yields zero segments" in {
      val content = "# Level one only\nbody"
      SplitTextStep.splitHeadings(content, headingLevel = 2) shouldBe empty
    }

    "level-1 heading split does not match level-2 heading lines" in {
      val content = "# Title\nintro\n## Sub\nbody"
      val result  = SplitTextStep.splitHeadings(content, headingLevel = 1)
      result shouldBe Seq("# Title\nintro\n## Sub\nbody")
    }
  }

  "SplitTextStep.apply (row-level flatMap semantics)" should {
    "emits one row per paragraph segment with a 0-based segmentIndex" in {
      val rows = Seq(Map[String, Any]("content" -> "Para one.\n\nPara two."))
      val cfg  = SplitTextConfig(field = "content", mode = "paragraph")
      val result = SplitTextStep.apply(rows, cfg)
      result shouldBe Seq(
        Map("content" -> "Para one.", "segmentIndex" -> 0),
        Map("content" -> "Para two.", "segmentIndex" -> 1)
      )
    }

    "passes through other row fields unchanged" in {
      val rows = Seq(Map[String, Any]("content" -> "A.\n\nB.", "filename" -> "doc.md"))
      val cfg  = SplitTextConfig(field = "content", mode = "paragraph")
      val result = SplitTextStep.apply(rows, cfg)
      result should have size 2
      result.foreach(_("filename") shouldBe "doc.md")
    }

    "drops the row when the field value is null" in {
      val rows = Seq(Map[String, Any]("content" -> null, "filename" -> "doc.md"))
      val cfg  = SplitTextConfig(field = "content", mode = "paragraph")
      SplitTextStep.apply(rows, cfg) shouldBe empty
    }

    "drops the row when the field is absent entirely" in {
      val rows = Seq(Map[String, Any]("filename" -> "doc.md"))
      val cfg  = SplitTextConfig(field = "content", mode = "paragraph")
      SplitTextStep.apply(rows, cfg) shouldBe empty
    }

    "drops the row when heading mode finds no matching heading" in {
      val rows = Seq(Map[String, Any]("content" -> "no headings here"))
      val cfg  = SplitTextConfig(field = "content", mode = "heading", headingLevel = 2)
      SplitTextStep.apply(rows, cfg) shouldBe empty
    }

    "heading mode emits one row per matched section with custom indexField" in {
      val rows = Seq(Map[String, Any]("content" -> "## A\nx\n## B\ny"))
      val cfg  = SplitTextConfig(field = "content", mode = "heading", headingLevel = 2, indexField = "idx")
      val result = SplitTextStep.apply(rows, cfg)
      result shouldBe Seq(
        Map("content" -> "## A\nx", "idx" -> 0),
        Map("content" -> "## B\ny", "idx" -> 1)
      )
    }

    "indexField collision with an existing passthrough field: numeric index wins (last write wins)" in {
      val rows = Seq(Map[String, Any]("content" -> "A.\n\nB.", "segmentIndex" -> "preexisting"))
      val cfg  = SplitTextConfig(field = "content", mode = "paragraph", indexField = "segmentIndex")
      val result = SplitTextStep.apply(rows, cfg)
      result(0)("segmentIndex") shouldBe 0
      result(1)("segmentIndex") shouldBe 1
    }
  }
}
