package com.helio.api

import com.helio.api.http.{AuthDirectives, SessionCookies}
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.domain.model._
import com.helio.domain.steps.{AssertConfig, AssertRule}
import com.helio.infrastructure.persistence.alerts.{AlertEventRepository, AlertRuleRepository}
import com.helio.infrastructure.persistence.auth.{UserPreferenceRepository, UserRepository, UserSessionRepository}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.{OutputHistoryPoint, OutputHistoryRepository}
import com.helio.infrastructure.storage.{FileSystem, ListPage}
import com.helio.spark.{PipelineRunCache, SparkJobSubmitter}
import com.helio.testkit.HelioRouteTest
import com.helio.testsupport.{DatasetRowsTestSupport, OutputHistoryApiHarness}
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.{HttpRequest, StatusCodes}
import org.apache.pekko.http.scaladsl.model.headers.{Cookie, RawHeader}
import org.apache.pekko.http.scaladsl.server.Route
import org.apache.pekko.pattern.{after => pekkoAfter}
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.PostgresProfile.api._
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.time.Instant
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import scala.util.{Failure, Success}
import scala.concurrent.duration._
import scala.concurrent.{ExecutionContext, Future}

/** HEL-1283: the composed-`ApiRoutes` guard for the alert + output-history wiring. Every other alert/history
 *  spec hand-builds `AlertEvaluationService`/`PipelineRunService`; here `ApiRoutes` builds them itself from
 *  the same collaborators `Main` passes (`alertRuleRepo`, `alertEventRepo`, `outputHistoryRepo`), and real
 *  pipeline runs go through `POST /api/pipelines/:id/run`. If a reorder/refactor of `ApiRoutes` dropped the
 *  history repo from either service, or the alert service from `PipelineRunService`, baseline alerts would
 *  silently stop firing (a warn log) with every other gate green.
 *
 *  Sequencing: the run route returns `runService.submit`'s future, whose success branch is
 *  `executeRunSuccess -> onRunSuccess -> publishTerminalAfter(writesChain())`; `writesChain` awaits
 *  `materializedWrites` (the history write) and `alertEvaluation`, so DB state read after a 200 is final.
 *
 *  Exclusion of the triggering run: the history write and alert evaluation run concurrently, so on their
 *  own the run's own point may or may not be visible to evaluation. [[ReadAfterWriteHistoryRepo]] (passed
 *  through the same `outputHistoryRepo` param `Main` uses) forces it to be visible when armed, which is
 *  what makes the `baseline == run 1's value` assertion distinguish exclusion from self-inclusion. The
 *  armed wait's outcome is recorded and asserted first: a timed-out wait is swallowed by production
 *  `recover` layers and would otherwise look identical to a broken exclusion. */
class ApiRoutesAlertHistoryWiringSpec extends AnyWordSpec with Matchers with HelioRouteTest with BeforeAndAfterAll with OutputHistoryApiHarness {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  override protected def harnessEc: ExecutionContext     = typedSystem.executionContext

  /** Pass-through `listRecent`, except when armed for an Output: wait (bounded, polling an observable DB
   *  condition) until `n` history points exist, then delegate. Records every armed wait's outcome. */
  private final class ReadAfterWriteHistoryRepo(c: DbContext)(implicit ec: ExecutionContext)
      extends OutputHistoryRepository(c) {
    @volatile private var armed: Option[(String, Int)] = None
    val satisfied = new AtomicInteger(0)
    val timedOut  = new AtomicInteger(0)

    def arm(outputId: String, expectedPoints: Int): Unit = { satisfied.set(0); timedOut.set(0); armed = Some(outputId -> expectedPoints) }
    def disarm(): Unit                                    = armed = None

    private def pointCountNow(outputId: String): Future[Int] =
      c.withSystemContext(sql"SELECT count(*) FROM output_snapshot_history WHERE output_id = $outputId".as[Int].head)

    private def waitForPoints(outputId: String, n: Int, deadlineNanos: Long): Future[Unit] =
      pointCountNow(outputId).flatMap { count =>
        if (count >= n) Future.successful(())
        else if (System.nanoTime() > deadlineNanos) Future.failed(new IllegalStateException(s"timed out waiting for $n history points for $outputId (saw $count)"))
        else pekkoAfter(20.millis)(waitForPoints(outputId, n, deadlineNanos))
      }

    override def listRecent(outputId: String, limit: Int): Future[Vector[OutputHistoryPoint]] =
      armed match {
        case Some((oid, n)) if oid == outputId =>
          waitForPoints(outputId, n, System.nanoTime() + 5.seconds.toNanos).transformWith {
            case Success(_) => satisfied.incrementAndGet(); super.listRecent(outputId, limit)
            case Failure(e) => timedOut.incrementAndGet(); Future.failed(e)
          }
        case _ => super.listRecent(outputId, limit)
      }
  }

