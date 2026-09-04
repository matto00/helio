package com.helio.services.pipelines

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-913 task 7.3c-i: unit-level proof of `PipelineService`'s R14 request-address format
 *  helpers. No route or resolver in THIS change actually emits the joined `roots[<i>] ›
 *  steps[<i>]` form -- every one of 7.3a/7.3a-i's own failure cases fails BEFORE a valid root
 *  index exists to pair with the step/Output index (see `resolveStepRootIndex`/
 *  `resolveOutputRootIndex`'s doc). Without this test, that joined form would be "defined and
 *  never executed" -- a format HEL-914 inherits with zero evidence it actually produces the
 *  right string. This proves the format directly, converting "defined but unproven" into
 *  "proven at the unit level, unreachable at the route level" -- a claim HEL-914 can rely on. */
class PipelineServiceAddressFormatSpec extends AnyWordSpec with Matchers {

  "PipelineService.rootAddress/stepAddress/outputAddress" should {
    "format a single-array index address" in {
      PipelineService.rootAddress(0) shouldBe "roots[0]"
      PipelineService.rootAddress(3) shouldBe "roots[3]"
      PipelineService.stepAddress(0) shouldBe "steps[0]"
      PipelineService.stepAddress(7) shouldBe "steps[7]"
      PipelineService.outputAddress(0) shouldBe "outputs[0]"
      PipelineService.outputAddress(2) shouldBe "outputs[2]"
    }
  }

  "PipelineService.joinAddress" should {
    // HEL-913 task 7.3c-i: the joined roots[<i>] › steps[<i>] form R5/R14 name explicitly --
    // never reached by any resolver in this change, proven correct here so HEL-914 inherits a
    // tested format, not an assumed one.
    "join a root address and a step address with the U+203A separator" in {
      PipelineService.joinAddress(PipelineService.rootAddress(1), PipelineService.stepAddress(3)) shouldBe "roots[1] › steps[3]"
    }

    "join a root address and an output address with the U+203A separator" in {
      PipelineService.joinAddress(PipelineService.rootAddress(0), PipelineService.outputAddress(2)) shouldBe "roots[0] › outputs[2]"
    }

    "return a single segment unchanged when only one part is given" in {
      PipelineService.joinAddress(PipelineService.stepAddress(4)) shouldBe "steps[4]"
    }

    "join three segments in order" in {
      PipelineService.joinAddress(PipelineService.rootAddress(1), PipelineService.stepAddress(2), PipelineService.outputAddress(0)) shouldBe
        "roots[1] › steps[2] › outputs[0]"
    }
  }
}
