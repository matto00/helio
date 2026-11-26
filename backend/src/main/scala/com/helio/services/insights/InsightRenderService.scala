package com.helio.services.insights

import com.helio.domain.insights._
import com.helio.domain.model.{AuthenticatedUser, Output, OutputId, OutputKind, Pipeline, PipelineId, PipelineRunId}
import com.helio.domain.outputs.{InsightConfig, InsightRefresh}
import com.helio.domain.util.Clock
import com.helio.infrastructure.ai.ClaudeModelCatalog
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputInsightRepository, OutputRepository, PipelineRepository, PipelineStepRepository}
import com.helio.services.ServiceError
import com.helio.services.auth.AiPipelineQuotaGate
import com.helio.services.pipelines.OutputHistoryService
import org.slf4j.LoggerFactory
import slick.jdbc.PostgresProfile.api._
import spray.json.{JsObject, JsString}

import java.time.{Duration => JDuration, Instant}
import java.util.UUID
import java.util.concurrent.{ConcurrentHashMap, CopyOnWriteArrayList, Executors, ScheduledExecutorService, TimeUnit}
import java.util.concurrent.atomic.{AtomicBoolean, AtomicInteger, AtomicLong}
import scala.concurrent.duration._
import scala.concurrent.{ExecutionContext, Future, Promise, TimeoutException}
import scala.jdk.CollectionConverters._
import scala.util.{Failure, Success, Try}
import scala.util.control.NonFatal

/** Tunables, each overridable by a test. `timeout` bounds one render (send plus its single validator retry). */
final case class InsightRenderConfig(
    timeout: FiniteDuration = 30.seconds,
    throttle: JDuration = JDuration.ofHours(1),
    overlapGrace: JDuration = JDuration.ofMinutes(10),
    maxModelCallsPerPass: Int = 10,
    bucketSeconds: Long = 900L,
    dailyHourUtc: Int = 6
)

/** `started` is false when a render of that Output was already in flight in this process. */
final case class InsightRefreshAccepted(outputId: String, started: Boolean)

/** What the scheduler tick starts; kept a trait so the scheduler test can hand it a failing one. */
trait InsightTickPass {
  def tickPass(now: Instant): Future[Unit]
}

/** HEL-1743: when and how an insight renders. Triggers: after a real run (`renderForRun`), the tick pass (`daily` and
 *  `on_run` catch-up) and manual/pin refresh. Guards run in a fixed order: input digest, hourly throttle (automatic triggers
 *  only), pack size, owner-keyed weighted quota, then the send. A render never fails a run, and every outcome is one row
 *  (or a coalesced update of the newest row). Time comes from the injected `clock` everywhere, so a test drives the
 *  render stamps and the tick pass from one clock. */
