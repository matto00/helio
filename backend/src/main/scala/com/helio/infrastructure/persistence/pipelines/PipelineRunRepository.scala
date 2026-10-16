package com.helio.infrastructure.persistence.pipelines

import com.helio.infrastructure.persistence.DbContext
import com.helio.domain.model.{AssertionResult, AuthenticatedUser, PipelineId, PipelineRunId, UserId}
import com.helio.infrastructure.persistence.auth.ResourcePermissionRepository
import slick.jdbc.PostgresProfile.api._
import PipelineRepository.instantColumnType

import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** Persistence layer for `pipeline_runs`.
 *
 *  HEL-1492: an editor grantee's run is persisted too, through [[insertGranteeRunIfUnderOwnerCap]] /
 *  [[insertGranteeDryRun]] (re-authorized in-transaction) and the `*Internal` lifecycle writes.
 *
 *  HEL-265 CS2: all reads and writes are gated by the parent pipeline's
 *  `owner_id`. Runs inherit ACL from their parent pipeline (no separate
 *  `owner_id` column). Writes that the caller cannot prove ownership of
 *  become silent no-ops — keeps the run-lifecycle path resilient to a
 *  pipeline being deleted mid-run.
 *
 *  The privileged Spark driver path uses [[insertRunInternal]] /
 *  [[insertDryRunInternal]] / [[updateRunTerminalInternal]] /
 *  [[deleteOldRunsInternal]] / [[deleteOldDryRunsInternal]]; the
 *  pipeline ACL was checked at submit time and the background driver
 *  does not carry a request-bound user. */
class PipelineRunRepository(ctx: DbContext)(implicit ec: ExecutionContext) {

  import PipelineRunRepository._

  private val runsTable       = TableQuery[PipelineRunTable]
  private val pipelinesTable  = TableQuery[PipelineRepository.PipelineTable]
  private val assertionsTable = TableQuery[PipelineRunAssertionTable]
  private val permTable       = TableQuery[ResourcePermissionRepository.ResourcePermissionTable]

  private def pipelineOwnedAction(pipelineId: PipelineId, user: AuthenticatedUser) = {
    val ownerUuid = UUID.fromString(user.id.value)
    pipelinesTable.filter(p => p.id === pipelineId.value && p.ownerId === ownerUuid).exists.result
  }

  /** Owner-scoped insert. Silent no-op when the caller does not own the
    * parent pipeline. `triggerSource` defaults to `"manual"` (rather than
    * requiring every test/caller to pass the literal) -- the real callers
    * that care (`PipelineRunExecutor.executeRun`, the HEL-415 scheduler path)
    * always pass it explicitly. `triggeredByTokenId` (HEL-369) is the id of
    * the scoped or unscoped PAT that authenticated an external trigger, or
    * `None` for every other trigger source. */
  def insertRun(
      runId: PipelineRunId,
      pipelineId: PipelineId,
      startedAt: Instant,
      user: AuthenticatedUser,
      triggerSource: String = "manual",
      triggeredByTokenId: Option[String] = None,
      triggeredByUserId: Option[String] = None
  ): Future[Unit] =
    ctx.withUserContext(user.id.value)(pipelineOwnedAction(pipelineId, user)).flatMap {
      case false => Future.successful(())
      case true  => insertRunInternal(runId, pipelineId, startedAt, triggerSource, triggeredByTokenId, triggeredByUserId)
    }

  /** ACL-bypassing insertRun for the privileged Spark driver path.
    * `triggeredByTokenId` is the domain-facing `ApiTokenId.value` string;
    * converted to the column's `UUID` type here (mirrors every other
    * String-domain-id-over-UUID-column conversion in this repository, e.g.
    * `user.id.value` -> `UUID.fromString` above). */
  def insertRunInternal(
      runId: PipelineRunId,
      pipelineId: PipelineId,
      startedAt: Instant,
      triggerSource: String = "manual",
      triggeredByTokenId: Option[String] = None,
      triggeredByUserId: Option[String] = None
  ): Future[Unit] =
    ctx.withSystemContext(insertRunRowAction(runId, pipelineId, startedAt, triggerSource, triggeredByTokenId, triggeredByUserId)).map(_ => ())

  /** The queued-row insert as a plain `DBIO`, factored out of [[insertRunInternal]] so
    * [[insertRunIfUnderConcurrencyCap]] (HEL-505) can compose it into the SAME `DBIO` chain as the
    * concurrency check, rather than issuing it as a second, separately-transacted call. */
  private def insertRunRowAction(
      runId: PipelineRunId,
      pipelineId: PipelineId,
      startedAt: Instant,
      triggerSource: String,
      triggeredByTokenId: Option[String],
      triggeredByUserId: Option[String]
  ): DBIO[Unit] = {
    val row = PipelineRunRow(
      id                 = runId.value,
      pipelineId         = pipelineId.value,
      status             = "queued",
      startedAt          = startedAt,
      completedAt        = None,
      rowCount           = None,
      errorLog           = None,
      triggerSource      = triggerSource,
      triggeredByTokenId = triggeredByTokenId.map(UUID.fromString),
      triggeredByUserId  = triggeredByUserId.map(UUID.fromString),
      // HEL-873 (design.md Decision 2a): a queued row's truncation facts do not exist yet -- it
      // has not reached a terminal status and persists no row count, so NULL here is the one
      // decided, non-escalation exception to "every terminal row is non-null" (task 2.7).
      truncatedReads     = None,
      // HEL-1511 (design.md D1): a freshly admitted run is never "legacy" -- its first heartbeat is its start.
      heartbeatAt        = Some(startedAt)
    )
    (runsTable += row).map(_ => ())
  }

