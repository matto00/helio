package com.helio.infrastructure

import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.assistant.AssistantDailyUsageRepository
import com.helio.domain.model._
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import java.time.{LocalDate, ZoneOffset}
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-703 tasks.md 6.5 — `AssistantDailyUsageRepository.incrementIfUnderCap`'s atomic
 *  increment-or-deny behavior (cap boundary exact, concurrent increments never exceed the limit,
 *  per-UTC-day keying) PLUS real Postgres RLS enforcement on `assistant_daily_usage` (design.md
 *  D5). Mirrors `AssistantConversationRepositorySpec`'s exact dual-pool harness (a real
 *  `helio_app_test` role the app pool `SET ROLE`s into, NOT BYPASSRLS). */
class AssistantDailyUsageRepositorySpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres        = _
  private var privilegedDb: JdbcBackend.Database        = _ // postgres superuser
  private var appDb: JdbcBackend.Database                = _ // helio_app_test (non-superuser)
  private var ctx: DbContext                             = _
  private var repo: AssistantDailyUsageRepository        = _

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
    privCfg.setMaximumPoolSize(10)
    privCfg.setConnectionInitSql("SET ROLE helio_privileged")
    privilegedDb = JdbcBackend.Database.forDataSource(new HikariDataSource(privCfg), Some(10))

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

    // A larger pool than the other RLS specs' default (10, not 5) -- the concurrency test below
    // fires several `incrementIfUnderCap` calls in parallel and each briefly holds a connection.
    val appCfg = new HikariConfig()
    appCfg.setDataSource(superDs)
    appCfg.setMaximumPoolSize(10)
    appCfg.setConnectionInitSql("SET ROLE helio_app_test")
    appDb = JdbcBackend.Database.forDataSource(new HikariDataSource(appCfg), Some(10))

    ctx  = new DbContext(appDb, privilegedDb)
    repo = new AssistantDailyUsageRepository(ctx)

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
  }

  private def cleanDb(): Unit = await(ctx.withSystemContext(sqlu"TRUNCATE TABLE assistant_daily_usage"))

  private def countFor(owner: UserId): Option[Int] = {
    val today = LocalDate.now(ZoneOffset.UTC).toString
    await(ctx.withSystemContext(
      sql"""SELECT message_count FROM assistant_daily_usage
            WHERE user_id = ${owner.value}::uuid AND usage_date = $today::date"""
        .as[Int]
        .headOption
    ))
  }

  "AssistantDailyUsageRepository.incrementIfUnderCap" should {

    "allows the first message of the day and persists message_count = 1" in {
      cleanDb()
      val result = await(repo.incrementIfUnderCap(ownerA, limit = 5))
      result shouldBe true
      countFor(ownerA) shouldBe Some(1)
    }

    "denies immediately (no row written) when limit is 0 -- 'always capped' (design.md D6)" in {
      cleanDb()
      val result = await(repo.incrementIfUnderCap(ownerA, limit = 0))
      result shouldBe false
      countFor(ownerA) shouldBe None
    }

    "denies immediately (no row written) when limit is negative" in {
      cleanDb()
      val result = await(repo.incrementIfUnderCap(ownerA, limit = -1))
      result shouldBe false
      countFor(ownerA) shouldBe None
    }

    "cap boundary is exact: allows exactly `limit` messages, denies the (limit+1)th" in {
      cleanDb()
      val limit = 3
      (1 to limit).foreach { n =>
        withClue(s"message #$n should be allowed: ") {
          await(repo.incrementIfUnderCap(ownerA, limit)) shouldBe true
        }
      }
      countFor(ownerA) shouldBe Some(limit)

      val overCap = await(repo.incrementIfUnderCap(ownerA, limit))
      overCap shouldBe false
      // Denial never increments -- the count stays exactly at the cap.
      countFor(ownerA) shouldBe Some(limit)
    }

    "concurrent increments never push the count above the limit" in {
      cleanDb()
      val limit = 5
      val attempts = 15
      val results = await(Future.sequence(Vector.fill(attempts)(repo.incrementIfUnderCap(ownerA, limit))))

      results.count(identity) shouldBe limit
      results.count(!_) shouldBe (attempts - limit)
      countFor(ownerA) shouldBe Some(limit)
    }

    "keys usage per UTC day -- yesterday's row is untouched by today's increment, and doesn't count toward today's cap" in {
      cleanDb()
      val yesterday = LocalDate.now(ZoneOffset.UTC).minusDays(1).toString
      await(ctx.withSystemContext(
        sqlu"""INSERT INTO assistant_daily_usage (user_id, usage_date, message_count)
               VALUES (${ownerA.value}::uuid, $yesterday::date, 999)"""
      ))

      // Today's cap is evaluated independently -- 999 yesterday doesn't block a limit of 1 today.
      val result = await(repo.incrementIfUnderCap(ownerA, limit = 1))
      result shouldBe true
      countFor(ownerA) shouldBe Some(1)

      val yesterdayCount = await(ctx.withSystemContext(
        sql"""SELECT message_count FROM assistant_daily_usage
              WHERE user_id = ${ownerA.value}::uuid AND usage_date = $yesterday::date"""
          .as[Int]
          .head
      ))
      yesterdayCount shouldBe 999
    }

    // ── RLS (design.md D5) ────────────────────────────────────────────────────────────────────

    "RLS: ownerB's context cannot see ownerA's daily usage row" in {
      cleanDb()
      await(repo.incrementIfUnderCap(ownerA, limit = 5))

      val today = LocalDate.now(ZoneOffset.UTC).toString
      val rows = await(ctx.withUserContext(ownerB.value)(
        sql"""SELECT user_id::text FROM assistant_daily_usage
              WHERE usage_date = $today::date""".as[String]
      ))
      rows shouldBe empty
    }

    "RLS: ownerB's context cannot increment/overwrite ownerA's daily usage row via a direct write" in {
      cleanDb()
      await(repo.incrementIfUnderCap(ownerA, limit = 5))
      val today = LocalDate.now(ZoneOffset.UTC).toString

      val updated = await(ctx.withUserContext(ownerB.value)(
        sqlu"""UPDATE assistant_daily_usage SET message_count = 999
               WHERE user_id = ${ownerA.value}::uuid AND usage_date = $today::date"""
      ))
      updated shouldBe 0
      countFor(ownerA) shouldBe Some(1)
    }

    "withSystemContext (privileged pool) sees the row regardless of owner" in {
      cleanDb()
      await(repo.incrementIfUnderCap(ownerA, limit = 5))
      val today = LocalDate.now(ZoneOffset.UTC).toString

      val rows = await(ctx.withSystemContext(
        sql"""SELECT user_id::text FROM assistant_daily_usage
              WHERE usage_date = $today::date""".as[String]
      ))
      rows should contain(ownerA.value)
    }
  }
}
