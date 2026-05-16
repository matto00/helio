package com.helio.infrastructure

import com.helio.api.protocols.PipelineStepConfigCodec
import com.helio.domain._
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import PipelineRepository.instantColumnType

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Failure, Success}

/** Persistence layer for `pipeline_steps`.
 *
 *  The on-disk shape (`id, pipeline_id, position, op, config, created_at,
 *  updated_at` — config stored as JSON text) is unchanged. CS2c-3a moves the
 *  typed-ADT dispatch into `rowToDomain` / `domainToRow`: the repo speaks
 *  [[PipelineStep]] sealed-trait values across its public API, and reads /
 *  writes the typed `*Config` via [[PipelineStepConfigCodec]]. */
class PipelineStepRepository(db: JdbcBackend.Database)(implicit ec: ExecutionContext) {

  import PipelineStepRepository._

  private val stepsTable = TableQuery[PipelineStepTable]

  def listByPipeline(pipelineId: PipelineId): Future[Vector[PipelineStep]] =
    db.run(stepsTable.filter(_.pipelineId === pipelineId.value).sortBy(_.position).result)
      .map(_.toVector.map(rowToDomain))

  def findById(id: PipelineStepId): Future[Option[PipelineStep]] =
    db.run(stepsTable.filter(_.id === id.value).result.headOption).map(_.map(rowToDomain))

  /** Insert a new step at the next available position. The repo receives the
   *  fully-typed `*Config` plus the kind discriminator — assembling the ADT
   *  subtype is the repo's job because it owns the timestamp + id + position
   *  fields. */
  def insert(pipelineId: PipelineId, kind: String, config: Any): Future[PipelineStep] = {
    val now = Instant.now()
    val configJson = encodeConfig(kind, config)
    val action = for {
      maxPos   <- stepsTable.filter(_.pipelineId === pipelineId.value).map(_.position).max.result
      position  = maxPos.map(_ + 1).getOrElse(0)
      id        = UUID.randomUUID().toString
      row       = PipelineStepRow(id, pipelineId.value, position, kind, configJson, now, now)
      _        <- stepsTable += row
    } yield rowToDomain(row)
    db.run(action.transactionally)
  }

  /** Partial update. `kind` is the persisted row's discriminator (unchanged
   *  by PATCH — cross-type PATCH is rejected at the service boundary).
   *  `config`'s `Any` type is intentional: the service layer hands typed
   *  configs through and the codec validates them at encode time. */
  def update(id: PipelineStepId, config: Option[Any], position: Option[Int]): Future[Option[PipelineStep]] = {
    val now = Instant.now()
    val action = for {
      existing <- stepsTable.filter(_.id === id.value).result.headOption
      updated  <- existing match {
        case None      => DBIO.successful(None)
        case Some(row) =>
          val newConfig = config match {
            case Some(cfg) => encodeConfig(row.op, cfg)
            case None      => row.config
          }
          val newRow = row.copy(
            config    = newConfig,
            position  = position.getOrElse(row.position),
            updatedAt = now
          )
          stepsTable.filter(_.id === id.value).update(newRow).map(_ => Some(rowToDomain(newRow)))
      }
    } yield updated
    db.run(action.transactionally)
  }

  def delete(id: PipelineStepId): Future[Boolean] =
    db.run(stepsTable.filter(_.id === id.value).delete).map(_ > 0)

  // ── Row ↔ domain ──────────────────────────────────────────────────────────

  private def rowToDomain(row: PipelineStepRow): PipelineStep = {
    val stepId = PipelineStepId(row.id)
    val pid    = PipelineId(row.pipelineId)
    PipelineStepConfigCodec.decode(row.op, row.config) match {
      case Success(cfg: RenameConfig)    => RenameStep(stepId, pid, row.position, cfg, row.createdAt, row.updatedAt)
      case Success(cfg: FilterConfig)    => FilterStep(stepId, pid, row.position, cfg, row.createdAt, row.updatedAt)
      case Success(cfg: JoinConfig)      => JoinStep(stepId, pid, row.position, cfg, row.createdAt, row.updatedAt)
      case Success(cfg: ComputeConfig)   => ComputeStep(stepId, pid, row.position, cfg, row.createdAt, row.updatedAt)
      case Success(cfg: GroupByConfig)   => GroupByStep(stepId, pid, row.position, cfg, row.createdAt, row.updatedAt)
      case Success(cfg: CastConfig)      => CastStep(stepId, pid, row.position, cfg, row.createdAt, row.updatedAt)
      case Success(cfg: SelectConfig)    => SelectStep(stepId, pid, row.position, cfg, row.createdAt, row.updatedAt)
      case Success(cfg: LimitConfig)     => LimitStep(stepId, pid, row.position, cfg, row.createdAt, row.updatedAt)
      case Success(cfg: SortConfig)      => SortStep(stepId, pid, row.position, cfg, row.createdAt, row.updatedAt)
      case Success(cfg: AggregateConfig) => AggregateStep(stepId, pid, row.position, cfg, row.createdAt, row.updatedAt)
      case Success(other) =>
        throw new IllegalStateException(
          s"PipelineStepRepository: codec returned unexpected config type ${other.getClass.getName} for op '${row.op}'"
        )
      case Failure(ex) =>
        throw new IllegalStateException(
          s"PipelineStepRepository: failed to decode config for step ${row.id} (op='${row.op}'): ${ex.getMessage}",
          ex
        )
    }
  }

  /** Encode a typed config (handed in from the service layer) to JSON text. */
  private def encodeConfig(kind: String, config: Any): String =
    PipelineStepConfigCodec.encodeConfig(config)
}

object PipelineStepRepository {

  /** Internal row representation — never crosses the public boundary. Use
   *  [[PipelineStep]] outside the repository. */
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