  /** HEL-505 (design.md Decision 3, C1/C2): the concurrency-cap-gated counterpart to `insertRun`,
    * replacing (not supplementing) that plain call in `PipelineRunExecutor.executeRun`'s `preExec`
    * for the non-dry path. Composes THREE steps into ONE chained `DBIO`, passed to a SINGLE
    * `ctx.withUserContext` call -- never as separate repository calls issuing separate DB
    * round-trips -- because `DbContext.withUserContext` wraps exactly the `DBIO` it is given in
    * one transaction, and only a single shared transaction makes the advisory lock actually
    * serialize the count-then-insert decision against a second concurrent writer (a lock held
    * across two SEPARATE `withUserContext` calls, each its own transaction, would not prevent both
    * from reading the pre-insert count under READ COMMITTED before either commits):
    *
    *   1. The pipeline row's owner id read `FOR KEY SHARE` (`keyShareOwnerAction`, HEL-1503): an absent row
    *      yields `PipelineGone`, another owner `NotAuthorized` (defensive here -- this method is only reached
    *      post-ACL-check from `executeRun`), and nothing is counted or inserted for either. The key-share lock
    *      conflicts only with a `DELETE`, so a concurrent delete either committed first or waits for this
    *      transaction, and the insert's `pipeline_id` FK can never fail.
    *   2. `pg_advisory_xact_lock(hashtext('pipeline-run-concurrency:' || userId))` -- serializes
    *      concurrent submits from the SAME owner; auto-released at commit/rollback. Taken AFTER the row lock
    *      on both admission paths (uniform lock order).
    *   3. A live count of this owner's non-terminal REAL runs (`status NOT IN ('succeeded',
    *      'failed', 'dry_run')`, across every pipeline they own) -- `< maxConcurrent` inserts the
    *      new queued row inside the SAME transaction; otherwise rolls back without inserting.
    *
    * Dry runs never reach this method (C7) -- `insertDryRun`/`insertDryRunInternal` write their
    * own already-terminal row from an entirely different call site, `onDryRunSuccess`, reached
    * only after the dry run has already executed.
    *
    * Returns [[PipelineRunRepository.ConcurrencyCapResult]]: `NotAuthorized` (the caller does not own
    * the pipeline) is distinguished from `CapExceeded` so the caller
    * can map it to `Forbidden` rather than a 429. It is NEVER an admission: only `Inserted` admits a
    * run (HEL-1492 retired the former `NotOwned` arm that executed the run without recording it).
    * An editor grantee's submit goes through [[insertGranteeRunIfUnderOwnerCap]] instead. */
  def insertRunIfUnderConcurrencyCap(
      runId: PipelineRunId,
      pipelineId: PipelineId,
      startedAt: Instant,
      user: AuthenticatedUser,
      triggerSource: String,
      triggeredByTokenId: Option[String],
      maxConcurrent: Int,
      triggeredByUserId: Option[String] = None
  ): Future[PipelineRunRepository.ConcurrencyCapResult] = {
    import PipelineRunRepository.ConcurrencyCapResult._
    val action: DBIO[PipelineRunRepository.ConcurrencyCapResult] =
      keyShareOwnerAction(pipelineId).flatMap {
        // HEL-1503 (design.md D3): gone (deleted before the key-share lock -- or hidden by RLS) is told apart from
        // an existing pipeline someone else owns; the row stays key-share locked until this transaction ends.
        case None => DBIO.successful(PipelineGone)
        case Some(rowOwner) if rowOwner != UUID.fromString(user.id.value) => DBIO.successful(NotAuthorized)
        case Some(_) =>
          concurrencyLockAction(user.id.value).flatMap { _ =>
            countAndInsertAction(UUID.fromString(user.id.value), runId, pipelineId, startedAt, triggerSource, triggeredByTokenId, triggeredByUserId, maxConcurrent)
          }
      }
    ctx.withUserContext(user.id.value)(action)
  }

  /** The ONE definition of the concurrency cap's count: the run ids of an owner's non-terminal REAL runs
    * (`status NOT IN ('succeeded', 'failed', 'dry_run')`) across every pipeline they own. Shared by
    * [[countAndInsertAction]] (the authoritative cap) and [[countOwnerInFlightRealRunsInternal]]
    * (HEL-1504's read-only pre-flight), so the two can never disagree about what "in flight" means. */
  private def ownerInFlightRealRunsQuery(ownerUuid: UUID) =
    for {
      run      <- runsTable if run.status =!= "succeeded" && run.status =!= "failed" && run.status =!= "dry_run"
      pipeline <- pipelinesTable if pipeline.id === run.pipelineId && pipeline.ownerId === ownerUuid
    } yield run.id

  /** HEL-1504 (design.md D2a): read-only, system-context count of the owner's in-flight real runs --
    * the same predicate as the concurrency cap, with no lock and no insert. The auto-run firer uses it
    * to hold an auto-run back BEFORE `submit` when the owner is already at the cap (a rejection inside
    * `submit` would first consume a rate slot). Never an admission: `submit` stays authoritative. */
  def countOwnerInFlightRealRunsInternal(ownerId: UserId): Future[Int] =
    ctx.withSystemContext(ownerInFlightRealRunsQuery(UUID.fromString(ownerId.value)).length.result)

  /** The owner's live count of non-terminal REAL runs across every pipeline they own, then the queued-row
    * insert when under `maxConcurrent`. Shared by the owner path and the grantee path so both count the
    * same thing: the PIPELINE OWNER's runs, whoever submitted them. */
  private def countAndInsertAction(
      ownerUuid: UUID,
      runId: PipelineRunId,
      pipelineId: PipelineId,
      startedAt: Instant,
      triggerSource: String,
      triggeredByTokenId: Option[String],
      triggeredByUserId: Option[String],
      maxConcurrent: Int
  ): DBIO[PipelineRunRepository.ConcurrencyCapResult] = {
    import PipelineRunRepository.ConcurrencyCapResult._
    ownerInFlightRealRunsQuery(ownerUuid).length.result.flatMap { count =>
      if (count < maxConcurrent)
        insertRunRowAction(runId, pipelineId, startedAt, triggerSource, triggeredByTokenId, triggeredByUserId).map(_ => Inserted)
      else DBIO.successful(CapExceeded)
    }
  }

