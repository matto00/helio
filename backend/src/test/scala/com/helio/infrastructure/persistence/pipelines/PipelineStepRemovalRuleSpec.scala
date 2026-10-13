package com.helio.infrastructure.persistence.pipelines

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-1522: the one rule for what deleting a step removes, shared by `deleteInternal`, the patch-set preview
 *  removals and the patch-set fingerprint. */
class PipelineStepRemovalRuleSpec extends AnyWordSpec with Matchers {

  // (id, parentStepId, position)
  private val rows = Seq(
    ("root", None, 0), ("a", Some("root"), 0), ("b", Some("root"), 1), ("b1", Some("b"), 0), ("b2", Some("b1"), 0), ("c", Some("root"), 2)
  )

  "PipelineStepRepository.removalOf" should {
    "promote the lowest-position child and remove the other children's whole subtrees with the step" in {
      val removal = PipelineStepRepository.removalOf("root", rows)
      removal.headChild shouldBe Some("a")
      removal.tailRoots shouldBe Vector("b", "c")
      removal.removed shouldBe Set("root", "b", "b1", "b2", "c")
    }

    "break a position tie by id, whatever order the rows arrive in" in {
      val tied = Seq(("root", None, 0), ("z", Some("root"), 0), ("m", Some("root"), 0), ("m1", Some("m"), 0))
      Seq(tied, tied.reverse, tied.sortBy(_._1)).foreach { ordering =>
        val removal = PipelineStepRepository.removalOf("root", ordering)
        removal.headChild shouldBe Some("m")
        removal.removed shouldBe Set("root", "z")
      }
    }

    "remove only the step itself when it has at most one child, and nothing for a leaf's absence of children" in {
      PipelineStepRepository.removalOf("a", rows).removed shouldBe Set("a")
      PipelineStepRepository.removalOf("b2", rows).removed shouldBe Set("b2")
      PipelineStepRepository.removalOf("b1", rows).headChild shouldBe Some("b2")
    }
  }
}
