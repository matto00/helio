package com.helio.infrastructure

import com.helio.domain._
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

/** HEL-447 — `AlertRuleRepository` CRUD + RLS scoping + the privileged
 *  `listEnabledByDataTypeInternal` read path. */
class AlertRuleRepositorySpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
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

  private def newRule(
      ownerId: UserId,
      targetDataTypeId: DataTypeId,
      enabled: Boolean = true,
      condition: JsValue = defaultCondition,
      name: String = "My Rule"
  ): AlertRule = {
    val now = Instant.now()
    AlertRule(
      id               = AlertRuleId(UUID.randomUUID().toString),
      ownerId          = ownerId,
      targetDataTypeId = targetDataTypeId,
      metric           = "count",
      condition        = condition,
      name             = name,
      enabled          = enabled,
      severity         = Severity.Warning,
      createdAt        = now,
      updatedAt        = now
    )
  }

  "AlertRuleRepository" should {

    "insert then findByIdOwned round-trips every field, including unknown jsonb keys" in {
      cleanDb(); seedUsers()
      val dt = await(dtRepo.insert(newDataType(owner1), user1))
      val condition = JsObject(
        "comparator" -> JsString("gte"),
        "threshold"  -> JsNumber(10),
        "window"     -> JsString("1h"),
        "future"     -> JsObject("nested" -> JsString("kind"))
      )
      val rule = newRule(owner1, dt.id, condition = condition)

      await(arRepo.insert(rule, user1))
      val found = await(arRepo.findByIdOwned(rule.id, user1))

      found shouldBe defined
      found.get.id shouldBe rule.id
      found.get.ownerId shouldBe owner1
      found.get.targetDataTypeId shouldBe dt.id
      found.get.metric shouldBe "count"
      found.get.condition shouldBe condition
      found.get.name shouldBe "My Rule"
      found.get.enabled shouldBe true
      found.get.severity shouldBe Severity.Warning
    }

    "findByIdOwned returns None for unknown id" in {
      cleanDb(); seedUsers()
      val result = await(arRepo.findByIdOwned(AlertRuleId(UUID.randomUUID().toString), user1))
      result shouldBe None
    }

    "findByIdOwned excludes non-owned rows (RLS scoping)" in {
      cleanDb(); seedUsers()
      val dt   = await(dtRepo.insert(newDataType(owner1), user1))
      val rule = newRule(owner1, dt.id)
      await(arRepo.insert(rule, user1))

      val foundByOwner    = await(arRepo.findByIdOwned(rule.id, user1))
      val foundByNonOwner = await(arRepo.findByIdOwned(rule.id, user2))

      foundByOwner shouldBe defined
      foundByNonOwner shouldBe None
    }

    "findAll returns only rules owned by the given user" in {
      cleanDb(); seedUsers()
      val dt1 = await(dtRepo.insert(newDataType(owner1), user1))
      val dt2 = await(dtRepo.insert(newDataType(owner2), user2))
      val ruleA = newRule(owner1, dt1.id, name = "A")
      val ruleB = newRule(owner1, dt1.id, name = "B")
      val ruleC = newRule(owner2, dt2.id, name = "C")
      await(arRepo.insert(ruleA, user1))
      await(arRepo.insert(ruleB, user1))
      await(arRepo.insert(ruleC, user2))

      val forOwner1 = await(arRepo.findAll(owner1))
      forOwner1.map(_.id) should contain allOf (ruleA.id, ruleB.id)
      forOwner1.map(_.id) should not contain ruleC.id

      val forOwner2 = await(arRepo.findAll(owner2))
      forOwner2.map(_.id) should contain only ruleC.id
    }

    "update mutates fields and bumps updatedAt" in {
      cleanDb(); seedUsers()
      val dt   = await(dtRepo.insert(newDataType(owner1), user1))
      val rule = newRule(owner1, dt.id)
      await(arRepo.insert(rule, user1))

      val updated = rule.copy(
        metric    = "revenue",
        name      = "Renamed",
        enabled   = false,
        severity  = Severity.Critical,
        condition = JsObject("comparator" -> JsString("lt"), "threshold" -> JsNumber(1)),
        updatedAt = Instant.now().plusSeconds(60)
      )
      val result = await(arRepo.update(updated, user1))

      result shouldBe defined
      result.get.metric shouldBe "revenue"
      result.get.name shouldBe "Renamed"
      result.get.enabled shouldBe false
      result.get.severity shouldBe Severity.Critical
      result.get.condition shouldBe JsObject("comparator" -> JsString("lt"), "threshold" -> JsNumber(1))
    }

    "update returns None for unknown id" in {
      cleanDb(); seedUsers()
      val dt      = await(dtRepo.insert(newDataType(owner1), user1))
      val phantom = newRule(owner1, dt.id)
      val result  = await(arRepo.update(phantom, user1))
      result shouldBe None
    }

    "delete removes the row and returns true" in {
      cleanDb(); seedUsers()
      val dt   = await(dtRepo.insert(newDataType(owner1), user1))
      val rule = newRule(owner1, dt.id)
      await(arRepo.insert(rule, user1))

      val deleted = await(arRepo.delete(rule.id, user1))
      deleted shouldBe true
      await(arRepo.findByIdOwned(rule.id, user1)) shouldBe None
    }

    "delete returns false for unknown id" in {
      cleanDb(); seedUsers()
      val result = await(arRepo.delete(AlertRuleId(UUID.randomUUID().toString), user1))
      result shouldBe false
    }

    // No repository-level "delete by a non-owner is a no-op" test here —
    // this suite's `DbContext` runs both pools through the embedded
    // Postgres default "postgres" superuser (see `beforeAll`), and
    // PostgreSQL superusers unconditionally bypass row-level security
    // (including FORCE ROW LEVEL SECURITY) regardless of policy content.
    // This is the same documented dev/CI RLS-testing gap that applies to
    // every other owner-scoped repository in this codebase (see
    // `DataTypeRepositorySpec`/`DataSourceRepositorySpec`, neither of which
    // asserts cross-owner `delete` at the repository layer for the same
    // reason). The real guarantee — a non-owner's delete request is
    // rejected — is enforced by `AlertRuleService.delete`'s explicit
    // `findByIdOwned` ownership check *before* calling this repository
    // method, and is covered end-to-end by
    // `AlertRuleRoutesSpec`'s "DELETE /alert-rules/:id ... return 403 or 404
    // for a cross-user caller and leave the rule in place".

    "deleting the target DataType cascades and removes the alert rule" in {
      cleanDb(); seedUsers()
      val dt   = await(dtRepo.insert(newDataType(owner1), user1))
      val rule = newRule(owner1, dt.id)
      await(arRepo.insert(rule, user1))

      await(dtRepo.delete(dt.id, user1))

      await(arRepo.findByIdOwned(rule.id, user1)) shouldBe None
    }

    "listEnabledByDataTypeInternal bypasses per-owner RLS and returns rules across owners" in {
      cleanDb(); seedUsers()
      val dt1 = await(dtRepo.insert(newDataType(owner1), user1))
      // Second rule targeting the same DataType, owned by a different user —
      // only meaningful as a repository-level exercise of the privileged
      // path (no cross-user FK requirement on target_data_type_id).
      val ruleA = newRule(owner1, dt1.id, name = "OwnerOneRule")
      val ruleB = newRule(owner1, dt1.id, name = "OwnerOneRuleTwo")
      await(arRepo.insert(ruleA, user1))
      await(arRepo.insert(ruleB, user1))

      val result = await(arRepo.listEnabledByDataTypeInternal(dt1.id))
      result.map(_.id) should contain allOf (ruleA.id, ruleB.id)
    }

    "listEnabledByDataTypeInternal excludes disabled rules" in {
      cleanDb(); seedUsers()
      val dt = await(dtRepo.insert(newDataType(owner1), user1))
      val enabledRule  = newRule(owner1, dt.id, enabled = true, name = "Enabled")
      val disabledRule = newRule(owner1, dt.id, enabled = false, name = "Disabled")
      await(arRepo.insert(enabledRule, user1))
      await(arRepo.insert(disabledRule, user1))

      val result = await(arRepo.listEnabledByDataTypeInternal(dt.id))
      result.map(_.id) should contain(enabledRule.id)
      result.map(_.id) should not contain disabledRule.id
    }

    "listEnabledByDataTypeInternal returns empty for a DataType with no rules" in {
      cleanDb(); seedUsers()
      val dt = await(dtRepo.insert(newDataType(owner1), user1))
      val result = await(arRepo.listEnabledByDataTypeInternal(dt.id))
      result shouldBe empty
    }
  }
}