  /** HEL-1492 (design.md D2): the privileged counterpart of [[insertRunIfUnderConcurrencyCap]] for an EDITOR
    * grantee's submit -- RLS (V35 `pipeline_runs_owner`) would reject the grantee's own insert (42501), so the
    * write runs in system context, but never blind. ONE transaction: (1) the pipeline's owner id is read
    * `FOR KEY SHARE` (HEL-1503: an absent row yields `PipelineGone` and writes nothing), (2) the SAME advisory
    * lock the owner's own submits take (keyed by OWNER id, so owner and editor submits for one owner serialize
    * against each other), (3) the submitter is re-verified as the pipeline owner or an `editor` row in
    * `resource_permissions` (the `findGrantRole` predicate) -- a grant revoked since `submit`'s check yields
    * `NotAuthorized` and writes nothing, (4) the OWNER's non-terminal count and the insert, exactly as the
    * owner path. Authorization is checked here, at admission; every later lifecycle write for the admitted run
    * goes through the `*Internal` methods unconditionally so an admitted run can never stay non-terminal and
    * hold one of the owner's slots. */
  def insertGranteeRunIfUnderOwnerCap(
      runId: PipelineRunId,
      pipelineId: PipelineId,
      startedAt: Instant,
      submitter: AuthenticatedUser,
      triggerSource: String,
      triggeredByTokenId: Option[String],
      maxConcurrent: Int,
      triggeredByUserId: Option[String]
  ): Future[PipelineRunRepository.ConcurrencyCapResult] = {
    import PipelineRunRepository.ConcurrencyCapResult._
    val action: DBIO[PipelineRunRepository.ConcurrencyCapResult] =
      keyShareOwnerAction(pipelineId).flatMap {
        case None => DBIO.successful(PipelineGone)
        case Some(ownerUuid) =>
          for {
            _          <- concurrencyLockAction(ownerUuid.toString)
            authorized <- submitterMayRunAction(pipelineId, ownerUuid, submitter)
            result     <- if (!authorized) DBIO.successful(NotAuthorized)
                          else countAndInsertAction(ownerUuid, runId, pipelineId, startedAt, triggerSource, triggeredByTokenId, triggeredByUserId, maxConcurrent)
          } yield result
      }
    // withSystemContext: the editor is not the pipeline owner, so V35 pipeline_runs_owner RLS would refuse this
    // INSERT; bypass is correct because the same transaction re-verifies owner-or-editor (HEL-1492 Q5).
    ctx.withSystemContext(action)
  }

  /** HEL-1503 (design.md D3): the pipeline's owner id read with `FOR KEY SHARE`, taken BEFORE the owner-keyed advisory
    * lock in both admission transactions (uniform order: row key-share lock, then advisory lock). It conflicts only
    * with a `DELETE` (or key update) of that row, so a concurrent delete either committed first (`None`) or waits
    * until admission commits -- the insert's `pipeline_id` FK can then never fail. Plain SQL because Slick has no
    * key-share option and a row lock cannot sit inside an `.exists` wrapper. */
  private def keyShareOwnerAction(pipelineId: PipelineId): DBIO[Option[UUID]] =
    sql"SELECT owner_id::text FROM pipelines WHERE id = ${pipelineId.value} FOR KEY SHARE".as[String].headOption.map(_.map(UUID.fromString))

  /** HEL-1503 (design.md D4): privileged, read-only re-verification that `submitter` may still run `pipelineId`
    * (owner, or an `editor` grant), made immediately before a DRY run executes. Never writes. */
  def checkRunAuthorizationInternal(pipelineId: PipelineId, submitter: AuthenticatedUser): Future[RunAuthorization] = {
    import RunAuthorization._
    val action: DBIO[RunAuthorization] =
      pipelinesTable.filter(_.id === pipelineId.value).map(_.ownerId).result.headOption.flatMap {
        case None => DBIO.successful(PipelineGone)
        case Some(ownerUuid) =>
          submitterMayRunAction(pipelineId, ownerUuid, submitter).map(ok => if (ok) Authorized else NotAuthorized)
      }
    // withSystemContext: a read-only owner-or-editor check for an editor whom RLS would hide the owner's pipeline from.
    ctx.withSystemContext(action)
  }

  /** The submitter is the pipeline's owner, or holds an `editor` grant on it (same predicate as
    * `PipelineRepository.findGrantRole`, evaluated in the caller's transaction). Private; the preview-side owner-or-editor
    * check is `PipelineRepository.checkPreviewAccessInternal` (HEL-1516), which encodes the same predicate. */
  private def submitterMayRunAction(pipelineId: PipelineId, ownerUuid: UUID, submitter: AuthenticatedUser): DBIO[Boolean] = {
    val submitterUuid = UUID.fromString(submitter.id.value)
    if (submitterUuid == ownerUuid) DBIO.successful(true)
    else
      permTable
        .filter(p => p.resourceType === "pipeline" && p.resourceId === pipelineId.value && p.granteeId === submitterUuid && p.role === "editor")
        .exists
        .result
  }

  /** Transaction-scoped advisory lock keyed by owner id (design.md Decision 3), mirroring
    * `PipelineCycleGuard.lockAction`'s exact `pg_advisory_xact_lock(...)::text` shape (a scalar
    * `void`-returning function called via `SELECT`, decoded as `String` then discarded -- Slick's
    * plain-SQL `.as[T]` needs a concrete `GetResult[T]`, which `void` has none of, so the
    * established idiom here is to cast the result to `text` and ignore it). `hashtext` returns
    * `int4`, which Postgres implicitly widens to the `bigint` `pg_advisory_xact_lock` expects. */
  private def concurrencyLockAction(userId: String): DBIO[Unit] =
    sql"SELECT pg_advisory_xact_lock(hashtext(${"pipeline-run-concurrency:" + userId}))::text".as[String].map(_ => ())

  /** Owner-scoped terminal update via JOIN to `pipelines.owner_id`. Silent
    * no-op when the caller does not own the parent pipeline. HEL-1511 (design.md D4): first terminal write wins --
    * returns whether THIS call finalized the run (`false`: not owned, or already terminal, e.g. reaped). */
  def updateRunTerminal(
      runId: PipelineRunId,
      status: String,
      completedAt: Instant,
      rowCount: Option[Int],
      errorLog: Option[String],
      user: AuthenticatedUser,
      // HEL-873 (design.md Decision 2a): every terminal write is required to pass a real value --
      // no default -- so a forgotten call site fails to compile rather than silently writing NULL
      // to a terminal row (the exact SparkJobSubmitter hazard task 2.8 calls out).
      truncatedReadsJson: Option[String],
      // HEL-1579: the run's per-step row counts (compact JSON, step id -> count), written in the same statement as
      // `rowCount`. Defaults to `None` = "not recorded": every failure/blocked/reaped/Spark path writes NULL here.
      stepRowCountsJson: Option[String] = None
  ): Future[Boolean] = {
    val ownerUuid = UUID.fromString(user.id.value)
    val ownedRunQuery = for {
      run      <- runsTable if run.id === runId.value
      pipeline <- pipelinesTable if pipeline.id === run.pipelineId && pipeline.ownerId === ownerUuid
    } yield run.id
    ctx.withUserContext(user.id.value)(ownedRunQuery.result.headOption).flatMap {
      case None      => Future.successful(false)
      case Some(rid) => updateRunTerminalInternal(PipelineRunId(rid), status, completedAt, rowCount, errorLog, truncatedReadsJson, stepRowCountsJson)
    }
  }

