package com.helio.api.routes.pipelines

import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.domain.model.{AuthenticatedUser, PipelineId, UserId}
import com.helio.infrastructure.persistence.pipelines.{PipelineRepository, PipelineRunRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.pipelines.PipelineRunService
import com.helio.spark.PipelineRunCache
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.apache.pekko.stream.Materializer
import org.apache.pekko.stream.scaladsl.Sink
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend

import java.nio.file.Paths
import java.util.UUID
import java.util.concurrent.TimeoutException
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

/** HEL-1174: the systematic-debugging Iron Law probe for this ticket -- confirms the root cause
 *  BEFORE any fix code was written (see `probe-evidence.md` in this change's OpenSpec directory
 *  for the recorded verdict).
 *
 *  Two independent things are probed here, mirroring design.md Decision 1 / ticket.md's candidate
 *  list (a)-(e):
 *
 *   1. "reconnectGapDropsTheEvent" -- forces the EXACT interleaving design.md Decision 1 point 1
 *      calls out: subscribe, disconnect (simulating the fan-out manager's post-terminal
 *      reconnect), publish a `succeeded` event for a fresh run while NO subscriber is registered,
 *      THEN resubscribe. This directly demonstrates candidates (a)/(b)/(c) collapse into one
 *      structural fact: `PipelineRunRegistry` has no backlog/replay, so an event published during
 *      the reconnect gap is gone forever to the new subscriber -- proving the bug is real and
 *      deterministic, with no reliance on wall-clock timing luck.
 *
 *   2. "secondRunDoesLand" -- discriminates candidate (e) (ticket.md: "the second write never
 *      produces a run at all"). Submits two REAL runs back-to-back through `PipelineRunService`
 *      (the exact guard defaults the e2e's dev backend also runs under -- no
 *      `pipelineRunGuardRepo` wired, matching every other guard-off fixture in this test suite;
 *      the concurrency cap IS active since a real `pipelineRunRepo` is passed, exactly like
 *      production) and asserts BOTH runs land as `succeeded` rows in `pipeline_runs`. This directly
 *      falsifies (e): the run/guard layer is not silently swallowing the second run, so an
 *      SSE-layer fix (Decisions 2-3) is the one actually required to turn the e2e green -- not a
 *      guard/debounce fix or an escalation.
 */
class SseReconnectGapProbeSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest
    with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private def routeEc: ExecutionContext                   = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres     = _
  private var db: JdbcBackend.Database               = _
  private var ctx: DbContext                         = _
  private var pipelineRepo: PipelineRepository       = _
  private var stepRepo: PipelineStepRepository       = _
  private var dataSourceRepo: DataSourceRepository   = _
  private var pipelineRunRepo: PipelineRunRepository = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db              = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    ctx             = new DbContext(db, db)(routeEc)
    dataSourceRepo  = new DataSourceRepository(ctx)(routeEc)
    stepRepo        = new PipelineStepRepository(ctx)(routeEc)
    pipelineRepo    = new PipelineRepository(ctx, dataSourceRepo)(routeEc)
    pipelineRunRepo = new PipelineRunRepository(ctx)(routeEc)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private val fileSystem = new LocalFileSystem(Paths.get("/"))
  private val dummyUser  = AuthenticatedUser(UserId("00000000-0000-0000-0000-000000000001"))

  private def seedDsWithData(): String = {
    import slick.jdbc.PostgresProfile.api._
    val dsId     = UUID.randomUUID().toString
    val dsConfig = """{"columns":[{"name":"amount","type":"integer"}],"rows":[[10]]}"""
    await(db.run(sqlu"""INSERT INTO data_sources
      (id, name, source_type, config, owner_id, created_at, updated_at)
      VALUES ($dsId, 'probe-ds', 'dataset', $dsConfig,
        '00000000-0000-0000-0000-000000000001', now(), now())"""))
    dsId
  }

  private def seedPipeline(dsId: String): PipelineId = {
    import slick.jdbc.PostgresProfile.api._
    val pid = UUID.randomUUID().toString
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO pipelines (id, name, created_at, updated_at) VALUES ($pid, 'probe-pipe', now(), now())""",
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($pid, $pid, $dsId, 0)"""
    )))
    PipelineId(pid)
  }

  "HEL-1174 probe 1 -- the reconnect gap (candidates a/b/c)" should {

    "drop a succeeded event published while no subscriber is registered, permanently, to the next subscriber" in {
      val registry = new PipelineRunRegistry()(typedSystem)
      val pid      = "probe-reconnect-gap-" + UUID.randomUUID().toString

      // Step 1: an initial subscriber connects (mirrors the fan-out manager's first `connect()`).
      val firstSub = registry.subscribe(pid).take(1).runWith(Sink.seq)(Materializer(system))
      registry.publish(pid, RunStatusEvent("succeeded", rowCount = Some(1), runId = Some("run-1")))
      await(firstSub).map(_.status) shouldBe Seq("succeeded")

      // Step 2: the terminal event above already cleared the registry's subscriber set for this
      // pipeline id (PipelineRunRegistry.broadcastLocal's own terminal-cleanup branch) -- this IS
      // the reconnect gap: zero subscribers registered, exactly the window between the fan-out
      // manager's old stream closing and its new `connect()` call registering.
      registry.subscriberCountForTest(pid) shouldBe 0

      // Step 3: a SECOND run completes entirely inside that gap -- no subscriber is listening.
      registry.publish(pid, RunStatusEvent("succeeded", rowCount = Some(2), runId = Some("run-2")))

      // Step 4: the reconnecting subscriber registers AFTER the miss -- exactly like
      // pipelineRunFanout.ts's post-terminal `connect()` call.
      val secondSub = registry.subscribe(pid).take(1).runWith(Sink.seq)(Materializer(system))

      // Probe-confirmed: nothing arrives. `run-2`'s outcome is permanently unobservable via the
      // ephemeral push channel alone -- this is the structural root cause the e2e's second-submit
      // assertion was catching in CI (candidates (a)/(b)/(c) are all instances of this one gap;
      // the exact sub-path a real reconnect races through does not change the conclusion).
      a[TimeoutException] should be thrownBy Await.result(secondSub, 1.second)
    }
  }

  "HEL-1174 probe 2 -- does a second run actually land? (candidate e)" should {

    "persist TWO succeeded pipeline_runs rows for two runs submitted back-to-back, under the same guard defaults the e2e's dev backend runs (no rate/concurrency rejection)" in {
      implicit val ec: ExecutionContext = routeEc
      val dsId = seedDsWithData()
      val pid  = seedPipeline(dsId)
      val cache = new PipelineRunCache()
      val registry = new PipelineRunRegistry()(typedSystem)
      // No pipelineRunGuardRepo (rate limit off, matches every other guard-off fixture in this
      // test suite); guardConfig defaults to PipelineRunGuardConfig.fromEnv() -- the SAME
      // production defaults (rateLimitPerWindow=10/60s effectively unused here, maxConcurrent=3)
      // the ticket's own "generous relative to this test" analysis describes. The concurrency cap
      // IS active (a real pipelineRunRepo is passed), exactly like production.
      val service = new PipelineRunService(
        pipelineRepo, stepRepo, dataSourceRepo, pipelineRunRepo, cache, registry, fileSystem,
        connector = new RestApiConnectorDriver(None)
      )

      val first  = await(service.submit(pid, isDry = false, dummyUser))
      first.isRight shouldBe true
      val second = await(service.submit(pid, isDry = false, dummyUser))
      second.isRight shouldBe true

      val rows = await(pipelineRunRepo.listByPipelineInternal(pid))
      // Probe-confirmed: BOTH runs persisted as succeeded -- the guard/debounce layer is NOT
      // rejecting the second run under these (or the e2e's much more generous, ~30s-apart) write
      // conditions. Candidate (e) is falsified; the SSE ephemeral-channel gap (probe 1 above) is
      // the actual cause, and the reconciliation fix (Decisions 2-3) is the one that turns the
      // e2e green.
      rows.count(_.status == "succeeded") shouldBe 2
    }
  }
}
