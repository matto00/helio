package com.helio.domain.steps

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-1436: checks every supported target has an explicit runtime case (the parity spec iterates the constant itself). */
class CastSupportedTargetsSpec extends AnyWordSpec with Matchers {
  "CastStep.SupportedTargets" should {
    "have an explicit runtime case: no supported target is the legacy passthrough" in {
      // A Double only survives the passthrough; every supported target must transform it.
      for (t <- CastStep.SupportedTargets.filterNot(Set("double", "float", "number", "integer", "long").contains))
        CastStep.apply(Seq(Map("v" -> (2.5: Any))), CastConfig(Map("v" -> t))).head("v") should not be (2.5: Any)
    }
  }
}
