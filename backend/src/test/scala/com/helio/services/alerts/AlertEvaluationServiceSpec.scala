package com.helio.services.alerts

import com.helio.services.alerts.AlertEvaluationService
import com.helio.domain.model._
import com.helio.infrastructure.persistence.alerts.{AlertEventRepository, AlertRuleRepository}
import com.helio.infrastructure.persistence.pipelines.{OutputHistoryInsert, OutputHistoryRepository, OutputRepository, PipelineRepository}
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
  private var dsRepo: DataSourceRepository       = _
  private var pipeRepo: PipelineRepository       = _
  private var outRepo: OutputRepository          = _
  private var svc: AlertEvaluationService        = _
  private var histRepo: OutputHistoryRepository   = _
  private var baseSvc: AlertEvaluationService     = _

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))

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
    dsRepo = new DataSourceRepository(ctx)
    pipeRepo = new PipelineRepository(ctx, dsRepo)
    outRepo = new OutputRepository(ctx)
    svc    = new AlertEvaluationService(arRepo, aeRepo)
    histRepo = new OutputHistoryRepository(ctx)
    baseSvc  = new AlertEvaluationService(arRepo, aeRepo, histRepo)
  }

  override def afterAll(): Unit = {
    db.close()
    embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  private def cleanDb(): Unit = {
    import PostgresProfile.api._
    await(db.run(sqlu"DELETE FROM output_snapshot_history"))
    await(db.run(sqlu"DELETE FROM alert_events"))
    await(db.run(sqlu"DELETE FROM alert_rules"))
    await(db.run(sqlu"DELETE FROM outputs"))
    await(db.run(sqlu"DELETE FROM pipelines"))
    await(db.run(sqlu"DELETE FROM data_sources"))
    await(db.run(sqlu"DELETE FROM users"))
  }

  private val ownerId = UUID.randomUUID().toString
  private val owner    = UserId(ownerId)
  private val user     = AuthenticatedUser(owner)

  private def seedUser(): Unit = {
    import PostgresProfile.api._
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($ownerId::uuid, ${s"a-$ownerId@helio.test"}, now())"""))
  }

  // HEL-904 cycle 29: dead `newDataType` fixture helper (zero call sites) deleted outright --
  // its retired `DataType`/`DataTypeId` return type no longer exists anywhere in model.scala.

  /** HEL-904 (task 3.1): `AlertRule` now targets an Output — builds the
   *  minimal real source -> pipeline -> Output chain its FK requires. */
  private def seedOutput(): OutputId = {
    val now    = Instant.now()
    val source = DatasetSource(DataSourceId(UUID.randomUUID().toString), "src", owner, now, now)
    val createdSource = await(dsRepo.insert(source, user))
    val pipeline = await(pipeRepo.create("pipe", Vector(createdSource.id), user)).getOrElse(
      throw new IllegalStateException("seedOutput fixture: pipeline create failed")
    )
    await(outRepo.insertInternal(PipelineId(pipeline.id), None, owner, "out", OutputKind.Table, explicitRootId = None)).id
  }

  private def condition(comparator: String, threshold: Double): JsValue =
    JsObject("comparator" -> JsString(comparator), "threshold" -> JsNumber(threshold))

  private def seedRule(
      outputId: OutputId,
      metric: String,
      cond: JsValue,
      enabled: Boolean = true,
      severity: Severity = Severity.Warning
  ): AlertRule = {
    val now = Instant.now()
    val rule = AlertRule(
      id             = AlertRuleId(UUID.randomUUID().toString),
      ownerId        = owner,
      targetOutputId = outputId,
      metric         = metric,
      condition      = cond,
      name           = "Rule " + UUID.randomUUID().toString.take(8),
      enabled        = enabled,
      severity       = severity,
      createdAt      = now,
      updatedAt      = now
    )
    await(arRepo.insert(rule, user))
  }


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


  "AlertEvaluationService.evaluateForOutput" should {

    "create a firing event on breach with no active event" in {
      cleanDb(); seedUser()
      val dtId = seedOutput()
      val rule = seedRule(dtId, "errorCount", condition("gt", 5))

      await(svc.evaluateForOutput(dtId, Seq(Map("errorCount" -> 10)), Some("run-1")))

      val active = await(aeRepo.findActiveByRule(rule.id))
      active shouldBe defined
      active.get.state shouldBe AlertEventState.Firing
      active.get.value shouldBe JsNumber(10.0)
    }

    "dedup a repeated breach — no duplicate, value refreshed" in {
      cleanDb(); seedUser()
      val dtId = seedOutput()
      val rule = seedRule(dtId, "errorCount", condition("gt", 5))

      await(svc.evaluateForOutput(dtId, Seq(Map("errorCount" -> 10)), Some("run-1")))
      await(svc.evaluateForOutput(dtId, Seq(Map("errorCount" -> 20)), Some("run-2")))

      val all = await(aeRepo.findAll(owner, None))
      all should have size 1
      all.head.value shouldBe JsNumber(20.0)
    }

    "auto-resolve an active firing event once the condition clears" in {
      cleanDb(); seedUser()
      val dtId = seedOutput()
      val rule = seedRule(dtId, "errorCount", condition("gt", 5))

      await(svc.evaluateForOutput(dtId, Seq(Map("errorCount" -> 10)), Some("run-1")))
      await(aeRepo.findActiveByRule(rule.id)).map(_.state) shouldBe Some(AlertEventState.Firing)

      await(svc.evaluateForOutput(dtId, Seq(Map("errorCount" -> 1)), Some("run-2")))

      await(aeRepo.findActiveByRule(rule.id)) shouldBe None
      val all = await(aeRepo.findAll(owner, None))
      all.head.state shouldBe AlertEventState.Resolved
    }

    "no-op when there is no breach and no active event" in {
      cleanDb(); seedUser()
      val dtId = seedOutput()
      seedRule(dtId, "errorCount", condition("gt", 5))

      await(svc.evaluateForOutput(dtId, Seq(Map("errorCount" -> 1)), Some("run-1")))

      await(aeRepo.findAll(owner, None)) shouldBe empty
    }

    "evaluate none and no-op when no enabled rule targets the DataType" in {
      cleanDb(); seedUser()
      val dtId = seedOutput()

      await(svc.evaluateForOutput(dtId, Seq(Map("errorCount" -> 10)), Some("run-1")))

      await(aeRepo.findAll(owner, None)) shouldBe empty
    }

    "skip a disabled rule regardless of whether its condition would breach" in {
      cleanDb(); seedUser()
      val dtId = seedOutput()
      seedRule(dtId, "errorCount", condition("gt", 5), enabled = false)

      await(svc.evaluateForOutput(dtId, Seq(Map("errorCount" -> 10)), Some("run-1")))

      await(aeRepo.findAll(owner, None)) shouldBe empty
    }

    "record pipelineRunId = None for a triggeringRunId-less call (the scheduled-run clear seam)" in {
      cleanDb(); seedUser()
      val dtId = seedOutput()
      val rule = seedRule(dtId, "errorCount", condition("gt", 5))

      await(svc.evaluateForOutput(dtId, Seq(Map("errorCount" -> 10)), None))

      await(aeRepo.findActiveByRule(rule.id)).flatMap(_.pipelineRunId) shouldBe None
    }


    "log and skip one rule's malformed-condition exception without blocking a sibling rule" in {
      cleanDb(); seedUser()
      val dtId = seedOutput()
      val badRule  = seedRule(dtId, "errorCount", JsObject.empty) // missing comparator/threshold
      val goodRule = seedRule(dtId, "errorCount", condition("gt", 5))

      await(svc.evaluateForOutput(dtId, Seq(Map("errorCount" -> 10)), Some("run-1")))

      await(aeRepo.findActiveByRule(badRule.id)) shouldBe None
      await(aeRepo.findActiveByRule(goodRule.id)).map(_.state) shouldBe Some(AlertEventState.Firing)
    }
  }

  // ── HEL-1278: history baselines ──────────────────────────────────────────

  private def pipelineIdOf(outputId: OutputId): String = {
    import PostgresProfile.api._
    await(db.run(sql"SELECT pipeline_id FROM outputs WHERE id = ${outputId.value}".as[String].head))
  }

  private val t0 = Instant.parse("2026-01-01T00:00:00Z")

  /** Seeds one history point whose `metric` column sums to `total`; `age` orders points (higher = newer). */
  private def seedPoint(outputId: OutputId, runId: String, total: Double, age: Int, metric: String = "amount"): Unit = {
    val summary = JsObject(
      "v" -> JsNumber(1), "rowCount" -> JsNumber(1),
      "columns" -> JsObject(metric -> JsObject("count" -> JsNumber(1), "sum" -> JsNumber(total), "min" -> JsNumber(total), "max" -> JsNumber(total)))
    )
    await(db.run(histRepo.insertAction(Seq(OutputHistoryInsert(
      outputId.value, pipelineIdOf(outputId), None, None, Some(runId), "manual", t0.plusSeconds(age.toLong), 1, summary
    )))))
  }

  private def baselineCond(baseline: String, mode: String, comparator: String, threshold: Double, n: Option[Int] = None): JsValue =
    JsObject(
      (Map("baseline" -> JsString(baseline), "mode" -> JsString(mode), "comparator" -> JsString(comparator), "threshold" -> JsNumber(threshold)) ++
        n.map(v => "n" -> (JsNumber(v): JsValue))
      )
    )

  private def amountRows(total: Int): Seq[Map[String, Any]] = Seq(Map("amount" -> total))

  "AlertEvaluationService baseline rules" should {

    "breach then resolve against the previous run (abs)" in {
      cleanDb(); seedUser()
      val out  = seedOutput()
      val rule = seedRule(out, "amount", baselineCond("previous", "abs", "gt", 10))
      seedPoint(out, "r1", 80, 1)

      await(baseSvc.evaluateForOutput(out, amountRows(120), Some("r2")))
      val ev = await(aeRepo.findActiveByRule(rule.id)).get
      ev.state shouldBe AlertEventState.Firing
      ev.value shouldBe JsObject("value" -> JsNumber(120), "baseline" -> JsNumber(80), "delta" -> JsNumber(40), "mode" -> JsString("abs"))

      seedPoint(out, "r2", 120, 2)
      await(baseSvc.evaluateForOutput(out, amountRows(125), Some("r3")))
      await(aeRepo.findActiveByRule(rule.id)) shouldBe None
      await(aeRepo.findAll(owner, None)).head.state shouldBe AlertEventState.Resolved
    }

    "breach then resolve against the rolling average (pct)" in {
      cleanDb(); seedUser()
      val out  = seedOutput()
      val rule = seedRule(out, "amount", baselineCond("rolling_avg", "pct", "lt", -20, Some(3)))
      seedPoint(out, "r1", 100, 1); seedPoint(out, "r2", 120, 2); seedPoint(out, "r3", 140, 3)

      await(baseSvc.evaluateForOutput(out, amountRows(84), Some("r4")))
      val fired = await(aeRepo.findActiveByRule(rule.id)).get
      fired.state shouldBe AlertEventState.Firing
      fired.value shouldBe JsObject("value" -> JsNumber(84), "baseline" -> JsNumber(120), "delta" -> JsNumber(-30), "mode" -> JsString("pct"))

      seedPoint(out, "r4", 84, 4)
      await(baseSvc.evaluateForOutput(out, amountRows(125), Some("r5")))
      await(aeRepo.findActiveByRule(rule.id)) shouldBe None
    }

    "create no event when history is empty" in {
      cleanDb(); seedUser()
      val out = seedOutput()
      seedRule(out, "amount", baselineCond("previous", "abs", "gt", 10))
      seedRule(out, "amount", baselineCond("rolling_avg", "abs", "gt", 10, Some(2)))

      await(baseSvc.evaluateForOutput(out, amountRows(500), Some("r1")))
      await(aeRepo.findAll(owner, None)) shouldBe empty
    }

    "leave an active baseline event firing when the baseline cannot be resolved" in {
      cleanDb(); seedUser()
      val out  = seedOutput()
      val rule = seedRule(out, "amount", baselineCond("rolling_avg", "abs", "gt", 10, Some(2)))
      seedPoint(out, "r1", 100, 1); seedPoint(out, "r2", 100, 2)
      await(baseSvc.evaluateForOutput(out, amountRows(500), Some("r3")))
      await(aeRepo.findActiveByRule(rule.id)).map(_.state) shouldBe Some(AlertEventState.Firing)

      import PostgresProfile.api._
      await(db.run(sqlu"DELETE FROM output_snapshot_history WHERE run_id = 'r2'"))
      await(baseSvc.evaluateForOutput(out, amountRows(1), Some("r4")))
      await(aeRepo.findActiveByRule(rule.id)).map(_.state) shouldBe Some(AlertEventState.Firing)
    }

    "skip a pct rule whose baseline is zero (no breach, no event)" in {
      cleanDb(); seedUser()
      val out = seedOutput()
      seedRule(out, "amount", baselineCond("previous", "pct", "gt", 1))
      seedPoint(out, "r1", 0, 1)
      await(baseSvc.evaluateForOutput(out, amountRows(50), Some("r2")))
      await(aeRepo.findAll(owner, None)) shouldBe empty
    }

    "compare numeric-string columns consistently on both sides" in {
      cleanDb(); seedUser()
      val out  = seedOutput()
      val rule = seedRule(out, "amount", baselineCond("previous", "abs", "gt", 10))
      seedPoint(out, "r1", 100, 1)
      await(baseSvc.evaluateForOutput(out, Seq(Map("amount" -> "70"), Map("amount" -> "50")), Some("r2")))
      await(aeRepo.findActiveByRule(rule.id)).map(_.value) shouldBe
        Some(JsObject("value" -> JsNumber(120), "baseline" -> JsNumber(100), "delta" -> JsNumber(20), "mode" -> JsString("abs")))
    }

    "support the * (row count) metric" in {
      cleanDb(); seedUser()
      val out  = seedOutput()
      val rule = seedRule(out, "*", baselineCond("previous", "abs", "gt", 1))
      // seedPoint stores rowCount = 1
      seedPoint(out, "r1", 0, 1)
      await(baseSvc.evaluateForOutput(out, Seq(Map("a" -> 1), Map("a" -> 2), Map("a" -> 3)), Some("r2")))
      await(aeRepo.findActiveByRule(rule.id)).map(_.state) shouldBe Some(AlertEventState.Firing)
    }

    "EXCLUDE the triggering run's own history point (previous)" in {
      // Fixture: EXACTLY k=1 older point + the current run's point, the latter NEWEST. Included, the
      // baseline would be the run's own 120 (delta 0, no breach); excluded it is 100 (delta 20, breach).
      cleanDb(); seedUser()
      val out  = seedOutput()
      val rule = seedRule(out, "amount", baselineCond("previous", "abs", "gt", 10))
      seedPoint(out, "r1", 100, 1)
      seedPoint(out, "cur", 120, 2)

      await(baseSvc.evaluateForOutput(out, amountRows(120), Some("cur")))
      await(aeRepo.findActiveByRule(rule.id)).map(_.value.asJsObject.fields("baseline")) shouldBe Some(JsNumber(100))
    }

    "EXCLUDE the triggering run's own history point (rolling_avg, exactly n older points)" in {
      // Older 80,120 + current-run point 10 (newest). Pinning the exact baseline in the event value:
      // excluded mean is 100; self-inclusive it would be 55, and a k-limited fetch yields too few points.
      cleanDb(); seedUser()
      val out  = seedOutput()
      val rule = seedRule(out, "amount", baselineCond("rolling_avg", "abs", "gt", 0, Some(2)))
      seedPoint(out, "r1", 80, 1); seedPoint(out, "r2", 120, 2)
      seedPoint(out, "cur", 10, 3)

      await(baseSvc.evaluateForOutput(out, amountRows(200), Some("cur")))
      await(aeRepo.findActiveByRule(rule.id)).map(_.value.asJsObject.fields("baseline")) shouldBe Some(JsNumber(100))
    }

    "still use the n newest older points when the triggering run's point is not yet written" in {
      cleanDb(); seedUser()
      val out  = seedOutput()
      val rule = seedRule(out, "amount", baselineCond("rolling_avg", "abs", "gt", 0, Some(2)))
      seedPoint(out, "r0", 1000, 0); seedPoint(out, "r1", 100, 1); seedPoint(out, "r2", 100, 2)

      await(baseSvc.evaluateForOutput(out, amountRows(200), Some("cur")))
      await(aeRepo.findActiveByRule(rule.id)).map(_.value.asJsObject.fields("baseline")) shouldBe Some(JsNumber(100))
    }

    "skip baseline rules when no triggering run id is supplied" in {
      cleanDb(); seedUser()
      val out = seedOutput()
      seedRule(out, "amount", baselineCond("previous", "abs", "gt", 10))
      seedPoint(out, "r1", 100, 1)
      await(baseSvc.evaluateForOutput(out, amountRows(500), None))
      await(aeRepo.findAll(owner, None)) shouldBe empty
    }

    "skip baseline rules when no history repository is wired" in {
      cleanDb(); seedUser()
      val out = seedOutput()
      seedRule(out, "amount", baselineCond("previous", "abs", "gt", 10))
      seedPoint(out, "r1", 100, 1)
      await(svc.evaluateForOutput(out, amountRows(500), Some("r2")))
      await(aeRepo.findAll(owner, None)) shouldBe empty
    }

    "isolate a malformed stored baseline condition from sibling rules" in {
      cleanDb(); seedUser()
      val out  = seedOutput()
      val bad  = seedRule(out, "amount", JsObject("baseline" -> JsString("median"), "comparator" -> JsString("gt"), "threshold" -> JsNumber(1)))
      val good = seedRule(out, "amount", baselineCond("previous", "abs", "gt", 10))
      seedPoint(out, "r1", 100, 1)
      await(baseSvc.evaluateForOutput(out, amountRows(120), Some("r2")))
      await(aeRepo.findActiveByRule(bad.id)) shouldBe None
      await(aeRepo.findActiveByRule(good.id)).map(_.state) shouldBe Some(AlertEventState.Firing)
    }

    "leave plain threshold rules byte-unchanged (numeric string still skipped even with a history repo)" in {
      cleanDb(); seedUser()
      val out = seedOutput()
      seedRule(out, "amount", condition("gt", 5))
      await(baseSvc.evaluateForOutput(out, Seq(Map("amount" -> "70")), Some("r1")))
      await(aeRepo.findAll(owner, None)) shouldBe empty
    }
  }
}
