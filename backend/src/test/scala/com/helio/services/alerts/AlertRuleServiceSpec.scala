package com.helio.services.alerts


import com.helio.services.ServiceError
import com.helio.services.alerts.AlertRuleService
import com.helio.api.protocols.alerts.{CreateAlertRuleRequest, UpdateAlertRuleRequest}
import com.helio.domain.model._
import com.helio.infrastructure.persistence.alerts.AlertRuleRepository
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.DbContext
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import com.helio.testkit.VerifiedEmbeddedPostgres
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
  private var dataSourceRepo: DataSourceRepository = _
  private var pipelineRepo: PipelineRepository   = _
  private var outputRepo: OutputRepository       = _
  private var service: AlertRuleService          = _

  private val owner1Id = UUID.randomUUID().toString
  private val owner2Id = UUID.randomUUID().toString
  private val owner1   = UserId(owner1Id)
  private val owner2   = UserId(owner2Id)
  private val user1    = AuthenticatedUser(owner1)
  private val user2    = AuthenticatedUser(owner2)

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()
    db             = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx        = new DbContext(db, db)
    alertRuleRepo  = new AlertRuleRepository(ctx)
    dataSourceRepo = new DataSourceRepository(ctx)
    pipelineRepo   = new PipelineRepository(ctx, dataSourceRepo)
    outputRepo     = new OutputRepository(ctx)
    service        = new AlertRuleService(alertRuleRepo, outputRepo)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  private def cleanDb(): Unit = {
    import PostgresProfile.api._
    await(db.run(sqlu"DELETE FROM alert_rules"))
    await(db.run(sqlu"DELETE FROM outputs"))
    await(db.run(sqlu"DELETE FROM pipelines"))
    await(db.run(sqlu"DELETE FROM data_sources"))
    await(db.run(sqlu"DELETE FROM users"))
  }

  private def seedUsers(): Unit = {
    import PostgresProfile.api._
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($owner1Id::uuid, ${s"a-$owner1Id@helio.test"}, now())""",
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($owner2Id::uuid, ${s"b-$owner2Id@helio.test"}, now())"""
    )))
  }

  /** HEL-904 (task 3.1): `AlertRuleService.create` now resolves a
   *  `targetOutputId` — builds the minimal real source -> pipeline -> Output
   *  chain its FK requires. Renamed call sites keep `.id`/`.id.value`
   *  unchanged (`Output.id: OutputId`, the retired `DataType.id: DataTypeId`'s
   *  direct successor -- cycle 29 deleted `DataType`/`DataTypeId` outright). */
  private def insertDataType(ownerId: UserId): Output = {
    val now    = Instant.now()
    val user   = AuthenticatedUser(ownerId)
    val source = DatasetSource(DataSourceId(UUID.randomUUID().toString), "src", ownerId, now, now)
    val createdSource = await(dataSourceRepo.insert(source, user))
    val pipeline = await(pipelineRepo.create("pipe", Vector(createdSource.id), user)).getOrElse(
      throw new IllegalStateException("insertDataType fixture: pipeline create failed")
    )
    await(outputRepo.insertInternal(PipelineId(pipeline.id), None, ownerId, "out", OutputKind.Table, explicitRootId = None))
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
      targetOutputId   = targetDataTypeId,
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
          rule.targetOutputId shouldBe dt.id
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

      fetched.targetOutputId shouldBe dt.id
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

  // ── HEL-1278: baseline condition validation ──────────────────────────────

  private def bc(extra: (String, JsValue)*): JsValue =
    JsObject((Map("comparator" -> JsString("gt"), "threshold" -> JsNumber(1)) ++ extra.toMap))

  private val malformedBaselines: Seq[(String, JsValue)] = Seq(
      "unknown kind"          -> bc("baseline" -> JsString("median"), "mode" -> JsString("abs")),
      "null baseline"         -> bc("baseline" -> JsNull, "mode" -> JsString("abs")),
      "missing mode"          -> bc("baseline" -> JsString("previous")),
      "bad mode"              -> bc("baseline" -> JsString("previous"), "mode" -> JsString("rel")),
      "rolling_avg no n"      -> bc("baseline" -> JsString("rolling_avg"), "mode" -> JsString("abs")),
      "rolling_avg n=0"       -> bc("baseline" -> JsString("rolling_avg"), "n" -> JsNumber(0), "mode" -> JsString("abs")),
      "rolling_avg n=101"     -> bc("baseline" -> JsString("rolling_avg"), "n" -> JsNumber(101), "mode" -> JsString("abs")),
      "rolling_avg n=2.5"     -> bc("baseline" -> JsString("rolling_avg"), "n" -> JsNumber(2.5), "mode" -> JsString("abs")),
      "rolling_avg n string"  -> bc("baseline" -> JsString("rolling_avg"), "n" -> JsString("3"), "mode" -> JsString("abs")),
      "previous with n"       -> bc("baseline" -> JsString("previous"), "n" -> JsNumber(2), "mode" -> JsString("abs")),
      "n without baseline"    -> bc("n" -> JsNumber(3)),
      "mode without baseline" -> bc("mode" -> JsString("abs"))
    )

  "AlertRuleService baseline conditions" should {

    "reject every malformed baseline condition on create with BadRequest" in {
      cleanDb(); seedUsers()
      val dt = insertDataType(owner1)
      malformedBaselines.foreach { case (label, c) =>
        withClue(label) {
          await(service.create(createReq(dt.id.value, condition = c), user1)) match {
            case Left(ServiceError.BadRequest(_)) => succeed
            case other                             => fail(s"Expected BadRequest, got: $other")
          }
        }
      }
      await(alertRuleRepo.findAll(owner1)) shouldBe empty
    }

    "reject every malformed baseline condition on update with BadRequest and not mutate" in {
      cleanDb(); seedUsers()
      val dt      = insertDataType(owner1)
      val created = await(service.create(createReq(dt.id.value), user1)).getOrElse(fail("expected Right"))
      malformedBaselines.foreach { case (label, c) =>
        withClue(label) {
          await(service.update(created.id, UpdateAlertRuleRequest(None, Some(c), None, None, None), user1)) match {
            case Left(ServiceError.BadRequest(_)) => succeed
            case other                             => fail(s"Expected BadRequest, got: $other")
          }
        }
      }
      await(service.findById(created.id, user1)).map(_.condition) shouldBe Right(validCondition)
    }

    "accept and round-trip well-formed baseline conditions" in {
      cleanDb(); seedUsers()
      val dt = insertDataType(owner1)
      val prev = bc("baseline" -> JsString("previous"), "mode" -> JsString("pct"))
      val roll = bc("baseline" -> JsString("rolling_avg"), "n" -> JsNumber(5), "mode" -> JsString("abs"))
      val created = await(service.create(createReq(dt.id.value, condition = prev), user1)).getOrElse(fail("expected Right"))
      created.condition shouldBe prev
      val updated = await(service.update(created.id, UpdateAlertRuleRequest(None, Some(roll), None, None, None), user1)).getOrElse(fail("expected Right"))
      updated.condition shouldBe roll
    }
  }
}
