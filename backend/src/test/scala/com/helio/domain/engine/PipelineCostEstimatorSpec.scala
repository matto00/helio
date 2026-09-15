package com.helio.domain.engine

import com.helio.domain.engine.PipelineCostEstimator._
import com.helio.domain.model.PipelineStep
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-1092 design.md D8: the ticket's failable AC probe. `estimate` is pure, so every case is
 *  built by hand-constructed `CostInput`s -- no DB, no `PipelineStepConfigCodec`/`Registry`
 *  decode path involved (see `files-modified.md` for why the route-level probe, task 4.4, is a
 *  narrower surface than this one). */
class PipelineCostEstimatorSpec extends AnyWordSpec with Matchers {

  private val cheapRoot = RootCost(rootId = "root-1", kind = Some("dataset"), hasSourceUrl = false, datasetRowCount = Some(5L))

  "estimate" should {

    "deny with ai-step when an enabled step uses analyzewithai over a small dataset root" in {
      val input = CostInput(
        steps    = Vector(StepInput("s1", "filter"), StepInput("s2", "analyzewithai")),
        roots    = Vector(cheapRoot),
        lastRunRowCount = None
      )
      val verdict = estimate(input)
      verdict.autoRunnable shouldBe false
      verdict.reasons.map(_.code) should contain("ai-step")
      verdict.reasons.find(_.code == "ai-step").flatMap(_.stepId) shouldBe Some("s2")
    }

    "allow the same pipeline minus the AI step" in {
      val input = CostInput(
        steps = Vector(StepInput("s1", "filter")),
        roots = Vector(cheapRoot),
        lastRunRowCount = None
      )
      val verdict = estimate(input)
      verdict.autoRunnable shouldBe true
      verdict.reasons shouldBe empty
    }

    "deny with generatetext as ai-step too" in {
      val input = CostInput(Vector(StepInput("s1", "generatetext")), Vector(cheapRoot), None)
      estimate(input).reasons.map(_.code) should contain("ai-step")
    }

    "deny with unclassified-op for an op outside the cheap allowlist and not a named deny op" in {
      val input = CostInput(Vector(StepInput("s1", "convertformat")), Vector(cheapRoot), None)
      val verdict = estimate(input)
      verdict.autoRunnable shouldBe false
      verdict.reasons.map(_.code) should contain("unclassified-op")
    }

    "deny with writeback-step for upsertsource" in {
      val input = CostInput(Vector(StepInput("s1", "upsertsource")), Vector(cheapRoot), None)
      estimate(input).reasons.map(_.code) should contain("writeback-step")
    }

    "deny with remote-fetch for a rest_api root" in {
      val root = RootCost("root-1", Some("rest_api"), hasSourceUrl = false, None)
      val input = CostInput(Vector(StepInput("s1", "filter")), Vector(root), Some(5L))
      estimate(input).reasons.map(_.code) should contain("remote-fetch")
    }

    "deny with remote-fetch for a sql root" in {
      val root = RootCost("root-1", Some("sql"), hasSourceUrl = false, None)
      val input = CostInput(Vector(StepInput("s1", "filter")), Vector(root), Some(5L))
      estimate(input).reasons.map(_.code) should contain("remote-fetch")
    }

    "deny with remote-fetch for a URL-backed csv root" in {
      val root = RootCost("root-1", Some("csv"), hasSourceUrl = true, None)
      val input = CostInput(Vector(StepInput("s1", "filter")), Vector(root), Some(5L))
      estimate(input).reasons.map(_.code) should contain("remote-fetch")
    }

    "deny with unclassified-source for an unresolved root" in {
      val root = RootCost("root-1", kind = None, hasSourceUrl = false, datasetRowCount = None)
      val input = CostInput(Vector(StepInput("s1", "filter")), Vector(root), Some(5L))
      estimate(input).reasons.map(_.code) should contain("unclassified-source")
    }

    "deny with no-roots when the pipeline has zero roots" in {
      val input = CostInput(Vector(StepInput("s1", "filter")), Vector.empty, Some(5L))
      estimate(input).reasons.map(_.code) should contain("no-roots")
    }

    "deny with row-estimate-unavailable when no lastRunRowCount and a root's dataset count is unknown" in {
      val root = RootCost("root-1", Some("dataset"), hasSourceUrl = false, datasetRowCount = None)
      val input = CostInput(Vector(StepInput("s1", "filter")), Vector(root), None)
      estimate(input).reasons.map(_.code) should contain("row-estimate-unavailable")
    }

    "deny with rows-above-threshold when the estimate exceeds MaxAutoRunRows" in {
      val input = CostInput(Vector(StepInput("s1", "filter")), Vector(cheapRoot), Some(MaxAutoRunRows + 1))
      val verdict = estimate(input)
      verdict.estimatedRows shouldBe Some(MaxAutoRunRows + 1)
      verdict.reasons.map(_.code) should contain("rows-above-threshold")
    }

    "deny with steps-above-bound when enabled step count exceeds MaxAutoRunSteps" in {
      val steps = (1 to MaxAutoRunSteps + 1).map(i => StepInput(s"s$i", "filter")).toVector
      val input = CostInput(steps, Vector(cheapRoot), Some(5L))
      val verdict = estimate(input)
      verdict.stepCount shouldBe MaxAutoRunSteps + 1
      verdict.reasons.map(_.code) should contain("steps-above-bound")
    }

    "sum dataset row counts across multiple roots when every root is a dataset with a known count" in {
      val r1 = RootCost("root-1", Some("dataset"), hasSourceUrl = false, datasetRowCount = Some(3L))
      val r2 = RootCost("root-2", Some("dataset"), hasSourceUrl = false, datasetRowCount = Some(4L))
      val input = CostInput(Vector(StepInput("s1", "union")), Vector(r1, r2), None)
      estimate(input).estimatedRows shouldBe Some(7L)
    }

    "collect multiple reasons rather than stopping at the first" in {
      val badRoot = RootCost("root-1", kind = None, hasSourceUrl = false, datasetRowCount = None)
      val input = CostInput(Vector(StepInput("s1", "analyzewithai")), Vector(badRoot), None)
      val verdict = estimate(input)
      verdict.reasons.map(_.code) should contain allOf ("ai-step", "unclassified-source", "row-estimate-unavailable")
    }
  }

