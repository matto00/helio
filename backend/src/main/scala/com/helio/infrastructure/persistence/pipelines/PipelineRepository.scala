package com.helio.infrastructure.persistence.pipelines

import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ResourcePermissionRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.domain.model._
import slick.jdbc.PostgresProfile.api._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

class PipelineRepository(
    ctx: DbContext,
    dataSourceRepo: DataSourceRepository
)(implicit ec: ExecutionContext) {

  import PipelineRepository._

  private val pipelinesTable   = TableQuery[PipelineTable]
  private val dataSourcesTable = TableQuery[DataSourceRepository.DataSourceTable]
  private val permTable        = TableQuery[ResourcePermissionRepository.ResourcePermissionTable]
  private val rootsTable       = TableQuery[PipelineRootRepository.PipelineRootTable]

  // HEL-913: constructed internally (not injected) so the 50+ existing call sites of
  // `new PipelineRepository(ctx, dataSourceRepo)` across the codebase are unaffected --
  // `PipelineRootRepository` has no dependency beyond `ctx`, so there is nothing a caller could
  // meaningfully override by injecting its own instance here.
  private val rootRepo = new PipelineRootRepository(ctx)

  /** Owner-scoped existence check. Used to gate `addStep` / `listSteps`. */
  def exists(id: PipelineId, user: AuthenticatedUser): Future[Boolean] = {
    val ownerUuid = UUID.fromString(user.id.value)
    ctx.withUserContext(user.id.value)(
      pipelinesTable.filter(r => r.id === id.value && r.ownerId === ownerUuid).exists.result
    )
  }

  /** Owner-scoped lookup. Returns `None` for rows the caller does not own —
    * existence and authorization are indistinguishable at the API. */
  def findById(id: PipelineId, user: AuthenticatedUser): Future[Option[Pipeline]] = {
    val ownerUuid = UUID.fromString(user.id.value)
    ctx.withUserContext(user.id.value)(
      pipelinesTable.filter(r => r.id === id.value && r.ownerId === ownerUuid).result.headOption
    ).map(_.map(rowToPipeline))
  }

  /** ACL-bypassing read by id. Reserved for documented privileged callers:
    * - `ResourceTypeRegistry` resolver (the directive does the comparison)
    * - `SparkJobSubmitter` (already-authorized background execution path)
    *
    * Do not call from a request-bound service method. */
  def findByIdInternal(id: PipelineId): Future[Option[Pipeline]] =
    ctx.withSystemContext(
      pipelinesTable.filter(_.id === id.value).result.headOption
    ).map(_.map(rowToPipeline))

  /** Sharing-aware read. Returns Some if:
   *  - `callerOpt` is Some and the caller is the owner, or
   *  - `callerOpt` is Some and the caller has an editor/viewer grant.
   *  Returns None for all other cases (no existence leak).
   *  No public-viewer (anonymous) path for pipelines. */
  def findByIdShared(id: PipelineId, callerOpt: Option[AuthenticatedUser]): Future[Option[Pipeline]] =
    ctx.withSystemContext(pipelinesTable.filter(_.id === id.value).result.headOption).flatMap {
      case None => Future.successful(None)
      case Some(row) =>
        val ownerId = row.ownerId.toString
        callerOpt match {
          case Some(caller) if caller.id.value == ownerId =>
            Future.successful(Some(rowToPipeline(row)))

          case Some(caller) =>
            ctx.withUserContext(caller.id.value)(
              permTable
                .filter(p =>
                  p.resourceType === "pipeline" &&
                  p.resourceId   === id.value   &&
                  p.granteeId    === UUID.fromString(caller.id.value)
                )
                .exists
                .result
            ).map(hasGrant => if (hasGrant) Some(rowToPipeline(row)) else None)

          case None =>
            // No public-viewer path for pipelines.
            Future.successful(None)
        }
    }

  /** Owner-only read. Used for delete / rename where only the pipeline owner
   *  is authorised regardless of any sharing grants.
   *  Returns None for cross-user callers (no existence leak). */
  def findByIdOwned(id: PipelineId, user: AuthenticatedUser): Future[Option[Pipeline]] = {
    val ownerUuid = UUID.fromString(user.id.value)
    ctx.withUserContext(user.id.value)(
      pipelinesTable
        .filter(r => r.id === id.value && r.ownerId === ownerUuid)
        .result
        .headOption
    ).map(_.map(rowToPipeline))
  }

  /** HEL-913: ACL-bypassing resolution of a pipeline's LOWEST-POSITIONED root's
    * `data_source_id` -- the single-root-compatible replacement for the now-dropped
    * `Pipeline.sourceDataSourceId` field, used by the run/analyze paths (`PipelineRunService`,
    * `PipelineService`) that have not yet been generalized to walk every root (that
    * generalization is engine work, a later stage of this ticket -- see design.md's NodeKey/
    * RootKey engine contract). Every pipeline has at least one root (V98 backfill / task 4.6's
    * service-layer enforcement), so `None` here means the pipeline itself does not exist, not
    * "no source". */
  def findPrimaryDataSourceIdInternal(id: PipelineId): Future[Option[DataSourceId]] =
    ctx.withSystemContext(
      rootsTable
        .filter(_.pipelineId === id.value)
        .sortBy(_.position)
        .map(_.dataSourceId)
        .result
        .headOption
    ).map(_.map(DataSourceId.apply))

  /** HEL-913 task 5.4: every root's `(PipelineRootId, DataSourceId)`, ordered by `position`
    * ascending (R3's cross-root tiebreak) -- the multi-root-aware sibling of
    * [[findPrimaryDataSourceIdInternal]]. Privileged, mirroring that method's contract. */
  def listRootDataSourceIdsInternal(id: PipelineId): Future[Vector[(PipelineRootId, DataSourceId)]] =
    ctx.withSystemContext(
      rootsTable
        .filter(_.pipelineId === id.value)
        .sortBy(_.position)
        .map(r => (r.id, r.dataSourceId))
        .result
    ).map(_.map { case (rid, dsid) => (PipelineRootId(rid), DataSourceId(dsid)) }.toVector)

  /** HEL-914 (production N+1 fix, HEL-865's field report -- 220,197-char response on a
    * 25-source/43-pipeline workspace): the multi-pipeline sibling of
    * [[listRootDataSourceIdsInternal]] -- one round trip for every id in `pipelineIds` instead of
    * one per id. Privileged (`withSystemContext`), on the SAME basis as the single-id method it
    * replaces in `WorkspaceContextService.assemble`'s loop -- it does NOT itself check ownership,
    * exactly like `listRootDataSourceIdsInternal`. The only caller must feed it an id set that is
    * ALREADY owner-scoped (there, `PipelineSummaryResponse.id` values from the owner-scoped
    * `PipelineService.listSummaries` call), never a caller-supplied/unvalidated id set -- the same
    * discipline `laneTreeFromRoots`'s doc calls out, and the precedent this repo's HEL-384 near-miss
    * (a cross-tenant union-source ACL gap) exists to guard against repeating. */
  def listRootDataSourceIdsInternalBatch(
      pipelineIds: Set[PipelineId]
  ): Future[Map[PipelineId, Vector[(PipelineRootId, DataSourceId)]]] =
    if (pipelineIds.isEmpty) Future.successful(Map.empty)
    else {
      val ids = pipelineIds.map(_.value)
      ctx.withSystemContext(
        rootsTable
          .filter(r => r.pipelineId.inSet(ids))
          .sortBy(r => (r.pipelineId, r.position))
          .map(r => (r.pipelineId, r.id, r.dataSourceId))
          .result
      ).map(_.groupBy(_._1).view.mapValues(_.map { case (_, rid, dsid) =>
        (PipelineRootId(rid), DataSourceId(dsid))
      }.toVector).map { case (pid, v) => (PipelineId(pid), v) }.toMap)
    }

  /** Owner-scoped variant of [[findPrimaryDataSourceIdInternal]], for request-bound service
    * methods that must not bypass ACL (mirrors `findByIdOwned`'s contract). */
  def findPrimaryDataSourceIdOwned(id: PipelineId, user: AuthenticatedUser): Future[Option[DataSourceId]] = {
    val ownerUuid = UUID.fromString(user.id.value)
    ctx.withUserContext(user.id.value)(
      (for {
        pipeline <- pipelinesTable if pipeline.id === id.value && pipeline.ownerId === ownerUuid
        root     <- rootsTable if root.pipelineId === pipeline.id
      } yield root)
        .sortBy(_.position)
        .map(_.dataSourceId)
        .result
        .headOption
    ).map(_.map(DataSourceId.apply))
  }

  /** Returns the grant role string ("editor" or "viewer") for the caller on
   *  this pipeline, or None if no grant exists.
   *  Used by PipelineService to distinguish editor from viewer for mutation gating. */
  def findGrantRole(id: PipelineId, user: AuthenticatedUser): Future[Option[String]] =
    ctx.withSystemContext(
      permTable
        .filter(p =>
          p.resourceType === "pipeline" &&
          p.resourceId   === id.value   &&
          p.granteeId    === UUID.fromString(user.id.value)
        )
        .map(_.role)
        .result
        .headOption
    )

  private def rowToPipeline(row: PipelineRow): Pipeline =
    Pipeline(
      id            = PipelineId(row.id),
      name          = row.name,
      lastRunStatus = row.lastRunStatus,
      lastRunAt     = row.lastRunAt,
      createdAt     = row.createdAt,
      updatedAt     = row.updatedAt,
      ownerId       = UserId(row.ownerId.toString),
      tag           = row.tag
    )

  /** HEL-913: `PipelineSummary`'s `sourceDataSourceId`/`sourceDataSourceName` fields are
    * preserved as-is at this task (the wire shape moves to `roots[]` in task 7.2, a later
    * stage) -- populated here from the pipeline's LOWEST-POSITIONED root (`pipeline_roots`,
    * `position = 0`) rather than the now-dropped `pipelines.source_data_source_id` column. This
    * keeps every existing consumer of `PipelineSummary` correct for the single-root case
    * (today's only case) while the underlying storage has already moved to `pipeline_roots`. */
  private def summaryQuery(filteredPipelines: Query[PipelineTable, PipelineRow, Seq]) =
    for {
      pipeline   <- filteredPipelines
      root       <- rootsTable if root.pipelineId === pipeline.id && root.position === 0
      dataSource <- dataSourcesTable if dataSource.id === root.dataSourceId
    } yield (pipeline, root.dataSourceId, dataSource.name)

  /** HEL-913 task 7.2: every root (position-ordered) for the given pipeline ids, each joined to
    * its `DataSource` name -- the multi-root sibling of `summaryQuery`'s position-0-only join.
    * Privileged (`withSystemContext`): every caller here has already resolved ACL for the
    * pipelines themselves via `summaryQuery`'s own owner/sharing filter; a root can never be
    * read for a pipeline the caller couldn't already see. */
  private def allRootsQuery(pipelineIds: Set[String]) =
    (for {
      root       <- rootsTable if root.pipelineId.inSet(pipelineIds)
      dataSource <- dataSourcesTable if dataSource.id === root.dataSourceId
    } yield (root.pipelineId, root.id, root.position, root.dataSourceId, dataSource.name))
      .sortBy { case (pid, _, pos, _, _) => (pid, pos) }

  private def rootsByPipelineId(pipelineIds: Set[String]): DBIO[Map[String, Vector[PipelineRootSummary]]] =
    allRootsQuery(pipelineIds).result.map(_.groupBy(_._1).view.mapValues(_.map { case (_, rid, _, dsId, dsName) =>
      PipelineRootSummary(rid, dsId, dsName)
    }.toVector).toMap)

  private def rowToSummary(p: PipelineRow, sourceDataSourceId: String, srcName: String, roots: Vector[PipelineRootSummary]): PipelineSummary =
    PipelineSummary(
      id                   = p.id,
      name                 = p.name,
      sourceDataSourceId   = sourceDataSourceId,
      sourceDataSourceName = srcName,
      roots                = roots,
      lastRunStatus        = p.lastRunStatus,
      lastRunAt            = p.lastRunAt.map(_.toString),
      lastRunRowCount      = p.lastRunRowCount,
      ownerId              = p.ownerId.toString,
      tag                  = p.tag
    )

  /** Sharing-aware joined summary. Returns Some for owner or grantee callers. */
  def findSummaryByIdShared(id: PipelineId, callerOpt: Option[AuthenticatedUser]): Future[Option[PipelineSummary]] =
    findByIdShared(id, callerOpt).flatMap {
      case None => Future.successful(None)
      case Some(_) =>
        ctx.withSystemContext {
          for {
            headOpt <- summaryQuery(pipelinesTable.filter(_.id === id.value)).result.headOption
            roots   <- rootsByPipelineId(Set(id.value))
          } yield headOpt.map { case (p, srcId, srcName) => rowToSummary(p, srcId, srcName, roots.getOrElse(id.value, Vector.empty)) }
        }
    }

  /** Owner-scoped joined summary for a single pipeline. */
  def findSummaryById(id: PipelineId, user: AuthenticatedUser): Future[Option[PipelineSummary]] = {
    val ownerUuid = UUID.fromString(user.id.value)
    ctx.withUserContext(user.id.value) {
      for {
        headOpt <- summaryQuery(pipelinesTable.filter(p => p.id === id.value && p.ownerId === ownerUuid)).result.headOption
        roots   <- rootsByPipelineId(Set(id.value))
      } yield headOpt.map { case (p, srcId, srcName) => rowToSummary(p, srcId, srcName, roots.getOrElse(id.value, Vector.empty)) }
    }
  }

  /** Owner-scoped name update. Returns `None` if the pipeline does not exist
    * or the caller does not own it. */
  def updateName(id: PipelineId, name: String, user: AuthenticatedUser): Future[Option[PipelineSummary]] = {
    val now       = Instant.now()
    val ownerUuid = UUID.fromString(user.id.value)
    ctx.withUserContext(user.id.value)(
      pipelinesTable
        .filter(r => r.id === id.value && r.ownerId === ownerUuid)
        .map(r => (r.name, r.updatedAt))
        .update((name, now))
    ).flatMap {
      case 0 => Future.successful(None)
      case _ => findSummaryById(id, user)
    }
  }

  /** Owner-scoped create — HEL-913 task 7.3 (R8): `sourceDataSourceIds` is one root per element,
    * in request order (`position` = index). Validated and resolved SEQUENTIALLY, refusing on the
    * FIRST invalid entry -- a blank id is `Left("sourceId is required and must not be blank")`
    * (no `"not found"` substring, so `PipelineService.create`'s existing `msg.contains("not
    * found")` error-mapping convention correctly surfaces it as 400) with **no ownership lookup
    * performed for that entry** (R8's explicit rule: the HEL-950 empty-seed-id guard does not
    * extend to roots); a non-blank id that doesn't resolve via `findByIdOwned` is
    * `Left(s"Data source not found: ...")` (404, same convention). Never empty (R8/the
    * empty-`roots`-array 400 is enforced by the caller, `PipelineService.create`).
    *
    * HEL-904 task 3.5: no longer mints a DataType — a new pipeline's
    * panel-bindable output is an explicit Output row, created separately
    * (see `PipelineProposalService`'s own Output-creation path, task 3.8).
    * `output_data_type_id` is left `NULL` (V94 relaxed the NOT NULL
    * constraint) for every pipeline created via this path. */
  def create(
      name: String,
      sourceDataSourceIds: Vector[DataSourceId],
      user: AuthenticatedUser,
      tag: Option[String] = None
  ): Future[Either[String, PipelineSummary]] = {
    require(sourceDataSourceIds.nonEmpty, "create: sourceDataSourceIds must be non-empty (caller's job to enforce R8's empty-roots 400)")

    def resolveInOrder(remaining: List[DataSourceId], acc: Vector[(DataSourceId, DataSource)]): Future[Either[String, Vector[(DataSourceId, DataSource)]]] =
      remaining match {
        case Nil => Future.successful(Right(acc))
        case id :: rest =>
          if (id.value.trim.isEmpty)
            Future.successful(Left("sourceId is required and must not be blank"))
          else
            dataSourceRepo.findByIdOwned(id, user).flatMap {
              case None     => Future.successful(Left(s"Data source not found: ${id.value}"))
              case Some(ds) => resolveInOrder(rest, acc :+ ((id, ds)))
            }
      }

    resolveInOrder(sourceDataSourceIds.toList, Vector.empty).flatMap {
      case Left(msg) => Future.successful(Left(msg))
      case Right(dataSources) =>
        val now         = Instant.now()
        val pipelineId  = UUID.randomUUID().toString
        val pipelineRow = PipelineRow(
          id              = pipelineId,
          name            = name,
          lastRunStatus   = None,
          lastRunAt       = None,
          createdAt       = now,
          updatedAt       = now,
          lastRunRowCount = None,
          ownerId         = UUID.fromString(user.id.value),
          tag             = tag
        )
        val rootRows = dataSources.zipWithIndex.map { case ((dsId, _), position) =>
          PipelineRootRepository.PipelineRootRow(UUID.randomUUID().toString, pipelineId, dsId.value, position, now)
        }
        ctx.withUserContext(user.id.value)(
          DBIO.seq(pipelinesTable += pipelineRow, rootsTable ++= rootRows)
        ).map { _ =>
          val roots = dataSources.zip(rootRows).map { case ((dsId, ds), row) => PipelineRootSummary(row.id, dsId.value, ds.name) }
          val (primaryDsId, primaryDs) = dataSources.head
          Right(PipelineSummary(
            id                   = pipelineId,
            name                 = name,
            sourceDataSourceId   = primaryDsId.value,
            sourceDataSourceName = primaryDs.name,
            roots                = roots,
            lastRunStatus        = None,
            lastRunAt            = None,
            lastRunRowCount      = None,
            ownerId              = user.id.value,
            tag                  = tag
          ))
        }
    }
  }

  /** DBIO variant of the pipeline-row-insert half of `create` above (HEL-906 task 3.1,
   *  coordinator ruling D3) -- the caller (`PipelineService.create`'s single-call transactional
   *  path) performs the `dataSourceRepo.findByIdOwned` ownership check as its own `Future` BEFORE
   *  building this action (a read, not a write -- it doesn't need to share the write transaction
   *  for atomicity), then composes this action with the step/Output insert actions that follow
   *  into ONE transaction via `runTransactionally`. `sourceDataSourceName` is passed in rather
   *  than re-resolved here since the caller already has the `DataSource` from that check. */
  /** HEL-913 task 7.3a: multi-root DBIO variant of the pipeline-row-insert half of `create`
    * above -- `dataSources` is one already-ACL-checked `(DataSourceId, DataSource)` pair per
    * root, in request order (`position` = index), mirroring `create`'s own contract but composed
    * into the caller's larger transaction (`PipelineService.createTransactional`) instead of
    * running standalone. Returns the summary AND `rootIds`, the real persisted `PipelineRootId`
    * per root in the SAME order as `dataSources` -- the caller needs these to resolve `roots[]`'s
    * `clientId` (R13) to a real id BEFORE building step/Output insert actions, so a parentless
    * step/root-bound Output can name an explicit root rather than silently attaching to
    * whichever root this method happens to insert first. */
  def createAction(
      name: String,
      dataSources: Vector[(DataSourceId, DataSource)],
      user: AuthenticatedUser,
      tag: Option[String]
  ): DBIO[(PipelineSummary, Vector[PipelineRootId])] = {
    require(dataSources.nonEmpty, "createAction: dataSources must be non-empty (caller's job to enforce R8's empty-roots 400)")
    val now        = Instant.now()
    val pipelineId = UUID.randomUUID().toString
    val pipelineRow = PipelineRow(
      id              = pipelineId,
      name            = name,
      lastRunStatus   = None,
      lastRunAt       = None,
      createdAt       = now,
      updatedAt       = now,
      lastRunRowCount = None,
      ownerId         = UUID.fromString(user.id.value),
      tag             = tag
    )
    val rootRows = dataSources.zipWithIndex.map { case ((dsId, _), position) =>
      PipelineRootRepository.PipelineRootRow(UUID.randomUUID().toString, pipelineId, dsId.value, position, now)
    }
    DBIO.seq(pipelinesTable += pipelineRow, rootsTable ++= rootRows).map { _ =>
      val roots = dataSources.zip(rootRows).map { case ((dsId, ds), row) => PipelineRootSummary(row.id, dsId.value, ds.name) }
      val (primaryDsId, primaryDs) = dataSources.head
      val summary = PipelineSummary(
        id                   = pipelineId,
        name                 = name,
        sourceDataSourceId   = primaryDsId.value,
        sourceDataSourceName = primaryDs.name,
        roots                = roots,
        lastRunStatus        = None,
        lastRunAt            = None,
        lastRunRowCount      = None,
        ownerId              = user.id.value,
        tag                  = tag
      )
      (summary, rootRows.map(r => PipelineRootId(r.id)))
    }
  }

  /** Runs an arbitrary `DBIO` action through the APP pool, wrapped in one transaction scoped
   *  to `userId` (`DbContext.withUserContext`) -- exists so `PipelineService`'s single-call
   *  transactional pipeline-creation path (HEL-906 task 3.1, coordinator ruling D3) can compose
   *  `createAction` above with `PipelineStepRepository.insertInternalAction`/
   *  `OutputRepository.insertInternalAction` into ONE database transaction spanning three
   *  repositories, without exposing `DbContext` itself to the service layer (CONTRIBUTING.md:
   *  "raw `db.run` outside a repository is forbidden" -- this keeps that discipline while still
   *  letting the service layer be the one that KNOWS which actions need to compose).
   *
   *  HEL-906 cycle 7 (coordinator's empirical-experiment ruling): an earlier cycle used
   *  `DbContext.withSystemContext` here (the RLS-bypassing privileged pool), reasoning
   *  analytically that the composed `*Internal` actions "require" it. That reasoning was never
   *  actually tested against a real RLS-enforced (non-superuser) connection. It was tested this
   *  cycle (`PipelineRepositoryRunTransactionallyRlsSpec`, a non-superuser app-pool role) and
   *  the composed chain works unmodified under `withUserContext` -- `pipeline_steps_owner`'s
   *  and `outputs_insert`'s RLS checks both key off `current_setting('app.current_user_id')`/
   *  `owner_id`, which is exactly the same id every row in this composed chain is already
   *  stamped with, so no RLS check ever fires against a mismatched id here. Switched to
   *  `withUserContext` -- this now gets atomicity AND RLS enforcement together, with no
   *  bypass-justification comment needed (there is no bypass). */
  def runTransactionally[R](userId: String)(action: DBIO[R]): Future[R] = ctx.withUserContext(userId)(action)

  /** Owner-scoped delete. pipeline_steps and pipeline_runs cascade on
    * delete via FK constraints (V23, V24). Returns `true` only if a row
    * the caller owned was removed. */
  def delete(id: PipelineId, user: AuthenticatedUser): Future[Boolean] = {
    val ownerUuid = UUID.fromString(user.id.value)
    ctx.withUserContext(user.id.value)(
      pipelinesTable.filter(r => r.id === id.value && r.ownerId === ownerUuid).delete
    ).map(_ > 0)
  }

  /** Owner-scoped post-run housekeeping. Returns silently if no owned row
    * matches — keeps the run-lifecycle path resilient when the pipeline is
    * deleted mid-run. */
  def updateLastRun(
      id: PipelineId,
      status: String,
      at: Instant,
      rowCount: Option[Long],
      user: AuthenticatedUser
  ): Future[Unit] = {
    val ownerUuid = UUID.fromString(user.id.value)
    ctx.withUserContext(user.id.value)(
      pipelinesTable
        .filter(r => r.id === id.value && r.ownerId === ownerUuid)
        .map(r => (r.lastRunStatus, r.lastRunAt, r.lastRunRowCount, r.updatedAt))
        .update((Some(status), Some(at), rowCount, at))
    ).map(_ => ())
  }

  // HEL-904 task 2.10: `setOutputDataTypeIdInternalForTest`/
  // `findOutputDataTypeIdInternal` removed outright -- `pipelines.
  // output_data_type_id` is dropped (V94), and both methods had zero
  // production callers (dead since section 4.1) plus only vestigial test
  // callers that never actually depended on their effect (see
  // execution-progress.md cycle 26).

  // HEL-904 task 4.1: `findLastRunAtByOutputDataTypeId` removed outright —
  // its only caller (`PublicDashboardRoutes`'s per-panel `dataAsOf` lookup)
  // was removed in the same task since no panel carries a `dataTypeId`
  // binding anymore.

  /** ACL-bypassing variant of [[updateLastRun]] for the privileged Spark
    * driver path. The pipeline ACL was already checked at submit time; the
    * background driver does not carry a request-bound user. */
  def updateLastRunInternal(
      id: PipelineId,
      status: String,
      at: Instant,
      rowCount: Option[Long] = None
  ): Future[Unit] =
    ctx.withSystemContext(
      pipelinesTable
        .filter(_.id === id.value)
        .map(r => (r.lastRunStatus, r.lastRunAt, r.lastRunRowCount, r.updatedAt))
        .update((Some(status), Some(at), rowCount, at))
    ).map(_ => ())

  /** Owner-scoped baseline write (HEL-462). Persists the source schema
    * captured on a successful run as raw JSON text — `schemaJson` is the
    * already-serialized `Vector[SchemaField]` from `PipelineSchemaDrift`.
    * Targeted `.map(...).update(...)` projection, mirroring `updateLastRun` —
    * `last_source_schema` is deliberately kept off the `*` projection /
    * `Pipeline` domain model (design D2). Returns silently if no owned row
    * matches, same resilience convention as `updateLastRun`. */
  def updateLastSourceSchema(id: PipelineId, schemaJson: String, user: AuthenticatedUser): Future[Unit] = {
    val ownerUuid = UUID.fromString(user.id.value)
    ctx.withUserContext(user.id.value)(
      pipelinesTable
        .filter(r => r.id === id.value && r.ownerId === ownerUuid)
        .map(_.lastSourceSchema)
        .update(Some(schemaJson))
    ).map(_ => ())
  }

  /** Owner-scoped baseline read (HEL-462). Returns the raw JSON string of the
    * last successful run's source schema, or `None` when the pipeline has no
    * baseline yet (never run successfully) or does not exist / is not owned
    * by the caller. Callers are responsible for parsing. */
  def findLastSourceSchema(id: PipelineId, user: AuthenticatedUser): Future[Option[String]] = {
    val ownerUuid = UUID.fromString(user.id.value)
    ctx.withUserContext(user.id.value)(
      pipelinesTable
        .filter(r => r.id === id.value && r.ownerId === ownerUuid)
        .map(_.lastSourceSchema)
        .result
        .headOption
    ).map(_.flatten)
  }

  /** Owner-scoped list summaries — only returns pipelines owned by the
    * caller. Replaces the unscoped pre-CS2 listing that leaked every
    * pipeline to every authenticated user. `tag`, when given, exact-matches
    * (HEL-366 tasks.md 2.5) — `None` is the pre-existing unfiltered behavior. */
  def listSummaries(user: AuthenticatedUser, tag: Option[String] = None): Future[Vector[PipelineSummary]] = {
    val ownerUuid = UUID.fromString(user.id.value)
    val query = tag match {
      case Some(t) => summaryQuery(pipelinesTable.filter(p => p.ownerId === ownerUuid && p.tag === t))
      case None    => summaryQuery(pipelinesTable.filter(_.ownerId === ownerUuid))
    }

    ctx.withUserContext(user.id.value) {
      for {
        rows  <- query.result
        roots <- rootsByPipelineId(rows.map(_._1.id).toSet)
      } yield rows.map { case (p, srcId, srcName) => rowToSummary(p, srcId, srcName, roots.getOrElse(p.id, Vector.empty)) }.toVector
    }
  }
}