  /** ACL-bypassing terminal update for the privileged Spark driver path.
    * `truncatedReadsJson` has NO default (see `updateRunTerminal`'s doc) --
    * `SparkJobSubmitter`'s two call sites pass `PipelineRunService.EmptyTruncationJson`
    * explicitly (task 2.8, evaluation-2.md item 2). HEL-1511 (design.md D4): conditional on `completed_at IS NULL`,
    * so the first terminal write wins; returns `true` only when this call finalized the row. */
  def updateRunTerminalInternal(
      runId: PipelineRunId,
      status: String,
      completedAt: Instant,
      rowCount: Option[Int],
      errorLog: Option[String],
      truncatedReadsJson: Option[String],
      stepRowCountsJson: Option[String] = None
  ): Future[Boolean] =
    ctx.withSystemContext(
      runsTable
        .filter(r => r.id === runId.value && r.completedAt.isEmpty)
        .map(r => (r.status, r.completedAt, r.rowCount, r.errorLog, r.truncatedReads, r.stepRowCounts))
        .update((status, Some(completedAt), rowCount, errorLog, truncatedReadsJson, stepRowCountsJson))
    ).map(_ > 0)

  /** HEL-1511 (design.md D4) / HEL-1518 (design.md D1): the run's state -- open, terminal (reaped or otherwise
    * finalized) or missing (deleted with its pipeline, or pruned). The success chain reads it before any side effect,
    * so a run reaped while its instance stalled cannot write snapshots or write-backs. */
  def runStateInternal(runId: PipelineRunId): Future[RunState] =
    // Privileged: keyed by the server-generated run id the executor itself inserted. An editor-admitted run belongs to
    // the pipeline OWNER under the owner-JOIN RLS, so the user pool would not see it and would misread it as missing.
    ctx.withSystemContext(sql"SELECT completed_at IS NULL FROM pipeline_runs WHERE id = ${runId.value}".as[Boolean].headOption).map {
      case Some(true)  => RunState.Open
      case Some(false) => RunState.Terminal
      case None        => RunState.Missing
    }

  /** HEL-1518 (design.md D3): the in-transaction run guard, composed as the FIRST action of a node's snapshot
    * transaction. Locks the pipeline row `FOR KEY SHARE` (so a pipeline delete, whose `FOR UPDATE` conflicts, either
    * finishes first or waits for this transaction -- the delete's lock order stays pipeline row before cascaded rows)
    * and then the run row `FOR SHARE` (which conflicts with the reaper's non-key UPDATE, so a reap waits for this
    * transaction to commit). Fails the transaction with [[RunNoLongerOpen]] -- before anything was written -- when
    * the run is gone or was finalized by anything other than its own `succeeded` terminal write (that write is an
    * eager sibling of the node fold, so on a healthy run it can commit before a node's write). Must run inside an
    * already-privileged (`withSystemContext`) transaction: it reads rows the user pool's RLS may hide. */
  def runGuardAction(pipelineId: PipelineId, runId: PipelineRunId): DBIO[Unit] =
    (sql"SELECT 1 FROM pipelines WHERE id = ${pipelineId.value} FOR KEY SHARE".as[Int] andThen
      sql"SELECT status, completed_at IS NULL FROM pipeline_runs WHERE id = ${runId.value} FOR SHARE".as[(String, Boolean)].headOption).flatMap {
      case None                                                  => DBIO.failed(RunNoLongerOpen(RunState.Missing))
      case Some((status, open)) if open || status == "succeeded" => DBIO.successful(())
      case Some(_)                                               => DBIO.failed(RunNoLongerOpen(RunState.Terminal))
    }

  /** HEL-1511 (design.md D1): one conditional UPDATE refreshing the heartbeat of the given live runs. Always
    * system context: on the RLS user pool there is no request-bound user, so it would match 0 rows in prod. An
    * empty set issues no query. Returns the number of rows stamped. */
  def stampHeartbeatsInternal(runIds: Set[String], now: Instant): Future[Int] =
    if (runIds.isEmpty) Future.successful(0)
    else
      ctx.withSystemContext(
        runsTable
          .filter(r => r.id.inSet(runIds) && r.completedAt.isEmpty)
          .map(_.heartbeatAt)
          .update(Some(now))
      )

