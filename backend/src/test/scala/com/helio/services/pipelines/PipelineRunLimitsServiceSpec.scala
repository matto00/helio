package com.helio.services.pipelines

import com.helio.domain.engine.RunLimits
import com.helio.domain.model.{PipelineId, PipelineStep, PipelineStepId}
import com.helio.domain.steps.{ComputeConfig, ComputeStep, UnpivotConfig, UnpivotStep}
import com.helio.services.ServiceError
import com.helio.testsupport.RunServiceHarness
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.nio.file.{Files, Paths}

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

  "a pipeline the walk accepts but whose finished run would hold too much (skeptic-final-1 CR1)" should {
    "fail cleanly with the run memory-limit error and write no snapshot: 17 concat steps over 50,000 x 6 with Outputs on the terminal and its parent (259 MB when it was accepted)" in {
      val pid   = seedPipeline(csv(50000))
      val chain = (1 to 17).foldLeft(Vector.empty[PipelineStep])((acc, n) => acc :+ compute(pid, n, acc.lastOption))
      addOutput(pid, chain(15), "parent"); addOutput(pid, chain(16), "terminal")

      awaitDb(service.submit(pid, isDry = false, owner)).isLeft shouldBe true
      val run = awaitDb(pipelineRunRepo.listByPipeline(pid, owner)).head
      run.status shouldBe "failed"
      run.errorLog.get should include(chain(16).id.value)
      run.errorLog.get should include("Pipeline run memory limit reached")
      nodeSnapshotCount(pid) shouldBe 0
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

  // HEL-1679 (design.md D3, D5): one row's rendered JSON is bounded, for runs and for backfill (which writes through the same method).
  "a row wider than the render limit (HEL-1679)" should {
    // A one-column CSV row `{"a":"<n x>","c":...}` is a little over n characters wide as JSON.
    def widePipeline(cellChars: Int): (PipelineId, PipelineStep) = {
      val pid  = seedPipeline(seedCsvSource(2, 1, (r, _) => if (r == 0) "x" * cellChars else "short"))
      val step = addStep(pid, ComputeStep.Kind, ComputeConfig("c", "1", None))
      (pid, step)
    }

    "fail a real run cleanly with the run memory-limit error, naming the terminal step, and write no snapshot" in {
      val (pid, step) = widePipeline(RunLimits.MaxRowRenderChars.toInt)
      addOutput(pid, step, "wide")
      awaitDb(service.submit(pid, isDry = false, owner)).isLeft shouldBe true
      val run = awaitDb(pipelineRunRepo.listByPipeline(pid, owner)).head
      run.status shouldBe "failed"
      run.errorLog.get should include(step.id.value)
      run.errorLog.get should include("Pipeline run memory limit reached")
      run.errorLog.get should include("characters wide as JSON")
      nodeSnapshotCount(pid) shouldBe 0
    }

    "still run it as a dry run (a dry run writes and renders nothing)" in {
      val (pid, step) = widePipeline(RunLimits.MaxRowRenderChars.toInt)
      addOutput(pid, step, "wide")
      awaitDb(service.submit(pid, isDry = true, owner)) shouldBe a[Right[_, _]]
    }

    "accept a row just under the limit and write it" in {
      val (pid, step) = widePipeline(RunLimits.MaxRowRenderChars.toInt / 2)
      addOutput(pid, step, "ok")
      awaitDb(service.submit(pid, isDry = false, owner)) shouldBe a[Right[_, _]]
      nodeSnapshotRows(pid, step) shouldBe 2
    }

    // Backfill: a prior successful run (narrow data, no Output on the node), the source then rewritten to hold the wide row, an Output added, then
    // the targeted backfill. (A run holding a wide row never succeeds, so backfill's "has run once" gate needs the narrow first run.)
    def backfill(cellChars: Int): (PipelineId, PipelineStep) = {
      import slick.jdbc.PostgresProfile.api._
      val dsId = seedCsvSource(2, 1, (_, _) => "short")
      val pid  = seedPipeline(dsId)
      val step = addStep(pid, ComputeStep.Kind, ComputeConfig("c", "1", None))
      awaitDb(service.submit(pid, isDry = false, owner)) shouldBe a[Right[_, _]]
      nodeSnapshotCount(pid) shouldBe 0
      val path = awaitDb(db.run(sql"SELECT config->>'path' FROM data_sources WHERE id = $dsId".as[String].head))
      Files.writeString(Paths.get(path), "a\n" + ("x" * cellChars) + "\nshort\n")
      addOutput(pid, step, "late")
      awaitDb(service.backfillOutputNode(pid, Some(PipelineStepId(step.id.value)), owner, explicitRootId = None))
      (pid, step)
    }

    "be written by backfill when under the limit, through the same size-capped snapshot write" in {
      val (pid, step) = backfill(RunLimits.MaxRowRenderChars.toInt / 2)
      nodeSnapshotRows(pid, step) shouldBe 2
    }

    "make backfill write nothing (a logged failure, not a throw)" in {
      val (pid, step) = backfill(RunLimits.MaxRowRenderChars.toInt)
      nodeSnapshotRows(pid, step) shouldBe 0
    }
  }
}
