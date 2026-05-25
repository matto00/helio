package com.helio.infrastructure

import com.helio.api.protocols.PipelineStepConfigCodec
import com.helio.domain._
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
 *  writes the typed `*Config` via [[PipelineStepConfigCodec]].
 *
 *  HEL-265 CS2: every public method takes the caller identity and JOINs to
 *  `pipelines.owner_id` so the parent pipeline's ACL gates access. Steps
 *  inherit ACL from their parent pipeline; there is no separate `owner_id`
 *  column on `pipeline_steps`. */
class PipelineStepRepository(ctx: DbContext)(implicit ec: ExecutionContext) {

  import PipelineStepRepository._

  private val stepsTable     = TableQuery[PipelineStepTable]
  private val pipelinesTable = TableQuery[PipelineRepository.PipelineTable]

  /** Owner-scoped list. Returns empty vector when the parent pipeline does not
    * exist or is owned by someone else. */
  def listByPipeline(pipelineId: PipelineId, user: AuthenticatedUser): Future[Vector[PipelineStep]] = {
    val ownerUuid = UUID.fromString(user.id.value)
    val query = for {
      step     <- stepsTable if step.pipelineId === pipelineId.value
      pipeline <- pipelinesTable if pipeline.id === step.pipelineId && pipeline.ownerId === ownerUuid
    } yield step
    ctx.withUserContext(user.id.value)(query.sortBy(_.position).result).map(_.toVector.map(rowToDomain))
  }

  /** Owner-scoped findById via the parent-pipeline JOIN. */
  def findById(id: PipelineStepId, user: AuthenticatedUser): Future[Option[PipelineStep]] = {
    val ownerUuid = UUID.fromString(user.id.value)
    val query = for {
      step     <- stepsTable if step.id === id.value
      pipeline <- pipelinesTable if pipeline.id === step.pipelineId && pipeline.ownerId === ownerUuid
    } yield step
    ctx.withUserContext(user.id.value)(query.result.headOption).map(_.map(rowToDomain))
  }

  /** Insert a new step into the pipeline in user context.
    *
    * Gated by the caller having proven pipeline ownership at the service layer;
    * the repo itself only writes — the parent pipeline FK guards against the
    * pipeline disappearing mid-call.
    *
    * The V35 RLS policy on `pipeline_steps` uses an EXISTS subquery to
    * `pipelines.owner_id`. Running inside `withUserContext` means the policy
    * evaluates correctly: the new step is only insertable if the parent pipeline
    * is owned by the caller. */
  def insert(pipelineId: PipelineId, kind: String, config: Any, user: AuthenticatedUser): Future[PipelineStep] = {
    val now = Instant.now()
    val configJson = encodeConfig(kind, config)
    val action = for {
      maxPos   <- stepsTable.filter(_.pipelineId === pipelineId.value).map(_.position).max.result
      position  = maxPos.map(_ + 1).getOrElse(0)
      id        = UUID.randomUUID().toString
      row       = PipelineStepRow(id, pipelineId.value, position, kind, configJson, now, now)
      _        <- stepsTable += row
    } yield rowToDomain(row)
    ctx.withUserContext(user.id.value)(action.transactionally)
  }

  /** Owner-scoped partial update. Returns `None` if the step does not exist or
    * the caller does not own the parent pipeline. Cross-type PATCH is rejected
    * at the service boundary; here `kind` stays whatever the persisted row
    * carries. */
  def update(id: PipelineStepId, config: Option[Any], position: Option[Int], user: AuthenticatedUser): Future[Option[PipelineStep]] = {
    val now       = Instant.now()
    val ownerUuid = UUID.fromString(user.id.value)
    val ownedQuery = for {
      step     <- stepsTable if step.id === id.value
      pipeline <- pipelinesTable if pipeline.id === step.pipelineId && pipeline.ownerId === ownerUuid
    } yield step
    val action = for {
      existing <- ownedQuery.result.headOption
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
    ctx.withUserContext(user.id.value)(action.transactionally)
  }

  /** Owner-scoped delete via the parent-pipeline JOIN. Returns `true` only if
    * a step the caller owned was removed.
    *
    * Both the ownership check and the DELETE run inside a single
    * `withUserContext` transaction so the V35 RLS policy on `pipeline_steps`
    * (EXISTS subquery to `pipelines.owner_id`) is active throughout. */
  def delete(id: PipelineStepId, user: AuthenticatedUser): Future[Boolean] = {
    val ownerUuid = UUID.fromString(user.id.value)
    val ownedQuery = for {
      step     <- stepsTable if step.id === id.value
      pipeline <- pipelinesTable if pipeline.id === step.pipelineId && pipeline.ownerId === ownerUuid
    } yield step.id
    val action = ownedQuery.result.headOption.flatMap {
      case None      => DBIO.successful(false)
      case Some(sid) => stepsTable.filter(_.id === sid).delete.map(_ > 0)
    }
    ctx.withUserContext(user.id.value)(action.transactionally)
  }

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
