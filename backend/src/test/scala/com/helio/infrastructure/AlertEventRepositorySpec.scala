package com.helio.infrastructure

import com.helio.domain._
import com.helio.services.ServiceError
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

/** HEL-455 — `AlertEventRepository` dedup/upsert contract (all four `ReFire`
 *  branches via `upsertFiringInternal`), owner-scoped RLS, `applyTransition`,
 *  and cascade delete from `alert_rules`. */
class AlertEventRepositorySpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var aeRepo: AlertEventRepository       = _
  private var arRepo: AlertRuleRepository        = _
  private var dtRepo: DataTypeRepository         = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()

    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()

    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx = new DbContext(db, db)
    aeRepo = new AlertEventRepository(ctx)
    arRepo = new AlertRuleRepository(ctx)
    dtRepo = new DataTypeRepository(ctx)
  }

  override def afterAll(): Unit = {
    db.close()
    embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  private def cleanDb(): Unit = {
    import PostgresProfile.api._
    await(db.run(sqlu"DELETE FROM alert_events"))
    await(db.run(sqlu"DELETE FROM alert_rules"))
    await(db.run(sqlu"DELETE FROM data_types"))
    await(db.run(sqlu"DELETE FROM users"))
  }

  private val owner1Id = UUID.randomUUID().toString
  private val owner2Id = UUID.randomUUID().toString
  private val owner1   = UserId(owner1Id)
  private val owner2   = UserId(owner2Id)
  private val user1    = AuthenticatedUser(owner1)
  private val user2    = AuthenticatedUser(owner2)

  private def seedUsers(): Unit = {
    import PostgresProfile.api._
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($owner1Id::uuid, ${s"a-$owner1Id@helio.test"}, now())""",
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($owner2Id::uuid, ${s"b-$owner2Id@helio.test"}, now())"""
    )))
  }

  private def newDataType(ownerId: UserId): DataType = {
    val now = Instant.now()
    DataType(
      id        = DataTypeId(UUID.randomUUID().toString),
      sourceId  = None,
      name      = "MyType",
      fields    = Vector(DataField("value", "Value", "integer", nullable = false)),
      version   = 1,
      createdAt = now,
      updatedAt = now,
      ownerId   = ownerId
    )
  }

  private val defaultCondition: JsValue =
    JsObject("comparator" -> JsString("gt"), "threshold" -> JsNumber(5))

  private def newRule(ownerId: UserId, targetDataTypeId: DataTypeId): AlertRule = {
    val now = Instant.now()
    AlertRule(
      id               = AlertRuleId(UUID.randomUUID().toString),
      ownerId          = ownerId,
      targetDataTypeId = targetDataTypeId,
      metric           = "count",
      condition        = defaultCondition,
      name             = "My Rule",
      enabled          = true,
      severity         = Severity.Warning,
      createdAt        = now,
      updatedAt        = now
    )
  }

  /** Seeds a user + DataType + AlertRule owned by `ownerId`, returning the rule. */
  private def seedRule(ownerId: UserId): AlertRule = {
    val user = AuthenticatedUser(ownerId)
    val dt   = await(dtRepo.insert(newDataType(ownerId), user))
    await(arRepo.insert(newRule(ownerId, dt.id), user))
  }

  "AlertEventRepository.upsertFiringInternal" should {

    "create a new firing event when no active event exists" in {
      cleanDb(); seedUsers()
      val rule = seedRule(owner1)

      val event = await(aeRepo.upsertFiringInternal(
        rule.id, owner1, rule.targetDataTypeId, JsNumber(10), Some("run-1"), Severity.Warning
      ))

      event.state shouldBe AlertEventState.Firing
      event.firstFiredAt shouldBe event.lastEvaluatedAt
      event.acknowledgedAt shouldBe None
      event.resolvedAt shouldBe None
      event.snoozedUntil shouldBe None
    }

    "re-breach while firing updates in place (dedup)" in {
      cleanDb(); seedUsers()
      val rule = seedRule(owner1)

      val first = await(aeRepo.upsertFiringInternal(rule.id, owner1, rule.targetDataTypeId, JsNumber(10), Some("run-1"), Severity.Warning))
      // Re-fetch the persisted `firstFiredAt` (rather than using `first`'s
      // in-memory value) so both sides of the comparison below have been
      // through the same Postgres TIMESTAMPTZ round-trip — see the
      // "re-breach while acknowledged" test's comment for why.
      val firstFiredAtPersisted = await(aeRepo.findByIdOwned(first.id, user1)).getOrElse(fail("expected Some")).firstFiredAt
      val second = await(aeRepo.upsertFiringInternal(rule.id, owner1, rule.targetDataTypeId, JsNumber(20), Some("run-2"), Severity.Critical))

      second.id shouldBe first.id
      second.state shouldBe AlertEventState.Firing
      second.value shouldBe JsNumber(20)
      second.severity shouldBe Severity.Critical
      second.firstFiredAt shouldBe firstFiredAtPersisted

      val all = await(aeRepo.findAll(owner1, None))
      all should have size 1
    }

    "re-breach while acknowledged updates in place without changing state/acknowledgedAt" in {
      cleanDb(); seedUsers()
      val rule = seedRule(owner1)
      val fired = await(aeRepo.upsertFiringInternal(rule.id, owner1, rule.targetDataTypeId, JsNumber(10), Some("run-1"), Severity.Warning))
      await(aeRepo.applyTransition(fired.id, AlertEventAction.Acknowledge, user1))
      // Re-fetch the persisted `acknowledgedAt` (rather than using the value
      // `applyTransition` returned in-memory) so both sides of the comparison
      // below have been through the same Postgres TIMESTAMPTZ round-trip —
      // comparing an in-memory (nanosecond) `Instant.now()` to a persisted
      // one can differ by 1 microsecond (the JDBC driver rounds, Java's
      // `truncatedTo` truncates), which is not the dedup behavior under test.
      val ackedAtPersisted = await(aeRepo.findByIdOwned(fired.id, user1)).getOrElse(fail("expected Some")).acknowledgedAt

      val reFired = await(aeRepo.upsertFiringInternal(rule.id, owner1, rule.targetDataTypeId, JsNumber(30), Some("run-2"), Severity.Critical))

      reFired.id shouldBe fired.id
      reFired.state shouldBe AlertEventState.Acknowledged
      reFired.acknowledgedAt shouldBe ackedAtPersisted
      reFired.value shouldBe JsNumber(30)
      reFired.severity shouldBe Severity.Critical

      val all = await(aeRepo.findAll(owner1, None))
      all should have size 1
    }

    "re-breach while snoozed (not expired) updates in place without changing state/snoozedUntil" in {
      cleanDb(); seedUsers()
      val rule = seedRule(owner1)
      val fired = await(aeRepo.upsertFiringInternal(rule.id, owner1, rule.targetDataTypeId, JsNumber(10), Some("run-1"), Severity.Warning))
      val until = Instant.now().plusSeconds(3600)
      await(aeRepo.applyTransition(fired.id, AlertEventAction.Snooze(until), user1))
      // Re-fetch the persisted `snoozedUntil` (rather than comparing to the
      // in-memory `until`) so both sides of the comparison below have been
      // through the same Postgres TIMESTAMPTZ round-trip — see the
      // "re-breach while acknowledged" test's comment for why.
      val snoozedUntilPersisted = await(aeRepo.findByIdOwned(fired.id, user1)).getOrElse(fail("expected Some")).snoozedUntil

      val reFired = await(aeRepo.upsertFiringInternal(rule.id, owner1, rule.targetDataTypeId, JsNumber(40), Some("run-2"), Severity.Info))

      reFired.id shouldBe fired.id
      reFired.state shouldBe AlertEventState.Snoozed
      reFired.snoozedUntil shouldBe snoozedUntilPersisted
      reFired.value shouldBe JsNumber(40)

      val all = await(aeRepo.findAll(owner1, None))
      all should have size 1
    }

    "re-breach while snoozed (expired) flips to firing and clears snoozedUntil" in {
      cleanDb(); seedUsers()
      val rule = seedRule(owner1)
      val fired = await(aeRepo.upsertFiringInternal(rule.id, owner1, rule.targetDataTypeId, JsNumber(10), Some("run-1"), Severity.Warning))
      val expiredUntil = Instant.now().minusSeconds(3600)
      await(aeRepo.applyTransition(fired.id, AlertEventAction.Snooze(expiredUntil), user1))

      val reFired = await(aeRepo.upsertFiringInternal(rule.id, owner1, rule.targetDataTypeId, JsNumber(50), Some("run-2"), Severity.Info))

      reFired.id shouldBe fired.id
      reFired.state shouldBe AlertEventState.Firing
      reFired.snoozedUntil shouldBe None
      reFired.value shouldBe JsNumber(50)

      val all = await(aeRepo.findAll(owner1, None))
      all should have size 1
    }

    "breach after resolve opens a new event" in {
      cleanDb(); seedUsers()
      val rule = seedRule(owner1)
      val fired = await(aeRepo.upsertFiringInternal(rule.id, owner1, rule.targetDataTypeId, JsNumber(10), Some("run-1"), Severity.Warning))
      await(aeRepo.applyTransition(fired.id, AlertEventAction.Resolve, user1))

      val second = await(aeRepo.upsertFiringInternal(rule.id, owner1, rule.targetDataTypeId, JsNumber(60), Some("run-2"), Severity.Warning))

      second.id should not be fired.id
      second.state shouldBe AlertEventState.Firing
      second.firstFiredAt should not be fired.firstFiredAt

      val all = await(aeRepo.findAll(owner1, None))
      all.map(_.id) should contain allOf (fired.id, second.id)
      all should have size 2
    }
  }

  "AlertEventRepository.findActiveByRule" should {
    "return None when the only event is resolved" in {
      cleanDb(); seedUsers()
      val rule = seedRule(owner1)
      val fired = await(aeRepo.upsertFiringInternal(rule.id, owner1, rule.targetDataTypeId, JsNumber(10), Some("run-1"), Severity.Warning))
      await(aeRepo.applyTransition(fired.id, AlertEventAction.Resolve, user1))

      await(aeRepo.findActiveByRule(rule.id)) shouldBe None
    }

    "return the active event when one is firing" in {
      cleanDb(); seedUsers()
      val rule = seedRule(owner1)
      val fired = await(aeRepo.upsertFiringInternal(rule.id, owner1, rule.targetDataTypeId, JsNumber(10), Some("run-1"), Severity.Warning))

      await(aeRepo.findActiveByRule(rule.id)).map(_.id) shouldBe Some(fired.id)
    }
  }

  "AlertEventRepository owner scoping (RLS)" should {

    "findByIdOwned excludes non-owned rows" in {
      cleanDb(); seedUsers()
      val rule = seedRule(owner1)
      val fired = await(aeRepo.upsertFiringInternal(rule.id, owner1, rule.targetDataTypeId, JsNumber(10), Some("run-1"), Severity.Warning))

      await(aeRepo.findByIdOwned(fired.id, user1)) shouldBe defined
      await(aeRepo.findByIdOwned(fired.id, user2)) shouldBe None
    }

    "findAll returns only events owned by the given user" in {
      cleanDb(); seedUsers()
      val rule1 = seedRule(owner1)
      val rule2 = seedRule(owner2)
      val e1 = await(aeRepo.upsertFiringInternal(rule1.id, owner1, rule1.targetDataTypeId, JsNumber(1), None, Severity.Warning))
      val e2 = await(aeRepo.upsertFiringInternal(rule2.id, owner2, rule2.targetDataTypeId, JsNumber(2), None, Severity.Warning))

      val forOwner1 = await(aeRepo.findAll(owner1, None))
      forOwner1.map(_.id) should contain(e1.id)
      forOwner1.map(_.id) should not contain e2.id

      val forOwner2 = await(aeRepo.findAll(owner2, None))
      forOwner2.map(_.id) should contain only e2.id
    }

    "findAll(?state=firing) includes expired-snoozed events" in {
      cleanDb(); seedUsers()
      val rule = seedRule(owner1)
      val fired = await(aeRepo.upsertFiringInternal(rule.id, owner1, rule.targetDataTypeId, JsNumber(10), None, Severity.Warning))
      val expiredUntil = Instant.now().minusSeconds(3600)
      await(aeRepo.applyTransition(fired.id, AlertEventAction.Snooze(expiredUntil), user1))

      val firingList = await(aeRepo.findAll(owner1, Some(AlertEventState.Firing)))
      firingList.map(_.id) should contain(fired.id)
    }

    "findAll(?state=firing) excludes not-yet-expired-snoozed events" in {
      cleanDb(); seedUsers()
      val rule = seedRule(owner1)
      val fired = await(aeRepo.upsertFiringInternal(rule.id, owner1, rule.targetDataTypeId, JsNumber(10), None, Severity.Warning))
      val futureUntil = Instant.now().plusSeconds(3600)
      await(aeRepo.applyTransition(fired.id, AlertEventAction.Snooze(futureUntil), user1))

      val firingList = await(aeRepo.findAll(owner1, Some(AlertEventState.Firing)))
      firingList.map(_.id) should not contain fired.id
    }

    "applyTransition returns NotFound for a cross-user caller and leaves the row unchanged" in {
      cleanDb(); seedUsers()
      val rule = seedRule(owner1)
      val fired = await(aeRepo.upsertFiringInternal(rule.id, owner1, rule.targetDataTypeId, JsNumber(10), None, Severity.Warning))

      val result = await(aeRepo.applyTransition(fired.id, AlertEventAction.Acknowledge, user2))
      result match {
        case Left(ServiceError.NotFound(_)) => succeed
        case other                          => fail(s"Expected Left(NotFound), got: $other")
      }
      await(aeRepo.findByIdOwned(fired.id, user1)).map(_.state) shouldBe Some(AlertEventState.Firing)
    }

    "applyTransition returns Conflict for an illegal transition and leaves the row unchanged" in {
      cleanDb(); seedUsers()
      val rule = seedRule(owner1)
      val fired = await(aeRepo.upsertFiringInternal(rule.id, owner1, rule.targetDataTypeId, JsNumber(10), None, Severity.Warning))
      await(aeRepo.applyTransition(fired.id, AlertEventAction.Resolve, user1))

      val result = await(aeRepo.applyTransition(fired.id, AlertEventAction.Acknowledge, user1))
      result match {
        case Left(ServiceError.Conflict(_)) => succeed
        case other                          => fail(s"Expected Left(Conflict), got: $other")
      }
      await(aeRepo.findByIdOwned(fired.id, user1)).map(_.state) shouldBe Some(AlertEventState.Resolved)
    }
  }

  "AlertEventRepository cascade delete" should {
    "deleting the parent alert_rules row removes its alert_events" in {
      cleanDb(); seedUsers()
      val rule = seedRule(owner1)
      val fired = await(aeRepo.upsertFiringInternal(rule.id, owner1, rule.targetDataTypeId, JsNumber(10), None, Severity.Warning))

      await(arRepo.delete(rule.id, user1))

      await(aeRepo.findByIdOwned(fired.id, user1)) shouldBe None
    }
  }
}
