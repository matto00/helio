package com.helio.services.pipelines

import com.helio.domain.model.{PipelineId, PipelineStep}
import com.helio.domain.steps.{ComputeConfig, ComputeStep, UnpivotConfig, UnpivotStep}
import com.helio.services.ServiceError
import com.helio.testsupport.RunServiceHarness
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

/** HEL-1660 tasks 3.2 and 3.4 (AC5, AC6): the run limits seen end to end through `PipelineRunService`, over a real CSV and real
 *  snapshot/history repositories. */
class PipelineRunLimitsServiceSpec extends AnyWordSpec with Matchers with RunServiceHarness {

  /** 6 short text columns, the widest CSV the run path accepts is 50,000 x 6 (`CsvLimits`: 300,000 cells). */
  private def csv(rows: Int): String = seedCsvSource(rows, 6, (r, c) => s"${('a' + c).toChar}$r")

  private def compute(pid: PipelineId, n: Int, parent: Option[PipelineStep]): PipelineStep =
    addStep(pid, ComputeStep.Kind, ComputeConfig(s"c$n", "concat($a, $f)", None), parent)

  "an ordinary large pipeline (AC6)" should {
    "succeed under the run budget and write both Outputs' snapshots: 50,000 x 6 CSV, a 10-step compute chain, Outputs on a middle node and the terminal" in {
      val pid   = seedPipeline(csv(50000))
      val chain = (1 to 10).foldLeft(Vector.empty[PipelineStep])((acc, n) => acc :+ compute(pid, n, acc.lastOption))
      addOutput(pid, chain(4), "middle"); addOutput(pid, chain(9), "terminal")

      val result = awaitDb(service.submit(pid, isDry = false, owner))
      result shouldBe a[Right[_, _]]
      result.toOption.get.rowCount shouldBe 50000

      nodeSnapshotRows(pid, chain(4)) shouldBe 50000
      nodeSnapshotRows(pid, chain(9)) shouldBe 50000
      nodeSnapshotCount(pid) shouldBe 100000
    }

    "write the snapshot of an Output on a non-trunk branch too (its frame is retained by name)" in {
      val pid   = seedPipeline(csv(2000))
      val chain = (1 to 4).foldLeft(Vector.empty[PipelineStep])((acc, n) => acc :+ compute(pid, n, acc.lastOption))
      val tail  = addStep(pid, ComputeStep.Kind, ComputeConfig("tail", "concat($a, $b)", None), Some(chain(1)))
      addOutput(pid, tail, "tail"); addOutput(pid, chain(3), "terminal")

      awaitDb(service.submit(pid, isDry = false, owner)) shouldBe a[Right[_, _]]
      nodeSnapshotRows(pid, tail) shouldBe 2000
      nodeSnapshotRows(pid, chain(3)) shouldBe 2000
    }
  }

  "a run over a limit (AC5)" should {
    def unpivotOverTheLimit(): (PipelineId, PipelineStep) = {
      val pid = seedPipeline(csv(50000))
      val u   = addStep(pid, UnpivotStep.Kind, UnpivotConfig(Vector("a"), Vector("b", "c", "d"), "var", "val"))
      addOutput(pid, u, "never-written")
      (pid, u)
    }

    "be recorded as failed, with an error naming the step, its kind and the pipeline run limit, and write no node snapshot" in {
      val (pid, u) = unpivotOverTheLimit()

      val result = awaitDb(service.submit(pid, isDry = false, owner))
      result shouldBe a[Left[_, _]]

      val runs = awaitDb(pipelineRunRepo.listByPipeline(pid, owner))
      runs should have size 1
      runs.head.status shouldBe "failed"
      val log = runs.head.errorLog.get
      log should include(u.id.value)
      log should include("(unpivot)")
      log should include("unpivot would produce more than 100,000 rows (pipeline run limit)")
      log should not include "raft preview"
      nodeSnapshotCount(pid) shouldBe 0
    }

    "be returned by the saved-step preview as that step's error" in {
      val (pid, u) = unpivotOverTheLimit()

      val preview = awaitDb(service.previewStep(pid, u.id.value, owner))
      preview shouldBe a[Left[_, _]]
      preview.left.toOption.get match {
        case e: ServiceError => e.message should include("unpivot would produce more than 100,000 rows (pipeline run limit)")
      }
    }
  }
}
