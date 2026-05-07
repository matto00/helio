package com.helio.infrastructure

import com.helio.domain._
import slick.jdbc.PostgresProfile.api._
import PipelineRepository.instantColumnType

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

class PipelineStepRepository(db: slick.jdbc.JdbcBackend.Database)(implicit ec: ExecutionContext) {

  import PipelineStepRepository._

  private val stepsTable = TableQuery[PipelineStepTable]

  def listByPipeline(pipelineId: String): Future[Vector[PipelineStepRow]] =
    db.run(stepsTable.filter(_.pipelineId === pipelineId).sortBy(_.position).result)
      .map(_.toVector)

  def insert(pipelineId: String, op: String, config: String): Future[PipelineStepRow] = {
    val now = Instant.now()
    val action = for {
      maxPos   <- stepsTable.filter(_.pipelineId === pipelineId).map(_.position).max.result
      position  = maxPos.map(_ + 1).getOrElse(0)
      id        = UUID.randomUUID().toString
      row       = PipelineStepRow(id, pipelineId, position, op, config, now, now)
      _        <- stepsTable += row
    } yield row
    db.run(action.transactionally)
  }

  def update(id: String, op: Option[String], config: Option[String], position: Option[Int]): Future[Option[PipelineStepRow]] = {
    val now = Instant.now()
    val action = for {
      existing <- stepsTable.filter(_.id === id).result.headOption
      updated  <- existing match {
        case None => DBIO.successful(None)
        case Some(row) =>
          val newRow = row.copy(
            op        = op.getOrElse(row.op),
            config    = config.getOrElse(row.config),
            position  = position.getOrElse(row.position),
            updatedAt = now
          )
          stepsTable.filter(_.id === id).update(newRow).map(_ => Some(newRow))
      }
    } yield updated
    db.run(action.transactionally)
  }

  def delete(id: String): Future[Boolean] =
    db.run(stepsTable.filter(_.id === id).delete).map(_ > 0)
}

object PipelineStepRepository {

  case class PipelineStepRow(
      id: String,
      pipelineId: String,
      position: Int,
      op: String,
      config: String,
      createdAt: Instant,
      updatedAt: Instant
  )

  class PipelineStepTable(tag: Tag) extends Table[PipelineStepRow](tag, "pipeline_steps") {
    def id         = column[String]("id", O.PrimaryKey)
    def pipelineId = column[String]("pipeline_id")
    def position   = column[Int]("position")
    def op         = column[String]("op")
    def config     = column[String]("config")
    def createdAt  = column[Instant]("created_at")
    def updatedAt  = column[Instant]("updated_at")

    def * = (id, pipelineId, position, op, config, createdAt, updatedAt).mapTo[PipelineStepRow]
  }
}
