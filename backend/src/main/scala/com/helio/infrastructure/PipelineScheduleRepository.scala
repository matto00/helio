package com.helio.infrastructure

import com.helio.domain._
import slick.jdbc.PostgresProfile.api._
import PipelineRepository.instantColumnType

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** Owner-scoped (via parent pipeline) Slick repository for
 *  `pipeline_schedules` — a 1:1 child of `pipelines` with no `owner_id`
 *  column of its own (indirect-owner RLS, V62 — mirrors
 *  `PipelineRunRepository`'s JOIN-to-`pipelines.owner_id` shape). */
class PipelineScheduleRepository(ctx: DbContext)(implicit ec: ExecutionContext) {

  import PipelineScheduleRepository._

  private val table          = TableQuery[PipelineScheduleTable]
  private val pipelinesTable = TableQuery[PipelineRepository.PipelineTable]

  private def rowToDomain(row: PipelineScheduleRow): PipelineSchedule =
    PipelineSchedule(
      id         = PipelineScheduleId(row.id),
      pipelineId = PipelineId(row.pipelineId),
      kind       = ScheduleKind.fromString(row.kind)
        .getOrElse(throw new IllegalStateException(s"Unknown schedule kind in DB: '${row.kind}'")),
      expression = row.expression,
      enabled    = row.enabled,
      timezone   = row.timezone,
      nextRunAt  = row.nextRunAt,
      lastRunAt  = row.lastRunAt,
      createdAt  = row.createdAt,
      updatedAt  = row.updatedAt
    )

  private def domainToRow(schedule: PipelineSchedule): PipelineScheduleRow =
    PipelineScheduleRow(
      id         = schedule.id.value,
      pipelineId = schedule.pipelineId.value,
      kind       = ScheduleKind.asString(schedule.kind),
      expression = schedule.expression,
      enabled    = schedule.enabled,
      timezone   = schedule.timezone,
      nextRunAt  = schedule.nextRunAt,
      lastRunAt  = schedule.lastRunAt,
      createdAt  = schedule.createdAt,
      updatedAt  = schedule.updatedAt
    )

  /** Owner-scoped read via JOIN to the parent pipeline's `owner_id` — the
   *  same indirect-ACL shape as `PipelineRunRepository.listByPipeline`.
   *  Returns `None` both when no schedule exists and when the caller does
   *  not own the pipeline (existence not leaked at this layer — the service
   *  layer's `pipelineRepo.findByIdOwned` check is what actually
   *  distinguishes "pipeline not found" from "no schedule yet"). */
  def findByPipelineId(pipelineId: PipelineId, user: AuthenticatedUser): Future[Option[PipelineSchedule]] = {
    val ownerUuid = UUID.fromString(user.id.value)
    val query = for {
      schedule <- table if schedule.pipelineId === pipelineId.value
      pipeline <- pipelinesTable if pipeline.id === schedule.pipelineId && pipeline.ownerId === ownerUuid
    } yield schedule
    ctx.withUserContext(user.id.value)(query.result.headOption).map(_.map(rowToDomain))
  }

  /** Owner-scoped create-or-replace, keyed by the row's primary key `id`.
   *  Callers (`PipelineScheduleService.put`) are responsible for reusing an
   *  existing schedule's `id`/`createdAt` when replacing (looked up via
   *  `findByPipelineId` first) so this resolves to an `UPDATE`; a fresh `id`
   *  resolves to an `INSERT`. Backstopped by the V62 RLS policy, which
   *  rejects a write against a `pipeline_id` the caller does not own. */
  def upsert(schedule: PipelineSchedule, user: AuthenticatedUser): Future[PipelineSchedule] =
    ctx.withUserContext(user.id.value)(table.insertOrUpdate(domainToRow(schedule))).map(_ => schedule)

  /** Owner-scoped delete keyed by `pipeline_id`. Returns `false` (no-op)
   *  both when no schedule exists and when the caller does not own the
   *  pipeline (RLS excludes non-owned rows from the DELETE's row set). */
  def delete(pipelineId: PipelineId, user: AuthenticatedUser): Future[Boolean] =
    ctx.withUserContext(user.id.value)(
      table.filter(_.pipelineId === pipelineId.value).delete
    ).map(_ > 0)
}

object PipelineScheduleRepository {

  case class PipelineScheduleRow(
      id: String,
      pipelineId: String,
      kind: String,
      expression: String,
      enabled: Boolean,
      timezone: String,
      nextRunAt: Option[Instant],
      lastRunAt: Option[Instant],
      createdAt: Instant,
      updatedAt: Instant
  )

  class PipelineScheduleTable(tag: Tag) extends Table[PipelineScheduleRow](tag, "pipeline_schedules") {
    def id         = column[String]("id", O.PrimaryKey)
    def pipelineId = column[String]("pipeline_id")
    def kind       = column[String]("kind")
    def expression = column[String]("expression")
    def enabled    = column[Boolean]("enabled")
    def timezone   = column[String]("timezone")
    def nextRunAt  = column[Option[Instant]]("next_run_at")
    def lastRunAt  = column[Option[Instant]]("last_run_at")
    def createdAt  = column[Instant]("created_at")
    def updatedAt  = column[Instant]("updated_at")

    def * = (id, pipelineId, kind, expression, enabled, timezone, nextRunAt, lastRunAt, createdAt, updatedAt)
      .mapTo[PipelineScheduleRow]
  }
}
