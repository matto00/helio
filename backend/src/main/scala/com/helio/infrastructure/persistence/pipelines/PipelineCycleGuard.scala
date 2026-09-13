package com.helio.infrastructure.persistence.pipelines

import com.helio.domain.model.{DataSourceId, PipelineId}
import com.helio.domain.pipelines.PipelineCycleValidator
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import slick.jdbc.PostgresProfile.api._

import scala.concurrent.ExecutionContext

/** HEL-1101 (design.md Decision 4): the shared "lock + graph-read + check" composition every
 *  edge-adding write path (`PipelineRepository.create`/`createAction`, `PipelineRootRepository.add`,
 *  `PipelineStepRepository.spliceInsertAtInternal`/`attachTailInternal`/`updateInternal`) prepends
 *  to its own existing DBIO chain, ahead of the actual row write -- one place so the lock
 *  statement, the two graph-read queries, and the failure-message construction are never
 *  hand-copied per call site (five call sites would otherwise drift).
 *
 *  Composed as ONE `DBIO` on the SAME connection/transaction as the write that follows it
 *  (never a separate pre-flight `Future`) -- this is exactly what closes the concurrent-edit
 *  race: the advisory lock is the first statement taken, so a second concurrent writer blocks
 *  until the first's transaction (lock + check + write) commits or rolls back, and only then
 *  observes the first writer's edge already applied. */
object PipelineCycleGuard {

  /** Failure signalled inside a DBIO chain when the pending edge would close a cycle --
   *  `Slick`'s `.transactionally` rolls back the whole transaction on any failed action,
   *  mirroring `PipelineCreateValidationFailure`'s existing convention for the transactional
   *  create path. The service layer catches this once, after the transaction completes, and
   *  converts it to a `ServiceError`. */
  final case class PipelineCycleRejected(message: String) extends RuntimeException(message)

  private def lockAction(implicit ec: ExecutionContext): DBIO[Unit] =
    sql"SELECT pg_advisory_xact_lock(${PipelineCycleValidator.AdvisoryLockKey})::text".as[String].map(_ => ())

  /** Resolves each data source id in `ids` to its DISPLAYED name in the rejection message
   *  (design.md "Post-CONFIRM non-blocking fixes"): the acting caller's OWN name when they own
   *  that source (readable, informative), else the bare id (`data_sources` is owner-only
   *  readable per V35 -- an editor grantee of a pipeline that reads a source they don't own must
   *  never see a name they can't independently read). Missing ids (should not happen -- every id
   *  in a cycle path came from a query moments earlier in the same transaction) fall back to the
   *  id itself, never throw. */
  private def resolveDisplayNamesAction(ids: Set[String], actingUserId: String)(implicit ec: ExecutionContext): DBIO[Map[String, String]] =
    if (ids.isEmpty) DBIO.successful(Map.empty)
    else {
      val table = TableQuery[DataSourceRepository.DataSourceTable]
      table.filter(_.id.inSet(ids)).map(d => (d.id, d.name, d.ownerId)).result.map { rows =>
        rows.map { case (id, name, ownerId) =>
          id -> (if (ownerId.exists(_.toString == actingUserId)) name else id)
        }.toMap
      }
    }

  private def failOrNoop(
      result: Either[PipelineCycleValidator.CycleError, Unit],
      actingUserId: String
  )(implicit ec: ExecutionContext): DBIO[Unit] = result match {
    case Right(())  => DBIO.successful(())
    case Left(err) =>
      val ids = (err.edges.map(_.from) ++ err.edges.map(_.to)).map(_.value).toSet
      resolveDisplayNamesAction(ids, actingUserId).flatMap { names =>
        val message = err.message(dsId => names.getOrElse(dsId.value, dsId.value))
        DBIO.failed(PipelineCycleRejected(message))
      }
  }

  /** The general guard: lock, fetch both edge sets (visible to `actingUserId`, per
   *  `PipelineRootRepository.findReadEdgesVisibleTo`/`PipelineStepRepository.findUpsertWriteEdges`'s
   *  explicit, non-RLS-dependent filter), and check the pending edge (a pipeline named
   *  `writingPipelineId`/`writingPipelineName` reading every source in `readSources` and writing
   *  `writeTarget`) against the combined graph. Fails the DBIO with [[PipelineCycleRejected]] if
   *  it closes a cycle; otherwise a no-op `DBIO[Unit]`. */
  def checkAction(
      rootRepo: PipelineRootRepository,
      stepRepo: PipelineStepRepository,
      actingUserId: String,
      readSources: Set[DataSourceId],
      writeTarget: DataSourceId,
      writingPipelineId: PipelineId,
      writingPipelineName: String
  )(implicit ec: ExecutionContext): DBIO[Unit] =
    for {
      _          <- lockAction
      readEdges  <- rootRepo.findReadEdgesVisibleTo(actingUserId)
      writeEdges <- stepRepo.findUpsertWriteEdges(actingUserId)
      result      = PipelineCycleValidator.checkNoCycle(readEdges, writeEdges, readSources, writeTarget, writingPipelineId, writingPipelineName)
      _          <- failOrNoop(result, actingUserId)
    } yield ()

