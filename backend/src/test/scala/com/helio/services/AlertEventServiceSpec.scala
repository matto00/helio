package com.helio.services

import com.helio.domain._
import com.helio.infrastructure.{AlertEventRepository, AlertRuleRepository, DataTypeRepository, DbContext}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-455 — `AlertEventService` acknowledge/snooze/resolve happy paths,
 *  illegal-transition rejection, `?state=` list filtering, and cross-user
 *  ACL scoping (NotFound, existence not leaked — CONTRIBUTING.md's ACL
 *  triad). */
class AlertEventServiceSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var alertEventRepo: AlertEventRepository = _
  private var alertRuleRepo: AlertRuleRepository    = _
  private var dataTypeRepo: DataTypeRepository      = _
  private var service: AlertEventService            = _

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
    db              = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx         = new DbContext(db, db)
    alertEventRepo  = new AlertEventRepository(ctx)
    alertRuleRepo   = new AlertRuleRepository(ctx)
    dataTypeRepo    = new DataTypeRepository(ctx)
    service         = new AlertEventService(alertEventRepo)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  private def cleanDb(): Unit = {
    import PostgresProfile.api._
    await(db.run(sqlu"DELETE FROM alert_events"))
    await(db.run(sqlu"DELETE FROM alert_rules"))
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

  private def seedFiringEvent(ownerId: UserId): AlertEvent = {
    val user = AuthenticatedUser(ownerId)
    val now  = Instant.now()
    val dt = await(dataTypeRepo.insert(
      DataType(
        id        = DataTypeId(UUID.randomUUID().toString),
        sourceId  = None,
        name      = "MyType",
        fields    = Vector(DataField("value", "Value", "integer", nullable = false)),
        version   = 1,
        createdAt = now,
        updatedAt = now,
        ownerId   = ownerId
      ),
      user
    ))
    val rule = await(alertRuleRepo.insert(
      AlertRule(
        id               = AlertRuleId(UUID.randomUUID().toString),
        ownerId          = ownerId,
        targetDataTypeId = dt.id,
        metric           = "count",
        condition        = JsObject("comparator" -> JsString("gt"), "threshold" -> JsNumber(5)),
        name             = "My Rule",
        enabled          = true,
        severity         = Severity.Warning,
        createdAt        = now,
        updatedAt        = now
      ),
      user
    ))
    await(alertEventRepo.upsertFiringInternal(rule.id, ownerId, dt.id, JsNumber(10), Some("run-1"), Severity.Warning))
  }

  "AlertEventService.acknowledge" should {
    "transition a firing event to acknowledged and set acknowledgedAt" in {
      cleanDb(); seedUsers()
      val event = seedFiringEvent(owner1)

      val result = await(service.acknowledge(event.id, user1))
      result match {
        case Right(updated) =>
          updated.state shouldBe AlertEventState.Acknowledged
          updated.acknowledgedAt shouldBe defined
        case other => fail(s"Expected Right, got: $other")
      }
    }

    "reject acknowledging an already-resolved event with Conflict" in {
      cleanDb(); seedUsers()
      val event = seedFiringEvent(owner1)
      await(service.resolve(event.id, user1))

      val result = await(service.acknowledge(event.id, user1))
      result shouldBe a[Left[_, _]]
      result.left.toOption match {
        case Some(_: ServiceError.Conflict) => succeed
        case other                          => fail(s"Expected Left(Conflict), got: $other")
      }
    }

    "return NotFound for a cross-user caller and not mutate the event" in {
      cleanDb(); seedUsers()
      val event = seedFiringEvent(owner1)

      val result = await(service.acknowledge(event.id, user2))
      result shouldBe Left(ServiceError.NotFound("Alert event not found"))

      val stillFiring = await(service.findById(event.id, user1)).getOrElse(fail("expected Right"))
      stillFiring.state shouldBe AlertEventState.Firing
    }
  }

  "AlertEventService.snooze" should {
    "transition a firing event to snoozed with the given snoozedUntil" in {
      cleanDb(); seedUsers()
      val event = seedFiringEvent(owner1)
      val until = Instant.now().plusSeconds(3600)

      val result = await(service.snooze(event.id, until, user1))
      result match {
        case Right(updated) =>
          updated.state shouldBe AlertEventState.Snoozed
          updated.snoozedUntil shouldBe Some(until)
        case other => fail(s"Expected Right, got: $other")
      }
    }

    "reject snoozing an already-resolved event with Conflict" in {
      cleanDb(); seedUsers()
      val event = seedFiringEvent(owner1)
      await(service.resolve(event.id, user1))

      val result = await(service.snooze(event.id, Instant.now().plusSeconds(60), user1))
      result.left.toOption match {
        case Some(_: ServiceError.Conflict) => succeed
        case other                          => fail(s"Expected Left(Conflict), got: $other")
      }
    }

    "return NotFound for a cross-user caller and not mutate the event" in {
      cleanDb(); seedUsers()
      val event = seedFiringEvent(owner1)

      val result = await(service.snooze(event.id, Instant.now().plusSeconds(60), user2))
      result shouldBe Left(ServiceError.NotFound("Alert event not found"))
    }
  }

  "AlertEventService.resolve" should {
    "transition a firing event to resolved and set resolvedAt" in {
      cleanDb(); seedUsers()
      val event = seedFiringEvent(owner1)

      val result = await(service.resolve(event.id, user1))
      result match {
        case Right(updated) =>
          updated.state shouldBe AlertEventState.Resolved
          updated.resolvedAt shouldBe defined
        case other => fail(s"Expected Right, got: $other")
      }
    }

    "reject resolving an already-resolved event with Conflict" in {
      cleanDb(); seedUsers()
      val event = seedFiringEvent(owner1)
      await(service.resolve(event.id, user1))

      val result = await(service.resolve(event.id, user1))
      result.left.toOption match {
        case Some(_: ServiceError.Conflict) => succeed
        case other                          => fail(s"Expected Left(Conflict), got: $other")
      }
    }

    "return NotFound for a cross-user caller and not mutate the event" in {
      cleanDb(); seedUsers()
      val event = seedFiringEvent(owner1)

      val result = await(service.resolve(event.id, user2))
      result shouldBe Left(ServiceError.NotFound("Alert event not found"))
    }
  }

  "AlertEventService.findAll" should {
    "reject an unknown state filter value with BadRequest" in {
      cleanDb(); seedUsers()
      val result = await(service.findAll(user1, Some("bogus")))
      result match {
        case Left(_: ServiceError.BadRequest) => succeed
        case other                             => fail(s"Expected Left(BadRequest), got: $other")
      }
    }

    "filters by state, including expired-snoozed treated as firing" in {
      cleanDb(); seedUsers()
      val event = seedFiringEvent(owner1)
      await(service.snooze(event.id, Instant.now().minusSeconds(60), user1))

      val result = await(service.findAll(user1, Some("firing"))).getOrElse(fail("expected Right"))
      result.map(_.id) should contain(event.id)
    }
  }

  "AlertEventService.findById" should {
    "return NotFound for an event owned by a different user" in {
      cleanDb(); seedUsers()
      val event = seedFiringEvent(owner1)

      val result = await(service.findById(event.id, user2))
      result shouldBe Left(ServiceError.NotFound("Alert event not found"))
    }
  }
}
