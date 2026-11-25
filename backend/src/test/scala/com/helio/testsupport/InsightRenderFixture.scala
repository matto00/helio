package com.helio.testsupport

import com.helio.services.ServiceError
import com.helio.api.protocols.pipelines.RunResultResponse
import com.helio.domain.insights._
import com.helio.domain.model._
import com.helio.domain.steps.{AssertConfig, ComputeConfig}
import com.helio.domain.util.Clock
import com.helio.infrastructure.ai.ClaudeModelCatalog
import com.helio.infrastructure.persistence.assistant.AssistantDailyUsageRepository
import com.helio.infrastructure.persistence.auth.UserRepository
import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputInsightRepository}
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.auth.{AiPipelineQuotaGate, UserTierConfig}
import com.helio.services.insights.{InsightAccess, InsightRenderConfig, InsightRenderService, InsightRenderer}
import com.helio.services.pipelines.PipelineRunService
import com.helio.api.routes.pipelines.PipelineRunRegistry
import com.helio.spark.PipelineRunCache
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.nio.file.Paths
import java.time.{Duration, Instant}
import java.util.UUID
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.duration._
import scala.concurrent.{Await, ExecutionContext, Future, Promise}
import scala.jdk.CollectionConverters._

/** A scripted [[InsightModelClient]]: records every request and answers through `behaviour` (default: a valid, citation-free
 *  one-sentence narrative that echoes the requested model). */
final class FakeInsightModel extends InsightModelClient {
  private val received = new ConcurrentLinkedQueue[InsightModelRequest]()
  private val count    = new AtomicInteger(0)

  @volatile var behaviour: InsightModelRequest => Future[Either[InsightModelFailure, InsightModelResponse]] = FakeInsightModel.ok

  def sends: Int                            = count.get
  def requests: Vector[InsightModelRequest] = received.asScala.toVector

  override def render(request: InsightModelRequest): Future[Either[InsightModelFailure, InsightModelResponse]] = {
    received.add(request)
    count.incrementAndGet()
    behaviour(request)
  }
}

object FakeInsightModel {
  val Usage: InsightUsage = InsightUsage(120, 30)

  val ok: InsightModelRequest => Future[Either[InsightModelFailure, InsightModelResponse]] =
    r => Future.successful(Right(InsightModelResponse("Revenue held steady.", Usage, r.model.getOrElse("claude-haiku-5-5"))))
}

/** A real clock shifted by `offset`: render stamps, the hourly throttle and the tick pass all read it, while
 *  `pipelines.last_run_at` (stamped by the run path with the real wall clock) stays comparable to it. */
final class ShiftedClock extends Clock {
  @volatile var offset: Duration = Duration.ZERO
  override def now(): Instant    = Instant.now().plus(offset)
  def advance(d: Duration): Unit = offset = offset.plus(d)
}

/** Records every trigger call so a test can wait for the (asynchronous) render a real run started. */
final class RecordingTrigger(inner: => InsightRunTrigger) extends InsightRunTrigger {
  private val futures = new ConcurrentLinkedQueue[Future[Unit]]()
  val calls           = new AtomicInteger(0)

  override def afterRunSucceeded(pipelineId: PipelineId, runId: PipelineRunId): Future[Unit] = {
    // The future is registered BEFORE the call is counted: `settle` waits on the count, then on the futures, so counting first
    // let it see the call with no future to wait for (a flaky empty row list).
    val f = inner.afterRunSucceeded(pipelineId, runId)
    futures.add(f)
    calls.incrementAndGet()
    f
  }

  /** Waits until `n` trigger calls have been made, then for every render they started. */
  def settle(n: Int): Unit = {
    val deadline = System.nanoTime() + 20.seconds.toNanos
    while ((calls.get < n || futures.size < n) && System.nanoTime() < deadline) Thread.sleep(20)
    require(calls.get >= n, s"expected $n insight trigger calls, saw ${calls.get}")
    implicit val ec: ExecutionContext = ExecutionContext.global
    Await.result(Future.sequence(futures.asScala.toVector), 20.seconds)
  }
}

/** HEL-1743: a real runnable pipeline with an insight Output, driven through the production run path, over the history
 *  harness's database (privileged pool = superuser, app pool = a non-bypass role, so sharing is genuinely enforced). */
trait InsightRenderFixture extends OutputHistoryApiHarness {

  final case class Fx(pid: PipelineId, owner: String, insight: OutputId, metric: OutputId, dsId: String, stepId: PipelineStepId)

  protected val shiftedClock = new ShiftedClock

  protected def usageRepo: AssistantDailyUsageRepository = new AssistantDailyUsageRepository(ctx)(harnessEc)
  protected def insightRepo: OutputInsightRepository     = new OutputInsightRepository(ctx)(harnessEc)

  protected def gate(limit: Int = 1000): AiPipelineQuotaGate =
    new AiPipelineQuotaGate.Live(new UserRepository(db)(harnessEc), usageRepo, UserTierConfig(Set.empty, limit))(harnessEc)

  protected def newService(
      model: InsightModelClient,
      catalog: ClaudeModelCatalog = ClaudeModelCatalog.all,
      serverDefault: String = ClaudeModelCatalog.HaikuId,
      cfg: InsightRenderConfig = InsightRenderConfig(timeout = 5.seconds),
      available: Boolean = true,
      quota: AiPipelineQuotaGate = gate()
  ): InsightRenderService = {
    implicit val ec: ExecutionContext = harnessEc
    new InsightRenderService(
      outputRepo, pipelineRepo, stepRepo, snapshotRepo, historyService, insightRepo, quota, new InsightRenderer(model), catalog,
      serverDefault, shiftedClock, ctx, new InsightAccess(outputRepo, accessChecker), cfg, available
    )
  }

