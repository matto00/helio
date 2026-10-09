package com.helio.services.pipelines

import com.helio.services.ServiceError
import com.helio.api.protocols.pipelines.TruncatedReadResponse
import com.helio.domain.model.{DataSource, Pipeline, PipelineId, TruncatedRead, TruncationSink}
import com.helio.domain.engine.{InProcessPipelineEngine, SourceReadStats, StepExecutionException}
import com.helio.infrastructure.persistence.pipelines.PipelineRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import org.slf4j.LoggerFactory
import spray.json._
import scala.concurrent.{ExecutionContext, Future}

/** Shared helpers for the run-lifecycle collaborators: execution-failure logging/translation, run-truncation
 *  field assembly and serialization, and root DataSource resolution. Split out of `PipelineRunService` (HEL-1371). */
private[pipelines] final class PipelineRunSupport(
    pipelineRepo: PipelineRepository,
    dataSourceRepo: DataSourceRepository
)(implicit ec: ExecutionContext) {

  private val log = LoggerFactory.getLogger(classOf[PipelineRunService])

  /** HEL-1147: one log call for every pipeline-execution failure site. A step-configuration
   *  failure is a user error (an incomplete/invalid step), so it is a single WARN line --
   *  pipeline, step id, kind, reason -- with no stack trace; anything else (data, reference,
   *  provider, engine fault) keeps ERROR + stack. */
  private[pipelines] def logExecutionFailure(context: String, ex: Throwable): Unit = ex match {
    case see: StepExecutionException if see.isStepConfigError =>
      log.warn(s"$context: invalid step configuration at step ${see.stepId} (${see.stepKind}): ${see.reason}")
    case _ => log.error(context, ex)
  }

  /** HEL-1147: the 422 for a failed execution. A step-configuration failure is the named
   *  [[ServiceError.StepConfigInvalid]] (same `message`, plus the failing step and clean reason);
   *  everything else stays the unnamed [[ServiceError.UnprocessableEntity]]. */
  private[pipelines] def executionFailureError(ex: Throwable): ServiceError = ex match {
    case see: StepExecutionException if see.isStepConfigError =>
      ServiceError.StepConfigInvalid(see.stepId, see.stepKind, see.reason, see.getMessage)
    case see: StepExecutionException => ServiceError.UnprocessableEntity(see.getMessage)
    case _                           => ServiceError.UnprocessableEntity("Pipeline execution failed")
  }

  /** HEL-861 (design D4): the run-wide truncation fields, computed once from the primary
   *  source's own [[SourceReadStats]] plus any secondary-source truncated reads recorded in
   *  `sink` (design D8 -- `join`/`union`/`lookup` re-entries). Deduped by data-source name
   *  (task 3.1a) so two steps reading the same truncated secondary source produce one entry and
   *  the notice names it once. Returns `(sourceTruncated, sourceAvailableRowCount, notice,
   *  truncatedReads)`. */
  private[pipelines] def truncationFields(
      primaryName: String,
      primaryRowsRead: Long,
      primaryStats: SourceReadStats,
      sink: TruncationSink
  ): (Boolean, Option[Long], Option[String], Vector[TruncatedReadResponse]) = {
    val primaryRead =
      if (primaryStats.truncated) Vector(TruncatedRead(primaryName, primaryRowsRead, primaryStats.availableRowCount))
      else Vector.empty
    // Task 3.1a dedupe MUST be order-preserving, primary first — `groupBy(...).values` returns
    // hash-ordered results, which would let a multi-source notice name its sources in a different
    // order between two identical runs. A fold-based distinct keeps first-seen order instead.
    val allReads = (primaryRead ++ sink.reads).foldLeft(Vector.empty[TruncatedRead]) { (acc, read) =>
      if (acc.exists(_.dataSourceName == read.dataSourceName)) acc else acc :+ read
    }
    val notice = PipelineRunService.composeTruncationNotice(allReads, InProcessPipelineEngine.MaxRunRows)
    (
      allReads.nonEmpty,
      primaryStats.availableRowCount,
      notice,
      allReads.map(r => TruncatedReadResponse(r.dataSourceName, r.rowsRead, r.availableRowCount))
    )
  }

  /** HEL-873 (design.md Decision 1/2, evaluation-1.md CR1): serializes to the raw JSON text
    * stored in `pipeline_runs.truncated_reads` -- an OBJECT, `{"primaryAvailableRowCount": …,
    * "reads": [...]}`, not a bare array. A bare array cannot distinguish "the primary's own read
    * happens to be `reads.head`" from "the head entry is an unrelated truncated secondary" --
    * `truncationFields` only prepends the primary's own entry when the PRIMARY ITSELF was
    * truncated, so a complete-primary/truncated-secondary run has no primary entry in `reads` at
    * all, and inferring `primaryAvailableRowCount` from `reads.headOption` would silently publish
    * a secondary source's count under a primary-scoped name. Persisting the scalar explicitly,
    * alongside the detail vector it does NOT depend on, removes that inference entirely rather
    * than guarding it. Hand-rolled rather than relying on `PipelineProtocol
    * .truncatedReadResponseFormat` (a trait member, not reachable from this class without mixing
    * the whole trait in). Mirrors [[PipelineRunQueries.parseTruncationRecord]], its read-side
    * inverse. */
  private[pipelines] def truncatedReadsToJson(primaryAvailableRowCount: Option[Long], reads: Vector[TruncatedReadResponse]): String =
    JsObject(
      "primaryAvailableRowCount" -> primaryAvailableRowCount.map(JsNumber(_)).getOrElse(JsNull),
      "reads" -> JsArray(reads.map { r =>
        JsObject(
          "dataSourceName"    -> JsString(r.dataSourceName),
          "rowsRead"          -> JsNumber(r.rowsRead),
          "availableRowCount" -> r.availableRowCount.map(JsNumber(_)).getOrElse(JsNull)
        )
      })
    ).compactPrint

  /** HEL-913 task 5.4: every root's `(rootId, DataSource)`, ORDERED by `position` ascending
   *  (R3's tiebreak; `PipelineRepository.listRootDataSourceIdsInternal` already sorts) --
   *  threaded into `PipelineExecutionBackend.execute`'s `roots` parameter. A pipeline with exactly
   *  one root (today's only real case, since no route creates a second yet) yields a one-element
   *  Vector, preserving today's behavior exactly (5.5a's single-root parity requirement).
   *  Privileged (ACL is the caller's job, exactly like the `dataSourceRepo.findByIdInternal` calls
   *  it wraps). */
  private[pipelines] def resolveAllRootDataSourcesInternal(pipelineId: PipelineId): Future[Vector[(String, DataSource)]] =
    pipelineRepo.listRootDataSourceIdsInternal(pipelineId).flatMap { rootDsIds =>
      Future.sequence(rootDsIds.map { case (rootId, dsId) =>
        dataSourceRepo.findByIdInternal(dsId).map(dsOpt => (rootId.value, dsOpt))
      })
    }.map(_.collect { case (rootId, Some(ds)) => (rootId, ds) })
}
