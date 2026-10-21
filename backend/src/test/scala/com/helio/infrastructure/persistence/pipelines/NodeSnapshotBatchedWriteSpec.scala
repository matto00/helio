package com.helio.infrastructure.persistence.pipelines

import com.helio.domain.engine.{JsonTextLength, RunLimits}
import com.helio.infrastructure.persistence.DbContext
import com.helio.testsupport.RunServiceHarness
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import com.helio.domain.steps.{ComputeConfig, ComputeStep}
import spray.json._

import scala.collection.mutable.ArrayBuffer

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
    // Shared setup: a per-insert trigger counter, so a render callback can read, from another connection, how many rows the open transaction has inserted.
    def installInsertCounter(): () => Int = {
      import slick.jdbc.PostgresProfile.api._
      val bumpFunction = "CREATE OR REPLACE FUNCTION snapshot_probe_bump() RETURNS trigger AS $body$ BEGIN PERFORM nextval('snapshot_probe_seq'); RETURN NEW; END $body$ LANGUAGE plpgsql"
      awaitDb(db.run(DBIO.seq(
        sqlu"CREATE SEQUENCE IF NOT EXISTS snapshot_probe_seq",
        sqlu"#$bumpFunction",
        sqlu"DROP TRIGGER IF EXISTS snapshot_probe ON node_snapshots",
        sqlu"CREATE TRIGGER snapshot_probe AFTER INSERT ON node_snapshots FOR EACH ROW EXECUTE FUNCTION snapshot_probe_bump()",
        sql"SELECT setval('snapshot_probe_seq', 1, false)".as[Long].map(_ => ())
      )))
      () => awaitDb(db.run(sql"SELECT CASE WHEN is_called THEN last_value ELSE 0 END FROM snapshot_probe_seq".as[Int].head))
    }

    /** Writes `toWrite` and returns (rows rendered, the most rows rendered-but-not-inserted at any render, the most CHARACTERS rendered-but-not-inserted). */
    def writeObserving(toWrite: Vector[JsObject]): (Int, Int, Long) = {
      val inserted = installInsertCounter()
      val pid      = seedPipeline(seedCsvSource(1, 1, (_, _) => "x"))
      val step     = addStep(pid, ComputeStep.Kind, ComputeConfig("c", "1", None))
      val lengths  = ArrayBuffer.empty[Long]
      var maxRows  = 0
      var maxChars = 0L
      val action = repo.overwriteRowsActionRendering(pid.value, Some(step.id.value), toWrite, None, None, { row =>
        val text = row.compactPrint
        lengths += text.length.toLong
        val done = inserted()
        maxRows  = math.max(maxRows, lengths.size - done)
        maxChars = math.max(maxChars, lengths.drop(done).sum)
        text
      })
      awaitDb(new DbContext(db, db).withSystemContext(action))
      (lengths.size, maxRows, maxChars)
    }

    // Eager rendering renders every row before the first insert; lazy batches never get more than one batch ahead.
    "never render more than one batch ahead of the inserts (450 rows)" in {
      val (rendered, maxAhead, _) = writeObserving(rows(450, "ahead"))
      rendered shouldBe 450
      withClue(s"rows rendered but not yet inserted, at most: $maxAhead; ")(maxAhead should be <= repo.SnapshotInsertBatchSize)
    }

    // HEL-1679: a node of few WIDE rows is bounded by rendered size, not by row count. 12 rows of ~300,000 characters render ~3.6M characters; the
    // size cap holds the text rendered ahead of the inserts to one batch's budget. Rendering the lot at once (the 294 MB defect) shows as 12 rows ahead.
    "never hold more rendered text than the batch budget ahead of the inserts (12 rows of ~300,000 characters)" in {
      val wide = Vector.tabulate(12)(i => JsObject("i" -> JsNumber(i), "t" -> JsString(("ж" * 300000) + i)))
      val (rendered, maxAheadRows, maxAheadChars) = writeObserving(wide)
      rendered shouldBe 12
      withClue(s"characters rendered but not yet inserted, at most: $maxAheadChars (budget ${repo.SnapshotBatchMaxChars}); ")(
        maxAheadChars should be <= repo.SnapshotBatchMaxChars)
      withClue(s"rows ahead: $maxAheadRows; ")(maxAheadRows should be < 12)
    }

    "render a row wider than the budget alone, one row ahead at a time (3 rows of ~1.2M characters)" in {
      val wide = Vector.tabulate(3)(i => JsObject("t" -> JsString(("x" * 1200000) + i)))
      val (rendered, maxAheadRows, maxAheadChars) = writeObserving(wide)
      rendered shouldBe 3
      maxAheadRows shouldBe 1
      maxAheadChars should be <= 1200020L
    }
  }

  "the snapshot batching" should {
    def sized(chars: Int, i: Int = 0): JsObject = JsObject("t" -> JsString("x" * (chars - 8))) // {"t":""} is 8 characters
    def sizes(batches: Iterator[Vector[(JsObject, Int)]]): Vector[Int] = batches.map(_.size).toVector

    "close a batch exactly when the next row would pass the character budget, and keep each row's index" in {
      val rows  = Vector.fill(10)(sized(100))
      JsonTextLength.chars(rows.head) shouldBe 100L
      sizes(repo.batchesOf(rows, 300L)) shouldBe Vector(3, 3, 3, 1)   // 300 fits, 400 does not
      sizes(repo.batchesOf(rows, 299L)) shouldBe Vector.fill(5)(2)
      repo.batchesOf(rows, 300L).flatten.map(_._2).toVector shouldBe (0 until 10).toVector
    }

    "always put at least one row in a batch, however wide" in {
      sizes(repo.batchesOf(Vector(sized(5000), sized(10), sized(5000)), 100L)) shouldBe Vector(1, 1, 1)
    }

    "still cap a batch at 200 rows, and make no batch for no rows" in {
      sizes(repo.batchesOf(Vector.fill(450)(sized(20)), 1L << 40)) shouldBe Vector(200, 200, 50)
      repo.batchesOf(Vector.empty, 100L).hasNext shouldBe false
    }

    "use a budget no larger than the widest row a run may write" in {
      repo.SnapshotBatchMaxChars should be <= RunLimits.MaxRowRenderChars
      repo.SnapshotBatchMaxChars should be <= 1048576L
    }
  }
}
