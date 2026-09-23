package com.helio.infrastructure.persistence.pipelines

import com.helio.infrastructure.persistence.DbContext
import com.helio.domain.model.UserId
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-505 tasks.md 2.1/8.2/8.4/9.1 — `PipelineRunGuardRepository.incrementRateIfUnderLimit`'s
 *  atomic increment-or-deny behavior (window boundary exact, concurrent increments never exceed
 *  the limit -- the closest feasible in-process approximation of the DB-backed guard's
 *  cross-instance correctness, since two real Cloud Run instances aren't available in a test
 *  harness) PLUS real Postgres RLS enforcement on `pipeline_run_rate_window` under the
 *  non-BYPASSRLS app pool. Mirrors `AssistantDailyUsageRepositorySpec`'s exact dual-pool harness. */
class PipelineRunGuardRepositorySpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var privilegedDb: JdbcBackend.Database  = _ // postgres superuser
  private var appDb: JdbcBackend.Database          = _ // helio_app_test (non-superuser)
  private var ctx: DbContext                       = _
  private var repo: PipelineRunGuardRepository     = _

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

    // A larger pool (10, not 5) -- the concurrency test below fires several
    // `incrementRateIfUnderLimit` calls in parallel and each briefly holds a connection.
    val appCfg = new HikariConfig()
    appCfg.setDataSource(superDs)
    appCfg.setMaximumPoolSize(10)
    appCfg.setConnectionInitSql("SET ROLE helio_app_test")
    appDb = JdbcBackend.Database.forDataSource(new HikariDataSource(appCfg), Some(10))

    ctx  = new DbContext(appDb, privilegedDb)
    repo = new PipelineRunGuardRepository(ctx)

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

  private def cleanDb(): Unit = await(ctx.withSystemContext(sqlu"TRUNCATE TABLE pipeline_run_rate_window"))

  private def countFor(owner: UserId, now: Instant, windowSeconds: Int): Option[Int] = {
    val bucketed = repo.bucketStart(now, windowSeconds)
    await(ctx.withSystemContext(
      sql"""SELECT request_count FROM pipeline_run_rate_window
            WHERE user_id = ${owner.value}::uuid AND window_start = ${java.sql.Timestamp.from(bucketed)}"""
        .as[Int]
        .headOption
    ))
  }

  "PipelineRunGuardRepository.incrementRateIfUnderLimit" should {

    "allows the first submission of the window and persists request_count = 1" in {
      cleanDb()
      val now = Instant.now()
      val result = await(repo.incrementRateIfUnderLimit(ownerA, limit = 5, windowSeconds = 60, now))
      result shouldBe Right(())
      countFor(ownerA, now, 60) shouldBe Some(1)
    }

    "denies immediately (no row written) when limit is 0 -- 'always capped'" in {
      cleanDb()
      val now = Instant.now()
      val result = await(repo.incrementRateIfUnderLimit(ownerA, limit = 0, windowSeconds = 60, now))
      result.isLeft shouldBe true
      countFor(ownerA, now, 60) shouldBe None
    }

    "denies immediately (no row written) when limit is negative" in {
      cleanDb()
      val now = Instant.now()
      val result = await(repo.incrementRateIfUnderLimit(ownerA, limit = -1, windowSeconds = 60, now))
      result.isLeft shouldBe true
      countFor(ownerA, now, 60) shouldBe None
    }

    "cap boundary is exact: allows exactly `limit` submissions, denies the (limit+1)th, with a positive Retry-After" in {
      cleanDb()
      val now   = Instant.now()
      val limit = 3
      (1 to limit).foreach { n =>
        withClue(s"submission #$n should be allowed: ") {
          await(repo.incrementRateIfUnderLimit(ownerA, limit, windowSeconds = 60, now)) shouldBe Right(())
        }
      }
      countFor(ownerA, now, 60) shouldBe Some(limit)

      val overCap = await(repo.incrementRateIfUnderLimit(ownerA, limit, windowSeconds = 60, now))
      overCap.isLeft shouldBe true
      overCap.left.toOption.get should be > 0L
      // Denial never increments -- the count stays exactly at the cap.
      countFor(ownerA, now, 60) shouldBe Some(limit)
    }

    "concurrent increments never push the count above the limit (cross-instance approximation)" in {
      cleanDb()
      val now       = Instant.now()
      val limit     = 5
      val attempts  = 15
      val results = await(Future.sequence(Vector.fill(attempts)(repo.incrementRateIfUnderLimit(ownerA, limit, windowSeconds = 60, now))))

      results.count(_.isRight) shouldBe limit
      results.count(_.isLeft) shouldBe (attempts - limit)
      countFor(ownerA, now, 60) shouldBe Some(limit)
    }

    "buckets by window: a submission in a NEW window bucket does not count toward the prior bucket's cap" in {
      cleanDb()
      val windowSeconds = 60
      val earlier = Instant.ofEpochSecond((Instant.now().getEpochSecond / windowSeconds) * windowSeconds - windowSeconds)
      val later   = earlier.plusSeconds(windowSeconds.toLong)

      await(repo.incrementRateIfUnderLimit(ownerA, limit = 1, windowSeconds, earlier)) shouldBe Right(())
      // The prior window is now at its cap -- but a submission bucketed into the NEXT window is a
      // fresh row, unaffected by the prior window's count.
      await(repo.incrementRateIfUnderLimit(ownerA, limit = 1, windowSeconds, earlier)).isLeft shouldBe true
      await(repo.incrementRateIfUnderLimit(ownerA, limit = 1, windowSeconds, later)) shouldBe Right(())

      countFor(ownerA, earlier, windowSeconds) shouldBe Some(1)
      countFor(ownerA, later, windowSeconds) shouldBe Some(1)
    }

    "a different user's budget is unaffected by another user's submissions" in {
      cleanDb()
      val now = Instant.now()
      (1 to 3).foreach(_ => await(repo.incrementRateIfUnderLimit(ownerA, limit = 3, windowSeconds = 60, now)))
      await(repo.incrementRateIfUnderLimit(ownerA, limit = 3, windowSeconds = 60, now)).isLeft shouldBe true

      // ownerB's own budget starts fresh, unaffected by ownerA's exhausted cap.
      await(repo.incrementRateIfUnderLimit(ownerB, limit = 3, windowSeconds = 60, now)) shouldBe Right(())
    }

    "RLS: ownerB's context cannot see ownerA's rate-window row" in {
      cleanDb()
      val now = Instant.now()
      await(repo.incrementRateIfUnderLimit(ownerA, limit = 5, windowSeconds = 60, now))

      val bucketed = repo.bucketStart(now, 60)
      val rows = await(ctx.withUserContext(ownerB.value)(
        sql"""SELECT user_id::text FROM pipeline_run_rate_window
              WHERE window_start = ${java.sql.Timestamp.from(bucketed)}""".as[String]
      ))
      rows shouldBe empty
    }

    "RLS: ownerB's context cannot increment/overwrite ownerA's rate-window row via a direct write" in {
      cleanDb()
      val now = Instant.now()
      await(repo.incrementRateIfUnderLimit(ownerA, limit = 5, windowSeconds = 60, now))
      val bucketed = repo.bucketStart(now, 60)

      val updated = await(ctx.withUserContext(ownerB.value)(
        sqlu"""UPDATE pipeline_run_rate_window SET request_count = 999
               WHERE user_id = ${ownerA.value}::uuid AND window_start = ${java.sql.Timestamp.from(bucketed)}"""
      ))
      updated shouldBe 0
      countFor(ownerA, now, 60) shouldBe Some(1)
    }

    "withSystemContext (privileged pool) sees the row regardless of owner" in {
      cleanDb()
      val now = Instant.now()
      await(repo.incrementRateIfUnderLimit(ownerA, limit = 5, windowSeconds = 60, now))
      val bucketed = repo.bucketStart(now, 60)

      val rows = await(ctx.withSystemContext(
        sql"""SELECT user_id::text FROM pipeline_run_rate_window
              WHERE window_start = ${java.sql.Timestamp.from(bucketed)}""".as[String]
      ))
      rows should contain(ownerA.value)
    }
  }

  "PipelineRunGuardRepository.cleanupOldWindows" should {

    "deletes rows older than the retention window and leaves recent rows untouched" in {
      cleanDb()
      val now = Instant.now()
      val old = now.minusSeconds(7200) // 2 hours ago
      await(repo.incrementRateIfUnderLimit(ownerA, limit = 5, windowSeconds = 60, old))
      await(repo.incrementRateIfUnderLimit(ownerB, limit = 5, windowSeconds = 60, now))

      val deleted = await(repo.cleanupOldWindows(retainSeconds = 3600, now = now))
      deleted shouldBe 1

      countFor(ownerA, old, 60) shouldBe None
      countFor(ownerB, now, 60) shouldBe Some(1)
    }
  }
}
