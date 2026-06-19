package com.helio.infrastructure

import com.helio.domain._
import slick.jdbc.PostgresProfile.api._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

class PipelineRepository(
    ctx: DbContext,
    dataTypeRepo: DataTypeRepository,
    dataSourceRepo: DataSourceRepository
)(implicit ec: ExecutionContext) {

  import PipelineRepository._

  private val pipelinesTable   = TableQuery[PipelineTable]
  private val dataSourcesTable = TableQuery[DataSourceRepository.DataSourceTable]
  private val dataTypesTable   = TableQuery[DataTypeRepository.DataTypeTable]
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
      outputDataTypeId   = DataTypeId(row.outputDataTypeId),
      lastRunStatus      = row.lastRunStatus,
      lastRunAt          = row.lastRunAt,
      createdAt          = row.createdAt,
      updatedAt          = row.updatedAt,
      ownerId            = UserId(row.ownerId.toString)
    )

  /** Sharing-aware joined summary. Returns Some for owner or grantee callers. */
  def findSummaryByIdShared(id: PipelineId, callerOpt: Option[AuthenticatedUser]): Future[Option[PipelineSummary]] =
    findByIdShared(id, callerOpt).flatMap {
      case None => Future.successful(None)
      case Some(_) =>
        val query = for {
          pipeline   <- pipelinesTable if pipeline.id === id.value
          dataSource <- dataSourcesTable if dataSource.id === pipeline.sourceDataSourceId
          dataType   <- dataTypesTable   if dataType.id   === pipeline.outputDataTypeId
        } yield (pipeline, dataSource.name, dataType.name)
        ctx.withSystemContext(query.result.headOption).map(_.map { case (p, srcName, dtName) =>
          PipelineSummary(
            id                   = p.id,
            name                 = p.name,
            sourceDataSourceName = srcName,
            outputDataTypeName   = dtName,
            outputDataTypeId     = p.outputDataTypeId,
            lastRunStatus        = p.lastRunStatus,
            lastRunAt            = p.lastRunAt.map(_.toString),
            lastRunRowCount      = p.lastRunRowCount,
            ownerId              = p.ownerId.toString
          )
        })
    }

  /** Owner-scoped joined summary for a single pipeline. */
  def findSummaryById(id: PipelineId, user: AuthenticatedUser): Future[Option[PipelineSummary]] = {
    val ownerUuid = UUID.fromString(user.id.value)
    val query = for {
      pipeline   <- pipelinesTable if pipeline.id === id.value && pipeline.ownerId === ownerUuid
      dataSource <- dataSourcesTable if dataSource.id === pipeline.sourceDataSourceId
      dataType   <- dataTypesTable   if dataType.id   === pipeline.outputDataTypeId
    } yield (pipeline, dataSource.name, dataType.name)

    ctx.withUserContext(user.id.value)(query.result.headOption).map(_.map { case (p, srcName, dtName) =>
      PipelineSummary(
        id                   = p.id,
        name                 = p.name,
        sourceDataSourceName = srcName,
        outputDataTypeName   = dtName,
        outputDataTypeId     = p.outputDataTypeId,
        lastRunStatus        = p.lastRunStatus,
        lastRunAt            = p.lastRunAt.map(_.toString),
        lastRunRowCount      = p.lastRunRowCount,
        ownerId              = p.ownerId.toString
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
    * not 400 — existence and authorization are indistinguishable). */
  def create(
      name: String,
      sourceDataSourceId: DataSourceId,
      outputDataTypeName: String,
      user: AuthenticatedUser
  ): Future[Either[String, PipelineSummary]] = {
    dataSourceRepo.findByIdOwned(sourceDataSourceId, user).flatMap {
      case None =>
        Future.successful(Left("Data source not found"))
      case Some(dataSource) =>
        val now = Instant.now()
        val newDataType = DataType(
          id             = DataTypeId(UUID.randomUUID().toString),
          sourceId       = None,
          name           = outputDataTypeName,
          fields         = Vector.empty,
          computedFields = Vector.empty,
          version        = 1,
          createdAt      = now,
          updatedAt      = now,
          ownerId        = user.id
        )
        dataTypeRepo.insert(newDataType, user).flatMap { createdDataType =>
          val pipelineId  = UUID.randomUUID().toString
          val pipelineRow = PipelineRow(
            id                 = pipelineId,
            name               = name,
            sourceDataSourceId = sourceDataSourceId.value,
            outputDataTypeId   = createdDataType.id.value,
            lastRunStatus      = None,
            lastRunAt          = None,
            createdAt          = now,
            updatedAt          = now,
            lastRunRowCount    = None,
            ownerId            = UUID.fromString(user.id.value)
          )
          ctx.withUserContext(user.id.value)(pipelinesTable += pipelineRow).map { _ =>
            Right(PipelineSummary(
              id                   = pipelineId,
              name                 = name,
              sourceDataSourceName = dataSource.name,
              outputDataTypeName   = outputDataTypeName,
              outputDataTypeId     = createdDataType.id.value,
              lastRunStatus        = None,
              lastRunAt            = None,
              lastRunRowCount      = None,
              ownerId              = user.id.value
            ))
          }
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

  /** System-context lookup: returns the most recent `last_run_at` across all
    * pipelines whose `output_data_type_id` matches `id` AND whose
    * `last_run_status` is `'succeeded'`. Returns `None` when no pipeline
    * matches, or when no pipeline has ever completed a successful run.
    *
    * Uses `withSystemContext` (privileged bypass) because the caller — the
    * panel response assembler — only has a `DataTypeId`, not the pipeline
    * owner; the ACL gate is enforced at the panel layer (caller can only
    * reach panels they are allowed to see). Follows the same pattern as
    * `findByIdInternal`. */
  def findLastRunAtByOutputDataTypeId(id: DataTypeId): Future[Option[Instant]] = {
    // Filter to pipelines writing to this DataType with a successful last run.
    // lastRunAt is Option[Instant] in the table; we only select rows where it
    // is definitely set by filtering on lastRunStatus = 'succeeded', then take
    // the MAX via Slick's aggregate on the non-optional instant column equivalent.
    // We select the most-recent last_run_at and return it as Option[Instant]
    // (None = no matching succeeded pipeline found).
    ctx.withSystemContext(
      pipelinesTable
        .filter(r => r.outputDataTypeId === id.value && r.lastRunStatus === "succeeded")
        .map(_.lastRunAt)
        .result
    ).map { rows =>
      rows.flatten.maxOption
    }
  }

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

  /** Owner-scoped list summaries — only returns pipelines owned by the
    * caller. Replaces the unscoped pre-CS2 listing that leaked every
    * pipeline to every authenticated user. */
  def listSummaries(user: AuthenticatedUser): Future[Vector[PipelineSummary]] = {
    val ownerUuid = UUID.fromString(user.id.value)
    val query = for {
      pipeline   <- pipelinesTable if pipeline.ownerId === ownerUuid
      dataSource <- dataSourcesTable if dataSource.id === pipeline.sourceDataSourceId
      dataType   <- dataTypesTable   if dataType.id   === pipeline.outputDataTypeId
    } yield (pipeline, dataSource.name, dataType.name)

    ctx.withUserContext(user.id.value)(query.result).map(_.map { case (p, srcName, dtName) =>
      PipelineSummary(
        id                   = p.id,
        name                 = p.name,
        sourceDataSourceName = srcName,
        outputDataTypeName   = dtName,
        outputDataTypeId     = p.outputDataTypeId,
        lastRunStatus        = p.lastRunStatus,
        lastRunAt            = p.lastRunAt.map(_.toString),
        lastRunRowCount      = p.lastRunRowCount,
        ownerId              = p.ownerId.toString
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
      sourceDataSourceName: String,
      outputDataTypeName: String,
      outputDataTypeId: String,
      lastRunStatus: Option[String],
      lastRunAt: Option[String],
      lastRunRowCount: Option[Long],
      ownerId: String = ""
  )

  case class PipelineRow(
      id: String,
      name: String,
      sourceDataSourceId: String,
      outputDataTypeId: String,
      lastRunStatus: Option[String],
      lastRunAt: Option[Instant],
      createdAt: Instant,
      updatedAt: Instant,
      lastRunRowCount: Option[Long],
      ownerId: UUID
  )

  class PipelineTable(tag: Tag) extends Table[PipelineRow](tag, "pipelines") {
    def id                 = column[String]("id", O.PrimaryKey)
    def name               = column[String]("name")
    def sourceDataSourceId = column[String]("source_data_source_id")
    def outputDataTypeId   = column[String]("output_data_type_id")
    def lastRunStatus      = column[Option[String]]("last_run_status")
    def lastRunAt          = column[Option[Instant]]("last_run_at")
    def createdAt          = column[Instant]("created_at")
    def updatedAt          = column[Instant]("updated_at")
    def lastRunRowCount    = column[Option[Long]]("last_run_row_count")
    def ownerId            = column[UUID]("owner_id")

    def * =
      (id, name, sourceDataSourceId, outputDataTypeId, lastRunStatus, lastRunAt, createdAt, updatedAt, lastRunRowCount, ownerId)
        .mapTo[PipelineRow]
  }
}
