package com.helio.services.pipelines

import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.alerts.{AlertEventRepository, AlertRuleRepository}
import com.helio.infrastructure.persistence.pipelines._
import com.helio.services.alerts.AlertEvaluationService
import com.helio.testsupport.OutputHistoryFixtures
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import com.helio.testkit.VerifiedEmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.time.{Duration, Instant}
import java.util.UUID
import scala.concurrent.ExecutionContext

/** HEL-1285 proof: after a REAL `OutputHistoryRepository.thinAndPurge`, the compare read API's `previous_run`
 *  baseline and the alert `previous` / `rolling_avg` baselines are the literal previous / n most recent runs.
 *
 *  Fixture (fixed, never wall-clock): `now` = 12:04:00Z, Output A has a point every minute for 111 minutes
 *  (point i at `now - i min`, value `1000 - i`, point 0 = the triggering run's own point). The newest five
 *  points share the epoch-aligned 5-minute bucket [12:00, 12:05), so a thin pass that bucket-ranks all rows
 *  deletes points 1..4 and the "previous" baseline would silently become point 5. */
class HistoryBaselineAfterThinningSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll with OutputHistoryFixtures {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var historyRepo: OutputHistoryRepository = _
  private var outputRepo: OutputRepository       = _
  private var ruleRepo: AlertRuleRepository      = _
  private var eventRepo: AlertEventRepository    = _
  private var historyService: OutputHistoryService = _
  private var alerts: AlertEvaluationService     = _

