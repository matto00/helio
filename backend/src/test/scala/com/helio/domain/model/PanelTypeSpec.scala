package com.helio.domain.model

import com.helio.domain.model.PanelType
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-904 task 3.6: trimmed to the collapsed 5-value set
 *  (output|text|markdown|image|divider) -- Metric/Chart/Table/Collection/
 *  Timeline no longer exist as `PanelType` values. */
class PanelTypeSpec extends AnyWordSpec with Matchers {

  "PanelType.fromString" should {
    "parse \"markdown\" as Markdown" in {
      PanelType.fromString("markdown") shouldBe Right(PanelType.Markdown)
    }

    "parse all existing types without regression" in {
      PanelType.fromString("text")   shouldBe Right(PanelType.Text)
      PanelType.fromString("output") shouldBe Right(PanelType.Output)
    }

    "parse \"image\" as Image" in {
      PanelType.fromString("image") shouldBe Right(PanelType.Image)
    }

    "return Left for unknown types" in {
      PanelType.fromString("unknown").isLeft shouldBe true
    }

    "parse divider as Divider" in {
      PanelType.fromString("divider") shouldBe Right(PanelType.Divider)
    }

    "parse \"output\" as Output" in {
      PanelType.fromString("output") shouldBe Right(PanelType.Output)
    }
  }

  "PanelType.asString" should {
    "serialise Markdown as \"markdown\"" in {
      PanelType.asString(PanelType.Markdown) shouldBe "markdown"
    }

    "serialise Image as \"image\"" in {
      PanelType.asString(PanelType.Image) shouldBe "image"
    }

    "serialise Divider as divider" in {
      PanelType.asString(PanelType.Divider) shouldBe "divider"
    }

    "serialise Output as \"output\"" in {
      PanelType.asString(PanelType.Output) shouldBe "output"
    }

    "round-trip all types" in {
      val all = Seq(PanelType.Text, PanelType.Markdown, PanelType.Image, PanelType.Divider, PanelType.Output)
      all.foreach { t =>
        PanelType.fromString(PanelType.asString(t)) shouldBe Right(t)
      }
    }
  }
}