final class InsightRenderService(
    outputRepo: OutputRepository,
    pipelineRepo: PipelineRepository,
    stepRepo: PipelineStepRepository,
    snapshotRepo: NodeSnapshotRepository,
    historyService: OutputHistoryService,
    insightRepo: OutputInsightRepository,
    quotaGate: AiPipelineQuotaGate,
    renderer: InsightRenderer,
    catalog: ClaudeModelCatalog,
    serverDefaultModel: String,
    clock: Clock,
    ctx: DbContext,
    access: InsightAccess,
    config: InsightRenderConfig = InsightRenderConfig(),
    /** False when no API key is configured: every render then records a no-model `failed` row before any charge. */
    modelAvailable: Boolean = true,
    limits: InsightLimits = InsightLimits(),
    /** Called with each started render's `(outputId, result)` once it completes; a no-op in production (a test awaits it). */
    renderObserver: (String, InsightRenderService.RenderResult) => Unit = (_, _) => ()
)(implicit ec: ExecutionContext) extends InsightRunTrigger with InsightTickPass {

  import InsightRenderService._

  private val log     = LoggerFactory.getLogger(getClass)
  private val inputs  = new InsightInputsBuilder(outputRepo, stepRepo, snapshotRepo, historyService)
  private val timer: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor { r =>
    val t = new Thread(r, "insight-render-timeout"); t.setDaemon(true); t
  }

  /** Output ids with a render in flight in THIS process. Released when the underlying send completes, not at the timeout,
   *  so a hung send cannot overlap a second one here. */
  private val inFlight = ConcurrentHashMap.newKeySet[String]()

  private val listeners = new CopyOnWriteArrayList[InsightRenderedListener]()
  def addListener(l: InsightRenderedListener): Unit = listeners.add(l)

  // ----- run trigger ------------------------------------------------------------------------------------------

  override def afterRunSucceeded(pipelineId: PipelineId, runId: PipelineRunId): Future[Unit] = renderForRun(pipelineId, runId)

  /** Renders every `on_run` insight of the pipeline, one after another. Never fails. */
  def renderForRun(pipelineId: PipelineId, runId: PipelineRunId): Future[Unit] =
    Future.delegate(
      for {
        outputs <- outputRepo.listByPipelineInternal(pipelineId)
        insights = outputs.filter(_.kind == OutputKind.Insight)
        configs <- outputRepo.findConfigsByIdsInternal(insights.map(_.id.value))
        due      = insights.filter(o => refreshOf(configs.getOrElse(o.id.value, JsObject.empty)) == InsightRefresh.OnRun)
        _       <- sequentially(due)(o => startRender(o, InsightTrigger.OnRun, Some(runId.value), automatic = true)._2.map(_ => ()))
      } yield ()
    ).recover { case NonFatal(e) => log.warn(s"insight render after run ${runId.value} of pipeline ${pipelineId.value} failed", e) }

  // ----- manual refresh ---------------------------------------------------------------------------------------

  /** `Forbidden` for a viewer; the same `NotFound` for a stranger, an unknown id and a non-insight Output. The render is
   *  started, not awaited: the caller learns the result from `GET /insight`. Bypasses the hourly throttle, never the digest
   *  skip or the quota gate. `trigger` is `Manual` or `Pin`. */
  def refresh(id: OutputId, user: AuthenticatedUser, trigger: InsightTrigger): Future[Either[ServiceError, InsightRefreshAccepted]] =
    access.resolve(id, user).map {
      case Left(err) => Left(err)
      case Right((_, acc)) if !InsightAccess.isPrivileged(acc) => Left(ServiceError.Forbidden("Only the pipeline owner or an editor can refresh an insight"))
      case Right((output, _)) =>
        val (started, done) = startRender(output, trigger, runId = None, automatic = false, requester = Some(user))
        done.failed.foreach(e => log.warn(s"insight refresh of ${id.value} failed", e))
        Right(InsightRefreshAccepted(id.value, started))
    }

  /** The newest `ok` render, with no ACL check: for internal callers (the HEL-919 delivery seam) only. */
  def latestFor(outputId: String): Future[Option[OutputInsightRecord]] = insightRepo.latestOk(outputId)

  // ----- tick pass --------------------------------------------------------------------------------------------

  private val lastBucket = new AtomicLong(-1L)
  private val passBusy   = new AtomicBoolean(false)

  /** One pass per aligned `bucketSeconds` wall-clock bucket and one in flight per process; across instances an advisory lock
   *  held on a pinned privileged session lets one pass render at a time (no transaction is open across a model call). Never
   *  fails. */
  override def tickPass(now: Instant): Future[Unit] = {
    val bucket = now.getEpochSecond / config.bucketSeconds
    val prev   = lastBucket.get()
    if (prev == bucket || !passBusy.compareAndSet(false, true)) Future.unit
    else if (!lastBucket.compareAndSet(prev, bucket)) { passBusy.set(false); Future.unit }
    else
      Future.delegate(runLocked(now))
        .recover { case NonFatal(e) => log.error("insight tick pass failed", e) }
        .andThen { case _ => passBusy.set(false) }
  }

  private def runLocked(now: Instant): Future[Unit] = {
    val lock   = sql"SELECT pg_try_advisory_lock(#$LockKey)".as[Boolean].head
    val unlock = sql"SELECT pg_advisory_unlock(#$LockKey)".as[Boolean].head
    // Privileged on purpose: a background pass has no user, and the advisory lock must live on one connection; the pass
    // itself reads and writes through the repositories' own privileged contexts.
    ctx.withSystemPinnedSession(
      lock.flatMap { got =>
        if (!got) { log.debug("insight tick pass: another instance holds the lock; skipping this bucket"); DBIO.successful(()) }
        else DBIO.from(runCandidates(now)).cleanUp(_ => unlock.map(_ => ()), keepFailure = true)
      }
    )
  }

  private def runCandidates(now: Instant): Future[Unit] =
    insightRepo.listCandidates().flatMap { all =>
      val due = all.filter(c => InsightSchedule.dailyDue(c, now, config.dailyHourUtc) || InsightSchedule.catchUpDue(c, now, config.throttle, config.overlapGrace))
      val calls = new AtomicInteger(0)
      sequentially(due.sortBy(_.newestAttempt)(Ordering.Option(Ordering[Instant]))) { c =>
        if (calls.get >= config.maxModelCallsPerPass) Future.unit
        else
          outputRepo.findByIdInternal(OutputId(c.outputId)).flatMap {
            case None => Future.unit
            case Some(output) =>
              val trigger = if (c.refresh == "daily") InsightTrigger.Daily else InsightTrigger.OnRun
              startRender(output, trigger, runId = None, automatic = true, at = Some(now))._2.map { r => if (r.reachedModel) calls.incrementAndGet(); () }
          }
      }
    }

  // ----- one render -------------------------------------------------------------------------------------------

  /** Claims the Output (no second render of it in this process) and starts the render. The future never fails. */
  private def startRender(
      output: Output, trigger: InsightTrigger, runId: Option[String], automatic: Boolean, at: Option[Instant] = None,
      requester: Option[AuthenticatedUser] = None
  ): (Boolean, Future[RenderResult]) = {
    val id = output.id.value
    if (!inFlight.add(id)) { log.info(s"insight render of $id skipped: one is already in flight"); (false, Future.successful(RenderResult.InFlight)) }
    else {
      val start    = at.getOrElse(clock.now())
      val handedOff = new AtomicBoolean(false)
      val done = Future.delegate(renderGuarded(output, trigger, runId, automatic, start, () => handedOff.set(true), requester))
        .recover { case NonFatal(e) => log.warn(s"insight render of $id (${trigger.wire}) failed unexpectedly", e); RenderResult.Errored }
        .andThen { case _ => if (!handedOff.get()) inFlight.remove(id) }
        .andThen { case Success(r) => try renderObserver(id, r) catch { case NonFatal(e) => log.warn("insight render observer failed", e) } }
      (true, done)
    }
  }

  private def renderGuarded(
      output: Output, trigger: InsightTrigger, runId: Option[String], automatic: Boolean, start: Instant,
      handOff: () => Unit, requester: Option[AuthenticatedUser]
  ): Future[RenderResult] =
    requester match {
      // HEL-1882 D4: a manual or pin refresh acts for the requester, who must STILL be owner or editor when the render starts: this is
      // before any attempt row, quota charge or model call, so a refused render writes and charges nothing. Automatic triggers act
      // for no user (requester None) and are unchanged.
      case Some(user) =>
        pipelineRepo.currentWriteAccessInternal(output.node.pipelineId, user).flatMap { access =>
          if (access.mayWrite) renderAuthorised(output, trigger, runId, automatic, start, handOff)
          else { log.info(s"insight render of ${output.id.value} refused: the requester no longer has write access ($access)"); Future.successful(RenderResult.Refused) }
        }
      case None => renderAuthorised(output, trigger, runId, automatic, start, handOff)
    }

  private def renderAuthorised(
      output: Output, trigger: InsightTrigger, runId: Option[String], automatic: Boolean, start: Instant, handOff: () => Unit
  ): Future[RenderResult] = {
    val id = output.id.value
    pipelineRepo.findByIdInternal(output.node.pipelineId).flatMap {
      case None => Future.successful(RenderResult.Gone)
      case Some(pipeline) =>
        val pipelineId = pipeline.id.value
        def noSend(status: InsightStatus, digest: Option[String]): Future[RenderResult] =
          write(OutputInsightInsert(id, pipelineId, runId, trigger, status, None, inputDigest = digest, createdAt = start))
            .map(_ => RenderResult.Wrote(status, reachedModel = false))
        outputRepo.findConfigsByIdsInternal(Vector(id)).flatMap { configs =>
          InsightConfig.parse(configs.getOrElse(id, JsObject.empty), _ => true) match {
            case Left(msg) =>
              log.warn(s"insight $id has an unusable stored config ($msg); recording a failed attempt")
              noSend(InsightStatus.Failed, None)
            case Right(cfg) =>
              resolveModel(cfg) match {
                case Left(unselectable) =>
                  log.warn(s"insight $id names model '$unselectable', which is no longer selectable; recording a failed attempt")
                  noSend(InsightStatus.Failed, None)
                case Right(_) if !modelAvailable =>
                  log.warn(s"insight $id not rendered: no model is configured")
                  noSend(InsightStatus.Failed, None)
                case Right(m) =>
                  val ctxOf = RenderContext(output, pipeline, cfg, m, trigger, runId, automatic, start)
                  proceed(ctxOf, noSend, handOff)
              }
          }
        }
    }
  }

  /** The guards, in order: digest, hourly throttle, pack size, quota, then the send. */
  private def proceed(
      c: RenderContext, noSend: (InsightStatus, Option[String]) => Future[RenderResult], handOff: () => Unit
  ): Future[RenderResult] = {
    val spec = InsightRenderSpec(c.cfg.maxSentences, c.cfg.maxChars, c.cfg.prompt)
    inputs.build(c.output, c.cfg, c.pipeline, c.start, limits).flatMap { built =>
      val digest = InsightDigest.compute(built.preset, spec, c.model.id, built.inputs)
      insightRepo.latestOk(c.output.id.value).flatMap { latestOk =>
        if (latestOk.exists(_.inputDigest.contains(digest))) noSend(InsightStatus.SkippedUnchanged, Some(digest))
        else
          throttled(c).flatMap {
            case true => log.info(s"insight ${c.output.id.value} throttled: a model call was made within the last hour"); Future.successful(RenderResult.Throttled)
            case false =>
              renderer.prepare(built.inputs, built.preset, spec) match {
                case Left(estimate) =>
                  log.warn(s"insight ${c.output.id.value} grounding pack is over the input budget ($estimate tokens); not sent")
                  noSend(InsightStatus.SkippedBudget, Some(digest))
                case Right(prompt) =>
                  quotaGate.checkAndIncrement(c.pipeline.ownerId, c.model.weight).flatMap {
                    case Left(_)  => noSend(InsightStatus.SkippedQuota, Some(digest))
                    case Right(_) => send(c, built, prompt, spec, digest, handOff)
                  }
              }
          }
      }
    }
  }

  /** Automatic triggers skip when the Output's newest model call is younger than the throttle: a broken model is called at
   *  most once an hour per Output, and a throttled render writes no row (the tick pass catches it up). */
  private def throttled(c: RenderContext): Future[Boolean] =
    if (!c.automatic) Future.successful(false)
    else insightRepo.lastModelCallAt(c.output.id.value).map(_.exists(last => last.isAfter(c.start.minus(config.throttle))))

  private def send(
      c: RenderContext, built: InsightRenderInputs, prompt: InsightBuiltPrompt, spec: InsightRenderSpec, digest: String, handOff: () => Unit
  ): Future[RenderResult] = {
    val id = c.output.id.value
    // Asserted by the live check: the model that will be requested, logged before the call.
    log.info(s"insight render: requesting model '${c.model.id}' for output $id (trigger ${c.trigger.wire})")
    handOff()
    val sent: Future[InsightRenderOutcome] =
      Try(renderer.send(prompt, built.preset, spec, None, c.model.wire)) match {
        case Success(f) => f
        case Failure(e) => Future.failed(e)
      }
    sent.onComplete(_ => inFlight.remove(id))
    // First completion wins: the render or the timeout. A result that arrives after the timeout finds the promise taken,
    // so it writes no row and publishes nothing.
    val race = Promise[Try[InsightRenderOutcome]]()
    sent.onComplete(t => race.trySuccess(t))
    val handle = timer.schedule(new Runnable { def run(): Unit = { race.trySuccess(Failure(new TimeoutException(s"render exceeded ${config.timeout}"))); () } }, config.timeout.toMillis, TimeUnit.MILLISECONDS)
    race.future.onComplete(_ => handle.cancel(false))
    race.future.flatMap { outcome =>
      val row = rowFor(c, digest, prompt, outcome)
      write(row).map { recordId =>
        if (row.status == InsightStatus.Ok) recordId.foreach(rid => notifyRendered(InsightRendered(id, c.pipeline.id.value, rid)))
        RenderResult.Wrote(row.status, reachedModel = true)
      }
    }
  }

  private def rowFor(c: RenderContext, digest: String, prompt: InsightBuiltPrompt, outcome: Try[InsightRenderOutcome]): OutputInsightInsert = {
    val id = c.output.id.value
    def base(status: InsightStatus): OutputInsightInsert =
      OutputInsightInsert(id, c.pipeline.id.value, c.runId, c.trigger, status, None, inputDigest = Some(digest), model = Some(c.model.id), createdAt = c.start)
    def withUsage(row: OutputInsightInsert, usage: InsightUsage, cost: Option[Long]): OutputInsightInsert =
      if (usage == InsightUsage.Zero) row
      else row.copy(
        inputTokens = Some(usage.inputTokens), outputTokens = Some(usage.outputTokens),
        cacheCreationTokens = Some(usage.cacheCreationInputTokens), cacheReadTokens = Some(usage.cacheReadInputTokens), costMicros = cost
      )
    outcome match {
      case Success(InsightRenderOutcome.Accepted(render, usage, cost)) =>
        val citations = render.citationsUsed.flatMap(prompt.pack.citationById.get).map(StoredInsightCitation.from)
        withUsage(base(InsightStatus.Ok).copy(markdown = Some(render.text), citations = citations), usage, cost)
      case Success(InsightRenderOutcome.Rejected(reasons, usage, cost, _)) =>
        log.warn(s"insight $id render rejected by the validator after one retry: ${reasons.mkString("; ")}")
        withUsage(base(InsightStatus.Failed), usage, cost)
      case Success(InsightRenderOutcome.Failed(InsightModelFailure.Unavailable(reason), _, _, _)) =>
        log.warn(s"insight $id not rendered: $reason")
        base(InsightStatus.Failed).copy(model = None)
      case Success(InsightRenderOutcome.Failed(failure, usage, cost, _)) =>
        log.warn(s"insight $id render failed: $failure")
        withUsage(base(InsightStatus.Failed), usage, cost)
      case Success(InsightRenderOutcome.PackTooLarge(estimate, _)) =>
        log.warn(s"insight $id pack too large at send time ($estimate)")
        base(InsightStatus.Failed)
      case Failure(e) =>
        log.warn(s"insight $id render failed: ${e.getClass.getSimpleName}: ${e.getMessage}")
        base(InsightStatus.Failed)
    }
  }

  /** Explicit `model` must still be selectable; absent uses the server default unconditionally. A catalog-defined id is sent
   *  by name (so the catalog request rules apply); a non-catalog default is sent as `CLAUDE_MODEL` itself. */
  private def resolveModel(cfg: InsightConfig): Either[String, ResolvedModel] =
    cfg.model match {
      case Some(id) => catalog.select(id).map(spec => ResolvedModel(spec.id, Some(spec.id), catalog.weightOf(spec.id))).toRight(id)
      case None     => Right(ResolvedModel(serverDefaultModel, catalog.definition(serverDefaultModel).map(_.id), catalog.weightOf(serverDefaultModel)))
    }

  /** One outcome, one row, except a no-model outcome whose status equals the newest attempt's, which updates that attempt
   *  (a no-model `failed` only merges into another no-model `failed`, never into a row that carries a model, tokens or cost). */
  private def write(row: OutputInsightInsert): Future[Option[UUID]] =
    if (row.model.isDefined) insightRepo.insertReturningId(row).map(Some(_))
    else
      insightRepo.latestAttempt(row.outputId).flatMap {
        case Some(newest) if newest.status == row.status && (row.status != InsightStatus.Failed || newest.model.isEmpty) =>
          insightRepo.coalesce(newest.id, row.createdAt, row.trigger, row.runId, row.inputDigest).map(_ => Some(newest.id))
        case _ => insightRepo.insertReturningId(row).map(Some(_))
      }

  private def notifyRendered(event: InsightRendered): Unit =
    listeners.asScala.foreach(l => try l.onRendered(event) catch { case NonFatal(e) => log.warn("InsightRendered listener failed", e) })
}

