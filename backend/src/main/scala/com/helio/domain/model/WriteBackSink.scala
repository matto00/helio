package com.helio.domain.model

import com.helio.domain.steps.UpsertSourceConfig

/** HEL-1100 design.md Decision 2: one `upsertsource` step's deferred write, recorded during
 *  `evaluate` rather than applied there. `stepId` is the step whose config this write came from
 *  (for a new-source rewrite and for error attribution); `config` is that step's evaluated
 *  `UpsertSourceConfig`; `rows` are the exact input rows the step saw, engine `Row` shape
 *  (`Map[String, Any]`) -- mapped to storage's positional `Vector[JsValue]` shape later, inside
 *  `DataSourceRepository.applyWriteBacks` (design.md Decision 6), never here. */
final case class PendingWrite(stepId: String, config: UpsertSourceConfig, rows: Seq[Map[String, Any]])

/** Mutable output sink an `upsertsource` step's `evaluate` records its [[PendingWrite]] into
 *  (design.md Decision 2) -- mirrors [[AssertionSink]] exactly: `record`/`writes` are both
 *  `synchronized` for the same reason (a future concurrent-step-evaluation engine change must not
 *  race this). Defaults to a fresh, unread sink on [[PipelineExecutionContext]] so every
 *  pre-existing direct construction of that context (tests, preview) keeps compiling -- an
 *  `upsertsource` step still evaluates during preview/dry run, its write is simply appended here
 *  and never applied (`PipelineRunService` only calls `DataSourceRepository.applyWriteBacks` for a
 *  real, non-dry run). Writes are recorded in the ORDER `evaluate` is called -- the walk's own
 *  evaluation order (design.md Decision 3's "ordered by the walk's evaluation order"). */
final class WriteBackSink {
  private var _writes: Vector[PendingWrite] = Vector.empty

  def record(write: PendingWrite): Unit = synchronized {
    _writes = _writes :+ write
  }

  def writes: Vector[PendingWrite] = synchronized {
    _writes
  }
}