  protected def runsWith(
      trigger: InsightRunTrigger, registry: PipelineRunRegistry = null, snapshots: NodeSnapshotRepository = null
  ): PipelineRunService = {
    implicit val ec: ExecutionContext = harnessEc
    new PipelineRunService(
      pipelineRepo, stepRepo, dataSourceRepo, runRepo, new PipelineRunCache(), registry,
      new LocalFileSystem(Paths.get("/")), outputRepo = outputRepo, nodeSnapshotRepo = Option(snapshots).getOrElse(snapshotRepo), outputHistoryRepo = historyRepo,
      insightTrigger = trigger
    )
  }

  private def payload(amounts: Seq[String]): String =
    s"""{"columns":[{"name":"amount","type":"string"}],"rows":${amounts.map(a => s"""["$a"]""").mkString("[", ",", "]")}}"""

  protected def seedFx(tier: String = "beta", insightConfig: String = "{}", withInsight: Boolean = true): Fx = {
    implicit val ec: ExecutionContext = harnessEc
    val owner = seedUser(tier)
    val dsId  = UUID.randomUUID().toString
    val pid   = UUID.randomUUID().toString
    awaitDb(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($dsId, 'ds', 'dataset', '{}', $owner::uuid, now(), now())""",
      DatasetRowsTestSupport.seedActionsFromRaw(dsId, payload(Seq("10", "20"))),
      sqlu"""INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ($pid, 'p', $owner::uuid, now(), now())""",
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($pid, $pid, $dsId, 0)"""
    )))
    val pipelineId = PipelineId(pid)
    val step = awaitDb(stepRepo.insertInternal(pipelineId, "assert", AssertConfig(Vector.empty), enabled = true, None, explicitRootId = None))
    val metricCfg = """{"fieldMapping":{"value":"amount"},"aggregation":{"value":"amount","agg":"sum"},"compare":"previous_run"}""".parseJson.asJsObject
    val metric  = awaitDb(outputRepo.insertInternal(pipelineId, Some(step.id), UserId(owner), "metric", OutputKind.Metric, metricCfg, explicitRootId = None, actor = AuthenticatedUser(UserId(owner))))
    val insightId =
      if (!withInsight) OutputId("none")
      else awaitDb(outputRepo.insertInternal(pipelineId, Some(step.id), UserId(owner), "insight", OutputKind.Insight, insightConfig.parseJson.asJsObject, explicitRootId = None, actor = AuthenticatedUser(UserId(owner)))).id
    Fx(pipelineId, owner, insightId, metric.id, dsId, step.id)
  }

  /** The tick pass scans every insight in the database; removes the other fixtures' insights so a pass sees only `fx`'s. */
  protected def isolate(fx: Fx): Unit =
    awaitDb(db.run(sqlu"DELETE FROM outputs WHERE kind = 'insight' AND id <> ${fx.insight.value}"))

  /** Replaces the dataset source's rows (the next run materializes them). */
  protected def setAmounts(fx: Fx, amounts: Seq[String]): Unit =
    awaitDb(db.run(DBIO.seq(
      sqlu"DELETE FROM dataset_rows WHERE data_source_id = ${fx.dsId}",
      DatasetRowsTestSupport.seedActionsFromRaw(fx.dsId, payload(amounts))
    )))

  protected def asOwner(fx: Fx): AuthenticatedUser = AuthenticatedUser(UserId(fx.owner))

  protected def realRun(svc: PipelineRunService, fx: Fx): Either[ServiceError, RunResultResponse] =
    awaitDb(svc.submit(fx.pid, isDry = false, asOwner(fx)))

  /** Every insight row of an Output, oldest first. */
  protected def rowsOf(outputId: OutputId): Vector[OutputInsightRecord] =
    awaitDb(insightRepo.listRecent(outputId.value, 100, None)).reverse

  protected def counterOf(userId: String): Int =
    awaitDb(db.run(sql"SELECT COALESCE(sum(message_count), 0) FROM assistant_daily_usage WHERE user_id = $userId::uuid".as[Int].head))

  /** Polls `cond` for up to 15 s (a refresh answers 202 before its render finishes). */
  protected def until(what: String)(cond: => Boolean): Unit = {
    val deadline = System.nanoTime() + 15.seconds.toNanos
    while (!cond && System.nanoTime() < deadline) Thread.sleep(25)
    require(cond, s"timed out waiting for: $what")
  }

  /** Appends a step the engine cannot evaluate, so the next run fails. */
  protected def breakPipeline(fx: Fx): Unit = {
    implicit val ec: ExecutionContext = harnessEc
    awaitDb(stepRepo.insertInternal(fx.pid, "compute", ComputeConfig("bad", "stats.adp_ppr - stats.pts_ppr", None), enabled = true, Some(fx.stepId), explicitRootId = None))
    ()
  }

  protected def hanging(): (Promise[Either[InsightModelFailure, InsightModelResponse]], InsightModelRequest => Future[Either[InsightModelFailure, InsightModelResponse]]) = {
    val p = Promise[Either[InsightModelFailure, InsightModelResponse]]()
    (p, _ => p.future)
  }
}
