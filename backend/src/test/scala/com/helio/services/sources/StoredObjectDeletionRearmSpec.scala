package com.helio.services.sources

import com.helio.domain.util.Clock
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.sources.StoredObjectDeletionRepository
import com.helio.infrastructure.storage.{FileSystem, ListPage, LocalFileSystem}
import com.helio.testkit.{TempDirectorySupport, VerifiedEmbeddedPostgres}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.{BeforeAndAfterAll, BeforeAndAfterEach}
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

/** HEL-1531: a row at the attempt cap is re-armed 24 h after its last attempt (design.md D1), for LEGACY (V128,
 *  `not_before` null) and NEW-STYLE (V132, `claimed_at = 'infinity'`) rows. Real Postgres (superuser; the production
 *  role shape is proved in `StoredObjectDeletionsMigrationSpec`) and a `LocalFileSystem` in a temp dir. The clock is
 *  frozen and settable. Boundary fixtures sit at exactly 24 h +/- 1 minute (tasks.md C4). */
class StoredObjectDeletionRearmSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll with BeforeAndAfterEach with TempDirectorySupport {

  import PostgresProfile.api._

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private final class TestClock(@volatile var instant: Instant) extends Clock { def now(): Instant = instant }

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
  private val baseInstant = Instant.now()
  private val clock = new TestClock(baseInstant)

  private val Day = 86400L

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db      = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    root    = newTempDir("helio-hel1531-rearm")
    fs      = new FlakyFileSystem(new LocalFileSystem(root))
    repo    = new StoredObjectDeletionRepository(new DbContext(db, db))
    service = new StoredObjectDeletionService(repo, fs, clock)
  }

  /** Each test starts from an empty queue, so a row left by one test (e.g. a re-armed, now-due one) is never
   *  claimed by the next test's pass. */
  override def beforeEach(): Unit = {
    super.beforeEach()
    sql(sqlu"DELETE FROM stored_object_deletions")
    clock.instant = baseInstant
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

  private def freshKey(): String            = s"images/${UUID.randomUUID()}.png"
  private def object_(key: String): String  = { await(fs.write(key, "x".getBytes(StandardCharsets.UTF_8))); key }
  private def present(key: String): Boolean = Files.exists(root.resolve(key))
  private def ts(i: Instant): Timestamp     = Timestamp.from(i)

  private def image(owner: String, key: String): String = {
    val id = UUID.randomUUID().toString
    sql(sqlu"""INSERT INTO image_uploads (id, owner_id, storage_key, mime_type, filename, size_bytes)
               VALUES ($id, $owner::uuid, $key, 'image/png', 'a.png', 1)""")
    id
  }

  /** A queued, unreferenced object. LEGACY: an `image_uploads` delete (V128 trigger, `not_before` null).
   *  NEW-STYLE: `enqueue`, which yields the same shape as V132's triggers (`not_before` set, `claimed_at = infinity`). */
  private def queue(legacy: Boolean): String = {
    val key = object_(freshKey())
    if (legacy) {
      val id = image(newUser(), key)
      sql(sqlu"DELETE FROM image_uploads WHERE id = $id")
    } else await(repo.enqueue(Seq(key), "test", clock.now().minusSeconds(10)))
    key
  }

  private def cap(key: String, lastAttempt: Option[Instant]): Unit =
    sql(sqlu"UPDATE stored_object_deletions SET attempts = 10, last_attempt_at = ${lastAttempt.map(ts)} WHERE storage_key = $key")

  /** `(attempts, claimed_at = infinity, claimed_at IS NULL, not_before IS NOT NULL, lease_until IS NOT NULL)`. */
  private def state(key: String): Vector[(Int, Boolean, Boolean, Boolean, Boolean)] =
    await(db.run(sql"""SELECT attempts, claimed_at = 'infinity', claimed_at IS NULL, not_before IS NOT NULL, lease_until IS NOT NULL
                       FROM stored_object_deletions WHERE storage_key = $key""".as[(Int, Boolean, Boolean, Boolean, Boolean)])).toVector

  for ((label, legacy) <- Seq("legacy (V128)" -> true, "new-style (V132)" -> false)) {
    s"a capped $label row" should {

      "stay stuck one minute inside the 24 h cool-down" in {
        val key = queue(legacy)
        cap(key, Some(clock.now().minusSeconds(Day - 60)))
        pass() shouldBe 0
        present(key) shouldBe true
        state(key).map(_._1) shouldBe Vector(10)
      }

      "be re-armed and deleted one minute past the 24 h cool-down" in {
        val key = queue(legacy)
        cap(key, Some(clock.now().minusSeconds(Day + 60)))
        pass() shouldBe 1
        present(key) shouldBe false
        state(key) shouldBe empty
      }

      "reset attempts and clear the lease on re-arm, keeping the row kind (claimed_at stays infinity for new-style)" in {
        val key = queue(legacy)
        cap(key, Some(clock.now().minusSeconds(Day + 60)))
        sql(sqlu"UPDATE stored_object_deletions SET lease_until = ${ts(clock.now().plusSeconds(500))} WHERE storage_key = $key")
        await(repo.rearm(clock.now().minusSeconds(Day), 10)) should be >= 1
        // (attempts, claimed_at infinity, claimed_at null, not_before set, lease set)
        state(key) shouldBe Vector((0, !legacy, legacy, !legacy, false))
      }

      "stay stuck when it has no last attempt (hand SQL only), however old" in {
        val key = queue(legacy)
        cap(key, None)
        pass() shouldBe 0
        present(key) shouldBe true
        state(key).map(_._1) shouldBe Vector(10)
      }

      "keep the object when the re-armed key is still referenced" in {
        val key = queue(legacy)
        image(newUser(), key) // an image_uploads row holds the key again: authoritative reference
        cap(key, Some(clock.now().minusSeconds(Day + 60)))
        pass() shouldBe 0
        present(key) shouldBe true
        state(key) shouldBe empty
      }

      "reach the cap again when the delete keeps failing, then wait out another cool-down" in {
        val key = queue(legacy)
        cap(key, Some(clock.now().minusSeconds(Day + 60)))
        val start = clock.now()
        fs.failDelete = true
        try {
          (1 to 10).foreach { i =>
            clock.instant = start.plusSeconds(i * 7200L) // past the 1 h backoff cap each time, inside 24 h
            pass() shouldBe 0
            state(key).map(_._1) shouldBe Vector(i)
          }
          clock.instant = start.plusSeconds(11 * 7200L)
          pass() shouldBe 0
          state(key).map(_._1) shouldBe Vector(10)
        } finally { fs.failDelete = false; clock.instant = start }
        present(key) shouldBe true
      }
    }
  }
}
