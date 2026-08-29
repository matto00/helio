package com.helio.domain.model

/** One rule's pass/fail outcome, evaluated against the row set at an `assert`
 *  step's position in the pipeline (HEL-509 / 419-B). One `AssertionResult`
 *  per RULE — aggregated across the whole row set, never one per row
 *  (design.md Decision 2).
 *
 *  Lives in `domain` directly (not `domain.steps.AssertStep`, where the rule
 *  evaluation logic itself lives) because `InProcessPipelineEngine` — also in
 *  `domain` — needs to reference both this type and [[AssertionSink]] to
 *  extend `PipelineExecutionContext` and `executeWithStepCounts`'s signature.
 *  `domain.steps` already imports *from* `domain`, never the reverse; keeping
 *  these types here avoids introducing a `domain` -> `domain.steps`
 *  dependency (design.md Decision 1). */
final case class AssertionResult(
    stepId: String,
    kind: String,
    field: Option[String],
    severity: String,
    passed: Boolean,
    observed: Option[String],
    message: Option[String]
)

/** Caller-supplied, mutable output parameter threaded through
 *  [[PipelineExecutionContext]] (design.md Decision 4) — a deliberate
 *  departure from this codebase's otherwise-immutable Future-chaining style.
 *  A successful `Future`'s tuple can't carry partial results after a
 *  mid-pipeline failure (a failed `Future` carries only its exception), so
 *  this sink is the one way to survive that failure with whatever was
 *  evaluated before it. `synchronized` guards concurrent `record`/`results`
 *  access; each `PipelineRunService.executeRun` call constructs its own
 *  fresh sink, so contention is not expected in practice, but the guard costs
 *  nothing and removes any doubt. */
final class AssertionSink {
  private var _results: Vector[AssertionResult] = Vector.empty

  def record(results: Seq[AssertionResult]): Unit = synchronized {
    _results = _results ++ results
  }

  def results: Vector[AssertionResult] = synchronized {
    _results
  }
}

/** One truncated read recorded during a run (HEL-861, design D8) — the source's own name, how
 *  many rows were actually read, and its true total when the driver could measure it. */
final case class TruncatedRead(dataSourceName: String, rowsRead: Long, availableRowCount: Option[Long])

/** Caller-supplied, mutable output parameter mirroring [[AssertionSink]] exactly (design D8):
 *  `InProcessPipelineEngine.makeContext`'s `loadSource` re-enters `loadRowsWithStats` for every
 *  `join`/`union`/`lookup` secondary-source read, so a run-level `sourceTruncated` computed from
 *  only the primary source would be a false assertion of completeness whenever a secondary read
 *  was itself truncated. Every truncated read observed anywhere in a run — primary or secondary —
 *  is appended here. `synchronized` guards concurrent `record`/`reads` access, same rationale as
 *  `AssertionSink`. */
final class TruncationSink {
  private var _reads: Vector[TruncatedRead] = Vector.empty

  def record(read: TruncatedRead): Unit = synchronized {
    _reads = _reads :+ read
  }

  def reads: Vector[TruncatedRead] = synchronized {
    _reads
  }
}
