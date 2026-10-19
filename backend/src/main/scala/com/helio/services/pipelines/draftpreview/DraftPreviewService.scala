package com.helio.services.pipelines.draftpreview

import com.helio.api.protocols.pipelines.DraftPreviewLine._
import com.helio.api.protocols.pipelines.{DraftPreviewLine, DraftPreviewRequest}
import com.helio.domain.engine.{DraftPreviewCancelled, InProcessPipelineEngine, NodeKey, NodeOutcome, RootKey, StepExecutionException, StepKey}
import com.helio.domain.model.{AuthenticatedUser, PipelineId, PipelineRootId, PipelineStep, PipelineStepId}
import com.helio.infrastructure.persistence.pipelines.{PipelineRepository, PipelineRunRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.services.ServiceError
import org.apache.pekko.NotUsed
import org.apache.pekko.stream.{BoundedSourceQueue, QueueOfferResult}
import org.apache.pekko.stream.scaladsl.Source
import org.apache.pekko.util.ByteString
import org.slf4j.LoggerFactory
import spray.json._

import java.util.concurrent.atomic.{AtomicBoolean, AtomicInteger}
import scala.concurrent.{ExecutionContext, Future}
import scala.util.control.NonFatal
import scala.util.{Failure, Success, Try}

object DraftPreviewService {

  /** Test-only seam (default no-op): called after each evaluated step's line is queued, with the 1-based count of steps
   *  evaluated so far and a view of the cancel flag. A spec holds here to make "abort after the first line" deterministic. */
  type NodeHook = (Int, () => Boolean) => Unit
  val NoHook: NodeHook = (_, _) => ()

  /** The route's slot, as the service sees it. The walk owns the slot from [[onWalkStarted]] to [[onWalkEnded]]; a stream that
   *  ends for a walk that never started (it was refused, expired or cancelled first) hands the slot back via [[onStreamTerminated]]. */
  final case class SlotHooks(onStreamTerminated: () => Unit, onWalkStarted: () => Unit, onWalkEnded: () => Unit)

  /** One line per enabled step, plus the final `rows` and a possible `failed`. */
  val QueueCapacity: Int = DraftPreviewLimits.MaxSteps + 2
}

/** HEL-1630: evaluates an unsaved draft's steps over client-supplied frames and streams the result as NDJSON. Never reads a
 *  data source (ruling C2), never calls a model (ruling F), never writes a run, snapshot or write-back, and never logs a
 *  cell.
 *
 *  Everything that can be refused is refused before the response is committed: access, decoding, the caps and the graph
 *  checks. The access check runs twice, the second time immediately before the walk (HEL-1516), because decoding can be slow
 *  and a grant may have been revoked meanwhile. */
final class DraftPreviewService(
    pipelineRepo: PipelineRepository,
    stepRepo: PipelineStepRepository,
    engine: InProcessPipelineEngine,
    dataSourceRepo: DataSourceRepository,
    afterNode: DraftPreviewService.NodeHook = DraftPreviewService.NoHook
)(implicit ec: ExecutionContext) {
  import DraftPreviewService._

  private val log = LoggerFactory.getLogger(getClass)

  /** `slot` is how the route's in-flight slot follows the request: it is held until the walk's own Future completes (a cancel
   *  stops the walk only at the next node boundary, so the stream ending does not mean the evaluation has ended). */
  def start(
      pipelineId: PipelineId,
      body: JsValue,
      user: AuthenticatedUser,
      slot: SlotHooks
  ): Future[Either[ServiceError, Source[ByteString, NotUsed]]] =
    authorize(pipelineId, user, firstCheck = true).flatMap {
      case Left(e) => Future.successful(Left(e))
      case Right(_) =>
        prepare(pipelineId, body) match {
          case Left(e) => Future.successful(Left(e))
          case Right((req, plan)) =>
            authorize(pipelineId, user, firstCheck = false).map(_.map(_ => stream(pipelineId, req, plan, slot)))
        }
    }

  private def authorize(id: PipelineId, user: AuthenticatedUser, firstCheck: Boolean): Future[Either[ServiceError, Unit]] = {
    def notFound = ServiceError.NotFound("Pipeline not found: " + id.value)
    // A def, not a val: the role read must start only after `findByIdShared` has answered, never alongside it.
    def check: Future[Either[ServiceError, Unit]] =
      pipelineRepo.checkPreviewAccessInternal(id, user, requireEditor = true).map {
        case PipelineRunRepository.RunAuthorization.Authorized    => Right(())
        case PipelineRunRepository.RunAuthorization.NotAuthorized => Left(ServiceError.Forbidden("Forbidden"))
        case PipelineRunRepository.RunAuthorization.PipelineGone  => Left(notFound)
      }
    if (firstCheck)
      pipelineRepo.findByIdShared(id, Some(user)).flatMap {
        case None    => Future.successful(Left(notFound))
        case Some(_) => check
      }
    else check
  }

  private def prepare(pipelineId: PipelineId, body: JsValue): Either[ServiceError, (DraftPreviewRequest, DraftPreviewPlan)] =
    for {
      req     <- DraftPreviewRequestDecoder.decode(body)
      decoded <- DraftPreviewStepDecoder.decode(stepRepo, pipelineId, req)
      plan    <- DraftPreviewPlanner.plan(req, decoded)
    } yield (req, plan)

  private def stream(
      pipelineId: PipelineId,
      req: DraftPreviewRequest,
      plan: DraftPreviewPlan,
      slot: SlotHooks
  ): Source[ByteString, NotUsed] = {
    val cancelled = new AtomicBoolean(false)
    Source
      .queue[ByteString](QueueCapacity)
      .mapMaterializedValue { queue =>
        walk(pipelineId, req, plan, cancelled, line => offer(queue, line), () => queue.complete(), slot)
        NotUsed
      }
      .watchTermination() { (notUsed, done) =>
        done.onComplete { _ =>
          cancelled.set(true)
          slot.onStreamTerminated()
        }
        notUsed
      }
  }

  /** Anything but `Enqueued` fails the walk rather than silently dropping a line. `QueueClosed` (the client went away mid-step)
   *  is deliberately NOT turned into [[DraftPreviewCancelled]]: only the engine's own `shouldContinue` check may produce that,
   *  so the logged outcome `aborted` still means "stopped at a node boundary because the stream was cancelled". */
  private def offer(queue: BoundedSourceQueue[ByteString], line: DraftPreviewLine): Unit =
    queue.offer(ByteString(line.toJson.compactPrint + "\n")) match {
      case QueueOfferResult.Enqueued    => ()
      case other                        => throw new IllegalStateException(s"Draft preview line was not enqueued: $other")
    }

  private def walk(
      pipelineId: PipelineId,
      req: DraftPreviewRequest,
      plan: DraftPreviewPlan,
      cancelled: AtomicBoolean,
      emit: DraftPreviewLine => Unit,
      finish: () => Unit,
      slot: SlotHooks
  ): Unit = {
    slot.onWalkStarted()
    val started       = System.nanoTime()
    val evaluated     = new AtomicInteger(0)
    val enabledTotal  = req.steps.count(_.enabled)
    val walked        = plan.walkSteps
    val enabledWalked = walked.filter(_.enabled).map(_.id.value).toSet
    val requestOrder  = req.steps.map(_.id).zipWithIndex.toMap
    val rootIdOfStep: Map[PipelineStepId, PipelineRootId] =
      req.steps.flatMap(s => s.rootId.map(r => PipelineStepId(s.id) -> PipelineRootId(r))).toMap

    def onFrame(key: NodeKey, rows: Seq[Map[String, Any]]): Unit = key match {
      // A client that has gone must not make the next offer fail: skipping it lets the engine's own `shouldContinue` check end the
      // walk with `DraftPreviewCancelled`, so a routine mid-node abort is logged as `aborted`, not `failed`.
      case StepKey(id) if enabledWalked.contains(id) && !cancelled.get() =>
        val n = evaluated.incrementAndGet()
        emit(DraftPreviewStepLine(id, rows.size, DraftPreviewSchema.of(rows)))
        afterNode(n, () => cancelled.get())
      case _ => ()
    }

    def onError(step: PipelineStep, ex: Throwable): Unit = {
      val message = ex match {
        case s: StepExecutionException => s.reason
        case _                         => "step execution failed"
      }
      if (cancelled.get()) return
      emit(DraftPreviewErrorLine(step.id.value, message))
      InProcessPipelineEngine
        .dependentsClosure(walked, Set(step.id.value))
        .filter(enabledWalked.contains)
        .toVector
        .sortBy(requestOrder.getOrElse(_, Int.MaxValue))
        .foreach(id => emit(DraftPreviewUnavailableLine(id, Reason.DownstreamOfError)))
    }

    val secondaries: String => Future[Seq[Map[String, Any]]] = id =>
      req.sources.get(id).filter(_.complete) match {
        case Some(src) => Future.successful(src.rows)
        case None      => Future.failed(new IllegalStateException("Draft preview secondary was not supplied"))
      }

    def outcomeOf(result: Try[Map[NodeKey, NodeOutcome]]): String = result match {
      case Success(_)                        => "completed"
      case Failure(_: DraftPreviewCancelled) => s"aborted-after-${evaluated.get()}-of-$enabledTotal"
      case Failure(_)                        => "failed"
    }

    val run: Future[Map[NodeKey, NodeOutcome]] =
      try {
        plan.unavailable.foreach(emit)
        engine
          .executeTree(
            rootFrames = req.roots.map(r => r.id -> (r.rows: Seq[Map[String, Any]])),
            steps = walked,
            stepRepo = stepRepo,
            rootIdOfStep = rootIdOfStep,
            dataSourceRepo = dataSourceRepo,
            contextTransform = DraftPreviewStandIns.draftContext(secondaries),
            externalLanes = req.lanes.map { case (id, frame) => id -> (frame.rows: Seq[Map[String, Any]]) },
            onNodeFrame = onFrame,
            onNodeError = Some(onError),
            shouldContinue = () => !cancelled.get(),
            retainOnly = Some(Set(plan.rowsStepId.fold[NodeKey](RootKey(req.roots.head.id))(StepKey(_))))
          )
          .map(_.nodeOutcomes)
      } catch { case NonFatal(e) => Future.failed(e) }

    run.map { outcomes => if (!cancelled.get()) emit(rowsLine(req, plan, outcomes)) }.onComplete { result =>
      val outcome = outcomeOf(result.map(_ => Map.empty))
      if (outcome == "failed") {
        // The class only: a cause's message can carry the very cell that broke it.
        log.warn("draft-preview pipeline={} failed with {}", pipelineId.value, result.failed.get.getClass.getName)
        Try(emit(DraftPreviewFailedLine))
      }
      Try(finish())
      try
        log.info(
          "draft-preview pipeline={} steps={} outcome={} durationMs={}",
          pipelineId.value,
          Int.box(req.steps.size),
          outcome,
          Long.box((System.nanoTime() - started) / 1000000L)
        )
      // Only now, once the evaluation has really ended, do the running and per-principal slots come back.
      finally slot.onWalkEnded()
    }
  }

  private def rowsLine(req: DraftPreviewRequest, plan: DraftPreviewPlan, outcomes: Map[NodeKey, NodeOutcome]): DraftPreviewLine = {
    val key: NodeKey = plan.rowsStepId.fold[NodeKey](RootKey(req.roots.head.id))(StepKey(_))
    outcomes.get(key) match {
      case Some(o) =>
        val shown = o.rows.take(DraftPreviewLimits.MaxResponseRows)
        DraftPreviewRowsLine(plan.rowsStepId, available = true, shown.map(DraftPreviewCells.encode).toVector, o.rows.size, truncated = o.rows.size > shown.size)
      case None => DraftPreviewRowsLine(plan.rowsStepId, available = false, Vector.empty, 0, truncated = false)
    }
  }
}