object PipelineRepository {

  implicit val instantColumnType: BaseColumnType[Instant] =
    MappedColumnType.base[Instant, java.sql.Timestamp](
      instant => java.sql.Timestamp.from(instant),
      ts      => ts.toInstant
    )

  /** One root as it appears on a `PipelineSummary` (HEL-913 task 7.2) -- `position`-ordered by
    * the caller that assembles the `Vector`, never re-sorted downstream. */
  case class PipelineRootSummary(
      id: String,
      dataSourceId: String,
      dataSourceName: String
  )

  /** Flat DTO returned by the list-summaries query. `sourceDataSourceId`/`sourceDataSourceName`
    * (the lowest-positioned root's convenience fields, unchanged since Stage 1) are KEPT
    * alongside the new `roots` (additive, HEL-913 task 7.2) -- removing them would cascade into
    * `PipelineRunService`/`WorkspaceContextService`/`PatchSetPreviewProjection`/
    * `PatchSetApplyResolvers`/`RefinementEditShape`/`PipelineProposalService`/
    * `WorkspaceSearchService` (12 files, ~59 call sites total across the codebase), none of
    * which is this task's own scope -- tracked as remaining work, not silently dropped (see
    * files-modified.md). */
  case class PipelineSummary(
      id: String,
      name: String,
      sourceDataSourceId: String,
      sourceDataSourceName: String,
      roots: Vector[PipelineRootSummary],
      lastRunStatus: Option[String],
      lastRunAt: Option[String],
      lastRunRowCount: Option[Long],
      ownerId: String = "",
      tag: Option[String] = None
  )

