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

/** HEL-1434: the trigger + drain, over real Postgres (a superuser connection; the NOSUPERUSER NOBYPASSRLS proof is
 *  `StoredObjectDeletionsMigrationSpec`) and a `LocalFileSystem` rooted in a fresh temp dir.
 *
 *  Proof kinds (design.md Decision 6):
 *  - [MUTATION] M1 shared key, M2 legacy `filePath` key in the shared-key check, M3 drain failure bookkeeping,
 *    M5 lease/backoff/attempt-cap. Green on the pre-fix tree by construction (no queue yet); proved by the named
 *    mutation in the run evidence.
 *  - [GUARD] G1 rolled-back delete, G4 non-file source (also mutation-proved), G5 `ENABLE ALWAYS` (also mutation-proved). */
class StoredObjectDeletionServiceSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll with TempDirectorySupport {

  import PostgresProfile.api._

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private final class TestClock(@volatile var instant: Instant) extends Clock { def now(): Instant = instant }

  /** Local storage whose delete can be made to fail. */
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
  private var service: StoredObjectDeletionService = _
  private val clock = new TestClock(Instant.parse("2026-10-12T12:00:00Z"))

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db   = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    root = newTempDir("helio-hel1434-drain")
    fs   = new FlakyFileSystem(new LocalFileSystem(root))
    service = new StoredObjectDeletionService(new StoredObjectDeletionRepository(new DbContext(db, db)), fs, clock)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 20.seconds)
  private def sql(a: DBIO[_]): Unit     = { await(db.run(a)); () }

  private def newUser(): String = {
    val id = UUID.randomUUID().toString
    sql(sqlu"""INSERT INTO users (id, email) VALUES ($id::uuid, ${s"$id@example.test"})""")
    id
  }

  private def object_(key: String): String = { await(fs.write(key, "x".getBytes(StandardCharsets.UTF_8))); key }
  private def present(key: String): Boolean = Files.exists(root.resolve(key))

  private def image(owner: String, key: String): String = {
    val id = UUID.randomUUID().toString
    sql(sqlu"""INSERT INTO image_uploads (id, owner_id, storage_key, mime_type, filename, size_bytes)
               VALUES ($id, $owner::uuid, $key, 'image/png', 'a.png', 1)""")
    id
  }

  private def source(owner: String, kind: String, config: String): String = {
    val id = UUID.randomUUID().toString
    sql(sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
               VALUES ($id, 'ds', $kind, $config::jsonb, $owner::uuid, now(), now())""")
    id
  }

  private def freshKey(prefix: String = "images", ext: String = "png"): String = s"$prefix/${UUID.randomUUID()}.$ext"

  private def queued(key: String): Vector[(Int, Boolean)] =
    await(db.run(sql"SELECT attempts, claimed_at IS NOT NULL FROM stored_object_deletions WHERE storage_key = $key".as[(Int, Boolean)])).toVector

  private def pass(): Int = await(service.runPass())

  "the deletion trigger" should {

    "G4 [guard] enqueue nothing for a non-file source" in {
      val u = newUser()
      val key = freshKey("csv", "csv")
      val ids = Seq(source(u, "dataset", s"""{"path":"$key"}"""), source(u, "rest_api", s"""{"path":"$key","url":"http://x.test/a"}"""))
      ids.foreach(id => sql(sqlu"DELETE FROM data_sources WHERE id = $id"))
      queued(key) shouldBe empty
    }

    "G1 [guard] enqueue nothing and keep the object when the delete is rolled back" in {
      val u   = newUser()
      val key = object_(freshKey())
      val id  = image(u, key)
      Await.ready(db.run(sqlu"DELETE FROM image_uploads WHERE id = $id".andThen(DBIO.failed(new IllegalStateException("rollback"))).transactionally), 20.seconds)
      queued(key) shouldBe empty
      pass()
      present(key) shouldBe true
    }

    "G5 [guard] enqueue a delete made under session_replication_role = replica" in {
      val u   = newUser()
      val key = object_(freshKey())
      val id  = image(u, key)
      sql((sqlu"SET session_replication_role = replica" andThen sqlu"DELETE FROM image_uploads WHERE id = $id" andThen sqlu"SET session_replication_role = origin").withPinnedSession)
      queued(key) should have size 1
    }
  }

  "StoredObjectDeletionService.runPass" should {

    "M1 keep an object while another row still references its key, remove it once none does" in {
      val u    = newUser()
      val key  = object_(freshKey())
      val a    = image(u, key)
      val b    = image(u, key)
      sql(sqlu"DELETE FROM image_uploads WHERE id = $a")
      pass()
      present(key) shouldBe true
      queued(key) shouldBe empty // dequeued without deleting
      sql(sqlu"DELETE FROM image_uploads WHERE id = $b")
      pass()
      present(key) shouldBe false
    }

    "M2 let a surviving legacy filePath-only csv row protect its key" in {
      val u   = newUser()
      val key = object_(freshKey("csv", "csv"))
      source(u, "csv", s"""{"filePath":"$key"}""")
      val img = image(u, key)
      sql(sqlu"DELETE FROM image_uploads WHERE id = $img")
      pass()
      present(key) shouldBe true
      queued(key) shouldBe empty
    }

    "M3 keep the row, count the attempt and clear the lease when the storage delete fails, without failing the pass" in {
      val u   = newUser()
      val key = object_(freshKey())
      val id  = image(u, key)
      sql(sqlu"DELETE FROM image_uploads WHERE id = $id")
      fs.failDelete = true
      try pass() shouldBe 0
      finally fs.failDelete = false
      present(key) shouldBe true
      queued(key) shouldBe Vector((1, false))
    }

    "M5 skip a freshly leased row and a row inside its backoff, reclaim a stale lease, and honour the attempt cap" in {
      val u = newUser()
      def queuedRow(): String = {
        val key = object_(freshKey())
        val id  = image(u, key)
        sql(sqlu"DELETE FROM image_uploads WHERE id = $id")
        key
      }
      val now      = clock.now()
      val leased   = queuedRow(); sql(sqlu"UPDATE stored_object_deletions SET claimed_at = ${Timestamp.from(now.minusSeconds(10))} WHERE storage_key = $leased")
      val stale    = queuedRow(); sql(sqlu"UPDATE stored_object_deletions SET claimed_at = ${Timestamp.from(now.minusSeconds(301))} WHERE storage_key = $stale")
      val backoff  = queuedRow(); sql(sqlu"UPDATE stored_object_deletions SET attempts = 1, last_attempt_at = ${Timestamp.from(now.minusSeconds(30))} WHERE storage_key = $backoff")
      val due      = queuedRow(); sql(sqlu"UPDATE stored_object_deletions SET attempts = 1, last_attempt_at = ${Timestamp.from(now.minusSeconds(90))} WHERE storage_key = $due")
      val capped   = queuedRow(); sql(sqlu"UPDATE stored_object_deletions SET attempts = 10, last_attempt_at = ${Timestamp.from(now.minusSeconds(3600))} WHERE storage_key = $capped")
      pass()
      present(leased) shouldBe true
      present(backoff) shouldBe true
      present(capped) shouldBe true
      present(stale) shouldBe false
      present(due) shouldBe false
    }
  }
}
