package com.helio.infrastructure.persistence.pipelines

import com.helio.domain.model.{PipelineId, UserId}
import com.helio.infrastructure.persistence.DbContext
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import com.helio.testkit.VerifiedEmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1093 tasks.md 1.3/3.5: `PipelineAutoRunDebounceRepository` (V110) -- the forward-only
 *  UPSERT (design.md Decision 2), the atomic claim (design.md Decision 3 step 1 -- the
 *  exclusivity primitive the owner's ruling requires), the compare-and-delete release (Decision 3
 *  step 4), and the RLS probe. Mirrors `PipelineRunGuardRepositorySpec`'s exact dual-pool harness
 *  (`AssistantDailyUsageRepositorySpec`'s pattern) so the RLS assertions run against a genuine
 *  non-BYPASSRLS app-pool role, not the Postgres superuser Flyway migrates as (which bypasses RLS
 *  regardless of FORCE ROW LEVEL SECURITY). */
class PipelineAutoRunDebounceRepositorySpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var privilegedDb: JdbcBackend.Database = _ // postgres superuser
  private var appDb: JdbcBackend.Database         = _ // helio_app_test (non-superuser)
  private var ctx: DbContext                      = _
  private var repo: PipelineAutoRunDebounceRepository = _

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))

    val superDs   = embeddedPostgres.getPostgresDatabase
    val superJdbc = embeddedPostgres.getJdbcUrl("postgres", "postgres")
    Flyway.configure()
      .dataSource(superJdbc, "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()

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

    val appCfg = new HikariConfig()
    appCfg.setDataSource(superDs)
    appCfg.setMaximumPoolSize(10)
    appCfg.setConnectionInitSql("SET ROLE helio_app_test")
    appDb = JdbcBackend.Database.forDataSource(new HikariDataSource(appCfg), Some(10))

    ctx  = new DbContext(appDb, privilegedDb)
    repo = new PipelineAutoRunDebounceRepository(ctx)
  }

  override def afterAll(): Unit = {
    appDb.close(); privilegedDb.close(); embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def cleanDb(): Unit = {
    await(ctx.withSystemContext(DBIO.seq(
      sqlu"DELETE FROM pipeline_auto_run_debounce",
      sqlu"DELETE FROM pipelines",
      sqlu"DELETE FROM users"
    )))
  }

  /** Seeds a fresh owner + pipeline (no roots/steps needed -- this spec never runs the pipeline,
   *  only exercises the debounce table's own FK/RLS). */
  private def seedPipeline(owner: UserId = UserId(UUID.randomUUID().toString)): PipelineId = {
    val pid = UUID.randomUUID().toString
    await(ctx.withSystemContext(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at)
             VALUES (${owner.value}::uuid, ${s"${owner.value}@test.local"}, now())
             ON CONFLICT DO NOTHING""",
      sqlu"""INSERT INTO pipelines (id, name, owner_id, created_at, updated_at)
             VALUES ($pid, 'pipe', ${owner.value}::uuid, now(), now())"""
    )))
    PipelineId(pid)
  }

  private def rawFireAt(pipelineId: PipelineId): Option[Instant] =
    await(ctx.withSystemContext(
      sql"""SELECT fire_at FROM pipeline_auto_run_debounce WHERE pipeline_id = ${pipelineId.value}"""
        .as[Timestamp].headOption
    )).map(_.toInstant)

  private def rawClaimedAt(pipelineId: PipelineId): Option[Instant] =
    await(ctx.withSystemContext(
      sql"""SELECT claimed_at FROM pipeline_auto_run_debounce WHERE pipeline_id = ${pipelineId.value}"""
        .as[Option[Timestamp]].headOption
    )).flatten.map(_.toInstant)

  "upsertDebounce" should {

    "creates a new row with the given fire_at and claimed_at = NULL" in {
      cleanDb()
      val pid = seedPipeline()
      val fireAt = Instant.parse("2026-01-01T00:00:05Z")
      await(repo.upsertDebounce(pid, fireAt))

      rawFireAt(pid) shouldBe Some(fireAt)
      rawClaimedAt(pid) shouldBe None
    }

    "pushes fire_at forward (GREATEST) on a later write, never backward on an earlier one" in {
      cleanDb()
      val pid = seedPipeline()
      await(repo.upsertDebounce(pid, Instant.parse("2026-01-01T00:00:05Z")))
      await(repo.upsertDebounce(pid, Instant.parse("2026-01-01T00:00:10Z")))
      rawFireAt(pid) shouldBe Some(Instant.parse("2026-01-01T00:00:10Z"))

      // An earlier write (out-of-order delivery across instances) must never move fire_at backward.
      await(repo.upsertDebounce(pid, Instant.parse("2026-01-01T00:00:01Z")))
      rawFireAt(pid) shouldBe Some(Instant.parse("2026-01-01T00:00:10Z"))
    }

    "resets claimed_at to NULL on every write, including a write arriving after a claim" in {
      cleanDb()
      val pid = seedPipeline()
      val now = Instant.parse("2026-01-01T00:00:05Z")
      await(repo.upsertDebounce(pid, now))
      await(repo.claimDue(now, staleClaimAfter = now.minusSeconds(300)))
      rawClaimedAt(pid) shouldBe defined

      await(repo.upsertDebounce(pid, now.plusSeconds(5)))
      rawClaimedAt(pid) shouldBe None
    }
  }

  "claimDue" should {

    "claims a due, unclaimed row and returns its pipeline id + the claimed_at token it wrote" in {
      cleanDb()
      val pid = seedPipeline()
      val fireAt = Instant.parse("2026-01-01T00:00:00Z")
      await(repo.upsertDebounce(pid, fireAt))

      val now = fireAt.plusSeconds(1)
      val claimed = await(repo.claimDue(now, staleClaimAfter = now.minusSeconds(300)))

      claimed.map(_._1) shouldBe Vector(pid)
      claimed.head._2 shouldBe rawClaimedAt(pid).get
    }

    "does not claim a row that is not yet due" in {
      cleanDb()
      val pid = seedPipeline()
      val fireAt = Instant.parse("2026-01-01T00:01:00Z")
      await(repo.upsertDebounce(pid, fireAt))

      val now = fireAt.minusSeconds(30)
      await(repo.claimDue(now, staleClaimAfter = now.minusSeconds(300))) shouldBe empty
    }

    "does not re-claim a row whose existing claim is fresh (not stale) -- the exclusivity " +
      "primitive: two concurrent claims cannot both win" in {
      cleanDb()
      val pid = seedPipeline()
      val fireAt = Instant.parse("2026-01-01T00:00:00Z")
      await(repo.upsertDebounce(pid, fireAt))
      val firstClaimAt = fireAt.plusSeconds(1)
      await(repo.claimDue(firstClaimAt, staleClaimAfter = firstClaimAt.minusSeconds(300))) should have size 1

      val secondNow = firstClaimAt.plusSeconds(1)
      await(repo.claimDue(secondNow, staleClaimAfter = secondNow.minusSeconds(300))) shouldBe empty
    }

    "DOES re-claim a row whose existing claim is stale (self-healing fallback for a crashed process)" in {
      cleanDb()
      val pid = seedPipeline()
      val fireAt = Instant.parse("2026-01-01T00:00:00Z")
      await(repo.upsertDebounce(pid, fireAt))
      val firstClaimAt = fireAt.plusSeconds(1)
      await(repo.claimDue(firstClaimAt, staleClaimAfter = firstClaimAt.minusSeconds(300))) should have size 1
      // Never released (simulates a crash between claim and release).

      val muchLater = firstClaimAt.plusSeconds(600)
      val reclaimed = await(repo.claimDue(muchLater, staleClaimAfter = muchLater.minusSeconds(300)))
      reclaimed.map(_._1) shouldBe Vector(pid)
      reclaimed.head._2 should be > firstClaimAt
    }
  }

  "releaseClaim" should {

    "deletes the row when claimedAt matches exactly" in {
      cleanDb()
      val pid = seedPipeline()
      val fireAt = Instant.parse("2026-01-01T00:00:00Z")
      await(repo.upsertDebounce(pid, fireAt))
      val now = fireAt.plusSeconds(1)
      val claimed = await(repo.claimDue(now, staleClaimAfter = now.minusSeconds(300)))
      val (claimedPid, claimedAt) = claimed.head

      await(repo.releaseClaim(claimedPid, claimedAt))
      rawFireAt(pid) shouldBe None
    }

    "does NOT delete the row when claimedAt no longer matches -- a fresh write reset it mid-fire " +
      "(design.md Decision 3 step 4's own load-bearing case)" in {
      cleanDb()
      val pid = seedPipeline()
      val fireAt = Instant.parse("2026-01-01T00:00:00Z")
      await(repo.upsertDebounce(pid, fireAt))
      val now = fireAt.plusSeconds(1)
      val claimed = await(repo.claimDue(now, staleClaimAfter = now.minusSeconds(300)))
      val (claimedPid, staleClaimedAt) = claimed.head

      // A new write arrives DURING the fire, between claim and release -- resets claimed_at to
      // NULL and pushes fire_at forward (upsertDebounce's own contract).
      await(repo.upsertDebounce(pid, now.plusSeconds(10)))

      // The release, still carrying the OLD claimedAt token, must match zero rows.
      await(repo.releaseClaim(claimedPid, staleClaimedAt))

      // The fresh pending write must survive -- not silently discarded.
      rawFireAt(pid) shouldBe Some(now.plusSeconds(10))
      rawClaimedAt(pid) shouldBe None
    }
  }

  private def rawRetryCount(pipelineId: PipelineId): Option[Int] =
    await(ctx.withSystemContext(
      sql"""SELECT guard_retry_count FROM pipeline_auto_run_debounce WHERE pipeline_id = ${pipelineId.value}""".as[Int].headOption
    ))

  private def claimOne(pid: PipelineId, fireAt: Instant): Instant = {
    await(repo.upsertDebounce(pid, fireAt))
    val now = fireAt.plusSeconds(1)
    await(repo.claimDue(now, staleClaimAfter = now.minusSeconds(300))).head._2
  }

  "unclaim (HEL-1504 D1)" should {

    "hands the claim back without deleting the row: claimed_at NULL, fire_at and retry count untouched" in {
      cleanDb()
      val pid = seedPipeline()
      val fireAt = Instant.parse("2026-01-01T00:00:00Z")
      val claimedAt = claimOne(pid, fireAt)

      await(repo.unclaim(pid, claimedAt))
      rawFireAt(pid) shouldBe Some(fireAt)
      rawClaimedAt(pid) shouldBe None
      rawRetryCount(pid) shouldBe Some(0)
      // Immediately re-claimable on the next tick.
      await(repo.claimDue(fireAt.plusSeconds(2), staleClaimAfter = fireAt.minusSeconds(300))).map(_._1) shouldBe Vector(pid)
    }

    "is a harmless no-op on a token mismatch (a fresh write already reset the claim)" in {
      cleanDb()
      val pid = seedPipeline()
      val fireAt = Instant.parse("2026-01-01T00:00:00Z")
      val staleClaim = claimOne(pid, fireAt)
      await(repo.upsertDebounce(pid, fireAt.plusSeconds(10)))
      // Re-claim so a DIFFERENT live claim exists; the old token must not release it.
      val later = fireAt.plusSeconds(11)
      await(repo.claimDue(later, staleClaimAfter = later.minusSeconds(300))) should have size 1

      await(repo.unclaim(pid, staleClaim))
      rawClaimedAt(pid) shouldBe Some(later)
    }
  }

  "rearmAfterGuardRejection (HEL-1504 D2)" should {

    "re-arms: fire_at moved, claimed_at NULL, retry count incremented, until the allowance is spent" in {
      cleanDb()
      val pid = seedPipeline()
      val fireAt = Instant.parse("2026-01-01T00:00:00Z")
      val claim1 = claimOne(pid, fireAt)
      val retryAt = fireAt.plusSeconds(30)

      await(repo.rearmAfterGuardRejection(pid, claim1, retryAt, maxRetries = 2)) shouldBe RearmOutcome.Rearmed(1)
      rawFireAt(pid) shouldBe Some(retryAt)
      rawClaimedAt(pid) shouldBe None

      val now2 = retryAt.plusSeconds(1)
      val claim2 = await(repo.claimDue(now2, staleClaimAfter = now2.minusSeconds(300))).head._2
      await(repo.rearmAfterGuardRejection(pid, claim2, now2.plusSeconds(30), maxRetries = 2)) shouldBe RearmOutcome.Rearmed(2)

      val now3 = now2.plusSeconds(31)
      val claim3 = await(repo.claimDue(now3, staleClaimAfter = now3.minusSeconds(300))).head._2
      await(repo.rearmAfterGuardRejection(pid, claim3, now3.plusSeconds(30), maxRetries = 2)) shouldBe RearmOutcome.Exhausted(2)
      rawFireAt(pid) shouldBe None
    }

    "maxRetries = 0 never re-arms: the first rejection deletes the row" in {
      cleanDb()
      val pid = seedPipeline()
      val claim = claimOne(pid, Instant.parse("2026-01-01T00:00:00Z"))
      await(repo.rearmAfterGuardRejection(pid, claim, Instant.parse("2026-01-01T00:01:00Z"), maxRetries = 0)) shouldBe RearmOutcome.Exhausted(0)
      rawFireAt(pid) shouldBe None
    }

    "reports Superseded and changes nothing on a token mismatch" in {
      cleanDb()
      val pid = seedPipeline()
      val fireAt = Instant.parse("2026-01-01T00:00:00Z")
      val staleClaim = claimOne(pid, fireAt)
      await(repo.upsertDebounce(pid, fireAt.plusSeconds(10)))

      await(repo.rearmAfterGuardRejection(pid, staleClaim, fireAt.plusSeconds(99), maxRetries = 5)) shouldBe RearmOutcome.Superseded
      rawFireAt(pid) shouldBe Some(fireAt.plusSeconds(10))
      rawRetryCount(pid) shouldBe Some(0)
    }

    "a fresh write resets the retry count to 0 (D3)" in {
      cleanDb()
      val pid = seedPipeline()
      val fireAt = Instant.parse("2026-01-01T00:00:00Z")
      val claim = claimOne(pid, fireAt)
      await(repo.rearmAfterGuardRejection(pid, claim, fireAt.plusSeconds(30), maxRetries = 5)) shouldBe RearmOutcome.Rearmed(1)
      rawRetryCount(pid) shouldBe Some(1)

      await(repo.upsertDebounce(pid, fireAt.plusSeconds(5)))
      rawRetryCount(pid) shouldBe Some(0)
      // GREATEST: the write during the Retry-After wait never pulls the fire earlier than the retry.
      rawFireAt(pid) shouldBe Some(fireAt.plusSeconds(30))
    }
  }

  "RLS (HEL-1093 tasks.md 3.5)" should {

    "FORCE ROW LEVEL SECURITY: a non-owning user's app-pool query sees zero rows for another " +
      "user's pipeline's debounce row" in {
      cleanDb()
      val ownerA = UserId(UUID.randomUUID().toString)
      val ownerB = UserId(UUID.randomUUID().toString)
      val pid = seedPipeline(ownerA)
      await(repo.upsertDebounce(pid, Instant.now().plusSeconds(5)))
      await(ctx.withSystemContext(
        sqlu"""INSERT INTO users (id, email, created_at)
               VALUES (${ownerB.value}::uuid, ${s"${ownerB.value}@test.local"}, now())
               ON CONFLICT DO NOTHING"""
      ))

      val rowsVisible = await(ctx.withUserContext(ownerB.value)(
        sql"""SELECT pipeline_id FROM pipeline_auto_run_debounce WHERE pipeline_id = ${pid.value}""".as[String]
      ))
      rowsVisible shouldBe empty

      // withSystemContext (privileged pool) sees the row regardless of owner -- confirms the
      // negative result above is RLS filtering, not a genuinely-missing row.
      val rowsPrivileged = await(ctx.withSystemContext(
        sql"""SELECT pipeline_id FROM pipeline_auto_run_debounce WHERE pipeline_id = ${pid.value}""".as[String]
      ))
      rowsPrivileged shouldBe Vector(pid.value)
    }
  }
}
