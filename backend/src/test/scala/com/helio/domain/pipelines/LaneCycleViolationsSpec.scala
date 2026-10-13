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

  "LaneCycleViolations.dependentsOf / descendantsOf" should {
    "include the seeds, children and steps that lane to a member, transitively across two lane hops" in {
      // a -> d (child); x lanes to d; y lanes to x
      val steps = Vector(rename("a", None), rename("d", Some("a")), lanejoin("x", None, "d"), lanejoin("y", None, "x"), rename("z", None))
      LaneCycleViolations.dependentsOf(Set("a"), steps) shouldBe Set("a", "d", "x", "y")
      LaneCycleViolations.descendantsOf(Set("a"), steps) shouldBe Set("a", "d")
    }
    "handle a diamond (two paths to the same dependent)" in {
      val steps = Vector(rename("a", None), rename("b", Some("a")), lanejoin("m", Some("b"), "a"), rename("end", Some("m")))
      LaneCycleViolations.dependentsOf(Set("a"), steps) shouldBe Set("a", "b", "m", "end")
    }
    "terminate on a legacy cyclic graph" in {
      val steps = Vector(lanejoin("p", None, "q"), lanejoin("q", None, "p"))
      LaneCycleViolations.dependentsOf(Set("p"), steps) shouldBe Set("p", "q")
      LaneCycleViolations.ancestorsFrom(Some(PipelineStepId("p")), Vector(rename("p", Some("q")), rename("q", Some("p")))) shouldBe Set("p", "q")
    }
    "never follow a seed's own outgoing lane edge" in {
      val steps = Vector(rename("t", None), lanejoin("a", None, "t"))
      LaneCycleViolations.dependentsOf(Set("a"), steps) shouldBe Set("a")
    }
  }

  "LaneCycleViolations.relationOf" should {
    import LaneCycleViolations._
    "apply Itself > Ancestor > Descendant > DependentViaLane" in {
      relationOf("t", Some("t"), Set("t"), Set("t"), Set("t")) shouldBe Some(Itself)
      relationOf("t", Some("s"), Set("t"), Set("t"), Set("t")) shouldBe Some(Ancestor)
      relationOf("t", Some("s"), Set.empty, Set("t"), Set("t")) shouldBe Some(Descendant)
      relationOf("t", Some("s"), Set.empty, Set.empty, Set("t")) shouldBe Some(DependentViaLane)
      relationOf("t", Some("s"), Set.empty, Set.empty, Set.empty) shouldBe None
    }
  }

  "LaneCycleViolations.of (lane-transitive)" should {
    "flag a lane to a step that depends on the referrer through a lane link, not as a descendant" in {
      // a lanes to x; x lanes to d, a child of a
      val steps = Vector(lanejoin("a", None, "x"), rename("d", Some("a")), lanejoin("x", None, "d"))
      LaneCycleViolations.of(steps).map(v => v.stepId -> v.relation) should contain ("a" -> LaneCycleViolations.DependentViaLane)
    }
    "report a parent-chain descendant as Descendant even though it is also a dependent" in {
      LaneCycleViolations.of(Vector(lanejoin("a", None, "d"), rename("d", Some("a")))).map(_.relation) shouldBe Vector(LaneCycleViolations.Descendant)
    }
    "be empty for a lane to a node upstream only through another step's lane link" in {
      val steps = Vector(rename("z", None), lanejoin("y", None, "z"), lanejoin("a", None, "y"))
      LaneCycleViolations.of(steps) shouldBe empty
    }
  }
}
