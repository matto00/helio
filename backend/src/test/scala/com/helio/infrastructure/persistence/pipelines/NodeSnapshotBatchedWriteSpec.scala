package com.helio.infrastructure.persistence.pipelines

import com.helio.infrastructure.persistence.DbContext
import com.helio.testsupport.RunServiceHarness
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import com.helio.domain.steps.{ComputeConfig, ComputeStep}
import spray.json._

/** HEL-1660 (final gate round 2): the snapshot write builds each row's JSON text one batch at a time, inside the one transaction, so a node's
 *  write never holds a second full copy of its text (211 MB for a UTF-16 text-heavy run when it did). This pins the batch size and that the
 *  batched write persists the same rows, in order, replacing the previous snapshot atomically; `PipelineRunBackfill` writes through the same
 *  method. */
class NodeSnapshotBatchedWriteSpec extends AnyWordSpec with Matchers with RunServiceHarness {

  private def repo = new NodeSnapshotRepository(new DbContext(db, db))
  private def rows(n: Int, tag: String): Vector[JsObject] = Vector.tabulate(n)(i => JsObject("i" -> JsNumber(i), "t" -> JsString(s"$tag-ж-$i")))

  "the snapshot write" should {
    "build at most 200 rows' JSON text per batch" in {
      repo.SnapshotInsertBatchSize should be <= 200
    }

    "persist the same rows in order across batch boundaries, replacing the earlier snapshot" in {
      val pid  = seedPipeline(seedCsvSource(1, 1, (_, _) => "x"))
      val step = addStep(pid, ComputeStep.Kind, ComputeConfig("c", "1", None))
      Seq(0, 1, 199, 200, 201, 450).foreach { n =>
        val written = rows(n, s"n$n")
        awaitDb(repo.overwriteRows(pid.value, Some(step.id.value), written, None))
        val read = awaitDb(repo.listRows(pid.value, Some(step.id.value), explicitRootId = None))
        withClue(s"$n rows: ")(read.size shouldBe n)
        withClue(s"$n rows: ")(read == written shouldBe true)
      }
    }
  }
}
