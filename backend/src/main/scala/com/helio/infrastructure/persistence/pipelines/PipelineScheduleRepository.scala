package com.helio.infrastructure.persistence.pipelines

import com.helio.infrastructure.persistence.DbContext
import com.helio.domain.model._
import slick.jdbc.PostgresProfile.api._
import PipelineRepository.instantColumnType

import java.sql.Timestamp
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

  /** HEL-1574: every enabled schedule on a pipeline the caller owns, plus the sources feeding them, in exactly two
   *  queries regardless of pipeline/source counts. `sources` carries one row per distinct source: the soonest
   *  non-null `next_run_at` among its scheduled pipelines (nulls last, ties by pipeline name). Data sources are read
   *  under the caller's RLS context, so only sources the caller can access appear. */
  def listEnabledWithSources(user: AuthenticatedUser): Future[PipelineScheduleList] = {
    val owner = user.id.value
    val itemsQuery =
      sql"""SELECT s.pipeline_id, p.name, s.kind, s.expression, s.timezone, s.next_run_at, s.last_run_at
            FROM pipeline_schedules s JOIN pipelines p ON p.id = s.pipeline_id
            WHERE p.owner_id = $owner::uuid AND s.enabled
            ORDER BY s.next_run_at ASC NULLS LAST, p.name""".as[(String, String, String, String, String, Option[Timestamp], Option[Timestamp])]
    val sourcesQuery =
      sql"""SELECT DISTINCT ON (ds.id) ds.id, ds.name, s.next_run_at, p.id, p.name
            FROM pipeline_roots r
            JOIN pipeline_schedules s ON s.pipeline_id = r.pipeline_id AND s.enabled
            JOIN pipelines p ON p.id = r.pipeline_id AND p.owner_id = $owner::uuid
            JOIN data_sources ds ON ds.id = r.data_source_id
            ORDER BY ds.id, s.next_run_at ASC NULLS LAST, p.name""".as[(String, String, Option[Timestamp], String, String)]
    ctx.withUserContext(user.id.value)(itemsQuery.zip(sourcesQuery)).map { case (items, sources) =>
      val sortedSources = sources
        .map { case (id, name, next, pid, pname) => ScheduledSourceItem(id, name, next.map(_.toInstant), pid, pname) }
        .sortBy(src => (src.nextRunAt.isEmpty, src.nextRunAt.map(_.toEpochMilli).getOrElse(0L), src.sourceName))
      PipelineScheduleList(
        items.map { case (pid, name, kind, expr, tz, next, last) =>
          ScheduledPipelineItem(pid, name, kind, expr, tz, next.map(_.toInstant), last.map(_.toInstant))
        },
        sortedSources
      )
    }
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

  /** ACL-bypassing read of every enabled schedule due for a tick — either
   *  never-yet-computed (`nextRunAt` unset, e.g. fresh from `put`) or
   *  actually due (`nextRunAt <= now`). System context: the scheduler
   *  background job has no request-bound user (HEL-415). */
  def listTickCandidatesInternal(now: Instant): Future[Vector[PipelineSchedule]] =
    ctx.withSystemContext(
      table.filter(s => s.enabled && (s.nextRunAt.isEmpty || s.nextRunAt <= now)).result
    ).map(_.map(rowToDomain).toVector)

  /** ACL-bypassing bookkeeping update after a tick — either a bare
   *  recompute (no fire) or post-fire bookkeeping. System context: same
   *  privileged background-job callsite as [[listTickCandidatesInternal]]. */
  def updateAfterTickInternal(id: PipelineScheduleId, nextRunAt: Option[Instant], lastRunAt: Option[Instant]): Future[Unit] =
    ctx.withSystemContext(
      table.filter(_.id === id.value).map(s => (s.nextRunAt, s.lastRunAt)).update((nextRunAt, lastRunAt))
    ).map(_ => ())
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
