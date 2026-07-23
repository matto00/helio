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

/** HEL-466 — `AlertEvaluationService`: numeric coercion, metric extraction,
 *  comparator matrix (pure-function unit tests, accessing the `private[
 *  services]` helpers directly since this spec lives in the same package),
 *  and breach/clear-driven event transitions + per-rule failure isolation
 *  (integration tests against an embedded Postgres, mirroring
 *  `AlertEventRepositorySpec`/`AlertRuleRepositorySpec`'s fixture shape). */
class AlertEvaluationServiceSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var arRepo: AlertRuleRepository        = _
  private var aeRepo: AlertEventRepository       = _
  private var dtRepo: DataTypeRepository         = _
  private var svc: AlertEvaluationService        = _

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
    aeRepo = new AlertEventRepository(ctx)
    dtRepo = new DataTypeRepository(ctx)
    svc    = new AlertEvaluationService(arRepo, aeRepo)
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

  private val ownerId = UUID.randomUUID().toString
  private val owner    = UserId(ownerId)
  private val user     = AuthenticatedUser(owner)

  private def seedUser(): Unit = {
    import PostgresProfile.api._
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($ownerId::uuid, ${s"a-$ownerId@helio.test"}, now())"""))
  }

  private def newDataType(): DataType = {
    val now = Instant.now()
    DataType(
      id        = DataTypeId(UUID.randomUUID().toString),
      sourceId  = None,
      name      = "MyType",
      fields    = Vector(DataField("value", "Value", "integer", nullable = false)),
      version   = 1,
      createdAt = now,
      updatedAt = now,
      ownerId   = owner
    )
  }

  private def seedDataType(): DataTypeId = await(dtRepo.insert(newDataType(), user)).id

  private def condition(comparator: String, threshold: Double): JsValue =
    JsObject("comparator" -> JsString(comparator), "threshold" -> JsNumber(threshold))

  private def seedRule(
      dataTypeId: DataTypeId,
      metric: String,
      cond: JsValue,
      enabled: Boolean = true,
      severity: Severity = Severity.Warning
  ): AlertRule = {
    val now = Instant.now()
    val rule = AlertRule(
      id               = AlertRuleId(UUID.randomUUID().toString),
      ownerId          = owner,
      targetDataTypeId = dataTypeId,
      metric           = metric,
      condition        = cond,
      name             = "Rule " + UUID.randomUUID().toString.take(8),
      enabled          = enabled,
      severity         = severity,
      createdAt        = now,
      updatedAt        = now
    )
    await(arRepo.insert(rule, user))
  }

  // ── 4.2: metric extraction ────────────────────────────────────────────────

  "AlertEvaluationService.numericValue" should {
    "coerce genuinely numeric-typed values" in {
      svc.numericValue(12: Int) shouldBe Some(12.0)
      svc.numericValue(12L: Long) shouldBe Some(12.0)
      svc.numericValue(12.5f: Float) shouldBe Some(12.5)
      svc.numericValue(12.5: Double) shouldBe Some(12.5)
      svc.numericValue(BigDecimal(12.5)) shouldBe Some(12.5)
    }

    "never coerce a String, even a numeric-looking one" in {
      svc.numericValue("12") shouldBe None
      svc.numericValue("not-a-number") shouldBe None
    }

    "reject Boolean, null, and nested values" in {
      svc.numericValue(true) shouldBe None
      svc.numericValue(null) shouldBe None
      svc.numericValue(Map("a" -> 1)) shouldBe None
    }
  }

  "AlertEvaluationService.extractMetric" should {
    "yield the row count for the count sentinel with zero rows" in {
      svc.extractMetric("*", Seq.empty) shouldBe Some(0.0)
    }

    "yield the row count for the count sentinel with multiple rows" in {
      val rows = (1 to 7).map(_ => Map.empty[String, Any])
      svc.extractMetric("*", rows) shouldBe Some(7.0)
    }

    "extract a single-row scalar" in {
      svc.extractMetric("errorCount", Seq(Map("errorCount" -> 12))) shouldBe Some(12.0)
    }

    "skip a single-row scalar that is a numeric-looking String, not coerced" in {
      svc.extractMetric("errorCount", Seq(Map("errorCount" -> "12"))) shouldBe None
    }

    "sum a multi-row aggregate, skipping a non-numeric-typed value" in {
      val rows = Seq(Map("amount" -> (10: Any)), Map("amount" -> "n/a"), Map("amount" -> (5: Any)))
      svc.extractMetric("amount", rows) shouldBe Some(15.0)
    }

    "sum a multi-row aggregate, skipping a numeric-looking String value" in {
      val rows = Seq(Map("amount" -> (10: Any)), Map("amount" -> "20"), Map("amount" -> (5: Any)))
      svc.extractMetric("amount", rows) shouldBe Some(15.0)
    }

    "skip the rule for zero rows with a non-count metric" in {
      svc.extractMetric("errorCount", Seq.empty) shouldBe None
    }
  }

  // ── 4.3: comparator matrix ────────────────────────────────────────────────

  "AlertEvaluationService.breaches" should {
    "evaluate all six comparators at equality (gte/eq/lte breach, gt/lt/neq do not)" in {
      svc.breaches(10.0, Comparator.Gt, 10.0) shouldBe false
      svc.breaches(10.0, Comparator.Gte, 10.0) shouldBe true
      svc.breaches(10.0, Comparator.Lt, 10.0) shouldBe false
      svc.breaches(10.0, Comparator.Lte, 10.0) shouldBe true
      svc.breaches(10.0, Comparator.Eq, 10.0) shouldBe true
      svc.breaches(10.0, Comparator.Neq, 10.0) shouldBe false
    }

    "evaluate gt/lt correctly off equality" in {
      svc.breaches(11.0, Comparator.Gt, 10.0) shouldBe true
      svc.breaches(9.0, Comparator.Lt, 10.0) shouldBe true
      svc.breaches(11.0, Comparator.Neq, 10.0) shouldBe true
    }
  }

  // ── 4.4: breach/clear-driven event transitions ───────────────────────────

  "AlertEvaluationService.evaluateForDataType" should {

    "create a firing event on breach with no active event" in {
      cleanDb(); seedUser()
      val dtId = seedDataType()
      val rule = seedRule(dtId, "errorCount", condition("gt", 5))

      await(svc.evaluateForDataType(dtId, Seq(Map("errorCount" -> 10)), Some("run-1")))

      val active = await(aeRepo.findActiveByRule(rule.id))
      active shouldBe defined
      active.get.state shouldBe AlertEventState.Firing
      active.get.value shouldBe JsNumber(10.0)
    }

    "dedup a repeated breach — no duplicate, value refreshed" in {
      cleanDb(); seedUser()
      val dtId = seedDataType()
      val rule = seedRule(dtId, "errorCount", condition("gt", 5))

      await(svc.evaluateForDataType(dtId, Seq(Map("errorCount" -> 10)), Some("run-1")))
      await(svc.evaluateForDataType(dtId, Seq(Map("errorCount" -> 20)), Some("run-2")))

      val all = await(aeRepo.findAll(owner, None))
      all should have size 1
      all.head.value shouldBe JsNumber(20.0)
    }

    "auto-resolve an active firing event once the condition clears" in {
      cleanDb(); seedUser()
      val dtId = seedDataType()
      val rule = seedRule(dtId, "errorCount", condition("gt", 5))

      await(svc.evaluateForDataType(dtId, Seq(Map("errorCount" -> 10)), Some("run-1")))
      await(aeRepo.findActiveByRule(rule.id)).map(_.state) shouldBe Some(AlertEventState.Firing)

      await(svc.evaluateForDataType(dtId, Seq(Map("errorCount" -> 1)), Some("run-2")))

      await(aeRepo.findActiveByRule(rule.id)) shouldBe None
      val all = await(aeRepo.findAll(owner, None))
      all.head.state shouldBe AlertEventState.Resolved
    }

    "no-op when there is no breach and no active event" in {
      cleanDb(); seedUser()
      val dtId = seedDataType()
      seedRule(dtId, "errorCount", condition("gt", 5))

      await(svc.evaluateForDataType(dtId, Seq(Map("errorCount" -> 1)), Some("run-1")))

      await(aeRepo.findAll(owner, None)) shouldBe empty
    }

    "evaluate none and no-op when no enabled rule targets the DataType" in {
      cleanDb(); seedUser()
      val dtId = seedDataType()

      await(svc.evaluateForDataType(dtId, Seq(Map("errorCount" -> 10)), Some("run-1")))

      await(aeRepo.findAll(owner, None)) shouldBe empty
    }

    "skip a disabled rule regardless of whether its condition would breach" in {
      cleanDb(); seedUser()
      val dtId = seedDataType()
      seedRule(dtId, "errorCount", condition("gt", 5), enabled = false)

      await(svc.evaluateForDataType(dtId, Seq(Map("errorCount" -> 10)), Some("run-1")))

      await(aeRepo.findAll(owner, None)) shouldBe empty
    }

    "record pipelineRunId = None for a triggeringRunId-less call (the scheduled-run clear seam)" in {
      cleanDb(); seedUser()
      val dtId = seedDataType()
      val rule = seedRule(dtId, "errorCount", condition("gt", 5))

      await(svc.evaluateForDataType(dtId, Seq(Map("errorCount" -> 10)), None))

      await(aeRepo.findActiveByRule(rule.id)).flatMap(_.pipelineRunId) shouldBe None
    }

    // ── 4.5: per-rule failure isolation ─────────────────────────────────────

    "log and skip one rule's malformed-condition exception without blocking a sibling rule" in {
      cleanDb(); seedUser()
      val dtId = seedDataType()
      val badRule  = seedRule(dtId, "errorCount", JsObject.empty) // missing comparator/threshold
      val goodRule = seedRule(dtId, "errorCount", condition("gt", 5))

      await(svc.evaluateForDataType(dtId, Seq(Map("errorCount" -> 10)), Some("run-1")))

      await(aeRepo.findActiveByRule(badRule.id)) shouldBe None
      await(aeRepo.findActiveByRule(goodRule.id)).map(_.state) shouldBe Some(AlertEventState.Firing)
    }
  }
}
