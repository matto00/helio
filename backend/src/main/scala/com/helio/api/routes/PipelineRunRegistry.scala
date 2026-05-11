package com.helio.api.routes

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.actor.{ActorRef, Status => ActorStatus}
import org.apache.pekko.stream.{CompletionStrategy, Materializer, OverflowStrategy}
import org.apache.pekko.NotUsed
import org.apache.pekko.stream.scaladsl.Source
import org.apache.pekko.util.ByteString
import spray.json._

import java.util.concurrent.ConcurrentHashMap

// -- Domain event -------------------------------------------------------------

final case class RunStatusEvent(
    status:   String,
    rowCount: Option[Int]    = None,
    errorLog: Option[String] = None
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
    val json = JsObject(fields.toMap).compactPrint
    ByteString("event: run-status\ndata: " + json + "\n\n")
  }
}

// -- Registry -----------------------------------------------------------------

/**
 * In-memory publish/subscribe channel for pipeline run-status events.
 *
 * One SSE subscription per pipeline is maintained at a time (single-active-run
 * assumption). The actor ref produced by Source.actorRef is stored in a
 * ConcurrentHashMap keyed by pipeline ID.
 */
final class PipelineRunRegistry(implicit system: ActorSystem[_]) {
  private implicit val mat: Materializer = Materializer(system.classicSystem)

  // pipelineId -> actor ref from the currently active Source.actorRef
  private val refs = new ConcurrentHashMap[String, ActorRef]()

  /**
   * Create a new SSE source for pipelineId and return it.
   * The source emits RunStatusEvent values published via publish and
   * completes when a terminal event is published.
   */
  def subscribe(pipelineId: String): Source[RunStatusEvent, NotUsed] = {
    val completionMatcher: PartialFunction[Any, CompletionStrategy] = {
      case ActorStatus.Success(_) => CompletionStrategy.immediately
    }
    val failureMatcher: PartialFunction[Any, Throwable] = PartialFunction.empty
    val (ref, source) = Source
      .actorRef[RunStatusEvent](completionMatcher, failureMatcher, 8, OverflowStrategy.dropHead)
      .preMaterialize()
    refs.put(pipelineId, ref)
    source
  }

  /**
   * Publish event to the current subscriber for pipelineId.
   * On terminal events the stream is completed and the entry removed from the map.
   */
  def publish(pipelineId: String, event: RunStatusEvent): Unit =
    Option(refs.get(pipelineId)).foreach { ref =>
      ref ! event
      if (RunStatusEvent.isTerminal(event.status)) {
        ref ! ActorStatus.Success(())
        refs.remove(pipelineId)
      }
    }
}
