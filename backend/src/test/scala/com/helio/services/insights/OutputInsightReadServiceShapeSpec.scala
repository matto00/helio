package com.helio.services.insights

import com.helio.infrastructure.persistence.pipelines.{OutputInsightRepository, OutputRepository}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import scala.concurrent.ExecutionContext

/** HEL-1742: "reads never regenerate" is enforced by construction. The service takes exactly the two
 *  DB-backed repositories and the execution context, so no model client, renderer, `OutputService`
 *  (which reaches a live `AiStepClient` through `PipelineRunService`) or anything that holds one can
 *  be added without turning this red. It pins the direct collaborators only: a model client added
 *  inside `OutputRepository` or `OutputInsightRepository` would not be caught here. */
class OutputInsightReadServiceShapeSpec extends AnyWordSpec with Matchers {

  "OutputInsightReadService's constructor" should {
    "take exactly the Output repository, the insight repository and the execution context" in {
      val ctors = classOf[OutputInsightReadService].getConstructors
      ctors should have size 1
      ctors.head.getParameterTypes.toSeq shouldBe Seq[Class[_]](classOf[OutputRepository], classOf[OutputInsightRepository], classOf[ExecutionContext])
    }

    "hold no field beyond those collaborators" in {
      val fieldTypes = classOf[OutputInsightReadService].getDeclaredFields.map(_.getType).toSet
      fieldTypes should contain only (classOf[OutputRepository], classOf[OutputInsightRepository], classOf[ExecutionContext])
    }
  }
}
