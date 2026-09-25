package com.helio.api.routes.pipelines

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.actor.{ActorRef, Status => ActorStatus}
import org.apache.pekko.stream.{CompletionStrategy, Materializer, OverflowStrategy}
import org.apache.pekko.NotUsed
import org.apache.pekko.stream.scaladsl.Source
import org.apache.pekko.util.ByteString
import spray.json._

import java.util.concurrent.ConcurrentHashMap
import scala.jdk.CollectionConverters._


/** HEL-913 R15: `nodeKind` is the explicit wire discriminator distinguishing a `nodeId` that
 *  names a pipeline ROOT from one that names a STEP -- `"root"` or `"step"`, always populated
 *  alongside `nodeId` (never one without the other). Before this, `nodeId` carried a raw id
 *  string with no way for a consumer to tell which kind of id it was without ALREADY knowing
 *  which ids in this pipeline are roots (the exact ambiguity `NodeKey`/`RootKey`/`StepKey`
 *  exists internally to eliminate; this closes the same gap on the wire). */
final case class RunStatusEvent(
    status:   String,
    rowCount: Option[Int]    = None,
    errorLog: Option[String] = None,
    // HEL-905 (design.md Decision 6): identifies the node a "node-progress" event describes.
    // HEL-913 R15: `nodeKind` (below) is the discriminator; `nodeId` alone is now ambiguous
    // under multi-root without it.
    nodeId:   Option[String] = None,
    nodeKind: Option[String] = None,
    // HEL-1174 (design.md Decision 3, option (i)): the run this event belongs to. Lets the
    // live-event path (`pipelineRunFanout.ts`) set `entry.lastObservedRunId` directly at the
    // point it fires, the same bookkeeping the reconcile-on-connect path
    // (`GET .../runs/latest`) performs -- one code path either way, and avoids the redundant
    // extra "new run" firing the no-wire-change alternative would otherwise risk on the very
    // next reconnect.
    runId:    Option[String] = None
)

object RunStatusEvent {
  val TerminalStatuses: Set[String] = Set("succeeded", "failed", "dry_run")

  def isTerminal(status: String): Boolean = TerminalStatuses.contains(status)

  /**
   * Encode the event as an SSE wire-format ByteString.
   *
   * Wire format example:
   *   event: run-status\n
   *   data: {"status":"queued"}\n
   *   \n
   */
  def toSseBytes(event: RunStatusEvent): ByteString = {
    val fields = scala.collection.mutable.LinkedHashMap[String, JsValue](
      "status" -> JsString(event.status)
    )
    event.rowCount.foreach(n => fields("rowCount") = JsNumber(n))
    event.errorLog.foreach(s => fields("errorLog") = JsString(s))
    event.nodeId.foreach(s => fields("nodeId") = JsString(s))
    event.nodeKind.foreach(s => fields("nodeKind") = JsString(s))
    event.runId.foreach(s => fields("runId") = JsString(s))
    val json = JsObject(fields.toMap).compactPrint
    ByteString("event: run-status\ndata: " + json + "\n\n")
  }
}


/**
 * In-memory publish/subscribe channel for pipeline run-status events, optionally fanned out
 * across backend instances via a [[PipelineRunNotifyBus]] (HEL-1168 design.md D5-D7).
 *
 * Every live subscriber for a pipelineId receives every event published for that pipeline id
 * -- HEL-1168 replaced the earlier single-`ActorRef`-per-pipeline map (an unconditional
 * `put` overwrite that silently starved every subscriber but the most recently registered one)
 * with a `Set[ActorRef]` per pipeline id.
 */
final class PipelineRunRegistry(eventBus: PipelineRunNotifyBus = null)(implicit system: ActorSystem[_]) {
  private implicit val mat: Materializer = Materializer(system.classicSystem)

  // pipelineId -> the set of actor refs from every currently-subscribed Source.actorRef.
  private val refs = new ConcurrentHashMap[String, java.util.Set[ActorRef]]()