  /** HEL-1511 (design.md D2): finalizes every stale non-terminal real run as `failed` in ONE statement. A run is
    * stale when its heartbeat is older than `staleAfterSeconds`, or (no heartbeat ever: a legacy row) when it
    * started more than `legacyAfterSeconds` ago. The conditional UPDATE needs no lock: under READ COMMITTED a
    * concurrent heartbeat or reap that commits first makes this statement re-evaluate its WHERE on the updated row
    * and skip it. The pipeline's `last_run_*` becomes failed only for a run with no newer non-dry run. */
  def reapStaleRunsInternal(
      now: Instant,
      staleAfterSeconds: Long,
      legacyAfterSeconds: Long,
      truncatedReadsJson: String
  ): Future[Vector[ReapedRun]] = {
    val nowTs        = Timestamp.from(now)
    val staleCutoff  = Timestamp.from(now.minusSeconds(staleAfterSeconds))
    val legacyCutoff = Timestamp.from(now.minusSeconds(legacyAfterSeconds))
    val legacyReason = s"Run abandoned: no heartbeat recorded and started over ${legacyAfterSeconds / 3600} h ago (the server running it likely stopped)"
    ctx.withSystemContext(
      sql"""WITH reaped AS (
              UPDATE pipeline_runs
              SET status = 'failed', completed_at = $nowTs, truncated_reads = $truncatedReadsJson::jsonb, step_row_counts = NULL,
                  error_log = CASE WHEN heartbeat_at IS NOT NULL
                                   THEN 'Run abandoned: no heartbeat for ' || floor(extract(epoch FROM ($nowTs::timestamptz - heartbeat_at)))::bigint
                                        || ' s (the server running it likely stopped)'
                                   ELSE $legacyReason END
              WHERE completed_at IS NULL AND status <> 'dry_run'
                AND ((heartbeat_at IS NOT NULL AND heartbeat_at < $staleCutoff)
                  OR (heartbeat_at IS NULL AND started_at < $legacyCutoff))
              RETURNING id, pipeline_id, started_at, error_log
            ), last_run AS (
              UPDATE pipelines p
              SET last_run_status = 'failed', last_run_at = $nowTs, last_run_row_count = NULL, last_run_truncated = false,
                  last_run_step_row_counts = NULL,
                  updated_at = $nowTs
              FROM reaped r
              WHERE p.id = r.pipeline_id
                AND NOT EXISTS (SELECT 1 FROM pipeline_runs n
                                WHERE n.pipeline_id = r.pipeline_id AND n.status <> 'dry_run' AND n.started_at > r.started_at)
              RETURNING p.id
            )
            SELECT r.id, r.pipeline_id, p.owner_id::text, r.started_at, r.error_log
            FROM reaped r JOIN pipelines p ON p.id = r.pipeline_id"""
        .as[(String, String, String, Timestamp, String)]
    ).map(_.map { case (id, pid, owner, started, reason) =>
      ReapedRun(PipelineRunId(id), PipelineId(pid), UserId(owner), started.toInstant, reason)
    }.toVector)
  }

  /** Owner-scoped dry-run insert. Silent no-op when the caller does not own
    * the parent pipeline. Dry runs are always triggered interactively (the
    * scheduler never dry-runs), so `triggerSource` is always `"manual"` --
    * no caller-supplied parameter. `truncatedReadsJson` (HEL-873, design.md
    * Decision 2a): a dry run inserts an already-terminal row in one
    * statement, so it must never leave this NULL, unlike `insertRunInternal`'s
    * queued row. */
  def insertDryRun(runId: PipelineRunId, pipelineId: PipelineId, startedAt: Instant, rowCount: Int, user: AuthenticatedUser, truncatedReadsJson: String, triggeredByUserId: Option[String] = None): Future[Unit] =
    ctx.withUserContext(user.id.value)(pipelineOwnedAction(pipelineId, user)).flatMap {
      case false => Future.successful(())
      case true  => insertDryRunInternal(runId, pipelineId, startedAt, rowCount, truncatedReadsJson, triggeredByUserId)
    }

  /** HEL-1492: an EDITOR grantee's dry-run insert -- the privileged counterpart of [[insertDryRun]]. A dry run has
    * no preceding authorized row to key on, so the owner-or-editor predicate is evaluated in the SAME transaction
    * as the insert; a submitter who is neither (grant revoked mid-run, pipeline deleted) writes nothing, silently,
    * like [[insertDryRun]]'s non-owner no-op. */
  def insertGranteeDryRun(runId: PipelineRunId, pipelineId: PipelineId, startedAt: Instant, rowCount: Int, submitter: AuthenticatedUser, truncatedReadsJson: String, triggeredByUserId: Option[String]): Future[Unit] = {
    val action: DBIO[Unit] =
      pipelinesTable.filter(_.id === pipelineId.value).map(_.ownerId).result.headOption.flatMap {
        case None => DBIO.successful(())
        case Some(ownerUuid) =>
          submitterMayRunAction(pipelineId, ownerUuid, submitter).flatMap {
            case false => DBIO.successful(())
            case true  => dryRunRowAction(runId, pipelineId, startedAt, rowCount, truncatedReadsJson, triggeredByUserId)
          }
      }
    // withSystemContext: the editor is not the pipeline owner, so V35 pipeline_runs_owner RLS would refuse this
    // INSERT; bypass is correct because the same transaction re-verifies owner-or-editor (HEL-1492 Q5).
    ctx.withSystemContext(action)
  }

  /** ACL-bypassing dry-run insert for the privileged Spark driver path. */
  def insertDryRunInternal(runId: PipelineRunId, pipelineId: PipelineId, startedAt: Instant, rowCount: Int, truncatedReadsJson: String, triggeredByUserId: Option[String] = None): Future[Unit] =
    ctx.withSystemContext(dryRunRowAction(runId, pipelineId, startedAt, rowCount, truncatedReadsJson, triggeredByUserId))

  private def dryRunRowAction(runId: PipelineRunId, pipelineId: PipelineId, startedAt: Instant, rowCount: Int, truncatedReadsJson: String, triggeredByUserId: Option[String]): DBIO[Unit] = {
    val row = PipelineRunRow(
      id             = runId.value,
      pipelineId     = pipelineId.value,
      status         = "dry_run",
      startedAt      = startedAt,
      completedAt    = Some(startedAt),
      rowCount       = Some(rowCount),
      errorLog       = None,
      triggerSource  = "manual",
      truncatedReads = Some(truncatedReadsJson),
      triggeredByUserId = triggeredByUserId.map(UUID.fromString)
    )
    (runsTable += row).map(_ => ())
  }

  /**
   * Owner-scoped retention pass. Silent no-op when the caller does not own
   * the parent pipeline.
   */
  def deleteOldRuns(pipelineId: PipelineId, user: AuthenticatedUser, keepN: Int = 10): Future[Unit] =
    ctx.withUserContext(user.id.value)(pipelineOwnedAction(pipelineId, user)).flatMap {
      case false => Future.successful(())
      case true  => deleteOldRunsInternal(pipelineId, keepN)
    }

