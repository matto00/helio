package com.helio.infrastructure

import com.helio.domain._
import com.helio.infrastructure.AssistantConversationRepository.AssistantConversationRecord
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-663 tasks.md 6.6/6.7 — `AssistantConversationRepository` CRUD round-trip PLUS real Postgres
 *  RLS enforcement (not app-layer-only scoping, and not the privileged/BYPASSRLS pool): a second,
 *  non-superuser-role user genuinely cannot list or read the first user's conversations. Mirrors
 *  `AuthoringConversationRepositorySpec`'s exact dual-pool harness — a real `helio_app_test` role
 *  (NOT BYPASSRLS) the app pool `SET ROLE`s into, so the V80 policy is actually evaluated, not
 *  skipped by a superuser connection. */
class AssistantConversationRepositorySpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var privilegedDb: JdbcBackend.Database = _ // postgres superuser
  private var appDb: JdbcBackend.Database         = _ // helio_app_test (non-superuser)
  private var ctx: DbContext                      = _
  private var repo: AssistantConversationRepository = _

  private val ownerA = UserId(UUID.randomUUID().toString)
  private val ownerB = UserId(UUID.randomUUID().toString)

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()

    val superDs   = embeddedPostgres.getPostgresDatabase
    val superJdbc = embeddedPostgres.getJdbcUrl("postgres", "postgres")
    Flyway
      .configure()
      .dataSource(superJdbc, "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()

    import com.zaxxer.hikari.{HikariConfig, HikariDataSource}

    val privCfg = new HikariConfig()
    privCfg.setDataSource(superDs)
    privCfg.setMaximumPoolSize(5)
    privCfg.setConnectionInitSql("SET ROLE helio_privileged")
    privilegedDb = JdbcBackend.Database.forDataSource(new HikariDataSource(privCfg), Some(5))

    val superConn = superDs.getConnection
    try {
      val stmt = superConn.createStatement()
      stmt.execute(
        """DO $$ BEGIN
          |  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'helio_app_test') THEN
          |    CREATE ROLE helio_app_test NOSUPERUSER NOCREATEDB NOCREATEROLE NOLOGIN;
          |  END IF;
          |END $$""".stripMargin
      )
      stmt.execute("GRANT helio_app_test TO postgres")
      stmt.execute("GRANT USAGE ON SCHEMA public TO helio_app_test")
      stmt.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO helio_app_test")
      stmt.execute("GRANT USAGE ON SCHEMA public TO helio_privileged")
      stmt.execute("GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public TO helio_privileged")
      stmt.execute("GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO helio_privileged")
      stmt.close()
    } finally {
      superConn.close()
    }

    val appCfg = new HikariConfig()
    appCfg.setDataSource(superDs)
    appCfg.setMaximumPoolSize(5)
    appCfg.setConnectionInitSql("SET ROLE helio_app_test")
    appDb = JdbcBackend.Database.forDataSource(new HikariDataSource(appCfg), Some(5))

    ctx  = new DbContext(appDb, privilegedDb)
    repo = new AssistantConversationRepository(ctx)

    await(ctx.withSystemContext(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at)
             VALUES (${ownerA.value}::uuid, ${s"${ownerA.value}@test.local"}, now())
             ON CONFLICT DO NOTHING""",
      sqlu"""INSERT INTO users (id, email, created_at)
             VALUES (${ownerB.value}::uuid, ${s"${ownerB.value}@test.local"}, now())
             ON CONFLICT DO NOTHING"""
    )))
  }

  override def afterAll(): Unit = {
    appDb.close()
    privilegedDb.close()
    embeddedPostgres.close()
    super.afterAll()
  }

  private def cleanDb(): Unit =
    await(ctx.withSystemContext(sqlu"TRUNCATE TABLE assistant_conversations"))

  private def newRecord(
      owner: UserId,
      title: String = "Untitled",
      pinned: Boolean = false,
      updatedAt: Instant = Instant.now()
  ): AssistantConversationRecord = {
    val id = AssistantConversationId(UUID.randomUUID().toString)
    AssistantConversationRecord(
      id         = id,
      ownerId    = owner,
      title      = title,
      pinned     = pinned,
      gcsBodyRef = s"assistant-conversations/${owner.value}/${id.value}.json",
      createdAt  = updatedAt,
      updatedAt  = updatedAt
    )
  }

  "AssistantConversationRepository" should {

    "create then findById round-trips every field for the owner" in {
      cleanDb()
      val record = newRecord(ownerA, title = "Sales chat")
      await(repo.create(record))

      val found = await(repo.findById(record.id, ownerA))
      found shouldBe defined
      found.get.id         shouldBe record.id
      found.get.ownerId    shouldBe ownerA
      found.get.title      shouldBe "Sales chat"
      found.get.pinned     shouldBe false
      found.get.gcsBodyRef shouldBe record.gcsBodyRef
      found.get.lastIdempotencyKey shouldBe None
    }

    "findById returns None for an unknown id" in {
      cleanDb()
      val result = await(repo.findById(AssistantConversationId(UUID.randomUUID().toString), ownerA))
      result shouldBe None
    }

    // ── The real RLS assertions (not app-layer-only scoping) ────────────────

    "findById run as a second user CANNOT see the first user's conversation (real Postgres RLS)" in {
      cleanDb()
      val record = newRecord(ownerA)
      await(repo.create(record))

      val foundByOwner    = await(repo.findById(record.id, ownerA))
      val foundByNonOwner = await(repo.findById(record.id, ownerB))

      foundByOwner shouldBe defined
      foundByNonOwner shouldBe None
    }

    "findAll run as a second user CANNOT list the first user's conversations (real Postgres RLS)" in {
      cleanDb()
      await(repo.create(newRecord(ownerA)))
      await(repo.create(newRecord(ownerA)))
      await(repo.create(newRecord(ownerB)))

      val listedByOwner    = await(repo.findAll(ownerA, 10))
      val listedByNonOwner = await(repo.findAll(ownerB, 10))

      listedByOwner should have size 2
      listedByNonOwner should have size 1
      listedByNonOwner.map(_.ownerId) should contain only ownerB
    }

    "updatePinned run as a second user CANNOT pin the first user's conversation (real Postgres RLS) and leaves the row unchanged" in {
      cleanDb()
      val record = newRecord(ownerA, pinned = false)
      await(repo.create(record))

      val attackResult = await(repo.updatePinned(record.id, ownerB, pinned = true))
      attackResult shouldBe None

      val stillOwnedByOriginal = await(repo.findById(record.id, ownerA))
      stillOwnedByOriginal shouldBe defined
      stillOwnedByOriginal.get.pinned shouldBe false
    }

    "updatePinned run as the owner flips pinned" in {
      cleanDb()
      val record = newRecord(ownerA, pinned = false)
      await(repo.create(record))

      val updated = await(repo.updatePinned(record.id, ownerA, pinned = true))
      updated shouldBe defined
      updated.get.pinned shouldBe true
    }

    "updatePinned returns None for an unknown id" in {
      cleanDb()
      val result = await(repo.updatePinned(AssistantConversationId(UUID.randomUUID().toString), ownerA, pinned = true))
      result shouldBe None
    }

    "updateTitle run as the owner renames the conversation" in {
      cleanDb()
      val record = newRecord(ownerA, title = "Old title")
      await(repo.create(record))

      val updated = await(repo.updateTitle(record.id, ownerA, "New title"))
      updated shouldBe defined
      updated.get.title shouldBe "New title"
    }

    "updateTitle run as a second user CANNOT rename the first user's conversation (real Postgres RLS)" in {
      cleanDb()
      val record = newRecord(ownerA, title = "Original")
      await(repo.create(record))

      val attackResult = await(repo.updateTitle(record.id, ownerB, "Hijacked"))
      attackResult shouldBe None

      val stillOwnedByOriginal = await(repo.findById(record.id, ownerA))
      stillOwnedByOriginal.get.title shouldBe "Original"
    }

    "touchUpdatedAt updates gcs_body_ref and bumps updated_at" in {
      cleanDb()
      val initialUpdatedAt = Instant.now().minus(1, ChronoUnit.HOURS)
      val record = newRecord(ownerA, updatedAt = initialUpdatedAt)
      await(repo.create(record))

      val newRef = s"${record.gcsBodyRef}.new"
      val updated = await(repo.touchUpdatedAt(record.id, ownerA, newRef))
      updated shouldBe defined
      updated.get.gcsBodyRef shouldBe newRef
      updated.get.updatedAt.isAfter(initialUpdatedAt) shouldBe true
    }

    "touchUpdatedAt returns None for an unknown id" in {
      cleanDb()
      val result = await(repo.touchUpdatedAt(AssistantConversationId(UUID.randomUUID().toString), ownerA, "some/path.json"))
      result shouldBe None
    }

    // ── HEL-698 idempotency key (design.md D2/D3) ──────────────────────────

    "touchUpdatedAt with a Some key persists it in the same update as gcs_body_ref/updated_at" in {
      cleanDb()
      val record = newRecord(ownerA)
      await(repo.create(record))

      val newRef = s"${record.gcsBodyRef}.new"
      val updated = await(repo.touchUpdatedAt(record.id, ownerA, newRef, Some("key-1")))
      updated shouldBe defined
      updated.get.lastIdempotencyKey shouldBe Some("key-1")
      updated.get.gcsBodyRef shouldBe newRef
    }

    "touchUpdatedAt with a None key leaves a previously-set idempotency key untouched" in {
      cleanDb()
      val record = newRecord(ownerA)
      await(repo.create(record))
      await(repo.touchUpdatedAt(record.id, ownerA, record.gcsBodyRef, Some("key-1")))

      val newRef = s"${record.gcsBodyRef}.newer"
      val updated = await(repo.touchUpdatedAt(record.id, ownerA, newRef, None))
      updated shouldBe defined
      updated.get.lastIdempotencyKey shouldBe Some("key-1")
      updated.get.gcsBodyRef shouldBe newRef
    }

    // ── List ordering (design.md D1/D5 — `ORDER BY pinned DESC, updated_at DESC`) ───────────────

    "findAll orders a pinned-but-older conversation before an unpinned-but-newer one" in {
      cleanDb()
      val now = Instant.now()
      val pinnedOlder   = newRecord(ownerA, title = "Pinned older", pinned = true, updatedAt = now.minusSeconds(3600))
      val unpinnedNewer = newRecord(ownerA, title = "Unpinned newer", pinned = false, updatedAt = now)
      await(repo.create(pinnedOlder))
      await(repo.create(unpinnedNewer))

      val listed = await(repo.findAll(ownerA, 10))
      listed.map(_.id) shouldBe Vector(pinnedOlder.id, unpinnedNewer.id)
    }

    "findAll caps at the given limit, pinned-first then most-recent-first, for a user with more rows than the limit" in {
      cleanDb()
      val now = Instant.now()
      val records = (1 to 12).map(i => newRecord(ownerA, title = s"conv-$i", updatedAt = now.plusSeconds(i.toLong)))
      records.foreach(r => await(repo.create(r)))

      val listed = await(repo.findAll(ownerA, 10))
      listed should have size 10
      // Most-recently-updated first among the (all-unpinned) set.
      listed.map(_.id) shouldBe records.reverse.take(10).map(_.id)
    }

    "withSystemContext (privileged pool) sees a conversation regardless of owner" in {
      cleanDb()
      val record = newRecord(ownerA)
      await(repo.create(record))

      val rows = await(ctx.withSystemContext(sql"SELECT id FROM assistant_conversations".as[String]))
      rows should contain(record.id.value)
    }
  }
}
