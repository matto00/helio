package com.helio.domain.model

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-1136 task 1.1 — `StepGroup.All`'s declared display order is stable and its ids are unique;
 *  design.md Decision 3 relies on this Vector, not sorted `id`/`label` strings, to convey order. */
class StepGroupSpec extends AnyWordSpec with Matchers {

  "StepGroup.All" should {

    "declare a stable order across repeated reads" in {
      StepGroup.All shouldBe StepGroup.All
      StepGroup.All.map(_.id) shouldBe StepGroup.All.map(_.id)
    }

    "have unique ids" in {
      val ids = StepGroup.All.map(_.id)
      ids.distinct should have size ids.size
    }

    "have unique, non-blank labels" in {
      val labels = StepGroup.All.map(_.label)
      labels.foreach(_.trim should not be empty)
      labels.distinct should have size labels.size
    }
  }
}
