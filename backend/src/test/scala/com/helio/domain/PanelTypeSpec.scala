package com.helio.domain

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

class PanelTypeSpec extends AnyWordSpec with Matchers {

  "PanelType.fromString" should {
    "parse \"markdown\" as Markdown" in {
      PanelType.fromString("markdown") shouldBe Right(PanelType.Markdown)
    }

    "parse all existing types without regression" in {
      PanelType.fromString("metric")   shouldBe Right(PanelType.Metric)
      PanelType.fromString("chart")    shouldBe Right(PanelType.Chart)
      PanelType.fromString("text")     shouldBe Right(PanelType.Text)
      PanelType.fromString("table")    shouldBe Right(PanelType.Table)
    }

    "parse \"image\" as Image" in {
      PanelType.fromString("image") shouldBe Right(PanelType.Image)
    }

    "return Left for unknown types" in {
      PanelType.fromString("unknown").isLeft shouldBe true
    }
  }

  "PanelType.asString" should {
    "serialise Markdown as \"markdown\"" in {
      PanelType.asString(PanelType.Markdown) shouldBe "markdown"
    }

    "serialise Image as \"image\"" in {
      PanelType.asString(PanelType.Image) shouldBe "image"
    }

    "round-trip all types" in {
      val all = Seq(PanelType.Metric, PanelType.Chart, PanelType.Text, PanelType.Table, PanelType.Markdown, PanelType.Image)
      all.foreach { t =>
        PanelType.fromString(PanelType.asString(t)) shouldBe Right(t)
      }
    }
  }
}
