package com.helio.services

import com.helio.api.protocols.{CreateAlertRuleRequest, UpdateAlertRuleRequest}
import com.helio.domain._
import com.helio.infrastructure.{AlertRuleRepository, DataTypeRepository, DbContext}
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

/** HEL-447 — `AlertRuleService` validation, absent-optional-field
 *  normalization, ownership checks on the target DataType, and `condition`
 *  round-trip with unknown/extra keys preserved. */
class AlertRuleServiceSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var alertRuleRepo: AlertRuleRepository = _
  private var dataTypeRepo: DataTypeRepository   = _
  private var service: AlertRuleService          = _

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
    db             = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx        = new DbContext(db, db)
    alertRuleRepo  = new AlertRuleRepository(ctx)
    dataTypeRepo   = new DataTypeRepository(ctx)
    service        = new AlertRuleService(alertRuleRepo, dataTypeRepo)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  private def cleanDb(): Unit = {
    import PostgresProfile.api._
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

  private def insertDataType(ownerId: UserId): DataType = {
    val now = Instant.now()
    val dt = DataType(
      id        = DataTypeId(UUID.randomUUID().toString),
      sourceId  = None,
      name      = "MyType",
      fields    = Vector(DataField("value", "Value", "integer", nullable = false)),
      version   = 1,
      createdAt = now,
      updatedAt = now,
      ownerId   = ownerId
    )
    await(dataTypeRepo.insert(dt, AuthenticatedUser(ownerId)))
    dt
  }

  private val validCondition: JsValue =
    JsObject("comparator" -> JsString("gt"), "threshold" -> JsNumber(5))

  private def createReq(
      targetDataTypeId: String,
      condition: JsValue = validCondition,
      enabled: Option[Boolean] = Some(true),
      severity: String = "warning",
      name: String = "My Rule",
      metric: String = "count"
  ): CreateAlertRuleRequest =
    CreateAlertRuleRequest(
      targetDataTypeId = targetDataTypeId,
      metric           = metric,
      condition        = condition,
      severity         = severity,
      enabled          = enabled,
      name             = name
    )

  "AlertRuleService.create" should {

    "create a rule targeting a DataType the caller owns" in {
      cleanDb(); seedUsers()
      val dt = insertDataType(owner1)

      val result = await(service.create(createReq(dt.id.value), user1))

      result match {
        case Right(rule) =>
          rule.targetDataTypeId shouldBe dt.id
          rule.metric shouldBe "count"
          rule.condition shouldBe validCondition
          rule.severity shouldBe Severity.Warning
          rule.enabled shouldBe true
          rule.name shouldBe "My Rule"
        case other => fail(s"Expected Right, got: $other")
      }
    }

    "round-trip through create -> fetch unchanged, including unknown condition keys" in {
      cleanDb(); seedUsers()
      val dt = insertDataType(owner1)
      val condition = JsObject(
        "comparator" -> JsString("lte"),
        "threshold"  -> JsNumber(3),
        "window"     -> JsString("15m"),
        "futureKey"  -> JsArray(JsString("a"), JsString("b"))
      )

      val created = await(service.create(createReq(dt.id.value, condition = condition), user1))
        .getOrElse(fail("expected Right"))
      val fetched = await(service.findById(created.id, user1)).getOrElse(fail("expected Right"))

      fetched.targetDataTypeId shouldBe dt.id
      fetched.metric shouldBe created.metric
      fetched.condition shouldBe condition
      fetched.severity shouldBe created.severity
      fetched.enabled shouldBe created.enabled
      fetched.name shouldBe created.name
    }

    "normalize an absent `enabled` field to true (spray-json omits None on the wire)" in {
      cleanDb(); seedUsers()
      val dt = insertDataType(owner1)

      val result = await(service.create(createReq(dt.id.value, enabled = None), user1))

      result match {
        case Right(rule) => rule.enabled shouldBe true
        case other        => fail(s"Expected Right, got: $other")
      }
    }

    "reject a non-existent targetDataTypeId with 404/422 (UnprocessableEntity)" in {
      cleanDb(); seedUsers()
      val result = await(service.create(createReq(UUID.randomUUID().toString), user1))

      result match {
        case Left(ServiceError.UnprocessableEntity(_)) => succeed
        case other                                      => fail(s"Expected UnprocessableEntity, got: $other")
      }
    }

    "reject a targetDataTypeId owned by a different user with 404/422" in {
      cleanDb(); seedUsers()
      val dt = insertDataType(owner2)

      val result = await(service.create(createReq(dt.id.value), user1))

      result match {
        case Left(ServiceError.UnprocessableEntity(_)) => succeed
        case other                                      => fail(s"Expected UnprocessableEntity, got: $other")
      }
    }

    "reject a condition missing comparator" in {
      cleanDb(); seedUsers()
      val dt = insertDataType(owner1)
      val badCondition = JsObject("threshold" -> JsNumber(5))

      val result = await(service.create(createReq(dt.id.value, condition = badCondition), user1))

      result match {
        case Left(ServiceError.BadRequest(msg)) => msg should include("comparator")
        case other                               => fail(s"Expected BadRequest, got: $other")
      }
    }

    "reject a condition with an unknown comparator value" in {
      cleanDb(); seedUsers()
      val dt = insertDataType(owner1)
      val badCondition = JsObject("comparator" -> JsString("between"), "threshold" -> JsNumber(5))

      val result = await(service.create(createReq(dt.id.value, condition = badCondition), user1))

      result match {
        case Left(ServiceError.BadRequest(_)) => succeed
        case other                             => fail(s"Expected BadRequest, got: $other")
      }
    }

    "reject a condition missing threshold" in {
      cleanDb(); seedUsers()
      val dt = insertDataType(owner1)
      val badCondition = JsObject("comparator" -> JsString("gt"))

      val result = await(service.create(createReq(dt.id.value, condition = badCondition), user1))

      result match {
        case Left(ServiceError.BadRequest(msg)) => msg should include("threshold")
        case other                               => fail(s"Expected BadRequest, got: $other")
      }
    }

    "reject an unknown severity value" in {
      cleanDb(); seedUsers()
      val dt = insertDataType(owner1)

      val result = await(service.create(createReq(dt.id.value, severity = "urgent"), user1))

      result match {
        case Left(ServiceError.BadRequest(_)) => succeed
        case other                             => fail(s"Expected BadRequest, got: $other")
      }
    }

    "reject a blank name" in {
      cleanDb(); seedUsers()
      val dt = insertDataType(owner1)

      val result = await(service.create(createReq(dt.id.value, name = "  "), user1))

      result match {
        case Left(ServiceError.BadRequest(_)) => succeed
        case other                             => fail(s"Expected BadRequest, got: $other")
      }
    }
  }

  "AlertRuleService.findById" should {
    "return NotFound for a rule owned by a different user" in {
      cleanDb(); seedUsers()
      val dt = insertDataType(owner1)
      val created = await(service.create(createReq(dt.id.value), user1)).getOrElse(fail("expected Right"))

      val result = await(service.findById(created.id, user2))
      result shouldBe Left(ServiceError.NotFound("Alert rule not found"))
    }
  }

  "AlertRuleService.update" should {

    "apply only the provided fields, leaving the rest unchanged" in {
      cleanDb(); seedUsers()
      val dt = insertDataType(owner1)
      val created = await(service.create(createReq(dt.id.value), user1)).getOrElse(fail("expected Right"))

      val result = await(service.update(
        created.id,
        UpdateAlertRuleRequest(metric = None, condition = None, severity = None, enabled = Some(false), name = None),
        user1
      ))

      result match {
        case Right(rule) =>
          rule.enabled shouldBe false
          rule.metric shouldBe created.metric
          rule.condition shouldBe created.condition
          rule.name shouldBe created.name
          rule.severity shouldBe created.severity
        case other => fail(s"Expected Right, got: $other")
      }
    }

    "reject update on a rule owned by a different user (NotFound, no mutation)" in {
      cleanDb(); seedUsers()
      val dt = insertDataType(owner1)
      val created = await(service.create(createReq(dt.id.value), user1)).getOrElse(fail("expected Right"))

      val result = await(service.update(
        created.id,
        UpdateAlertRuleRequest(metric = None, condition = None, severity = None, enabled = Some(false), name = None),
        user2
      ))

      result shouldBe Left(ServiceError.NotFound("Alert rule not found"))
      val stillEnabled = await(service.findById(created.id, user1)).getOrElse(fail("expected Right"))
      stillEnabled.enabled shouldBe true
    }

    "return NotFound for an unknown id" in {
      cleanDb(); seedUsers()
      val result = await(service.update(
        AlertRuleId(UUID.randomUUID().toString),
        UpdateAlertRuleRequest(None, None, None, Some(false), None),
        user1
      ))
      result shouldBe Left(ServiceError.NotFound("Alert rule not found"))
    }
  }

  "AlertRuleService.delete" should {

    "delete a rule owned by the caller" in {
      cleanDb(); seedUsers()
      val dt = insertDataType(owner1)
      val created = await(service.create(createReq(dt.id.value), user1)).getOrElse(fail("expected Right"))

      val result = await(service.delete(created.id, user1))
      result shouldBe Right(())
      await(service.findById(created.id, user1)) shouldBe a[Left[_, _]]
    }

    "reject delete on a rule owned by a different user" in {
      cleanDb(); seedUsers()
      val dt = insertDataType(owner1)
      val created = await(service.create(createReq(dt.id.value), user1)).getOrElse(fail("expected Right"))

      val result = await(service.delete(created.id, user2))
      result shouldBe Left(ServiceError.NotFound("Alert rule not found"))
    }
  }
}
