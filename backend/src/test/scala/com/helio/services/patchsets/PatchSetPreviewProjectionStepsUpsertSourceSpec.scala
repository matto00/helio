package com.helio.services.patchsets

import com.helio.domain.model.{PipelineId, PipelineStepId}
import com.helio.domain.steps.{UpsertMode, UpsertSourceConfig, UpsertSourceStep, UpsertTarget}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.time.Instant

/** HEL-1100 skeptic-final-1.md CR2: `PipelineStepProjectionSupport.withPosition`/
 *  `withDecodedConfig` had no `UpsertSourceStep`/`UpsertSourceConfig` arm -- a patch-set preview
 *  touching a persisted `upsertsource` step crashed with a `MatchError` (`withPosition`) or a
 *  spurious `Left` (`withDecodedConfig`), reproducing the same defect class as the analyze crash
 *  (CR1) one file over. */
class PatchSetPreviewProjectionStepsUpsertSourceSpec extends AnyWordSpec with Matchers {

  private val now = Instant.now()
  private val step = UpsertSourceStep(
    PipelineStepId("step-1"), PipelineId("pipe-1"), position = 0,
    config = UpsertSourceConfig(UpsertTarget.ExistingSource("ds-1"), UpsertMode.Append),
    createdAt = now, updatedAt = now
  )

  "PipelineStepProjectionSupport.withPosition" should {
    "not throw a MatchError for an UpsertSourceStep, and update its position" in {
      val moved = PipelineStepProjectionSupport.withPosition(step, 3)
      moved.position shouldBe 3
      moved.asInstanceOf[UpsertSourceStep].config shouldBe step.config
    }
  }

  "PipelineStepProjectionSupport.withDecodedConfig" should {
    "not return a spurious Left for an UpsertSourceStep/UpsertSourceConfig pair" in {
      val newConfig = UpsertSourceConfig(UpsertTarget.ExistingSource("ds-2"), UpsertMode.Replace)
      val result = PipelineStepProjectionSupport.withDecodedConfig(step, newConfig)
      result shouldBe a[Right[_, _]]
      result.getOrElse(fail("expected Right")).asInstanceOf[UpsertSourceStep].config shouldBe newConfig
    }
  }
}