  private var ownerId: String                      = _
  private val token                                = "alert-history-wiring-token"
  private var api: Route                           = _
  private var ruleRepo: AlertRuleRepository        = _
  private var eventRepo: AlertEventRepository      = _
  private var rawHistory: ReadAfterWriteHistoryRepo = _

  private val stubSessions: UserSessionRepository = new UserSessionRepository {
    override def findValidSession(t: String): Future[Option[AuthenticatedUser]] =
      Future.successful(if (t == token) Some(AuthenticatedUser(UserId(ownerId))) else None)
  }
  private val stubFs: FileSystem = new FileSystem {
    def write(path: String, bytes: Array[Byte]): Future[Unit] = Future.successful(())
    def read(path: String): Future[Array[Byte]]                = Future.successful(Array.empty)
    def delete(path: String): Future[Unit]                     = Future.successful(())
    def exists(path: String): Future[Boolean]                  = Future.successful(false)
    def list(prefix: String, cursor: Option[String] = None, pageSize: Int = 1000): Future[ListPage] = Future.successful(ListPage(Seq.empty, None))
  }

  override def beforeAll(): Unit = {
    super.beforeAll()
    startHarness()
    ownerId   = seedUser("owner")
    ruleRepo  = new AlertRuleRepository(ctx)(harnessEc)
    eventRepo = new AlertEventRepository(ctx)(harnessEc)
    rawHistory = new ReadAfterWriteHistoryRepo(ctx)(harnessEc)
    // The alert/history collaborators are passed exactly as Main passes them; AlertEvaluationService and
    // PipelineRunService are built by ApiRoutes itself (that composition is what is under test).
    api = new ApiRoutes(
      dashboardRepo, panelRepo, dataSourceRepo, permissionRepo, stubFs, new RestApiConnectorDriver(Some(_ => Future.successful(Left("no HTTP")))),
      new UserRepository(db)(harnessEc), stubSessions, new UserPreferenceRepository(db)(harnessEc), pipelineRepo, stepRepo,
      new PipelineRunCache(), new SparkJobSubmitter("local", dataSourceRepo, pipelineRepo)(harnessEc),
      dbContext = ctx, alertRuleRepo = ruleRepo, alertEventRepo = eventRepo, outputHistoryRepo = rawHistory
    ).routes
  }
  override def afterAll(): Unit = { stopHarness(); super.afterAll() }

  private def authed(req: HttpRequest) =
    req.addHeader(Cookie(SessionCookies.Name -> token)).addHeader(RawHeader(AuthDirectives.CsrfHeaderName, AuthDirectives.CsrfHeaderValue))

  private final case class Fx(pid: PipelineId, dsId: String, output: OutputId, thresholdRule: AlertRuleId, baselineRule: AlertRuleId)

