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

  "the snapshot write's rendering" should {
    // A trigger bumps a (non-transactional) sequence per inserted row, so a render callback can read, from another connection, how many rows
    // the open transaction has inserted so far. Eager rendering renders every row before the first insert; lazy batches never get
    // more than one batch ahead.
    "never render more than one batch ahead of the inserts (450 rows)" in {
      import slick.jdbc.PostgresProfile.api._
      val bumpFunction = "CREATE OR REPLACE FUNCTION snapshot_probe_bump() RETURNS trigger AS $body$ BEGIN PERFORM nextval('snapshot_probe_seq'); RETURN NEW; END $body$ LANGUAGE plpgsql"
      awaitDb(db.run(DBIO.seq(
        sqlu"CREATE SEQUENCE IF NOT EXISTS snapshot_probe_seq",
        sqlu"#$bumpFunction",
        sqlu"DROP TRIGGER IF EXISTS snapshot_probe ON node_snapshots",
        sqlu"CREATE TRIGGER snapshot_probe AFTER INSERT ON node_snapshots FOR EACH ROW EXECUTE FUNCTION snapshot_probe_bump()",
        sql"SELECT setval('snapshot_probe_seq', 1, false)".as[Long].map(_ => ())
      )))
      def inserted: Int = awaitDb(db.run(sql"SELECT CASE WHEN is_called THEN last_value ELSE 0 END FROM snapshot_probe_seq".as[Int].head))
      val pid  = seedPipeline(seedCsvSource(1, 1, (_, _) => "x"))
      val step = addStep(pid, ComputeStep.Kind, ComputeConfig("c", "1", None))
      var rendered = 0
      var maxAhead = 0
      val action = repo.overwriteRowsActionRendering(pid.value, Some(step.id.value), rows(450, "ahead"), None, None, { row =>
        rendered += 1
        maxAhead = math.max(maxAhead, rendered - inserted)
        row.compactPrint
      })
      awaitDb(new DbContext(db, db).withSystemContext(action))
      rendered shouldBe 450
      withClue(s"rows rendered but not yet inserted, at most: $maxAhead; ")(maxAhead should be <= repo.SnapshotInsertBatchSize)
    }
  }
}