  /** Lock-only variant for a write path that introduces no new edge of its own (e.g. the
   *  roots-only `PipelineService.create`/`createAction` path, which has no steps and so can
   *  never carry an `upsertsource`). Still takes the lock (serializing against any concurrent
   *  edge-adding write, per design.md Decision 4), but the check itself is UNCONDITIONALLY a
   *  no-op: with an empty pending-read set, `PipelineCycleValidator.checkNoCycle` has no
   *  `writeTarget` to search reachability FROM in a way that means anything (nothing here writes
   *  anything), so it always returns `Right(())` (HEL-1101 skeptic-final-1.md CR2 -- this
   *  deliberately does NOT scan the caller's visible graph for a standing cycle; see
   *  `checkNoCycle`'s own scaladoc for why that would incorrectly block unrelated writes). A
   *  pure-reads write genuinely cannot close a cycle by itself; the real check for a NEW
   *  pipeline's own roots-plus-steps lives in `PipelineCycleGuard`'s create-path wiring inside
   *  `PipelineStepRepository.insertInternalAction` instead (task 3.2/CR1). */
  def checkExistingGraphAction(
      rootRepo: PipelineRootRepository,
      stepRepo: PipelineStepRepository,
      actingUserId: String
  )(implicit ec: ExecutionContext): DBIO[Unit] =
    checkAction(rootRepo, stepRepo, actingUserId, Set.empty, DataSourceId(""), PipelineId(""), "")

  /** `addRoot`'s shape (task 3.3): a NEW read source is being added to an ALREADY-EXISTING
   *  pipeline. The only way this can close a cycle is if that same pipeline already has an
   *  `upsertsource` write edge (fetched here, from `writeEdges`, filtered to `pipelineId`) that
   *  the new read reaches back to -- checked once per that pipeline's own existing write target
   *  (ordinarily zero or one; more than one is checked exhaustively, short-circuiting on the
   *  first rejection). A pipeline with NO write edge of its own has an empty `ownWriteTargets`,
   *  so the `foldLeft` never runs its body and simply returns its `Right(())` zero value --
   *  never a call into `checkNoCycle` at all, and never `checkExistingGraphAction`'s no-op call
   *  either (there is no reason to route through it). */
  def checkAddReadAction(
      rootRepo: PipelineRootRepository,
      stepRepo: PipelineStepRepository,
      actingUserId: String,
      pipelineId: PipelineId,
      pipelineName: String,
      newReadSource: DataSourceId
  )(implicit ec: ExecutionContext): DBIO[Unit] =
    for {
      _              <- lockAction
      readEdges      <- rootRepo.findReadEdgesVisibleTo(actingUserId)
      writeEdges     <- stepRepo.findUpsertWriteEdges(actingUserId)
      ownWriteTargets = writeEdges.filter(_.pipelineId == pipelineId).map(_.dataSourceId).distinct
      result          = ownWriteTargets.foldLeft[Either[PipelineCycleValidator.CycleError, Unit]](Right(())) {
        case (Right(()), target) =>
          PipelineCycleValidator.checkNoCycle(readEdges, writeEdges, Set(newReadSource), target, pipelineId, pipelineName)
        case (left, _) => left
      }
      _              <- failOrNoop(result, actingUserId)
    } yield ()

  /** `addStep`/`updateStep`'s shape (task 3.4): a NEW or UPDATED `upsertsource` write target is
   *  being set on an ALREADY-EXISTING pipeline. `readSources` is that SAME pipeline's own
   *  currently-visible read sources (derived from `readEdges`, filtered to `pipelineId`) -- the
   *  pending edge under check is exactly this pipeline reading what it already reads and writing
   *  `writeTarget`.
   *
   *  `excludeExistingWriteTarget` (HEL-1101 skeptic-final-1.md non-blocking note, folded into
   *  CR2's fix): for an UPDATE of an already-persisted `upsertsource` step, the row's OLD target
   *  is still present in `writeEdges` (its own row hasn't changed yet) -- checking the NEW
   *  target's reachability while that stale edge is still counted as part of "the existing
   *  graph" could incorrectly fold in an edge that is being REPLACED by this very update, not
   *  one that will still exist afterward. Filtered out of `writeEdges`, for this pipeline only,
   *  before the check runs. `None` (the default, used by every insert-shaped call site) is a
   *  no-op filter. */
  def checkAddWriteAction(
      rootRepo: PipelineRootRepository,
      stepRepo: PipelineStepRepository,
      actingUserId: String,
      pipelineId: PipelineId,
      pipelineName: String,
      writeTarget: DataSourceId,
      excludeExistingWriteTarget: Option[DataSourceId] = None
  )(implicit ec: ExecutionContext): DBIO[Unit] =
    for {
      _             <- lockAction
      readEdges     <- rootRepo.findReadEdgesVisibleTo(actingUserId)
      writeEdgesRaw <- stepRepo.findUpsertWriteEdges(actingUserId)
      writeEdges     = excludeExistingWriteTarget match {
        case Some(oldTarget) => writeEdgesRaw.filterNot(w => w.pipelineId == pipelineId && w.dataSourceId == oldTarget)
        case None             => writeEdgesRaw
      }
      ownReadSources = readEdges.filter(_.pipelineId == pipelineId).map(_.dataSourceId).toSet
      result         = PipelineCycleValidator.checkNoCycle(readEdges, writeEdges, ownReadSources, writeTarget, pipelineId, pipelineName)
      _             <- failOrNoop(result, actingUserId)
    } yield ()
}
