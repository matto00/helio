package com.helio.services.auth

import com.helio.domain.model.UserId
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.assistant.AssistantDailyUsageRepository
import com.helio.infrastructure.persistence.auth.UserRepository
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

/** HEL-1108 (design.md D7, tasks.md 3.2b): the tier semantics [[AiPipelineQuotaGate.Live]] must
 *  inherit from `ChatAccessService`'s machinery, verified directly over a real Postgres --
 *  `owner` uncounted, `beta` increments (or denies at cap), a configured limit below 1 "always
 *  capped" with NO database write. Separated from the wiring proof (design-gate N13) so a
 *  half-done gate implementation can't read as complete from wiring evidence alone. */
class AiPipelineQuotaGateSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var userRepo: UserRepository           = _
  private var usageRepo: AssistantDailyUsageRepository = _

  private val ownerUser = UserId(UUID.randomUUID().toString)
  private val betaUser  = UserId(UUID.randomUUID().toString)
  private val freeUser  = UserId(UUID.randomUUID().toString)

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    userRepo  = new UserRepository(db)
    usageRepo = new AssistantDailyUsageRepository(new DbContext(db, db))

    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at, tier)
             VALUES (${ownerUser.value}::uuid, ${s"${ownerUser.value}@test.local"}, now(), 'owner')""",
      sqlu"""INSERT INTO users (id, email, created_at, tier)
             VALUES (${betaUser.value}::uuid, ${s"${betaUser.value}@test.local"}, now(), 'beta')""",
      sqlu"""INSERT INTO users (id, email, created_at, tier)
             VALUES (${freeUser.value}::uuid, ${s"${freeUser.value}@test.local"}, now(), 'free')"""
    )))
  }

  override def afterAll(): Unit = { db.close(); embeddedPostgres.close() }

  private def cleanUsage(): Unit = await(db.run(sqlu"TRUNCATE TABLE assistant_daily_usage"))

  private def countFor(owner: UserId): Option[Int] = {
    val today = LocalDate.now(ZoneOffset.UTC).toString
    await(db.run(
      sql"""SELECT message_count FROM assistant_daily_usage
            WHERE user_id = ${owner.value}::uuid AND usage_date = $today::date"""
        .as[Int]
        .headOption
    ))
  }

  private def gate(limit: Int): AiPipelineQuotaGate =
    new AiPipelineQuotaGate.Live(userRepo, usageRepo, UserTierConfig(ownerEmails = Set.empty, betaDailyMessageLimit = limit))

  "AiPipelineQuotaGate.Live.checkAndIncrement" should {

    "never counts an owner-tier pipeline owner -- permits with no DB write" in {
      cleanUsage()
      val result = await(gate(limit = 5).checkAndIncrement(ownerUser))
      result shouldBe Right(())
      countFor(ownerUser) shouldBe None
    }

    "increments a beta-tier owner's daily count and permits under the cap" in {
      cleanUsage()
      val result = await(gate(limit = 5).checkAndIncrement(betaUser))
      result shouldBe Right(())
      countFor(betaUser) shouldBe Some(1)
    }

    "denies a beta-tier owner once the daily cap is reached" in {
      cleanUsage()
      val g = gate(limit = 1)
      await(g.checkAndIncrement(betaUser)) shouldBe Right(())
      val second = await(g.checkAndIncrement(betaUser))
      second shouldBe Left(1)
      countFor(betaUser) shouldBe Some(1)
    }

    "denies a free-tier pipeline owner with no DB write" in {
      cleanUsage()
      val result = await(gate(limit = 5).checkAndIncrement(freeUser))
      result shouldBe Left(5)
      countFor(freeUser) shouldBe None
    }

    "a configured limit below 1 is 'always capped' -- denies a beta owner with no DB write" in {
      cleanUsage()
      val result = await(gate(limit = 0).checkAndIncrement(betaUser))
      result shouldBe Left(0)
      countFor(betaUser) shouldBe None
    }
  }
}
