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
      id                 = PipelineId(row.id),
      name               = row.name,
      sourceDataSourceId = DataSourceId(row.sourceDataSourceId),
      lastRunStatus      = row.lastRunStatus,
      lastRunAt          = row.lastRunAt,
      createdAt          = row.createdAt,
      updatedAt          = row.updatedAt,
      ownerId            = UserId(row.ownerId.toString),
      tag                = row.tag
    )

  /** Sharing-aware joined summary. Returns Some for owner or grantee callers. */
  def findSummaryByIdShared(id: PipelineId, callerOpt: Option[AuthenticatedUser]): Future[Option[PipelineSummary]] =
    findByIdShared(id, callerOpt).flatMap {
      case None => Future.successful(None)
      case Some(_) =>
        val query = for {
          pipeline   <- pipelinesTable if pipeline.id === id.value
          dataSource <- dataSourcesTable if dataSource.id === pipeline.sourceDataSourceId
        } yield (pipeline, dataSource.name)
        ctx.withSystemContext(query.result.headOption).map(_.map { case (p, srcName) =>
          PipelineSummary(
            id                   = p.id,
            name                 = p.name,
            sourceDataSourceId   = p.sourceDataSourceId,
            sourceDataSourceName = srcName,
            lastRunStatus        = p.lastRunStatus,
            lastRunAt            = p.lastRunAt.map(_.toString),
            lastRunRowCount      = p.lastRunRowCount,
            ownerId              = p.ownerId.toString,
            tag                  = p.tag
          )
        })
    }

  /** Owner-scoped joined summary for a single pipeline. */
  def findSummaryById(id: PipelineId, user: AuthenticatedUser): Future[Option[PipelineSummary]] = {
    val ownerUuid = UUID.fromString(user.id.value)
    val query = for {
      pipeline   <- pipelinesTable if pipeline.id === id.value && pipeline.ownerId === ownerUuid
      dataSource <- dataSourcesTable if dataSource.id === pipeline.sourceDataSourceId
    } yield (pipeline, dataSource.name)

    ctx.withUserContext(user.id.value)(query.result.headOption).map(_.map { case (p, srcName) =>
      PipelineSummary(
        id                   = p.id,
        name                 = p.name,
        sourceDataSourceId   = p.sourceDataSourceId,
        sourceDataSourceName = srcName,
        lastRunStatus        = p.lastRunStatus,
        lastRunAt            = p.lastRunAt.map(_.toString),
        lastRunRowCount      = p.lastRunRowCount,
        ownerId              = p.ownerId.toString,
        tag                  = p.tag
      )
    })
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

  /** Owner-scoped create. Verifies the bound `sourceDataSourceId` belongs to
    * the caller; returns `Left("Data source not found")` if it does not (404,
    * not 400 — existence and authorization are indistinguishable).
    *
    * HEL-904 task 3.5: no longer mints a DataType — a new pipeline's
    * panel-bindable output is an explicit Output row, created separately
    * (see `PipelineProposalService`'s own Output-creation path, task 3.8).
    * `output_data_type_id` is left `NULL` (V94 relaxed the NOT NULL
    * constraint) for every pipeline created via this path. */
  def create(
      name: String,
      sourceDataSourceId: DataSourceId,
      user: AuthenticatedUser,
      tag: Option[String] = None
  ): Future[Either[String, PipelineSummary]] = {
    dataSourceRepo.findByIdOwned(sourceDataSourceId, user).flatMap {
      case None =>
        Future.successful(Left("Data source not found"))
      case Some(dataSource) =>
        val now         = Instant.now()
        val pipelineId  = UUID.randomUUID().toString
        val pipelineRow = PipelineRow(
          id                 = pipelineId,
          name               = name,
          sourceDataSourceId = sourceDataSourceId.value,
          lastRunStatus      = None,
          lastRunAt          = None,
          createdAt          = now,
          updatedAt          = now,
          lastRunRowCount    = None,
          ownerId            = UUID.fromString(user.id.value),
          tag                = tag
        )
        ctx.withUserContext(user.id.value)(pipelinesTable += pipelineRow).map { _ =>
          Right(PipelineSummary(
            id                   = pipelineId,
            name                 = name,
            sourceDataSourceId   = sourceDataSourceId.value,
            sourceDataSourceName = dataSource.name,
            lastRunStatus        = None,
            lastRunAt            = None,
            lastRunRowCount      = None,
            ownerId              = user.id.value,
            tag                  = tag
          ))
        }
    }
  }

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
    val ownedPipelines = tag match {
      case Some(t) => pipelinesTable.filter(p => p.ownerId === ownerUuid && p.tag === t)
      case None    => pipelinesTable.filter(_.ownerId === ownerUuid)
    }
    val query = for {
      pipeline   <- ownedPipelines
      dataSource <- dataSourcesTable if dataSource.id === pipeline.sourceDataSourceId
    } yield (pipeline, dataSource.name)

    ctx.withUserContext(user.id.value)(query.result).map(_.map { case (p, srcName) =>
      PipelineSummary(
        id                   = p.id,
        name                 = p.name,
        sourceDataSourceId   = p.sourceDataSourceId,
        sourceDataSourceName = srcName,
        lastRunStatus        = p.lastRunStatus,
        lastRunAt            = p.lastRunAt.map(_.toString),
        lastRunRowCount      = p.lastRunRowCount,
        ownerId              = p.ownerId.toString,
        tag                  = p.tag
      )
    }.toVector)
  }
}

object PipelineRepository {

  implicit val instantColumnType: BaseColumnType[Instant] =
    MappedColumnType.base[Instant, java.sql.Timestamp](
      instant => java.sql.Timestamp.from(instant),
      ts      => ts.toInstant
    )

  /** Flat DTO returned by the list-summaries query. */
  case class PipelineSummary(
      id: String,
      name: String,
      sourceDataSourceId: String,
      sourceDataSourceName: String,
      lastRunStatus: Option[String],
      lastRunAt: Option[String],
      lastRunRowCount: Option[Long],
      ownerId: String = "",
      tag: Option[String] = None
  )

  case class PipelineRow(
      id: String,
      name: String,
      sourceDataSourceId: String,
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
    def sourceDataSourceId = column[String]("source_data_source_id")
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
      (id, name, sourceDataSourceId, lastRunStatus, lastRunAt, createdAt, updatedAt, lastRunRowCount, ownerId, tag)
        .mapTo[PipelineRow]
  }
}
