package com.helio.services.patchsets

import com.helio.domain.steps.AggregateStep
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-1310 design Decision 8: the agent-facing docs enumerate aggregate functions from
 *  [[AggregateStep.SupportedFunctions]], so a function added there cannot be missing from them. */
class AggregateFnDocDriftSpec extends AnyWordSpec with Matchers {

  "RefinementPrompt.Instructions" should {
    "list every supported aggregate function and mention p" in {
      val fns = AggregateStep.SupportedFunctions.mkString("|")
      RefinementPrompt.Instructions should include(fns)
      RefinementPrompt.Instructions should include("percentile needs p")
    }
  }

  "RefinementEditShape.Description" should {
    "list every supported aggregate function and mention p" in {
      val fns = AggregateStep.SupportedFunctions.mkString("|")
      RefinementEditShape.Description should include(fns)
      RefinementEditShape.Description should include("percentile needs p")
    }
  }
}
