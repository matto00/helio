package com.helio.domain.pipelines

import com.helio.api.protocols.pipelines.PipelineStepConfigCodec
import com.helio.domain.model.{PipelineId, PipelineStep, PipelineStepId}
import com.helio.domain.steps.{JoinConfig, JoinStep, RenameConfig, RenameStep}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.time.Instant

class LaneCycleViolationsSpec extends AnyWordSpec with Matchers {

  private val pid = PipelineId("p")
  private val now = Instant.EPOCH

  private def rename(id: String, parent: Option[String]): PipelineStep =
    RenameStep(PipelineStepId(id), pid, 0, PipelineStepConfigCodec.decode("rename", """{"renames":{}}""").get.asInstanceOf[RenameConfig], now, now, parentStepId = parent.map(PipelineStepId(_)))

  private def lanejoin(id: String, parent: Option[String], lane: String): PipelineStep =
    JoinStep(
      PipelineStepId(id), pid, 0,
      PipelineStepConfigCodec.decode("join", s"""{"secondaryInput":{"kind":"lane","stepId":"$lane"},"joinKey":"k","joinType":"inner"}""").get.asInstanceOf[JoinConfig],
      now, now, parentStepId = parent.map(PipelineStepId(_))
    )

  "LaneCycleViolations.of" should {
    "be empty for a pipeline with no lane references" in {
      LaneCycleViolations.of(Vector(rename("a", None), rename("b", Some("a")))) shouldBe empty
    }
    "flag a lane naming the step itself" in {
      LaneCycleViolations.of(Vector(lanejoin("a", None, "a"))).map(_.relation) shouldBe Vector(LaneCycleViolations.Itself)
    }
    "flag a lane naming an ancestor" in {
      LaneCycleViolations.of(Vector(rename("a", None), lanejoin("b", Some("a"), "a"))).map(_.relation) shouldBe Vector(LaneCycleViolations.Ancestor)
    }
    "flag a lane naming a descendant" in {
      LaneCycleViolations.of(Vector(lanejoin("a", None, "c"), rename("b", Some("a")), rename("c", Some("b")))).map(_.relation) shouldBe Vector(LaneCycleViolations.Descendant)
    }
    "check tails too, and accept a lane to an unrelated branch" in {
      val steps = Vector(rename("a", None), rename("b", Some("a")), lanejoin("t", Some("a"), "b"))
      LaneCycleViolations.of(steps) shouldBe empty
      LaneCycleViolations.of(steps.updated(1, rename("b", Some("t")))).map(v => v.stepId -> v.relation) shouldBe Vector("t" -> LaneCycleViolations.Descendant)
    }
    "not hang on a corrupt parent loop" in {
      LaneCycleViolations.of(Vector(lanejoin("a", Some("b"), "x"), rename("b", Some("a")))) shouldBe empty
    }
  }

  "LaneCycleViolations.introduced" should {
    "report only violations absent before" in {
      val before = Vector(rename("a", None), lanejoin("b", Some("a"), "a"))
      LaneCycleViolations.introduced(before, before) shouldBe empty
      val after = before :+ lanejoin("c", Some("a"), "a")
      LaneCycleViolations.introduced(before, after).map(_.stepId) shouldBe Vector("c")
    }
  }
}
