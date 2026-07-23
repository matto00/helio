package com.helio.infrastructure

import com.helio.domain._
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}

import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-414 — `PipelineScheduleRepository` CRUD, indirect-owner RLS scoping
 *  (via the parent pipeline's `owner_id`), and cascade-delete-on-pipeline. */
class PipelineScheduleRepositorySpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres    = _
  private var db: JdbcBackend.Database              = _
  private var scheduleRepo: PipelineScheduleRepository = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()
    db           = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    scheduleRepo = new PipelineScheduleRepository(new DbContext(db, db))
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  private val owner1Id = UUID.randomUUID().toString
  private val owner2Id = UUID.randomUUID().toString
  private val owner1   = UserId(owner1Id)
  private val owner2   = UserId(owner2Id)
  private val user1    = AuthenticatedUser(owner1)
  private val user2    = AuthenticatedUser(owner2)

  private def cleanDb(): Unit = {
    import PostgresProfile.api._
    await(db.run(sqlu"DELETE FROM pipeline_schedules"))
    await(db.run(sqlu"DELETE FROM pipelines"))
    await(db.run(sqlu"DELETE FROM data_sources"))
    await(db.run(sqlu"DELETE FROM data_types"))
    await(db.run(sqlu"DELETE FROM users"))
  }

  private def seedUsers(): Unit = {
    import PostgresProfile.api._
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($owner1Id::uuid, ${s"a-$owner1Id@helio.test"}, now())""",
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($owner2Id::uuid, ${s"b-$owner2Id@helio.test"}, now())"""
    )))
  }

  /** Seed a data source / data type / pipeline owned by `ownerId` and
   *  return the pipeline id — mirrors `PipelineStepRepositorySpec.seedPipeline`. */
  private def seedPipeline(ownerId: String): PipelineId = {
    import PostgresProfile.api._
    val dsId = UUID.randomUUID().toString
    val dtId = UUID.randomUUID().toString
    val pid  = UUID.randomUUID().toString
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources
               (id, name, source_type, config, owner_id, created_at, updated_at)
               VALUES ($dsId, 'ds', 'static', '{"columns":[],"rows":[]}', $ownerId::uuid, now(), now())""",
      sqlu"""INSERT INTO data_types
               (id, name, fields, version, owner_id, created_at, updated_at)
               VALUES ($dtId, 'dt', '[]', 1, $ownerId::uuid, now(), now())""",
      sqlu"""INSERT INTO pipelines
               (id, name, source_data_source_id, output_data_type_id, owner_id, created_at, updated_at)
               VALUES ($pid, 'pipe', $dsId, $dtId, $ownerId::uuid, now(), now())"""
    )))
    PipelineId(pid)
  }

  private def newSchedule(
      pipelineId: PipelineId,
      kind: ScheduleKind = ScheduleKind.Cron,
      expression: String = "*/5 * * * *",
      enabled: Boolean = true,
      timezone: String = "UTC"
  ): PipelineSchedule = {
    val now = Instant.now()
    PipelineSchedule(
      id         = PipelineScheduleId(UUID.randomUUID().toString),
      pipelineId = pipelineId,
      kind       = kind,
      expression = expression,
      enabled    = enabled,
      timezone   = timezone,
      nextRunAt  = None,
      lastRunAt  = None,
      createdAt  = now,
      updatedAt  = now
    )
  }

  "PipelineScheduleRepository" should {

    "upsert then findByPipelineId round-trips every field" in {
      cleanDb(); seedUsers()
      val pid = seedPipeline(owner1Id)
      val schedule = newSchedule(pid, kind = ScheduleKind.Interval, expression = "15m", timezone = "America/Los_Angeles")

      await(scheduleRepo.upsert(schedule, user1))
      val found = await(scheduleRepo.findByPipelineId(pid, user1))

      found shouldBe defined
      found.get.id shouldBe schedule.id
      found.get.pipelineId shouldBe pid
      found.get.kind shouldBe ScheduleKind.Interval
      found.get.expression shouldBe "15m"
      found.get.enabled shouldBe true
      found.get.timezone shouldBe "America/Los_Angeles"
      found.get.nextRunAt shouldBe None
      found.get.lastRunAt shouldBe None
    }

    "findByPipelineId returns None when no schedule exists" in {
      cleanDb(); seedUsers()
      val pid = seedPipeline(owner1Id)
      await(scheduleRepo.findByPipelineId(pid, user1)) shouldBe None
    }

    "findByPipelineId excludes a schedule on a pipeline owned by a different user (RLS scoping)" in {
      cleanDb(); seedUsers()
      val pid = seedPipeline(owner1Id)
      await(scheduleRepo.upsert(newSchedule(pid), user1))

      await(scheduleRepo.findByPipelineId(pid, user1)) shouldBe defined
      await(scheduleRepo.findByPipelineId(pid, user2)) shouldBe None
    }

    "upsert twice for the same pipeline replaces the row (exactly one row remains, holding the second call's values)" in {
      cleanDb(); seedUsers()
      val pid   = seedPipeline(owner1Id)
      val first = newSchedule(pid, expression = "0 * * * *")
      await(scheduleRepo.upsert(first, user1))

      val second = first.copy(expression = "0 0 * * *", updatedAt = Instant.now().plusSeconds(60))
      await(scheduleRepo.upsert(second, user1))

      val found = await(scheduleRepo.findByPipelineId(pid, user1))
      found shouldBe defined
      found.get.expression shouldBe "0 0 * * *"

      import PostgresProfile.api._
      val count = await(db.run(sql"SELECT COUNT(*) FROM pipeline_schedules WHERE pipeline_id = ${pid.value}".as[Int].head))
      count shouldBe 1
    }

    "delete removes the row and returns true" in {
      cleanDb(); seedUsers()
      val pid = seedPipeline(owner1Id)
      await(scheduleRepo.upsert(newSchedule(pid), user1))

      val deleted = await(scheduleRepo.delete(pid, user1))
      deleted shouldBe true
      await(scheduleRepo.findByPipelineId(pid, user1)) shouldBe None
    }

    "delete returns false when no schedule exists" in {
      cleanDb(); seedUsers()
      val pid = seedPipeline(owner1Id)
      await(scheduleRepo.delete(pid, user1)) shouldBe false
    }

    "deleting the parent pipeline cascades and removes the schedule" in {
      cleanDb(); seedUsers()
      val pid = seedPipeline(owner1Id)
      await(scheduleRepo.upsert(newSchedule(pid), user1))

      import PostgresProfile.api._
      await(db.run(sqlu"DELETE FROM pipelines WHERE id = ${pid.value}"))

      val remaining = await(db.run(sql"SELECT COUNT(*) FROM pipeline_schedules WHERE pipeline_id = ${pid.value}".as[Int].head))
      remaining shouldBe 0
    }
  }
}