  /** ACL-bypassing retention pass for the privileged Spark driver path.
    *
    *  HEL-1578 (owner answer `keep-24h`): keeps the `keepN` newest real runs UNION every real run started
    *  within the last [[RetentionWindowHours]] hours, then caps the survivors at the [[RetentionMaxRuns]]
    *  newest. Dry runs are never touched here. */
  def deleteOldRunsInternal(pipelineId: PipelineId, keepN: Int = 10): Future[Unit] = {
    val pid         = pipelineId.value
    val windowStart = Instant.now().minusSeconds(RetentionWindowHours * 3600L)
    val newestN = runsTable
      .filter(r => r.pipelineId === pid && r.status =!= "dry_run")
      .sortBy(_.startedAt.desc)
      .take(keepN)
      .map(_.id)
    val inWindow = runsTable
      .filter(r => r.pipelineId === pid && r.status =!= "dry_run" && r.startedAt >= windowStart)
      .map(_.id)
    // The cap: only the RetentionMaxRuns newest runs may survive, whatever the union says.
    val capped = runsTable
      .filter(r => r.pipelineId === pid && r.status =!= "dry_run")
      .sortBy(_.startedAt.desc)
      .take(RetentionMaxRuns)
      .map(_.id)

    val action = runsTable
      .filter(r =>
        r.pipelineId === pid && r.status =!= "dry_run" &&
          (!(r.id.in(newestN) || r.id.in(inWindow)) || !r.id.in(capped))
      )
      .delete

    ctx.withSystemContext(action).map(_ => ())
  }

  /**
   * Owner-scoped dry-run retention. Silent no-op when the caller does not
   * own the parent pipeline.
   */
  def deleteOldDryRuns(pipelineId: PipelineId, user: AuthenticatedUser, keepN: Int = 10): Future[Unit] =
    ctx.withUserContext(user.id.value)(pipelineOwnedAction(pipelineId, user)).flatMap {
      case false => Future.successful(())
      case true  => deleteOldDryRunsInternal(pipelineId, keepN)
    }

  /** ACL-bypassing dry-run retention for the privileged Spark driver path. */
  def deleteOldDryRunsInternal(pipelineId: PipelineId, keepN: Int = 10): Future[Unit] = {
    val pid = pipelineId.value
    val keepIds = runsTable
      .filter(r => r.pipelineId === pid && r.status === "dry_run")
      .sortBy(_.startedAt.desc)
      .take(keepN)
      .map(_.id)

    val action = runsTable
      .filter(r => r.pipelineId === pid && r.status === "dry_run" && !r.id.in(keepIds))
      .delete

    ctx.withSystemContext(action).map(_ => ())
  }

  /** Owner-scoped list of runs for a pipeline. Empty vector when the caller
    * does not own the parent pipeline. */
  def listByPipeline(pipelineId: PipelineId, user: AuthenticatedUser): Future[Vector[PipelineRunRow]] = {
    val ownerUuid = UUID.fromString(user.id.value)
    val query = for {
      run      <- runsTable if run.pipelineId === pipelineId.value
      pipeline <- pipelinesTable if pipeline.id === run.pipelineId && pipeline.ownerId === ownerUuid
    } yield run
    ctx.withUserContext(user.id.value)(query.sortBy(_.startedAt.desc).result).map(_.toVector)
  }

  /** ACL-bypassing list of runs. Safe to call only after the caller's pipeline
    * access has been confirmed via PipelineRepository.findByIdShared. Used by
    * PipelineRunService.history to support viewer/editor grantees. */
  def listByPipelineInternal(pipelineId: PipelineId): Future[Vector[PipelineRunRow]] =
    ctx.withSystemContext(
      runsTable
        .filter(_.pipelineId === pipelineId.value)
        .sortBy(_.startedAt.desc)
        .result
    ).map(_.toVector)

  /** ACL-bypassing lookup of the single most recent run (by `startedAt` desc, any status -- not
   *  just successful) for a pipeline, or `None` for a never-run pipeline (HEL-1174, design.md
   *  Decision 2). Safe to call only after the caller's pipeline access has been confirmed via
   *  `PipelineRepository.findByIdShared`, mirroring `listByPipelineInternal`'s own contract --
   *  backs `GET /api/pipelines/:id/runs/latest`, the durable reconciliation read a (re)connecting
   *  SSE subscriber uses instead of the ephemeral push channel alone. `.take(1)` before `.result`
   *  so the LIMIT is pushed down to Postgres rather than fetching every row and taking the head
   *  in Scala. */
  def latestRunInternal(pipelineId: PipelineId): Future[Option[PipelineRunRow]] =
    ctx.withSystemContext(
      runsTable
        .filter(_.pipelineId === pipelineId.value)
        .sortBy(_.startedAt.desc)
        .take(1)
        .result
    ).map(_.headOption)

  /** HEL-1206 design.md D4 -- the single most recent NON-DRY run (`status != 'dry_run'`, the same
   *  load-bearing filter `OutputService.assertionStatus` applies in Scala), pushed down as a
   *  `LIMIT 1` so provenance never loads the pipeline's whole retained run history. ACL-bypassing:
   *  callers must already have cleared access (authenticated Output read / public dashboard gate). */
  def latestNonDryRunInternal(pipelineId: PipelineId): Future[Option[PipelineRunRow]] =
    ctx.withSystemContext(
      runsTable
        .filter(r => r.pipelineId === pipelineId.value && r.status =!= "dry_run")
        .sortBy(_.startedAt.desc)
        .take(1)
        .result
    ).map(_.headOption)

  /** ACL-bypassing lookup of the most recent SUCCESSFUL run's `completedAt`
   *  for a pipeline (HEL-946 Bug C(2)). Used to distinguish "this node was
   *  never materialized" from "this node ran and legitimately returned zero
   *  rows": `onUnblockedRunSuccess` writes `node_snapshots` (even an empty
   *  snapshot) for every node that already has an Output at the moment a
   *  run completes, so if a successful run finished AFTER the Output's
   *  `createdAt`, that node WAS materialized by that run regardless of the
   *  stored row count -- an empty `node_snapshots` result in that case is a
   *  genuine empty result set, not "never ran". */
  def latestSuccessfulCompletedAtInternal(pipelineId: PipelineId): Future[Option[Instant]] =
    ctx.withSystemContext(
      runsTable
        .filter(r => r.pipelineId === pipelineId.value && r.status === "succeeded" && r.completedAt.isDefined)
        .map(_.completedAt)
        .max
        .result
    )

