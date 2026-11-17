package com.helio.services.insights

import com.helio.domain.insights.{InsightCompare, InsightWindow}
import com.helio.domain.model.Output
import com.helio.services.pipelines.{OutputHistoryResolution, OutputHistoryService}

/** What one Output's history resolution contributes to an insight's inputs. */
final case class InsightOutputInputs(compare: Option[InsightCompare], window: Option[InsightWindow])

/** HEL-1741 D2: maps the existing history read (no new SQL) onto the insight input types. */
object InsightInputAdapters {

  /** A compare needs a configured compare token and a current point carrying a metric field; otherwise `None`.
   *  Window points are the headline values of the resolution's points (oldest first); points without a
   *  headline are skipped, and a window with no points is `None`. */
  def fromResolution(output: Output, resolution: OutputHistoryResolution): InsightOutputInputs = {
    val outputId = output.id.value
    val compare = for {
      token   <- resolution.compare
      current <- resolution.current
      metric  <- current.metric
    } yield InsightCompare(
      outputId,
      output.name,
      metric.field,
      token,
      current.value,
      resolution.baseline.flatMap(_.value),
      resolution.delta,
      resolution.pct,
      Some(current.capturedAt),
      resolution.baseline.map(_.capturedAt)
    )
    val points = resolution.points.flatMap(p => OutputHistoryService.headline(p.summary).map(v => p.capturedAt -> v)).sortBy(_._1)
    val window = Option.when(points.nonEmpty)(InsightWindow(outputId, resolution.compare.getOrElse("recent"), points))
    InsightOutputInputs(compare, window)
  }
}
