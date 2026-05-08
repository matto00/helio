package com.helio.spark

import scala.collection.concurrent.TrieMap

/** Status values for a pipeline run. */
object RunStatus {
  val Queued    = "queued"
  val Running   = "running"
  val Succeeded = "succeeded"
  val Failed    = "failed"
}

/**
 * Immutable snapshot of a single pipeline run.
 *
 * @param runId  Unique identifier (UUID string) for this run.
 * @param status One of queued | running | succeeded | failed.
 * @param rows   Result rows, present when status == succeeded.
 * @param error  Error message, present when status == failed.
 */
final case class RunEntry(
    runId: String,
    status: String,
    rows: Option[Seq[Map[String, Any]]] = None,
    error: Option[String]               = None
)

/**
 * Thread-safe in-memory store for pipeline run state, keyed by runId.
 *
 * Uses a [[scala.collection.concurrent.TrieMap]] so that concurrent reads
 * from HTTP handlers and writes from background Spark futures never block each
 * other.
 */
class PipelineRunCache {

  private val store = TrieMap.empty[String, RunEntry]

  /** Insert a new entry with the given initial status (typically "queued"). */
  def put(runId: String, status: String): Unit =
    store.put(runId, RunEntry(runId = runId, status = status))

  /** Replace an existing entry with updated status, rows, and/or error. */
  def update(
      runId: String,
      status: String,
      rows: Option[Seq[Map[String, Any]]] = None,
      error: Option[String]               = None
  ): Unit =
    store.update(runId, RunEntry(runId = runId, status = status, rows = rows, error = error))

  /** Look up a run entry; returns None if the runId is unknown. */
  def get(runId: String): Option[RunEntry] = store.get(runId)
}