  /** ACL-bypassing check for an in-flight run (`completed_at IS NULL`) for a
    * pipeline — the persisted half of `PipelineSchedulerService`'s overlap
    * guard (HEL-415). Catches a still-running run across a scheduler
    * restart (the in-memory guard is lost) or a manually-submitted run in
    * flight when a schedule comes due. System context: the scheduler
    * background job has no request-bound user. */
  def hasActiveRunInternal(pipelineId: PipelineId): Future[Boolean] =
    ctx.withSystemContext(
      runsTable.filter(r => r.pipelineId === pipelineId.value && r.completedAt.isEmpty).exists.result
    )

  /** ACL-bypassing lookup of the in-flight run (`completed_at IS NULL`) for a
    * pipeline, if any -- same predicate as [[hasActiveRunInternal]], but
    * returning the row so `HookTriggerService` can collapse a duplicate
    * external trigger into the existing run's id/status (HEL-369 design.md
    * Decision 6) instead of starting a second one. `headOption` is safe:
    * at most one run per pipeline can have a null `completed_at` at a time
    * (the scheduler/hook overlap guard is what keeps that invariant true). */
  def findActiveRunInternal(pipelineId: PipelineId): Future[Option[PipelineRunRow]] =
    ctx.withSystemContext(
      runsTable.filter(r => r.pipelineId === pipelineId.value && r.completedAt.isEmpty).result.headOption
    )


  /** Privileged insert for the [[AssertionResult]]s evaluated during a run
    * (design.md Decision 6 — always `withSystemContext`, mirroring
    * `insertRunInternal`'s privileged pattern; the run itself was already
    * inserted owner-scoped, so there is no meaningfully-different ownership
    * check to perform here). No-op for an empty `results`. */
  def insertAssertions(runId: PipelineRunId, results: Seq[AssertionResult]): Future[Unit] =
    if (results.isEmpty) Future.successful(())
    else {
      val rows = results.map { r =>
        PipelineRunAssertionRow(
          id       = UUID.randomUUID().toString,
          runId    = runId.value,
          stepId   = r.stepId,
          kind     = r.kind,
          field    = r.field,
          severity = r.severity,
          passed   = r.passed,
          observed = r.observed,
          message  = r.message
        )
      }
      ctx.withSystemContext(assertionsTable ++= rows).map(_ => ())
    }

  /** Owner-scoped list of assertion results for a run, via JOIN through the
    * parent `pipeline_runs` row to `pipelines.owner_id`. Empty vector when
    * the caller does not own the parent pipeline. */
  def listAssertionsByRun(runId: PipelineRunId, user: AuthenticatedUser): Future[Vector[PipelineRunAssertionRow]] = {
    val ownerUuid = UUID.fromString(user.id.value)
    val query = for {
      a        <- assertionsTable if a.runId === runId.value
      run      <- runsTable if run.id === a.runId
      pipeline <- pipelinesTable if pipeline.id === run.pipelineId && pipeline.ownerId === ownerUuid
    } yield a
    ctx.withUserContext(user.id.value)(query.result).map(_.toVector)
  }

  /** HEL-1619: the batched sibling of `listByPipelineInternal(...).head` -- the id of the most
    * recent run (`startedAt` desc, any status, dry included) of each pipeline in `pipelineIds` that has
    * one, from ONE query that reads only `(pipeline_id, id, started_at)`. A never-run pipeline is
    * absent from the map. ACL-bypassing: the caller must feed it an id set it has ALREADY
    * confirmed access to (here, the ids `PipelineService.listSummaries` returned), never an
    * unvalidated caller-supplied set. */
  def latestRunIdsInternalBatch(pipelineIds: Set[PipelineId]): Future[Map[PipelineId, String]] =
    if (pipelineIds.isEmpty) Future.successful(Map.empty)
    else
      ctx.withSystemContext(
        runsTable
          .filter(_.pipelineId.inSet(pipelineIds.map(_.value)))
          .sortBy(_.startedAt.desc)
          .map(r => (r.pipelineId, r.id))
          .result
      ).map(_.foldLeft(Map.empty[PipelineId, String]) { case (acc, (pid, runId)) =>
        // Rows arrive newest-first, so the first one seen per pipeline is its latest run.
        if (acc.contains(PipelineId(pid))) acc else acc.updated(PipelineId(pid), runId)
      })

  /** HEL-1619: [[listAssertionsByRunInternal]] for many runs in one query, grouped by run id. A
    * run without assertion rows is absent from the map. Same ACL contract as the single-run method. */
  def listAssertionsByRunsInternalBatch(runIds: Set[String]): Future[Map[String, Vector[PipelineRunAssertionRow]]] =
    if (runIds.isEmpty) Future.successful(Map.empty)
    else
      ctx.withSystemContext(assertionsTable.filter(_.runId.inSet(runIds)).result)
        .map(_.toVector.groupBy(_.runId))

  /** ACL-bypassing list of assertion results for a run. Safe to call only
    * after the caller's run/pipeline access has been confirmed at the
    * service layer (mirrors `listByPipelineInternal` — a future
    * grantee-aware caller's job to wire up, per design.md Decision 6). */
  def listAssertionsByRunInternal(runId: PipelineRunId): Future[Vector[PipelineRunAssertionRow]] =
    ctx.withSystemContext(assertionsTable.filter(_.runId === runId.value).result).map(_.toVector)

  // HEL-904 task 2.10: `findLatestRunIdByOutputDataTypeIdInternal` removed
  // outright -- it resolved a pipeline via `pipelines.output_data_type_id`
  // (dropped, V94) and its only caller (`assertionStatusForDataType`/
  // `DataTypeRoutes`) was already deleted in task 4.1; zero production
  // callers remained, only test callers exercising a method with no live
  // caller (see execution-progress.md cycle 26).
}

object PipelineRunRepository {

  /** HEL-1578: real runs started inside this window survive retention (owner answer `keep-24h`). */
  val RetentionWindowHours: Long = 24L
  /** HEL-1578: hard cap on kept real runs per pipeline, bounding a very busy pipeline. */
  val RetentionMaxRuns: Int = 300

  /** HEL-1518: where a run stands. `Missing` = no row (deleted with its pipeline, or pruned). */
  sealed trait RunState
  object RunState {
    case object Open     extends RunState
    case object Terminal extends RunState
    case object Missing  extends RunState
  }

  /** HEL-1518: thrown by [[PipelineRunRepository.runGuardAction]] to roll a node's snapshot transaction back untouched. */
  final case class RunNoLongerOpen(state: RunState) extends RuntimeException(s"Run is no longer open ($state)")

