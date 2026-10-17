package com.helio.services.home

import com.helio.domain.util.CronSchedule

import java.time.Instant

/** HEL-1578: pure ranking / attention / upcoming / up-next logic over the rows one owner-scoped read returned
 *  (design D2). No clock, no I/O: `now` is an argument so every scenario is testable off the hour. */
object HomeSummaryBuilder {

  import HomeSummaryLimits._

  private def isLive(status: String): Boolean = status == "queued" || status == "running"

  /** Projected fires of one schedule: the first is `max(stored next fire, now)` (a due fire runs on the scheduler's
   *  next tick; a never-computed one is the next fire after now), each later one is the schedule's next fire after the previous. Unbounded by the horizon here. */
  private def firstFire(s: HomeScheduleRow, now: Instant): Option[Instant] =
    s.nextRunAt match {
      case Some(next) => Some(if (next.isBefore(now)) now else next)
      // Never computed yet (a schedule just saved, before the scheduler's next tick): the scheduler computes it
      // forward from now without firing, so the projection does the same instead of hiding the schedule.
      case None => CronSchedule.nextFireTime(s.kind, s.expression, s.timezone, now)
    }

  private def projectedFires(s: HomeScheduleRow, now: Instant, horizonEnd: Instant): Vector[Instant] =
    firstFire(s, now) match {
      case None => Vector.empty
      case Some(first) =>
        Iterator
          .iterate(Option(first))(_.flatMap(prev => CronSchedule.nextFireTime(s.kind, s.expression, s.timezone, prev)))
          .takeWhile(_.exists(_.isBefore(horizonEnd)))
          .flatten
          .take(MaxUpcoming)
          .toVector
    }

  def build(rows: HomeSummaryRows, now: Instant): HomeSummary = {
    val windowStart = now.minusSeconds(WindowHours * 3600L)
    val horizonEnd  = now.plusSeconds(HorizonHours * 3600L)

    val runsByPipeline = rows.runs.groupBy(_.pipelineId)
    val inFlight       = runsByPipeline.collect { case (id, rs) if rs.exists(r => isLive(r.status)) => id }.toSet
    val windowRuns     = rows.runs.filter(r => !r.startedAt.isBefore(windowStart))
    val windowByPipe   = windowRuns.groupBy(_.pipelineId)
    val schedulesByPipe = rows.schedules.groupBy(_.pipelineId)
    val upcomingByPipe  = schedulesByPipe.view.mapValues(_.flatMap(projectedFires(_, now, horizonEnd)).sorted.take(MaxUpcoming).toVector).toMap
    val nameOf = (rows.runs.map(r => r.pipelineId -> r.pipelineName) ++ rows.schedules.map(s => s.pipelineId -> s.pipelineName)).toMap

    val attention = attentionItems(rows, windowRuns, inFlight, now, windowStart)

    val eligible = nameOf.keys.filter(id => windowByPipe.contains(id) || upcomingByPipe.get(id).exists(_.nonEmpty)).toVector
    val latestEvent: Map[String, Instant] =
      (windowRuns.filter(_.status == "failed").map(r => r.pipelineId -> r.startedAt) ++ attention.map(a => a.pipelineId -> a.at))
        .groupMapReduce(_._1)(_._2)((a, b) => if (a.isAfter(b)) a else b)
    val (pinned, rest) = eligible.partition(latestEvent.contains)
    val pinnedOrdered  = pinned.sortBy(id => (-latestEvent(id).toEpochMilli, nameOf(id)))
    def activity(id: String): Int = windowByPipe.get(id).fold(0)(_.size) + upcomingByPipe.get(id).fold(0)(_.size)
    def latestRun(id: String): Long = windowByPipe.get(id).flatMap(_.map(_.startedAt.toEpochMilli).maxOption).getOrElse(Long.MinValue)
    val restOrdered = rest.sortBy(id => (-activity(id), -latestRun(id), nameOf(id)))

    val pipelines = (pinnedOrdered ++ restOrdered).take(MaxPipelines).map { id =>
      val sorted = windowByPipe.getOrElse(id, Vector.empty).sortBy(r => -r.startedAt.toEpochMilli)
      HomePipelineItem(
        id, nameOf(id),
        sorted.take(MaxRunsPerPipeline).map(r => HomeRunItem(r.runId, r.status, r.startedAt, r.completedAt, r.triggerSource, r.rowCount, r.errorLog)),
        math.max(0, sorted.size - MaxRunsPerPipeline),
        upcomingByPipe.getOrElse(id, Vector.empty)
      )
    }

    val upNext = rows.schedules
      .flatMap(s => firstFire(s, now).map(at => HomeUpNextItem(s.pipelineId, s.pipelineName, at)))
      .sortBy(i => (i.at, i.pipelineName))
      .take(UpNext)

    HomeSummary(now, windowStart, horizonEnd, pipelines, eligible.size, attention, upNext, Vector.empty)
  }

  private def attentionItems(
      rows: HomeSummaryRows, windowRuns: Vector[HomeRunRow], inFlight: Set[String], now: Instant, windowStart: Instant
  ): Vector[HomeAttentionItem] = {
    val failed = windowRuns.filter(_.status == "failed").groupBy(_.pipelineId).values.map { fs =>
      val latest   = fs.maxBy(_.startedAt.toEpochMilli)
      val resolved = windowRuns.filter(r => r.pipelineId == latest.pipelineId && r.status == "succeeded" && r.startedAt.isAfter(latest.startedAt))
        .map(_.startedAt).minOption
      HomeAttentionItem("failed", latest.pipelineId, latest.pipelineName, Some(latest.runId), latest.startedAt, latest.errorLog, resolved, inFlight(latest.pipelineId))
    }
    val stuckBefore = now.minus(StuckAfter)
    val stuck = rows.runs.filter(r => isLive(r.status) && r.startedAt.isBefore(stuckBefore)).map { r =>
      HomeAttentionItem("stuck", r.pipelineId, r.pipelineName, Some(r.runId), r.startedAt, None, None, inFlight = true)
    }
    val missedBefore = now.minus(MissedAfter)
    val missed = rows.schedules.flatMap(s => s.nextRunAt.filter(_.isBefore(missedBefore)).map { at =>
      HomeAttentionItem("missed", s.pipelineId, s.pipelineName, None, at, None, None, inFlight(s.pipelineId))
    })
    (failed.toVector ++ stuck ++ missed).sortBy(a => (-a.at.toEpochMilli, a.pipelineName))
  }
}