  // HEL-1168 design.md D6: registering here (rather than the bus polling the registry) keeps
  // PipelineRunNotifyBus ignorant of PipelineRunRegistry's existence -- the bus only knows how
  // to send/receive raw (pipelineId, RunStatusEvent) pairs. The bus itself drops any notification
  // whose originInstanceId matches its own (D7 self-echo guard) before this handler ever runs, so
  // `broadcastLocal` below is never called twice for the instance that originated an event.
  if (eventBus != null) {
    eventBus.onReceive((pipelineId, event) => broadcastLocal(pipelineId, event))
  }

  /**
   * Create a new SSE source for pipelineId and return it.
   * The source emits RunStatusEvent values published via publish and
   * completes when a terminal event is published.
   */
  def subscribe(pipelineId: String): Source[RunStatusEvent, NotUsed] = {
    // `draining` (not `immediately`) so the final terminal RunStatusEvent
    // ("succeeded"/"failed"/"dry_run") that was just enqueued before the
    // Success completion signal still reaches the SSE subscriber. With
    // `immediately`, the stream can close before its buffered messages emit.
    val completionMatcher: PartialFunction[Any, CompletionStrategy] = {
      case ActorStatus.Success(_) => CompletionStrategy.draining
    }
    val failureMatcher: PartialFunction[Any, Throwable] = PartialFunction.empty
    val (ref, source) = Source
      .actorRef[RunStatusEvent](completionMatcher, failureMatcher, 8, OverflowStrategy.dropHead)
      .preMaterialize()

    val subscribers = refs.computeIfAbsent(pipelineId, _ => ConcurrentHashMap.newKeySet[ActorRef]())
    subscribers.add(ref)

    // HEL-1168 task 1.2: remove this specific ref from the pipeline's subscriber set once its
    // stream terminates (client disconnect, or normal completion) -- closes the ticket's "no
    // cleanup on disconnect" gap. watchTermination's callback fires exactly once regardless of
    // whether the stream completed normally or failed.
    source.watchTermination() { (mat2, doneF) =>
      doneF.onComplete(_ => subscribers.remove(ref))(system.executionContext)
      mat2
    }
  }

  /**
   * Broadcast `event` to every current LOCAL subscriber for pipelineId (i.e. subscribers whose
   * SSE connection is held open on THIS instance). Never itself triggers a remote NOTIFY --
   * used both by `publish` (below, always) and by the eventBus receive-handler above (for events
   * that originated on a different instance).
   */
  private def broadcastLocal(pipelineId: String, event: RunStatusEvent): Unit =
    Option(refs.get(pipelineId)).foreach { subscribers =>
      subscribers.asScala.foreach(_ ! event)
      if (RunStatusEvent.isTerminal(event.status)) {
        subscribers.asScala.foreach(_ ! ActorStatus.Success(()))
        refs.remove(pipelineId)
      }
    }

  /**
   * Publish event to every current subscriber for pipelineId, on every backend instance.
   * On terminal events the streams are completed and the entry removed from the local map.
   *
   * Always broadcasts to this instance's own local subscribers first (synchronously), THEN --
   * only when an eventBus is wired (HEL-1168 design.md D6, nullable-optional collaborator; a
   * fixture/test that constructs this class with no eventBus gets pure local-only broadcast,
   * unchanged from pre-HEL-1168 behaviour) -- notifies every OTHER instance via Postgres
   * LISTEN/NOTIFY so their own local subscribers receive the same event.
   */
  def publish(pipelineId: String, event: RunStatusEvent): Unit = {
    broadcastLocal(pipelineId, event)
    if (eventBus != null) eventBus.notifyRemote(pipelineId, event)
  }

  /** Test-only accessor: the number of live local subscribers currently registered for
   *  pipelineId. Lets a disconnect-cleanup test (HEL-1168 task 1.2) wait deterministically for
   *  watchTermination's async removal callback to have actually run, instead of racing it with a
   *  fixed sleep. */
  private[pipelines] def subscriberCountForTest(pipelineId: String): Int =
    Option(refs.get(pipelineId)).map(_.size()).getOrElse(0)
}
