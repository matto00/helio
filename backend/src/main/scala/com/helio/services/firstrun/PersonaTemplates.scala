package com.helio.services.firstrun

import com.helio.api.protocols.pipelines.PipelineProposal
import com.helio.services.firstrun.FirstRunPlanner.Chain

/** The four persona sample-data templates (HEL-1210). Code-level registry: each template names its
 *  bundled classpath CSV, the numeric columns its pipeline casts (CSV values are strings), the exact
 *  column order of its table, and an explicit chart type per chart. Charts and their field mappings
 *  are stated here rather than inferred, so a template never depends on the rule planner's guesses.
 *  The renderer takes a chart's type from its panel and alphabetizes table columns unless told
 *  otherwise (the global defaults are HEL-1222's, not fixed here), so each template states the type
 *  on the panel and `columnOrder` on the table output.
 *
 *  Panels are laid out by [[FirstRunPlanner.dashboardProposal]]: table first, then the charts, each
 *  full width at x=0 on its own row, so the derived md/sm/xs layouts stack cleanly on a phone. */
object PersonaTemplates {

  final case class SeriesChart(title: String, timeField: String, granularity: String, measure: String, fn: String, chartType: String)
  final case class RankingChart(title: String, category: String, measure: String, fn: String, n: Int, chartType: String)

  final case class PersonaTemplate(
      slug: String,
      persona: String,
      sourceName: String,
      dashboardName: String,
      resource: String,
      numericColumns: Map[String, String],
      tableTitle: String,
      tableColumns: Vector[String],
      series: SeriesChart,
      ranking: RankingChart
  ) {
    def pipelineProposal(sourceId: String): Either[String, PipelineProposal] = {
      val parent = Some("cast").filter(_ => numericColumns.nonEmpty)
      for {
        table  <- FirstRunPlanner.tableChain(tableTitle, tableColumns, parent, pinColumnOrder = true)
        trend  <- FirstRunPlanner.timeSeriesChain(series.title, series.timeField, series.granularity, series.measure, series.fn, series.chartType, parent)
        ranked <- FirstRunPlanner.topNChain(ranking.title, ranking.category, ranking.measure, ranking.fn, ranking.n, ranking.chartType, parent)
      } yield {
        val chains: Vector[Chain] = Vector(table, trend, ranked)
        val cast                  = if (numericColumns.isEmpty) Vector.empty else Vector(FirstRunPlanner.castStep(numericColumns))
        FirstRunPlanner.pipelineOf(sourceId, s"$sourceName pipeline", cast ++ chains.flatMap(_.steps), chains.map(_.output))
      }
    }
  }

  val Streamer: PersonaTemplate = PersonaTemplate(
    slug = "streamer", persona = "Streamer", sourceName = "Sample: Streamer stats", dashboardName = "Streamer stats (sample)",
    resource = "templates/streamer.csv",
    numericColumns = Map("hours_streamed" -> "double", "peak_viewers" -> "integer", "new_followers" -> "integer", "revenue_usd" -> "double"),
    tableTitle = "Sample: Streamer sessions",
    tableColumns = Vector("date", "game", "hours_streamed", "peak_viewers", "new_followers", "revenue_usd"),
    series = SeriesChart("Sample: Followers gained per day", "date", "day", "new_followers", "sum", "line"),
    ranking = RankingChart("Sample: Hours streamed by game", "game", "hours_streamed", "sum", 5, "bar")
  )

  val Founder: PersonaTemplate = PersonaTemplate(
    slug = "founder", persona = "Founder", sourceName = "Sample: Founder growth", dashboardName = "Founder growth (sample)",
    resource = "templates/founder.csv",
    numericColumns = Map("signups" -> "integer", "new_customers" -> "integer", "mrr_added_usd" -> "double"),
    tableTitle = "Sample: Acquisition by month and channel",
    tableColumns = Vector("month", "channel", "signups", "new_customers", "mrr_added_usd"),
    series = SeriesChart("Sample: New MRR per month", "month", "month", "mrr_added_usd", "sum", "line"),
    ranking = RankingChart("Sample: Signups by channel", "channel", "signups", "sum", 4, "bar")
  )

  val Ops: PersonaTemplate = PersonaTemplate(
    slug = "ops", persona = "Ops", sourceName = "Sample: Ops incidents", dashboardName = "Ops incidents (sample)",
    resource = "templates/ops.csv",
    numericColumns = Map("incidents" -> "integer", "avg_resolution_min" -> "double", "uptime_pct" -> "double"),
    tableTitle = "Sample: Daily service health",
    tableColumns = Vector("date", "service", "incidents", "avg_resolution_min", "uptime_pct"),
    series = SeriesChart("Sample: Incidents per day", "date", "day", "incidents", "sum", "line"),
    ranking = RankingChart("Sample: Incidents by service", "service", "incidents", "sum", 4, "bar")
  )

  val Finance: PersonaTemplate = PersonaTemplate(
    slug = "finance", persona = "Finance", sourceName = "Sample: Finance spend", dashboardName = "Finance spend (sample)",
    resource = "templates/finance.csv",
    numericColumns = Map("amount_usd" -> "double"),
    tableTitle = "Sample: Transactions",
    tableColumns = Vector("date", "category", "merchant", "amount_usd"),
    series = SeriesChart("Sample: Spend per month", "date", "month", "amount_usd", "sum", "bar"),
    ranking = RankingChart("Sample: Spend by category", "category", "amount_usd", "sum", 6, "bar")
  )

  val All: Vector[PersonaTemplate] = Vector(Streamer, Founder, Ops, Finance)

  def bySlug(slug: String): Option[PersonaTemplate] = All.find(_.slug == slug)
}
