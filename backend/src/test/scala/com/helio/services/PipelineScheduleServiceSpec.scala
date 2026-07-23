package com.helio.services

import com.helio.api.protocols.PutPipelineScheduleRequest
import com.helio.domain._
import com.helio.infrastructure.{DataSourceRepository, DataTypeRepository, DbContext, PipelineRepository, PipelineScheduleRepository}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}

import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-414 — `PipelineScheduleService` cron/interval/timezone validation
 *  (valid + invalid), absent-`enabled` normalization, and not-found/not-owned
 *  ACL behavior against the parent pipeline. */
class PipelineScheduleServiceSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var service: PipelineScheduleService   = _

  private val owner1Id = UUID.randomUUID().toString
  private val owner2Id = UUID.randomUUID().toString
  private val owner1   = UserId(owner1Id)
  private val owner2   = UserId(owner2Id)
  private val user1    = AuthenticatedUser(owner1)
  private val user2    = AuthenticatedUser(owner2)

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx           = new DbContext(db, db)
    val dataSourceRepo = new DataSourceRepository(ctx)
    val dataTypeRepo   = new DataTypeRepository(ctx)
    val pipelineRepo   = new PipelineRepository(ctx, dataTypeRepo, dataSourceRepo)
    val scheduleRepo   = new PipelineScheduleRepository(ctx)
    service = new PipelineScheduleService(scheduleRepo, pipelineRepo)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

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

  private def putReq(
      kind: String = "cron",
      expression: String = "*/5 * * * *",
      enabled: Option[Boolean] = Some(true),
      timezone: String = "UTC"
  ): PutPipelineScheduleRequest =
    PutPipelineScheduleRequest(kind = kind, expression = expression, enabled = enabled, timezone = timezone)

  "PipelineScheduleService.put" should {

    "create a schedule for a pipeline the caller owns (valid cron)" in {
      cleanDb(); seedUsers()
      val pid = seedPipeline(owner1Id)

      val result = await(service.put(pid, putReq(), user1))

      result match {
        case Right(schedule) =>
          schedule.pipelineId shouldBe pid
          schedule.kind shouldBe ScheduleKind.Cron
          schedule.expression shouldBe "*/5 * * * *"
          schedule.enabled shouldBe true
          schedule.timezone shouldBe "UTC"
        case other => fail(s"Expected Right, got: $other")
      }
    }

    "create a schedule with a valid interval expression" in {
      cleanDb(); seedUsers()
      val pid = seedPipeline(owner1Id)

      val result = await(service.put(pid, putReq(kind = "interval", expression = "30m"), user1))

      result match {
        case Right(schedule) =>
          schedule.kind shouldBe ScheduleKind.Interval
          schedule.expression shouldBe "30m"
        case other => fail(s"Expected Right, got: $other")
      }
    }

    "normalize an absent `enabled` field to true" in {
      cleanDb(); seedUsers()
      val pid = seedPipeline(owner1Id)

      val result = await(service.put(pid, putReq(enabled = None), user1))

      result match {
        case Right(schedule) => schedule.enabled shouldBe true
        case other            => fail(s"Expected Right, got: $other")
      }
    }

    "replace an existing schedule on a second call, preserving the id" in {
      cleanDb(); seedUsers()
      val pid = seedPipeline(owner1Id)

      val created = await(service.put(pid, putReq(expression = "0 * * * *"), user1)).getOrElse(fail("expected Right"))
      val replaced = await(service.put(pid, putReq(expression = "0 0 * * *"), user1)).getOrElse(fail("expected Right"))

      replaced.id shouldBe created.id
      replaced.expression shouldBe "0 0 * * *"
    }

    "reject an unknown kind" in {
      cleanDb(); seedUsers()
      val pid = seedPipeline(owner1Id)

      val result = await(service.put(pid, putReq(kind = "weekly"), user1))
      result match {
        case Left(ServiceError.BadRequest(_)) => succeed
        case other                             => fail(s"Expected BadRequest, got: $other")
      }
    }

    "reject a cron expression with the wrong field count" in {
      cleanDb(); seedUsers()
      val pid = seedPipeline(owner1Id)

      val result = await(service.put(pid, putReq(expression = "* * * *"), user1))
      result match {
        case Left(ServiceError.BadRequest(msg)) => msg should include("5")
        case other                               => fail(s"Expected BadRequest, got: $other")
      }
    }

    "reject a cron expression with an out-of-range value" in {
      cleanDb(); seedUsers()
      val pid = seedPipeline(owner1Id)

      // Minute field max is 59.
      val result = await(service.put(pid, putReq(expression = "60 * * * *"), user1))
      result match {
        case Left(ServiceError.BadRequest(_)) => succeed
        case other                             => fail(s"Expected BadRequest, got: $other")
      }
    }

    "reject a cron expression with a non-numeric/non-wildcard token" in {
      cleanDb(); seedUsers()
      val pid = seedPipeline(owner1Id)

      val result = await(service.put(pid, putReq(expression = "abc * * * *"), user1))
      result match {
        case Left(ServiceError.BadRequest(_)) => succeed
        case other                             => fail(s"Expected BadRequest, got: $other")
      }
    }

    "accept a valid cron expression using list/range/step syntax" in {
      cleanDb(); seedUsers()
      val pid = seedPipeline(owner1Id)

      val result = await(service.put(pid, putReq(expression = "0,15,30,45 8-18 */2 1,6 1-5"), user1))
      result match {
        case Right(_) => succeed
        case other    => fail(s"Expected Right, got: $other")
      }
    }

    "reject an interval expression that is not a positive <n><unit> token" in {
      cleanDb(); seedUsers()
      val pid = seedPipeline(owner1Id)

      val result = await(service.put(pid, putReq(kind = "interval", expression = "0m"), user1))
      result match {
        case Left(ServiceError.BadRequest(_)) => succeed
        case other                             => fail(s"Expected BadRequest, got: $other")
      }
    }

    "reject an interval expression with an unsupported unit" in {
      cleanDb(); seedUsers()
      val pid = seedPipeline(owner1Id)

      val result = await(service.put(pid, putReq(kind = "interval", expression = "5w"), user1))
      result match {
        case Left(ServiceError.BadRequest(_)) => succeed
        case other                             => fail(s"Expected BadRequest, got: $other")
      }
    }

    "reject an invalid timezone" in {
      cleanDb(); seedUsers()
      val pid = seedPipeline(owner1Id)

      val result = await(service.put(pid, putReq(timezone = "Not/AZone"), user1))
      result match {
        case Left(ServiceError.BadRequest(msg)) => msg should include("timezone")
        case other                               => fail(s"Expected BadRequest, got: $other")
      }
    }

    "return NotFound for an unknown pipeline id" in {
      val result = await(service.put(PipelineId(UUID.randomUUID().toString), putReq(), user1))
      result shouldBe Left(ServiceError.NotFound("Pipeline not found"))
    }

    "return NotFound for a pipeline owned by a different user, and create no schedule" in {
      cleanDb(); seedUsers()
      val pid = seedPipeline(owner1Id)

      val result = await(service.put(pid, putReq(), user2))
      result shouldBe Left(ServiceError.NotFound("Pipeline not found"))

      await(service.find(pid, user1)) shouldBe Left(ServiceError.NotFound("Pipeline schedule not found"))
    }
  }

  "PipelineScheduleService.find" should {

    "return NotFound when the pipeline has no schedule" in {
      cleanDb(); seedUsers()
      val pid = seedPipeline(owner1Id)
      await(service.find(pid, user1)) shouldBe Left(ServiceError.NotFound("Pipeline schedule not found"))
    }

    "return the schedule for the owner" in {
      cleanDb(); seedUsers()
      val pid = seedPipeline(owner1Id)
      await(service.put(pid, putReq(), user1))

      val result = await(service.find(pid, user1))
      result match {
        case Right(schedule) => schedule.pipelineId shouldBe pid
        case other             => fail(s"Expected Right, got: $other")
      }
    }

    "return NotFound for a pipeline owned by a different user" in {
      cleanDb(); seedUsers()
      val pid = seedPipeline(owner1Id)
      await(service.put(pid, putReq(), user1))

      await(service.find(pid, user2)) shouldBe Left(ServiceError.NotFound("Pipeline not found"))
    }
  }

  "PipelineScheduleService.delete" should {

    "delete a schedule owned by the caller" in {
      cleanDb(); seedUsers()
      val pid = seedPipeline(owner1Id)
      await(service.put(pid, putReq(), user1))

      await(service.delete(pid, user1)) shouldBe Right(())
      await(service.find(pid, user1)) shouldBe Left(ServiceError.NotFound("Pipeline schedule not found"))
    }

    "return NotFound when no schedule exists" in {
      cleanDb(); seedUsers()
      val pid = seedPipeline(owner1Id)
      await(service.delete(pid, user1)) shouldBe Left(ServiceError.NotFound("Pipeline schedule not found"))
    }

    "return NotFound for a pipeline owned by a different user, and not delete the schedule" in {
      cleanDb(); seedUsers()
      val pid = seedPipeline(owner1Id)
      await(service.put(pid, putReq(), user1))

      await(service.delete(pid, user2)) shouldBe Left(ServiceError.NotFound("Pipeline not found"))
      await(service.find(pid, user1)) shouldBe a[Right[_, _]]
    }
  }
}