object InsightRenderService {

  /** Advisory-lock key for the tick pass: ASCII "HEL1743" as a number; no other lock uses it. */
  val LockKey: Long = 0x48454C31373433L

  /** The model one render uses: the id (for the digest, the row and the weight) and what to put on the wire. */
  final case class ResolvedModel(id: String, wire: Option[String], weight: Int)

  private final case class RenderContext(
      output: Output, pipeline: Pipeline, cfg: InsightConfig, model: ResolvedModel, trigger: InsightTrigger,
      runId: Option[String], automatic: Boolean, start: Instant
  )

  sealed trait RenderResult { def reachedModel: Boolean }
  object RenderResult {
    case object InFlight  extends RenderResult { val reachedModel = false }
    case object Gone      extends RenderResult { val reachedModel = false }
    case object Throttled extends RenderResult { val reachedModel = false }
    case object Errored   extends RenderResult { val reachedModel = false }
    /** HEL-1882: a manual or pin refresh whose requester lost owner-or-editor access before the render started. */
    case object Refused   extends RenderResult { val reachedModel = false }
    final case class Wrote(status: InsightStatus, reachedModel: Boolean) extends RenderResult
  }

  def refreshOf(config: JsObject): InsightRefresh =
    config.fields.get("refresh").collect { case JsString(s) => s }.flatMap(InsightRefresh.fromString).getOrElse(InsightRefresh.OnRun)

  def sequentially[A](items: Seq[A])(f: A => Future[Unit])(implicit ec: ExecutionContext): Future[Unit] =
    items.foldLeft(Future.unit)((acc, a) => acc.flatMap(_ => f(a).recover { case NonFatal(_) => () }))
}
