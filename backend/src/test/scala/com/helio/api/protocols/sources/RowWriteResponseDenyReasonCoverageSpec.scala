package com.helio.api.protocols.sources

import com.helio.domain.engine.PipelineCostEstimator
import com.helio.domain.model.{DataSourceId, DatasetSource, PipelineId, UserId}
import com.helio.services.pipelines.EvaluatedPipeline
import com.helio.services.sources.RowWriteResult
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.time.Instant

/** HEL-1096 tasks.md 3.1: every `CostReason.code` `PipelineCostEstimator` can produce survives,
 *  byte-for-byte, the whole wire path from `EvaluatedPipeline.Denied` through
 *  `DeniedPipelineResponse.fromDomain` into `RowWriteResponse.deniedPipelines`. A code silently
 *  dropped, renamed, or filtered anywhere along that path would fail this test loudly -- which is
 *  what makes the frontend's deny-copy mapping (design.md D6) provably complete rather than
 *  merely "probably" covering everything the backend can emit.
 *
 *  `AllReasonCodes` is a literal list (NOT derived from the estimator's own internals) --
 *  cross-checked, code-by-code, against `PipelineCostEstimatorSpec`'s own scenario coverage
 *  (every code below has a `should contain("<code>")` assertion there) and against the
 *  `run-to-update-affordance` spec's AC list. Kept literal so an estimator change that silently
 *  ADDS a new reason code without updating this list fails here, loudly, rather than the new code
 *  just working by accident with no test ever having asserted it round-trips. */
class RowWriteResponseDenyReasonCoverageSpec extends AnyWordSpec with Matchers {

  private val AllReasonCodes: Set[String] = Set(
    "ai-step", "writeback-step", "content-conversion", "remote-fetch",
    "unclassified-op", "unclassified-source", "no-roots",
    "row-estimate-unavailable", "rows-above-threshold", "steps-above-bound"
  )

  "DeniedPipelineResponse.fromDomain" should {
    AllReasonCodes.foreach { code =>
      s"preserves reason code '$code' unchanged from EvaluatedPipeline.Denied to the wire" in {
        val reason = PipelineCostEstimator.CostReason(code = code, detail = s"detail for $code", stepId = Some("s1"))
        val denied = EvaluatedPipeline.Denied(PipelineId("p1"), "pipe", Vector(reason), canRun = true)

        val wire = DeniedPipelineResponse.fromDomain(denied)

        wire.reasons.map(_.code) shouldBe Vector(code)
        wire.reasons.map(_.detail) shouldBe Vector(s"detail for $code")
      }
    }

    "carries every code on one denied pipeline without dropping any -- not just one at a time" in {
      val reasons = AllReasonCodes.toVector.map(c => PipelineCostEstimator.CostReason(c, s"detail for $c"))
      val denied  = EvaluatedPipeline.Denied(PipelineId("p1"), "pipe", reasons, canRun = true)

      DeniedPipelineResponse.fromDomain(denied).reasons.map(_.code).toSet shouldBe AllReasonCodes
    }
  }

  "RowWriteResponse.fromDomain (the actual write-response wire type)" should {
    "surfaces every reason code end-to-end from RowWriteResult.deniedPipelines" in {
      val now    = Instant.now()
      val source = DatasetSource(DataSourceId("ds1"), "src", UserId("u1"), now, now)
      val reasons = AllReasonCodes.toVector.map(c => PipelineCostEstimator.CostReason(c, s"detail for $c"))
      val denied  = EvaluatedPipeline.Denied(PipelineId("p1"), "pipe", reasons, canRun = true)
      val result  = RowWriteResult(source, rows = Vector.empty, deniedPipelines = Vector(denied))

      val response = RowWriteResponse.fromDomain(result)

      response.deniedPipelines should have size 1
      response.deniedPipelines.head.reasons.map(_.code).toSet shouldBe AllReasonCodes
    }
  }
}