  // skeptic-final-1.md CR2: `CheapOps shouldBe (Registry.keySet - "upsertsource")` is tautological
  // against a derived production formula -- it asserts the RHS equals itself and cannot fail for
  // any future `Registry` addition. `CheapOps` is now a hand-maintained literal (CR1); these tests
  // are the real tripwire: (a) a completeness/partition check that fails the moment a `Registry`
  // op is added without a matching entry in `CheapOps`/`AiOps`/`WriteBackOps` (C4's mandated
  // mutation target -- see mutation-evidence.md M3), and (b) a regression proving `estimate`
  // itself denies with `unclassified-op` for an op that is registered-shaped but absent from all
  // three sets, i.e. exactly the failure mode a silent-absorption bug would produce.
  "op coverage (skeptic-final-1.md CR2 / tasks.md C4)" should {

    "partition every registered op into exactly one of CheapOps, AiOps, WriteBackOps" in {
      val classified = CheapOps ++ AiOps ++ WriteBackOps
      val registered = PipelineStep.Registry.keySet

      // Every registered op is classified somewhere...
      (registered -- classified) shouldBe empty
      // ...and CheapOps/WriteBackOps are pure subsets of Registry (AiOps is deliberately allowed
      // to name ops that are NOT registered -- analyzewithai/generatetext, tasks.md C3 -- so it is
      // excluded from this direction of the check).
      (CheapOps -- registered) shouldBe empty
      (WriteBackOps -- registered) shouldBe empty
      // No op double-counted across the three sets.
      (CheapOps intersect AiOps) shouldBe empty
      (CheapOps intersect WriteBackOps) shouldBe empty
      (AiOps intersect WriteBackOps) shouldBe empty
    }

    "deny with unclassified-op an op that is registered-shaped but present in none of the three named sets" in {
      // Simulates the exact future-registration failure mode this ticket guards against: a new
      // op reaches the estimator (as it would the moment someone adds it to `Registry` without
      // updating `CheapOps`) and must still be denied, never silently allowed.
      val simulatedFutureOp = "convertformat"
      (CheapOps ++ AiOps ++ WriteBackOps) should not contain simulatedFutureOp

      val input = CostInput(Vector(StepInput("s1", simulatedFutureOp)), Vector(cheapRoot), None)
      val verdict = estimate(input)
      verdict.autoRunnable shouldBe false
      verdict.reasons.map(_.code) should contain("unclassified-op")
    }
  }
}
