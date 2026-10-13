package com.helio.services.sources

import com.helio.domain.util.Clock
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.sources.StoredObjectDeletionRepository
import com.helio.infrastructure.storage.{FileSystem, ListPage, LocalFileSystem}
import com.helio.testkit.{TempDirectorySupport, VerifiedEmbeddedPostgres}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}

import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path}
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1530 tasks.md 3.2 / 3.2a: V132's queue + the drain's extended shared-key guard over real Postgres (a superuser
 *  connection; the NOSUPERUSER NOBYPASSRLS proof is `FormAndConversationObjectDeletionsMigrationSpec`) and a
 *  `LocalFileSystem` in a fresh temp dir. The clock is real time plus a settable offset, because V132's trigger rows
 *  carry the database's `now()` as `not_before`. */
class FormAndConversationObjectDrainSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll with TempDirectorySupport {

  import PostgresProfile.api._

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private final class OffsetClock extends Clock {
    @volatile var offsetSeconds: Long = 0L
    def now(): Instant                = Instant.now().plusSeconds(offsetSeconds)
  }

  private final class FlakyFileSystem(delegate: FileSystem) extends FileSystem {
    @volatile var failDelete = false
    def write(path: String, bytes: Array[Byte]): Future[Unit]                         = delegate.write(path, bytes)
    def read(path: String): Future[Array[Byte]]                                       = delegate.read(path)
    def exists(path: String): Future[Boolean]                                         = delegate.exists(path)
    def list(prefix: String, cursor: Option[String], pageSize: Int): Future[ListPage] = delegate.list(prefix, cursor, pageSize)
    def delete(path: String): Future[Unit] =
      if (failDelete) Future.failed(new IllegalStateException("boom: file delete")) else delegate.delete(path)
  }

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var root: Path                         = _
  private var fs: FlakyFileSystem                = _
  private var repo: StoredObjectDeletionRepository = _
  private var service: StoredObjectDeletionService = _
  private val clock = new OffsetClock

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db      = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    root    = newTempDir("helio-hel1530-drain")
    fs      = new FlakyFileSystem(new LocalFileSystem(root))
    repo    = new StoredObjectDeletionRepository(new DbContext(db, db))
    service = new StoredObjectDeletionService(repo, fs, clock)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 20.seconds)
  private def sql(a: DBIO[_]): Unit     = { await(db.run(a)); () }
  private def pass(): Int               = await(service.runPass())

  private def newUser(): String = {
    val id = UUID.randomUUID().toString
    sql(sqlu"""INSERT INTO users (id, email) VALUES ($id::uuid, ${s"$id@example.test"})""")
    id
  }

  private def object_(key: String): String  = { await(fs.write(key, "x".getBytes(StandardCharsets.UTF_8))); key }
  private def present(key: String): Boolean = Files.exists(root.resolve(key))

  private def image(owner: String, key: String): String = {
    val id = UUID.randomUUID().toString
    sql(sqlu"""INSERT INTO image_uploads (id, owner_id, storage_key, mime_type, filename, size_bytes)
               VALUES ($id, $owner::uuid, $key, 'image/png', 'a.png', 1)""")
    id
  }

  private def dataset(owner: String): String = {
    val id = UUID.randomUUID().toString
    sql(sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
               VALUES ($id, 'ds', 'dataset', '{}'::jsonb, $owner::uuid, now(), now())""")
    id
  }

  private var seq = 0L
  private def row(source: String, json: String): String = {
    val id = UUID.randomUUID().toString
    seq += 1
    val s = seq
    sql(sqlu"""INSERT INTO dataset_rows (id, data_source_id, seq, data, created_at, updated_at)
               VALUES ($id, $source, $s, $json::jsonb, now(), now())""")
    id
  }

  private def conversation(owner: String): (String, String) = {
    val id  = UUID.randomUUID().toString
    val key = object_(s"assistant-conversations/$owner/$id.json")
    sql(sqlu"""INSERT INTO assistant_conversations (id, owner_id, title, gcs_body_ref) VALUES ($id, $owner::uuid, 't', $key)""")
    (id, key)
  }

  private def formKey(): String = s"form-uploads/${UUID.randomUUID()}.pdf"
  private def freshImageKey(): String = s"images/${UUID.randomUUID()}.png"
  private def cell(key: String): String = s"""[1, {"storageKey":"$key","mimeType":"application/pdf","filename":"a.pdf","sizeBytes":1}]"""

  /** `(attempts, claimed_at = infinity, not_before IS NOT NULL, lease_until IS NOT NULL)` of every queue row of `key`. */
  private def queued(key: String): Vector[(Int, Boolean, Boolean, Boolean)] =
    await(db.run(sql"""SELECT attempts, claimed_at = 'infinity', not_before IS NOT NULL, lease_until IS NOT NULL
                       FROM stored_object_deletions WHERE storage_key = $key""".as[(Int, Boolean, Boolean, Boolean)])).toVector

  private def notBefore(key: String): Instant =
    await(db.run(sql"SELECT not_before FROM stored_object_deletions WHERE storage_key = $key".as[Timestamp])).head.toInstant

  private def withOffset[T](seconds: Long)(body: => T): T = {
    clock.offsetSeconds = seconds
    try body finally clock.offsetSeconds = 0L
  }

  "dataset-row form-upload keys" should {

    "be removed by the drain after the row is deleted" in {
      val u = newUser(); val src = dataset(u); val key = object_(formKey())
      val r = row(src, cell(key))
      sql(sqlu"DELETE FROM dataset_rows WHERE id = $r")
      queued(key) shouldBe Vector((0, true, true, false))
      pass()
      present(key) shouldBe false
      queued(key) shouldBe empty
    }

    "be removed after the whole dataset source is deleted, and after a users cascade" in {
      val u1 = newUser(); val s1 = dataset(u1); val k1 = object_(formKey()); row(s1, cell(k1))
      sql(sqlu"DELETE FROM data_sources WHERE id = $s1")
      val u2 = newUser(); val s2 = dataset(u2); val k2 = object_(formKey()); row(s2, cell(k2))
      sql(sqlu"DELETE FROM users WHERE id = $u2::uuid")
      pass()
      present(k1) shouldBe false
      present(k2) shouldBe false
    }

    "be kept until the LAST row holding a shared key is deleted" in {
      val u = newUser(); val src = dataset(u); val key = object_(formKey())
      val a = row(src, cell(key)); val b = row(src, cell(key))
      sql(sqlu"DELETE FROM dataset_rows WHERE id = $a")
      pass()
      present(key) shouldBe true
      queued(key) shouldBe empty // dequeued: the surviving row's own delete re-queues it
      sql(sqlu"DELETE FROM dataset_rows WHERE id = $b")
      pass()
      present(key) shouldBe false
    }

    "remove only the replaced object when a row update swaps a file" in {
      val u = newUser(); val src = dataset(u); val oldKey = object_(formKey()); val newKey = object_(formKey())
      val r = row(src, cell(oldKey))
      val updated = cell(newKey)
      sql(sqlu"UPDATE dataset_rows SET data = $updated::jsonb WHERE id = $r")
      pass()
      present(oldKey) shouldBe false
      present(newKey) shouldBe true
    }

    "survive a full-set replace that re-inserts the same key (delete + insert in one transaction)" in {
      val u = newUser(); val src = dataset(u); val key = object_(formKey())
      val r = row(src, cell(key))
      val again = cell(key)
      val newId = UUID.randomUUID().toString
      sql(DBIO.seq(
        sqlu"DELETE FROM dataset_rows WHERE id = $r",
        sqlu"""INSERT INTO dataset_rows (id, data_source_id, seq, data, created_at, updated_at) VALUES ($newId, $src, 9999, $again::jsonb, now(), now())"""
      ).transactionally)
      pass()
      present(key) shouldBe true
      queued(key) shouldBe empty
    }
  }

  "conversation transcripts" should {
    "be removed after the conversation row is deleted" in {
      val u = newUser(); val (id, key) = conversation(u)
      sql(sqlu"DELETE FROM assistant_conversations WHERE id = $id")
      queued(key) shouldBe Vector((0, true, true, false))
      pass()
      present(key) shouldBe false
    }
  }

  "the extended shared-key guard" should {

    "defer an image key still copied as a bare string into a dataset row, then delete it once that row goes" in {
      val u = newUser(); val src = dataset(u); val key = object_(freshImageKey())
      val img = image(u, key)
      val copy = row(src, s"""["$key"]""")
      sql(sqlu"DELETE FROM image_uploads WHERE id = $img")
      pass()
      present(key) shouldBe true
      queued(key) should have size 1
      queued(key).head shouldBe ((0, true, true, false)) // legacy row converted to new-style, no attempt counted
      notBefore(key).isAfter(Instant.now().plusSeconds(3500)) shouldBe true
      // not_before is honoured: an hour-less pass does not touch it, even once the copy is gone
      sql(sqlu"DELETE FROM dataset_rows WHERE id = $copy")
      withOffset(1800)(pass())
      present(key) shouldBe true
      withOffset(3700)(pass())
      present(key) shouldBe false
      queued(key) shouldBe empty
    }

    "defer an image key copied as a binary-ref into a dataset row (non-form family) instead of dequeuing it" in {
      val u = newUser(); val src = dataset(u); val key = object_(freshImageKey())
      val img = image(u, key)
      val copy = row(src, cell(key))
      sql(sqlu"DELETE FROM image_uploads WHERE id = $img")
      pass()
      present(key) shouldBe true
      queued(key) should have size 1
      sql(sqlu"DELETE FROM dataset_rows WHERE id = $copy")
      withOffset(3700)(pass())
      present(key) shouldBe false
    }

    "defer a transcript key copied into a dataset row, and delete it after that row is deleted" in {
      val u = newUser(); val src = dataset(u); val (id, key) = conversation(u)
      val copy = row(src, s"""{"note":"$key"}""")
      sql(sqlu"DELETE FROM assistant_conversations WHERE id = $id")
      pass()
      present(key) shouldBe true
      queued(key) should have size 1
      sql(sqlu"DELETE FROM dataset_rows WHERE id = $copy")
      withOffset(3700)(pass())
      present(key) shouldBe false
    }

    "keep an image key held by a node snapshot until the snapshot no longer holds it" in {
      val u = newUser(); val key = object_(freshImageKey())
      val img = image(u, key)
      val snapPipeline = s"p-${UUID.randomUUID()}"
      val stepId = s"s-${UUID.randomUUID()}"
      val body = s"""{"photo":{"storageKey":"$key"}}"""
      sql(sqlu"""INSERT INTO node_snapshots (pipeline_id, node_step_id, row_index, data) VALUES ($snapPipeline, $stepId, 0, $body::jsonb)""")
      sql(sqlu"DELETE FROM image_uploads WHERE id = $img")
      pass()
      present(key) shouldBe true
      queued(key) should have size 1
      sql(sqlu"DELETE FROM node_snapshots WHERE pipeline_id = $snapPipeline")
      withOffset(3700)(pass())
      present(key) shouldBe false
    }

    "keep an image key held by a binary_refs row until that row is gone" in {
      val u = newUser(); val key = object_(freshImageKey())
      val img = image(u, key)
      val refId = s"ref-${UUID.randomUUID()}"
      // FK-free seeding (pipeline / step / root need not exist for the guard)
      sql((sqlu"SET session_replication_role = replica" andThen
        sqlu"""INSERT INTO binary_refs (id, row_index, field_name, storage_key, mime_type, filename, size_bytes, pipeline_id, node_step_id)
               VALUES ($refId, 0, 'f', $key, 'image/png', 'a.png', 1, 'p-x', 's-x')""" andThen
        sqlu"SET session_replication_role = origin").withPinnedSession)
      sql(sqlu"DELETE FROM image_uploads WHERE id = $img")
      pass()
      present(key) shouldBe true
      queued(key) should have size 1
      sql(sqlu"DELETE FROM binary_refs WHERE id = $refId")
      withOffset(3700)(pass())
      present(key) shouldBe false
      queued(key) shouldBe empty
    }

    "keep an image key held by a node_payload_history row until that row is gone" in {
      val u = newUser(); val key = object_(freshImageKey())
      val img = image(u, key)
      val hist = UUID.randomUUID().toString
      val rowsJson = s"""[{"photo":{"storageKey":"$key"}}]"""
      sql((sqlu"SET session_replication_role = replica" andThen
        sqlu"""INSERT INTO node_payload_history (id, pipeline_id, node_step_id, trigger_source, captured_at, row_count, byte_size, rows)
               VALUES ($hist::uuid, 'p-x', 's-x', 'manual', now(), 1, 10, $rowsJson::jsonb)""" andThen
        sqlu"SET session_replication_role = origin").withPinnedSession)
      sql(sqlu"DELETE FROM image_uploads WHERE id = $img")
      pass()
      present(key) shouldBe true
      queued(key) should have size 1
      sql(sqlu"DELETE FROM node_payload_history WHERE id = $hist::uuid")
      withOffset(3700)(pass())
      present(key) shouldBe false
      queued(key) shouldBe empty
    }

    "leave every claimed row queued, attempts unchanged, when the guard query itself fails" in {
      val u = newUser(); val key = object_(freshImageKey())
      sql(sqlu"DELETE FROM image_uploads WHERE id = ${image(u, key)}")
      val failing = new StoredObjectDeletionService(
        new StoredObjectDeletionRepository(new DbContext(db, db)) {
          override def classify(keys: Seq[String]) = Future.failed(new IllegalStateException("boom: guard"))
        }, fs, clock)
      await(failing.runPass()) shouldBe 0
      present(key) shouldBe true
      queued(key).map(_._1) shouldBe Vector(0)
      withOffset(400)(pass()) // the 300 s lease has expired; a healthy guard now deletes it
      present(key) shouldBe false
    }

    "keep an image key named by an alert event value" in {
      val u = newUser(); val key = object_(freshImageKey())
      val img = image(u, key)
      val rule = s"r-${UUID.randomUUID()}"; val ev = s"e-${UUID.randomUUID()}"
      val value = s"""{"x":"$key"}"""
      // FKs (rule, output) are irrelevant to the guard; replica role skips them for this one insert
      sql((sqlu"SET session_replication_role = replica" andThen
        sqlu"""INSERT INTO alert_events (id, alert_rule_id, owner_id, target_output_id, value, severity, state, first_fired_at, last_evaluated_at)
               VALUES ($ev, $rule, $u::uuid, 'out', $value::jsonb, 'info', 'firing', now(), now())""" andThen
        sqlu"SET session_replication_role = origin").withPinnedSession)
      sql(sqlu"DELETE FROM image_uploads WHERE id = $img")
      pass()
      present(key) shouldBe true
      queued(key) should have size 1
    }

    "dequeue (not defer) an image key a surviving image row still holds, and not count an attempt" in {
      val u = newUser(); val key = object_(freshImageKey())
      val a = image(u, key); image(u, key)
      sql(sqlu"DELETE FROM image_uploads WHERE id = $a")
      pass()
      present(key) shouldBe true
      queued(key) shouldBe empty
    }

    "treat an unrelated form key literal in a dataset row as no hold on a different key" in {
      val u = newUser(); val src = dataset(u); val key = object_(formKey()); val other = formKey()
      val r = row(src, cell(key)); row(src, cell(other))
      sql(sqlu"DELETE FROM dataset_rows WHERE id = $r")
      pass()
      present(key) shouldBe false
    }
  }

  "new-style queue rows" should {

    "back off on a failed storage delete by moving not_before, never touching claimed_at" in {
      val u = newUser(); val src = dataset(u); val key = object_(formKey())
      val r = row(src, cell(key))
      sql(sqlu"DELETE FROM dataset_rows WHERE id = $r")
      fs.failDelete = true
      try pass() shouldBe 0 finally fs.failDelete = false
      present(key) shouldBe true
      queued(key) shouldBe Vector((1, true, true, false))
      notBefore(key).isAfter(Instant.now().plusSeconds(50)) shouldBe true
      withOffset(30)(pass() shouldBe 0)
      present(key) shouldBe true
      withOffset(120)(pass())
      present(key) shouldBe false
    }

    "honour the attempt cap" in {
      val u = newUser(); val src = dataset(u); val key = object_(formKey())
      val r = row(src, cell(key))
      sql(sqlu"DELETE FROM dataset_rows WHERE id = $r")
      // Last attempt inside the 24 h re-arm cool-down at the offset clock (100000 s ahead): the cap still holds.
      sql(sqlu"UPDATE stored_object_deletions SET attempts = 10, last_attempt_at = ${Timestamp.from(Instant.now().plusSeconds(100000 - 3600))} WHERE storage_key = $key")
      withOffset(100000)(pass())
      present(key) shouldBe true
    }

    "not be re-claimed while their lease is live, and be re-claimed once it expires" in {
      val u = newUser(); val src = dataset(u); val key = object_(formKey())
      val r = row(src, cell(key))
      sql(sqlu"DELETE FROM dataset_rows WHERE id = $r")
      val claimed = await(repo.claim(Instant.now().plusSeconds(1), Instant.now().minusSeconds(300), 300, 10, 1000)).map(_.storageKey)
      claimed should contain(key)
      queued(key).head._4 shouldBe true
      await(repo.claim(Instant.now().plusSeconds(60), Instant.now().minusSeconds(300), 300, 10, 1000)).map(_.storageKey) should not contain key
      await(repo.claim(Instant.now().plusSeconds(400), Instant.now().minusSeconds(300), 300, 10, 1000)).map(_.storageKey) should contain(key)
    }
  }

  /** V128's claim statement, copied VERBATIM from the merged `StoredObjectDeletionRepository.claim` (only the bind
   *  parameters are named). An older revision still running during a rolling deploy executes exactly this. */
  private def v128Claim(now: Instant, stale: Instant): Vector[String] = {
    val nowTs   = Timestamp.from(now)
    val staleTs = Timestamp.from(stale)
    val maxAttempts = 10
    val limit = 100000
    await(db.run(
      sql"""UPDATE stored_object_deletions
            SET claimed_at = $nowTs
            WHERE id IN (
              SELECT id FROM stored_object_deletions
              WHERE attempts < $maxAttempts
                AND (claimed_at IS NULL OR claimed_at < $staleTs)
                AND (last_attempt_at IS NULL
                     OR last_attempt_at <= ($nowTs)::timestamptz - LEAST(3600.0, 60.0 * power(2, attempts - 1)) * interval '1 second')
              ORDER BY id
              LIMIT $limit
              FOR UPDATE SKIP LOCKED)
            RETURNING id, storage_key""".as[(Long, String)]
    )).map(_._2).toVector
  }

  "V128's own claim SQL (3.2a)" should {
    "claim a legacy V128-trigger row (control) but none of the new-style rows, however far in the future it runs" in {
      val u = newUser(); val src = dataset(u)
      // deferred (a copy holds the image key) and failed-backoff new-style rows first: each needs a drain pass, which
      // would also consume any pristine row created before it
      val deferredKey = object_(freshImageKey()); val deferredImg = image(u, deferredKey); row(src, s"""["$deferredKey"]""")
      sql(sqlu"DELETE FROM image_uploads WHERE id = $deferredImg")
      pass()
      val failedKey = object_(formKey()); sql(sqlu"DELETE FROM dataset_rows WHERE id = ${row(src, cell(failedKey))}")
      fs.failDelete = true
      try pass() finally fs.failDelete = false
      // pristine rows: legacy control (V128's image_uploads trigger), V132's dataset-row and conversation triggers, and
      // the app enqueue (form-submit compensation)
      val legacyKey = object_(freshImageKey()); sql(sqlu"DELETE FROM image_uploads WHERE id = ${image(u, legacyKey)}")
      val dsKey = object_(formKey()); sql(sqlu"DELETE FROM dataset_rows WHERE id = ${row(src, cell(dsKey))}")
      val (cid, convKey) = conversation(u); sql(sqlu"DELETE FROM assistant_conversations WHERE id = $cid")
      val appKey = formKey(); await(repo.enqueue(Seq(appKey), "form_submit_failed", Instant.now().plusSeconds(900)))
      Seq(legacyKey, dsKey, convKey, appKey, deferredKey, failedKey).foreach(k => queued(k) should have size 1)

      val claimed = v128Claim(Instant.now().plusSeconds(10L * 365 * 86400), Instant.now().plusSeconds(10L * 365 * 86400 - 300)).toSet
      claimed should contain(legacyKey)
      claimed should not contain dsKey
      claimed should not contain convKey
      claimed should not contain appKey
      claimed should not contain deferredKey
      claimed should not contain failedKey
    }
  }
}