  /** One run finalized by [[PipelineRunRepository.reapStaleRunsInternal]] (HEL-1511). */
  final case class ReapedRun(runId: PipelineRunId, pipelineId: PipelineId, ownerId: UserId, startedAt: Instant, reason: String)

  /** HEL-1503: result of [[PipelineRunRepository.checkRunAuthorizationInternal]]. */
  sealed trait RunAuthorization
  object RunAuthorization {
    case object Authorized extends RunAuthorization
    case object NotAuthorized extends RunAuthorization
    case object PipelineGone extends RunAuthorization
  }

  /** The outcomes of [[PipelineRunRepository.insertRunIfUnderConcurrencyCap]] and
   *  [[PipelineRunRepository.insertGranteeRunIfUnderOwnerCap]] (HEL-505, HEL-1492). Only `Inserted` admits a
   *  run. `NotAuthorized` (the submitter is not the pipeline's owner or an editor -- a revoked grant) is
   *  deliberately distinct from `CapExceeded`: it maps to `Forbidden`, not a 429. `PipelineGone` (HEL-1503: no such pipeline) maps to `NotFound`. */
  sealed trait ConcurrencyCapResult
  object ConcurrencyCapResult {
    case object Inserted extends ConcurrencyCapResult
    case object CapExceeded extends ConcurrencyCapResult
    case object NotAuthorized extends ConcurrencyCapResult
    /** HEL-1503: the pipeline no longer exists (deleted mid-submit) -- 404, never a 403/500. */
    case object PipelineGone extends ConcurrencyCapResult
  }

  case class PipelineRunRow(
      id: String,
      pipelineId: String,
      status: String,
      startedAt: Instant,
      completedAt: Option[Instant],
      rowCount: Option[Int],
      errorLog: Option[String],
      triggerSource: String,
      // HEL-369: UUID (not String) -- matches the column's REFERENCES
      // api_tokens(id) type; converted to/from the domain-facing
      // ApiTokenId.value string at the repository boundary (insertRunInternal's
      // param, PipelineRunService.history's mapping).
      triggeredByTokenId: Option[UUID] = None,
      // HEL-873 (design.md Decision 2, evaluation-1.md CR1, evaluation-2.md item 2): NULL means
      // "not recorded" -- predates this column or has not reached a terminal status. A present
      // value is an OBJECT, `{"primaryAvailableRowCount": <long|null>, "reads": [...]}` -- NOT a
      // bare JSON array (an earlier cycle's encoding, changed before this column ever shipped to
      // production). `reads` empty means recorded-and-complete; `reads` non-empty means truncated.
      // `PipelineRunService.EmptyTruncationJson` is the canonical recorded-and-complete literal --
      // use it, never a bare `"[]"`, which is NOT an object and therefore decodes to NOT-RECORDED
      // (`PipelineRunQueries.parseTruncationRecord`'s `Try` degrades any non-object value that
      // way, per CR4). Raw JSON text at this layer -- decoded to a `RunTruncationRecord` at the
      // service boundary, mirroring every other `jsonbStringType`-mapped column in this codebase
      // (see `PanelRepository`/`AlertRuleRepository`).
      truncatedReads: Option[String] = None,
      // HEL-1492: the user who submitted the run (owner, editor grantee, the scheduler's synthetic owner, a hook
      // token's user). NULL on rows written before V124 and on the dormant SparkJobSubmitter path.
      triggeredByUserId: Option[UUID] = None,
      // HEL-1511: last liveness stamp; NULL = never stamped (rows predating V126, and dry runs).
      heartbeatAt: Option[Instant] = None,
      // HEL-1579 (V135): per-step row counts as compact JSON text (step id -> count); NULL = not recorded (failed /
      // blocked / reaped / Spark / dry-run rows, and rows predating V135).
      stepRowCounts: Option[String] = None
  )

  class PipelineRunTable(tag: Tag) extends Table[PipelineRunRow](tag, "pipeline_runs") {
    def id                 = column[String]("id", O.PrimaryKey)
    def pipelineId         = column[String]("pipeline_id")
    def status             = column[String]("status")
    def startedAt          = column[Instant]("started_at")
    def completedAt        = column[Option[Instant]]("completed_at")
    def rowCount           = column[Option[Int]]("row_count")
    def errorLog           = column[Option[String]]("error_log")
    def triggerSource      = column[String]("trigger_source")
    def triggeredByTokenId = column[Option[UUID]]("triggered_by_token_id")
    // No explicit `jsonbStringType` needed here (unlike a non-Option JSONB column elsewhere in
    // this codebase) -- Slick derives `TypedType[Option[String]]` from the ambient `String`
    // column type automatically, and `jsonbStringType`'s mapping is identity at the Scala level
    // anyway (it exists purely to document the column's JSONB-backed intent).
    def truncatedReads     = column[Option[String]]("truncated_reads")

    def triggeredByUserId  = column[Option[UUID]]("triggered_by_user_id")

    def heartbeatAt        = column[Option[Instant]]("heartbeat_at")

    def stepRowCounts      = column[Option[String]]("step_row_counts")

    def * = (id, pipelineId, status, startedAt, completedAt, rowCount, errorLog, triggerSource, triggeredByTokenId, truncatedReads, triggeredByUserId, heartbeatAt, stepRowCounts).mapTo[PipelineRunRow]
  }


  case class PipelineRunAssertionRow(
      id: String,
      runId: String,
      stepId: String,
      kind: String,
      field: Option[String],
      severity: String,
      passed: Boolean,
      observed: Option[String],
      message: Option[String]
  )

  class PipelineRunAssertionTable(tag: Tag) extends Table[PipelineRunAssertionRow](tag, "pipeline_run_assertions") {
    def id       = column[String]("id", O.PrimaryKey)
    def runId    = column[String]("run_id")
    def stepId   = column[String]("step_id")
    def kind     = column[String]("kind")
    def field    = column[Option[String]]("field")
    def severity = column[String]("severity")
    def passed   = column[Boolean]("passed")
    def observed = column[Option[String]]("observed")
    def message  = column[Option[String]]("message")

    def * = (id, runId, stepId, kind, field, severity, passed, observed, message).mapTo[PipelineRunAssertionRow]
  }
}
