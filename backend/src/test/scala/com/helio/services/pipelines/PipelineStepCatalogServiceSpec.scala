package com.helio.services.pipelines

import com.helio.domain.model.{PipelineStep, StepGroup}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-1136 task 2.1 — `PipelineStepCatalogService.catalog()`'s projection of
 *  `PipelineStep.Registry` into ordered groups plus one entry per kind. */
class PipelineStepCatalogServiceSpec extends AnyWordSpec with Matchers {

  private val service = new PipelineStepCatalogService()

  "PipelineStepCatalogService.catalog" should {

    "produce exactly one entry per Registry kind, with no duplicates and no unregistered kind" in {
      val catalog = service.catalog()
      catalog.steps.map(_.kind).toSet shouldBe PipelineStep.Registry.keySet
      catalog.steps.map(_.kind).distinct.size shouldBe catalog.steps.size
    }

    "convey groups in StepGroup.All's declared order" in {
      service.catalog().groups shouldBe StepGroup.All
    }

    "carry group = None for the ungrouped assert kind" in {
      val entry = service.catalog().steps.find(_.kind == "assert").getOrElse(fail("assert missing"))
      entry.group shouldBe None
    }

    "carry a declared group for a grouped kind" in {
      val entry = service.catalog().steps.find(_.kind == "select").getOrElse(fail("select missing"))
      entry.group shouldBe Some(StepGroup.FilterShape)
    }

    "carry authorable = false for join and groupby, and true for every other kind" in {
      val catalog = service.catalog()
      catalog.steps.filter(!_.authorable).map(_.kind).toSet shouldBe Set("join", "groupby")
    }

    "carry every entry's companion-declared description" in {
      val entry = service.catalog().steps.find(_.kind == "select").getOrElse(fail("select missing"))
      entry.description shouldBe "Keep only the selected columns, dropping the rest."
    }
  }

  "PipelineStepCatalogService.labelFor" should {
    "fall back to a capitalized kind for an unmapped kind (a newly registered kind still labels)" in {
      PipelineStepCatalogService.labelFor("somenewkind") shouldBe "Somenewkind"
    }
  }
}