  override protected def seedDb: JdbcBackend.Database = db

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx = new DbContext(db, db)
    historyRepo    = new OutputHistoryRepository(ctx)
    outputRepo     = new OutputRepository(ctx)
    ruleRepo       = new AlertRuleRepository(ctx)
    eventRepo      = new AlertEventRepository(ctx)
    historyService = new OutputHistoryService(outputRepo, historyRepo, new NodePayloadHistoryRepository(ctx))
    alerts         = new AlertEvaluationService(ruleRepo, eventRepo, historyRepo)
  }

  override def afterAll(): Unit = { db.close(); embeddedPostgres.close() }

  private val now    = Instant.parse("2026-01-01T12:04:00Z")
  private val policy = HistoryThinningPolicy()
  private val caps: Map[UserTier, Duration] =
    Map(UserTier.Free -> Duration.ofDays(30), UserTier.Beta -> Duration.ofDays(90), UserTier.Owner -> Duration.ofDays(365))

  private val compareConfig = """{"compare":"previous_run"}"""

  /** A summary readable by BOTH `OutputHistoryService.headline` (`v` + `metric.value`) and
   *  `HistoryBaseline.summaryValue` (`columns.amount.sum`). */
  private def summaryOf(value: Int): JsObject = JsObject(
    "v"        -> JsNumber(1),
    "rowCount" -> JsNumber(1),
    "metric"   -> JsObject("field" -> JsString("amount"), "agg" -> JsString("sum"), "value" -> JsNumber(value)),
    "columns"  -> JsObject("amount" -> JsObject("sum" -> JsNumber(value)))
  )

  private def point(oid: String, pid: String, at: Instant, value: Int, runId: String = UUID.randomUUID().toString) =
    historyEntry(oid, pid, at, runId).copy(summary = summaryOf(value))

  private def survivors(oid: String): Set[Instant] = awaitDb(historyRepo.listRecent(oid, 5000)).map(_.capturedAt).toSet

  private def thin(): Unit = awaitDb(historyRepo.thinAndPurge(now, policy, caps))

  private def minutesAgo(i: Int): Instant = now.minus(Duration.ofMinutes(i.toLong))

  /** Independent model of the pass for a point set already known to be within the tier cap logic:
   *  the newest `protectedNewest` survive; the rest keep the newest per (age class, epoch-aligned bucket). */
  private def modelSurvivors(ats: Seq[Instant], cap: Duration, protectedNewest: Int): Set[Instant] = {
    val live     = ats.filterNot(_.isBefore(now.minus(cap))).sortBy(_.toEpochMilli)(Ordering[Long].reverse)
    val (prot, rest) = live.splitAt(protectedNewest)
    def classOf(at: Instant): (Int, Long) = {
      val ageSecs = Duration.between(at, now).getSeconds
      val (cls, bucket) =
        if (ageSecs < policy.recentWindow.getSeconds) (0, policy.recentBucket.getSeconds)
        else if (ageSecs < policy.midWindow.getSeconds) (1, policy.midBucket.getSeconds)
        else (2, policy.oldBucket.getSeconds)
      (cls, at.getEpochSecond / bucket)
    }
    (prot ++ rest.groupBy(classOf).values.map(_.maxBy(_.toEpochMilli))).toSet
  }

  "history thinning" should {

    // One seeded + thinned fixture shared by (a)-(c), so each assertion fails independently when it should.
    lazy val fx: (String, String, Seq[String]) = {
      awaitDb(db.run(sqlu"DELETE FROM output_snapshot_history"))
      val user = seedUser("owner")
      val (pid, oid) = seedPipelineWithOutput(user, config = compareConfig)
      val runIds = (0 to 110).map(_ => UUID.randomUUID().toString)
      awaitDb(new DbContext(db, db).withSystemContext(historyRepo.insertAction(
        (0 to 110).map(i => point(oid, pid, minutesAgo(i), 1000 - i, runIds(i)))
      )))
      thin()
      (user, oid, runIds)
    }

    "(a) keep exactly the newest 101 points plus the newest point of each older 5-minute bucket" in {
      val (_, oid, _) = fx
      // Points 0..100 protected, then the newest point of each older bucket: [10:20,10:25) -> 101,
      // [10:15,10:20) -> 105, [10:10,10:15) -> 110.
      survivors(oid) shouldBe ((0 to 100) ++ Seq(101, 105, 110)).map(minutesAgo).toSet
      survivors(oid) shouldBe modelSurvivors((0 to 110).map(minutesAgo), Duration.ofDays(365), 101)
    }

    "(b) resolve the compare API previous_run baseline to the literal previous run" in {
      val (_, oid, _) = fx
      val output     = awaitDb(outputRepo.findByIdInternal(OutputId(oid))).get
      val resolution = awaitDb(historyService.forOutput(output, JsObject("compare" -> JsString("previous_run")), 30, None))
      resolution.current.flatMap(_.value) shouldBe Some(1000.0)
      resolution.baseline.map(_.capturedAt) shouldBe Some(minutesAgo(1))
      resolution.baseline.flatMap(_.value) shouldBe Some(999.0)
    }

    // Evaluates one baseline rule for the triggering run that wrote point 0 (excluded from the baseline) and
    // returns the persisted event's `value.baseline`.
    def alertBaseline(condition: JsObject): Double = {
      val (user, oid, runIds) = fx
      val ownerUser = AuthenticatedUser(UserId(user))
      val ts        = Instant.now()
      val r = awaitDb(ruleRepo.insert(AlertRule(
        id = AlertRuleId(UUID.randomUUID().toString), ownerId = ownerUser.id, targetOutputId = OutputId(oid), metric = "amount",
        condition = condition, name = "r", enabled = true, severity = Severity.Warning, createdAt = ts, updatedAt = ts
      ), ownerUser))
      awaitDb(alerts.evaluateForOutput(OutputId(oid), Seq(Map[String, Any]("amount" -> 1000.0)), Some(runIds(0))))
      awaitDb(eventRepo.findActiveByRule(r.id)).get.value.asJsObject.fields("baseline").asInstanceOf[JsNumber].value.toDouble
    }
    def baselineCond(kind: (String, JsValue)*): JsObject =
      JsObject(Map("mode" -> JsString("abs"), "comparator" -> JsString("gte"), "threshold" -> JsNumber(-1000000)) ++ kind)

    "(c1) evaluate the alert previous baseline over the literal previous run" in {
      alertBaseline(baselineCond("baseline" -> JsString("previous"))) shouldBe 999.0
    }

    "(c2) evaluate the alert rolling_avg n=100 baseline over the literal 100 most recent prior runs" in {
      alertBaseline(baselineCond("baseline" -> JsString("rolling_avg"), "n" -> JsNumber(100))) shouldBe
        (1 to 100).map(i => (1000 - i).toDouble).sum / 100.0
    }

    "age-purge a protected point older than the tier cap (cap beats protection)" in {
      awaitDb(db.run(sqlu"DELETE FROM output_snapshot_history"))
      val (pid, oid) = seedPipelineWithOutput(seedUser("free"))
      awaitDb(new DbContext(db, db).withSystemContext(historyRepo.insertAction(
        (0 until 5).map(i => point(oid, pid, now.minus(Duration.ofDays(31L + i)), i))
      )))
      thin()
      historyCount(oid) shouldBe 0
    }

    "hold the newest 101 plus the exact older bucket heads for free and owner Outputs over 40 days" in {
      awaitDb(db.run(sqlu"DELETE FROM output_snapshot_history"))
      val (pidF, oidF) = seedPipelineWithOutput(seedUser("free"))
      val (pidO, oidO) = seedPipelineWithOutput(seedUser("owner"))
      val ats = (0 until 160).map(i => now.minus(Duration.ofHours(6L * i)))
      awaitDb(new DbContext(db, db).withSystemContext(historyRepo.insertAction(
        ats.zipWithIndex.flatMap { case (at, i) => Seq(point(oidF, pidF, at, i), point(oidO, pidO, at, i)) }
      )))
      thin()
      survivors(oidF) shouldBe modelSurvivors(ats, Duration.ofDays(30), 101)
      survivors(oidO) shouldBe modelSurvivors(ats, Duration.ofDays(365), 101)
      ats.take(101).foreach { at => survivors(oidF) should contain(at); survivors(oidO) should contain(at) }
      survivors(oidF).forall(!_.isBefore(now.minus(Duration.ofDays(30)))) shouldBe true
      survivors(oidO).exists(_.isBefore(now.minus(Duration.ofDays(30)))) shouldBe true
    }
  }
}
