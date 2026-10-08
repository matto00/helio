package com.helio.services.pipelines

import com.helio.services.ServiceError
import com.helio.api.protocols.pipelines.{AssertionFailureDetail, AssertionSummary, LatestRunResponse, PipelineRunRecord, RunTruncationRecord, TruncatedReadResponse}
import com.helio.domain.model.{AuthenticatedUser, Pipeline, PipelineId, PipelineRunId, TruncatedRead}
import com.helio.domain.engine.{InProcessPipelineEngine, PipelineRowJson}
import com.helio.infrastructure.persistence.pipelines.{PipelineRepository, PipelineRunRepository}
import com.helio.infrastructure.persistence.pipelines.PipelineRunRepository.PipelineRunAssertionRow
import com.helio.spark.PipelineRunCache
import org.slf4j.LoggerFactory
import spray.json._
import spray.json.DefaultJsonProtocol._
import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Failure, Success, Try}

/** Run-history reads: latest run, cached run status and persisted run history. Split out of
 *  `PipelineRunService` (HEL-1371). */
private[pipelines] final class PipelineRunQueries(
    pipelineRepo: PipelineRepository,
    pipelineRunRepo: PipelineRunRepository,
    cache: PipelineRunCache
)(implicit ec: ExecutionContext) {

  private val log = LoggerFactory.getLogger(classOf[PipelineRunService])

  /** `GET /api/pipelines/:id/runs/latest` (HEL-1174, design.md Decision 2): sharing-aware --
   *  owner, editor, and viewer grantees all resolve; a never-run pipeline (or a pipeline the
   *  caller cannot access) both come back `NotFound`, matching `history`'s no-grant behavior --
   *  existence is not leaked. Deliberately NOT a bare cache lookup keyed only by an opaque run id
   *  (the pre-HEL-1249 `status(runId)`, removed): copying that for THIS pipeline-id-keyed endpoint would leak
   *  any pipeline's latest run status/error detail to any authenticated user who guesses or
   *  enumerates pipeline ids. Reads through the durable `pipeline_runs` table (`latestRunInternal`),
   *  never the ephemeral `PipelineRunRegistry`/cache -- correct across backend instances (HEL-1168)
   *  regardless of which instance executed the run. */
  def latestRun(pipelineId: PipelineId, user: AuthenticatedUser): Future[Either[ServiceError, LatestRunResponse]] =
    if (pipelineRunRepo == null)
      Future.successful(Left(ServiceError.NotFound("No runs yet for pipeline: " + pipelineId.value)))
    else
      pipelineRepo.findByIdShared(pipelineId, Some(user)).flatMap {
        case None =>
          Future.successful(Left(ServiceError.NotFound("Pipeline not found: " + pipelineId.value)))
        case Some(_) =>
          // Safe: access confirmed by findByIdShared, same as history's own system-context read.
          pipelineRunRepo.latestRunInternal(pipelineId).map {
            case None =>
              Left(ServiceError.NotFound("No runs yet for pipeline: " + pipelineId.value))
            case Some(row) =>
              Right(LatestRunResponse(
                id          = row.id,
                status      = row.status,
                completedAt = row.completedAt.map(_.toString),
                rowCount    = row.rowCount,
                errorLog    = row.errorLog
              ))
          }
      }

  /** `GET /api/pipelines/:id/runs/:runId` (HEL-1249): the cached status of a run, served only
   *  through the pipeline that owns it and only to a caller who can see that pipeline
   *  (`findByIdShared`: owner or any grantee). Every failure arm -- pipeline absent or not
   *  visible, run absent, run recorded against a different pipeline -- is the SAME
   *  `ServiceError.NotFound` with one fixed message (no caller-supplied id echoed), so the
   *  serialized 404 is byte-identical and nothing about existence is leaked (HEL-1002). */
  def runStatus(pipelineId: PipelineId, runId: String, user: AuthenticatedUser): Future[Either[ServiceError, CachedRunStatus]] =
    pipelineRepo.findByIdShared(pipelineId, Some(user)).map {
      case None => Left(RunStatusNotFound)
      case Some(_) =>
        cache.get(runId).filter(_.pipelineId == pipelineId.value) match {
          case None => Left(RunStatusNotFound)
          case Some(entry) =>
            val rowsJson: Option[JsValue] = entry.rows.map { rows =>
              JsArray(rows.map { rowMap =>
                JsObject(rowMap.map { case (k, v) => k -> PipelineRowJson.anyToJsValue(v) })
              }.toVector)
            }
            Right(CachedRunStatus(entry.runId, entry.status, rowsJson, entry.error, entry.rows.map(_.size)))
        }
    }

  private val RunStatusNotFound = ServiceError.NotFound("Run not found")

  /** Persisted run history for a pipeline.
   *  HEL-279: sharing-aware — owner, editor, and viewer grantees can read history.
   *  HEL-576 (design.md Decision 2): each run's `AssertionSummary` is fetched via
   *  one `listAssertionsByRunInternal` call per run, issued concurrently by
   *  `Future.traverse` (not sequentially) -- bounded by the existing ~10 real +
   *  ~10 dry run retention caps (`deleteOldRunsInternal`/`deleteOldDryRunsInternal`),
   *  so at most ~20 concurrent calls per request. Not a scaling risk at that bound;
   *  see design.md's Risks/Trade-offs for why a bulk join isn't warranted here. */
  def history(pipelineId: PipelineId, user: AuthenticatedUser): Future[Either[ServiceError, Vector[PipelineRunRecord]]] =
    if (pipelineRunRepo == null) Future.successful(Right(Vector.empty))
    else
      pipelineRepo.findByIdShared(pipelineId, Some(user)).flatMap {
        case None =>
          Future.successful(Left(ServiceError.NotFound("Pipeline not found: " + pipelineId.value)))
        case Some(_) =>
          // Safe: access confirmed by findByIdShared. Use system context to bypass the
          // V35 pipeline_runs RLS owner-JOIN so grantees can read run records.
          pipelineRunRepo.listByPipelineInternal(pipelineId).flatMap { rows =>
            Future.traverse(rows) { r =>
              pipelineRunRepo.listAssertionsByRunInternal(PipelineRunId(r.id)).map { assertionRows =>
                PipelineRunRecord(
                  id                 = r.id,
                  pipelineId         = r.pipelineId,
                  status             = r.status,
                  startedAt          = r.startedAt.toString,
                  completedAt        = r.completedAt.map(_.toString),
                  rowCount           = r.rowCount,
                  errorLog           = r.errorLog,
                  triggerSource      = r.triggerSource,
                  triggeredByTokenId = r.triggeredByTokenId.map(_.toString),
                  assertions         = summarizeAssertions(assertionRows),
                  truncation         = r.truncatedReads.flatMap(parseTruncationRecord)
                )
              }
            }.map(Right(_))
          }
      }

  /** HEL-873 (design.md Decision 2, task 3.3; evaluation-1.md CR1/CR4): maps a non-null
    * `truncated_reads` column to a present [[RunTruncationRecord]] -- NULL (the column absent
    * entirely, never reaching this method at all -- see the `.flatMap` at the call site above) is
    * the distinct "not recorded" state. `truncated` is derived, never trusted from a second
    * stored flag (there is none). `notice` is RECOMPOSED here via the same
    * [[PipelineRunService.composeTruncationNotice]] the live run result uses (design.md
    * Decision 1) -- never a second, persisted phrasing. `primaryAvailableRowCount` is read back
    * VERBATIM from the persisted scalar (never inferred from `reads.headOption` -- see
    * `truncatedReadsToJson`'s doc for why that inference is unsound).
    *
    * TOTAL over malformed input (CR4): `Try` wraps the whole decode, including
    * `json.parseJson`'s own `ParsingException` on unparseable text, a non-object array element,
    * and a missing required field -- ANY of those degrade this one record to `None` (not
    * recorded), never to an empty-and-complete [[RunTruncationRecord]]. Collapsing an
    * undecodable row to `[]` would assert completeness for a row whose truncation facts could not
    * actually be read, which is precisely the defect this capability exists to remove. A failure
    * here is logged (same level as a structurally-wrong-but-parseable JSON value) and never
    * propagates -- one bad row must not fail the whole `GET /api/pipelines/:id/run-history`
    * request for every other run. */
  private def parseTruncationRecord(json: String): Option[RunTruncationRecord] =
    Try {
      val obj = json.parseJson.asJsObject
      val primaryAvailableRowCount = obj.fields.get("primaryAvailableRowCount").flatMap {
        case JsNull => None
        case other  => Some(other.convertTo[Long])
      }
      // HEL-873 (evaluation-2.md non-blocking suggestion): a `case JsArray(elements)` match
      // expresses "must be a JSON array" as a pattern rather than a cast -- still inside this
      // `Try`, so a non-array `reads` (any other JsValue) falls through to `MatchError`, caught
      // and degraded to not-recorded exactly like every other malformed shape (CR4).
      val reads = (obj.fields("reads") match {
        case JsArray(elements) => elements
        case other             => throw new IllegalArgumentException(s"reads must be a JSON array, got: $other")
      }).map { v =>
        val readObj = v.asJsObject
        TruncatedReadResponse(
          dataSourceName    = readObj.fields("dataSourceName").convertTo[String],
          rowsRead          = readObj.fields("rowsRead").convertTo[Long],
          availableRowCount = readObj.fields.get("availableRowCount").flatMap {
            case JsNull => None
            case other  => Some(other.convertTo[Long])
          }
        )
      }.toVector
      val domainReads = reads.map(r => TruncatedRead(r.dataSourceName, r.rowsRead, r.availableRowCount))
      RunTruncationRecord(
        truncated                = reads.nonEmpty,
        primaryAvailableRowCount = primaryAvailableRowCount,
        reads                    = reads,
        notice                   = PipelineRunService.composeTruncationNotice(domainReads, InProcessPipelineEngine.MaxRunRows)
      )
    } match {
      case Success(record) => Some(record)
      case Failure(ex) =>
        log.error(s"HEL-873: pipeline_runs.truncated_reads carried undecodable JSON, treating as not-recorded: $json", ex)
        None
    }

  /** Per-run pass/fail-by-severity summary (design.md Decision 1): `failures`
   *  carries only the FAILED results -- a passing result is just a count. */
  private def summarizeAssertions(rows: Vector[PipelineRunAssertionRow]): AssertionSummary = {
    val failed = rows.filterNot(_.passed)
    AssertionSummary(
      passed      = rows.count(_.passed),
      warnFailed  = failed.count(_.severity == "warn"),
      errorFailed = failed.count(_.severity == "error"),
      failures    = failed.map(r => AssertionFailureDetail(r.kind, r.field, r.severity, r.message))
    )
  }
}
