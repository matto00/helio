package com.helio.infrastructure

import com.helio.domain._
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

class PipelineRepository(
    db: JdbcBackend.Database,
    dataTypeRepo: DataTypeRepository,
    dataSourceRepo: DataSourceRepository
)(implicit ec: ExecutionContext) {

  import PipelineRepository._

  private val pipelinesTable   = TableQuery[PipelineTable]
  private val dataSourcesTable = TableQuery[DataSourceRepository.DataSourceTable]
  private val dataTypesTable   = TableQuery[DataTypeRepository.DataTypeTable]

  def exists(id: PipelineId): Future[Boolean] =
    db.run(pipelinesTable.filter(_.id === id.value).exists.result)

  def findById(id: PipelineId): Future[Option[Pipeline]] =
    db.run(pipelinesTable.filter(_.id === id.value).result.headOption).map {
      _.map(row =>
        Pipeline(
          id                 = PipelineId(row.id),
          name               = row.name,
          sourceDataSourceId = DataSourceId(row.sourceDataSourceId),
          outputDataTypeId   = DataTypeId(row.outputDataTypeId),
          lastRunStatus      = row.lastRunStatus,
          lastRunAt          = row.lastRunAt,
          createdAt          = row.createdAt,
          updatedAt          = row.updatedAt
        )
      )
    }

  /** Returns the joined summary for a single pipeline by id, or None if not found. */
  def findSummaryById(id: PipelineId): Future[Option[PipelineSummary]] = {
    val query = for {
      pipeline   <- pipelinesTable if pipeline.id === id.value
      dataSource <- dataSourcesTable if dataSource.id === pipeline.sourceDataSourceId
      dataType   <- dataTypesTable   if dataType.id   === pipeline.outputDataTypeId
    } yield (pipeline, dataSource.name, dataType.name)

    db.run(query.result.headOption).map(_.map { case (p, srcName, dtName) =>
      PipelineSummary(
        id                   = p.id,
        name                 = p.name,
        sourceDataSourceName = srcName,
        outputDataTypeName   = dtName,
        outputDataTypeId     = p.outputDataTypeId,
        lastRunStatus        = p.lastRunStatus,
        lastRunAt            = p.lastRunAt.map(_.toString),
        lastRunRowCount      = p.lastRunRowCount
      )
    })
  }

  /** Updates the pipeline name and returns the updated summary, or None if not found. */
  def updateName(id: PipelineId, name: String): Future[Option[PipelineSummary]] = {
    val now = Instant.now()
    db.run(
      pipelinesTable
        .filter(_.id === id.value)
        .map(r => (r.name, r.updatedAt))
        .update((name, now))
    ).flatMap {
      case 0 => Future.successful(None)
      case _ => findSummaryById(id)
    }
  }

  def create(
      name: String,
      sourceDataSourceId: DataSourceId,
      outputDataTypeName: String,
      ownerId: UserId
  ): Future[Either[String, PipelineSummary]] = {
    dataSourceRepo.findById(sourceDataSourceId).flatMap {
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
          ownerId        = ownerId
        )
        dataTypeRepo.insert(newDataType).flatMap { createdDataType =>
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
            lastRunRowCount    = None
          )
          db.run(pipelinesTable += pipelineRow).map { _ =>
            Right(PipelineSummary(
              id                   = pipelineId,
              name                 = name,
              sourceDataSourceName = dataSource.name,
              outputDataTypeName   = outputDataTypeName,
              outputDataTypeId     = createdDataType.id.value,
              lastRunStatus        = None,
              lastRunAt            = None,
              lastRunRowCount      = None
            ))
          }
        }
    }
  }

  /** Deletes the pipeline by id. pipeline_steps and pipeline_runs cascade on
    * delete via FK constraints (V23, V24). Returns true if a row was removed. */
  def delete(id: PipelineId): Future[Boolean] =
    db.run(pipelinesTable.filter(_.id === id.value).delete).map(_ > 0)

  /** Updates the lastRunStatus, lastRunAt, and lastRunRowCount columns for a pipeline after a run completes. */
  def updateLastRun(id: PipelineId, status: String, at: Instant, rowCount: Option[Long] = None): Future[Unit] =
    db.run(
      pipelinesTable
        .filter(_.id === id.value)
        .map(r => (r.lastRunStatus, r.lastRunAt, r.lastRunRowCount, r.updatedAt))
        .update((Some(status), Some(at), rowCount, at))
    ).map(_ => ())

  /** Returns a flat summary projection for all pipelines, joined with source and data type names. */
  def listSummaries(): Future[Vector[PipelineSummary]] = {
    val query = for {
      pipeline   <- pipelinesTable
      dataSource <- dataSourcesTable if dataSource.id === pipeline.sourceDataSourceId
      dataType   <- dataTypesTable   if dataType.id   === pipeline.outputDataTypeId
    } yield (pipeline, dataSource.name, dataType.name)

    db.run(query.result).map(_.map { case (p, srcName, dtName) =>
      PipelineSummary(
        id                   = p.id,
        name                 = p.name,
        sourceDataSourceName = srcName,
        outputDataTypeName   = dtName,
        outputDataTypeId     = p.outputDataTypeId,
        lastRunStatus        = p.lastRunStatus,
        lastRunAt            = p.lastRunAt.map(_.toString),
        lastRunRowCount      = p.lastRunRowCount
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
      lastRunRowCount: Option[Long]
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
      lastRunRowCount: Option[Long]
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

    def * =
      (id, name, sourceDataSourceId, outputDataTypeId, lastRunStatus, lastRunAt, createdAt, updatedAt, lastRunRowCount)
        .mapTo[PipelineRow]
  }
}