  case class PipelineRow(
      id: String,
      name: String,
      lastRunStatus: Option[String],
      lastRunAt: Option[Instant],
      createdAt: Instant,
      updatedAt: Instant,
      lastRunRowCount: Option[Long],
      ownerId: UUID,
      tag: Option[String] = None
  )

  // Constructor param renamed `slickTag` (not `tag`) — this table declares
  // its own `tag` *column* (HEL-366), which would otherwise shadow Slick's
  // own `Tag` constructor parameter of the same name.
  class PipelineTable(slickTag: Tag) extends Table[PipelineRow](slickTag, "pipelines") {
    def id                 = column[String]("id", O.PrimaryKey)
    def name               = column[String]("name")
    def lastRunStatus      = column[Option[String]]("last_run_status")
    def lastRunAt          = column[Option[Instant]]("last_run_at")
    def createdAt          = column[Instant]("created_at")
    def updatedAt          = column[Instant]("updated_at")
    def lastRunRowCount    = column[Option[Long]]("last_run_row_count")
    def ownerId            = column[UUID]("owner_id")
    def tag                = column[Option[String]]("tag")

    // HEL-462: schema-drift baseline. Table-local only — deliberately absent
    // from `*` / `PipelineRow` / the `Pipeline` domain model (design D2), so
    // every existing read path and the 22-arity projection stay untouched.
    // Read/written exclusively via the targeted `findLastSourceSchema` /
    // `updateLastSourceSchema` projections above.
    def lastSourceSchema   = column[Option[String]]("last_source_schema")

    def * =
      (id, name, lastRunStatus, lastRunAt, createdAt, updatedAt, lastRunRowCount, ownerId, tag)
        .mapTo[PipelineRow]
  }
}