  /** Run 1 sums to 30; `replaceWithRun2Rows` makes run 2 sum to 100. `amount` cells are JSON NUMBERS (string
   *  cells would be invisible to the threshold rule's numeric coercion). */
  private def seedFixture(): Fx = {
    val dsId = UUID.randomUUID().toString
    val pid  = UUID.randomUUID().toString
    awaitDb(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($dsId, 'ds', 'dataset', '{}', $ownerId::uuid, now(), now())""",
      DatasetRowsTestSupport.seedActionsFromRaw(dsId, """{"columns":[{"name":"amount","type":"integer"}],"rows":[[10],[20]]}"""),
      sqlu"""INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ($pid, 'p', $ownerId::uuid, now(), now())""",
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($pid, $pid, $dsId, 0)"""
    )))
    val pipelineId = PipelineId(pid)
    val step = awaitDb(stepRepo.insertInternal(pipelineId, "assert", AssertConfig(Vector.empty[AssertRule]), enabled = true, None, explicitRootId = None))
    val out  = awaitDb(outputRepo.insertInternal(pipelineId, Some(step.id), UserId(ownerId), "step-table", OutputKind.Table, explicitRootId = None))
    val user = AuthenticatedUser(UserId(ownerId))
    val now  = Instant.now()
    def rule(name: String, condition: JsObject): AlertRuleId =
      awaitDb(ruleRepo.insert(AlertRule(
        id = AlertRuleId(UUID.randomUUID().toString), ownerId = user.id, targetOutputId = out.id, metric = "amount",
        condition = condition, name = name, enabled = true, severity = Severity.Warning, createdAt = now, updatedAt = now
      ), user)).id
    val threshold = rule("threshold rule", JsObject("comparator" -> JsString("gte"), "threshold" -> JsNumber(1)))
    // Fires only if the baseline is run 1's value: exclusion -> |100 - 30| = 70 >= 50; self-inclusion -> 0.
    val baseline = rule("baseline rule", JsObject("baseline" -> JsString("previous"), "mode" -> JsString("abs"), "comparator" -> JsString("gte"), "threshold" -> JsNumber(50)))
    Fx(pipelineId, dsId, out.id, threshold, baseline)
  }

  private def replaceWithRun2Rows(dsId: String): Unit =
    awaitDb(db.run(DBIO.seq(
      sqlu"DELETE FROM dataset_rows WHERE data_source_id = $dsId",
      DatasetRowsTestSupport.seedActionsFromRaw(dsId, """{"columns":[{"name":"amount","type":"integer"}],"rows":[[40],[60]]}""")
    )))

  /** Posts a real run through the full route tree; returns its run id (from the run response). */
  private def runViaApi(pid: PipelineId): String =
    authed(Post(s"/api/pipelines/${pid.value}/run")) ~> api ~> check {
      status shouldBe StatusCodes.OK
      responseAs[String].parseJson.asJsObject.fields("runId").convertTo[String]
    }

  private def eventsFor(ruleId: AlertRuleId): Vector[(Option[String], JsValue)] =
    awaitDb(db.run(sql"SELECT pipeline_run_id, value::text FROM alert_events WHERE alert_rule_id = ${ruleId.value}".as[(Option[String], String)]))
      .map { case (run, v) => (run, v.parseJson) }.toVector

  private def historyPointsViaApi(output: OutputId): Vector[JsObject] =
    authed(Get(s"/api/outputs/${output.value}/history")) ~> api ~> check {
      status shouldBe StatusCodes.OK
      responseAs[String].parseJson.asJsObject.fields("points").convertTo[Vector[JsObject]]
    }

  "ApiRoutes composed with alert + history repositories" should {

    "record a history row and fire a threshold rule on a real run, with no baseline event yet" in {
      val fx = seedFixture()
      rawHistory.disarm()
      val run1 = runViaApi(fx.pid)

      val points = historyPointsViaApi(fx.output)
      points should have size 1
      points.head.fields("runId") shouldBe JsString(run1)

      val threshold = eventsFor(fx.thresholdRule)
      threshold should have size 1
      threshold.head._1 shouldBe Some(run1)
      threshold.head._2 shouldBe JsNumber(30)
      eventsFor(fx.baselineRule) shouldBe empty // no prior point: skipped, never fires
    }

    "fire a `previous` baseline rule exactly once across two runs over different data, with run 1's value as baseline" in {
      val fx = seedFixture()
      rawHistory.disarm()
      val run1 = runViaApi(fx.pid)
      eventsFor(fx.baselineRule) shouldBe empty

      replaceWithRun2Rows(fx.dsId)
      rawHistory.arm(fx.output.value, 2) // run 2's own point is visible to evaluation, so exclusion is observable
      val run2 = runViaApi(fx.pid)
      val satisfied = rawHistory.satisfied.get()
      val timedOut  = rawHistory.timedOut.get()
      rawHistory.disarm()
      info(s"D3b armed wait: satisfied=$satisfied timedOut=$timedOut")

      run2 should not be run1
      withClue("D3b precondition: evaluation read history (wiring cut or D3b mis-armed if satisfied = 0) and did not time out: ") {
        satisfied should be >= 1
        timedOut shouldBe 0
      }

      val baseline = eventsFor(fx.baselineRule)
      baseline should have size 1
      baseline.head._1 shouldBe Some(run2)
      baseline.head._2 shouldBe JsObject("value" -> JsNumber(100), "baseline" -> JsNumber(30), "delta" -> JsNumber(70), "mode" -> JsString("abs"))

      // The threshold rule's single active event is upserted by run 2 (value 100), not duplicated.
      val threshold = eventsFor(fx.thresholdRule)
      threshold should have size 1
      threshold.head._1 shouldBe Some(run2)
      threshold.head._2 shouldBe JsNumber(100)

      historyPointsViaApi(fx.output) should have size 2
    }
  }
}
