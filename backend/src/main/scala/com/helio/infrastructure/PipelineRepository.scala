package com.helio.infrastructure

import com.helio.domain._
import slick.jdbc.PostgresProfile.api._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

class PipelineRepository(
    db: slick.jdbc.JdbcBackend.Database,
    dataTypeRepo: DataTypeRepository,
    dataSourceRepo: DataSourceRepository
)(implicit ec: ExecutionContext) {

  import PipelineRepository._

  private val pipelinesTable   = TableQuery[PipelineTable]
  private val dataSourcesTable = TableQuery[DataSourceRepository.DataSourceTable]
  private val dataTypesTable   = TableQuery[DataTypeRepository.DataTypeTable]

  def exists(id: String): Future[Boolean] =
    db.run(pipelinesTable.filter(_.id === id).exists.result)

  def create(
      name: String,
      sourceDataSourceId: String,
      outputDataTypeName: String,
      ownerId: UserId
  ): Future[Either[String, PipelineSummary]] = {
    dataSourceRepo.findById(DataSourceId(sourceDataSourceId)).flatMap {
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
            sourceDataSourceId = sourceDataSourceId,
            outputDataTypeId   = createdDataType.id.value,
            lastRunStatus      = None,
            lastRunAt          = None,
            createdAt          = now,
            updatedAt          = now
          )
          db.run(pipelinesTable += pipelineRow).map { _ =>
            Right(PipelineSummary(
              id                   = pipelineId,
              name                 = name,
              sourceDataSourceName = dataSource.name,
              outputDataTypeName   = outputDataTypeName,
              lastRunStatus        = None,
              lastRunAt            = None
            ))
          }
        }
    }
  }

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
        lastRunStatus        = p.lastRunStatus,
        lastRunAt            = p.lastRunAt.map(_.toString)
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
      lastRunStatus: Option[String],
      lastRunAt: Option[String]
  )

  case class PipelineRow(
      id: String,
      name: String,
      sourceDataSourceId: String,
      outputDataTypeId: String,
      lastRunStatus: Option[String],
      lastRunAt: Option[Instant],
      createdAt: Instant,
      updatedAt: Instant
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

    def * =
      (id, name, sourceDataSourceId, outputDataTypeId, lastRunStatus, lastRunAt, createdAt, updatedAt)
        .mapTo[PipelineRow]
  }
}
