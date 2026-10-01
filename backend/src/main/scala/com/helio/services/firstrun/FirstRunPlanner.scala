package com.helio.services.firstrun

import com.helio.api.protocols.pipelines.{CreatePipelineTransactionalOutputRequest, CreatePipelineTransactionalStepRequest, PipelineProposal, PipelineProposalSource, ProposalOutputSummary}
import com.helio.api.protocols.proposals.{DashboardProposal, ProposalPanel, ProposalPanelLayout}
import com.helio.domain.shapes.{PassthroughShape, PipelineShape, ShapeStepExpansion, TimeSeriesShape, TopNShape}
import com.helio.domain.steps.{AggregateConfig, AggregateField, AggregateStep, Aggregation, CastConfig, CastStep}
import spray.json._

/** Pure rule that turns classified CSV columns into the pipeline and dashboard proposals the
 *  first-run builder applies (HEL-1209). No I/O, no Claude dependency.
 *
 *  Output order is fixed: table first (always), then time-series, then top-n; at most 3. Every
 *  chain hangs off the optional shared `cast` step. */
object FirstRunPlanner {

  private val CastId     = "cast"
  private val AggTopNId  = "agg_topn"
  private val TopN       = 10
  private val DayLimit   = 90
  private val TableH     = 6
  private val ChartH     = 4
  private val FullWidth  = 12
  private val IdLike     = """^(?i:id)$|^.*_(?i:id)$|^.*[a-z]Id$""".r

  private[firstrun] final case class Chain(steps: Vector[CreatePipelineTransactionalStepRequest], output: CreatePipelineTransactionalOutputRequest)

  /** The measure all aggregating shapes use: the leftmost numeric column that is not
   *  identifier-shaped (`id`, `user_id`, `orderId`), else the leftmost numeric column. */
  def measureOf(columns: Vector[ClassifiedColumn]): Option[ClassifiedColumn] = {
    val numeric = columns.filter(_.kind == ColumnKind.Numeric)
    numeric.find(c => !IdLike.matches(c.name)).orElse(numeric.headOption)
  }

  def pipelineProposal(sourceId: String, sourceName: String, columns: Vector[ClassifiedColumn]): Either[String, PipelineProposal] = {
    val numeric = columns.filter(_.kind == ColumnKind.Numeric)
    val cast = if (numeric.isEmpty) None else Some(castStep(numeric.map(_.name -> "double").toMap))
    val parent = cast.map(_.clientId)
    for {
      table  <- tableChain(s"$sourceName table", columns.map(_.name), parent)
      series <- timeSeriesChain(sourceName, columns, parent)
      topN   <- topNChain(sourceName, columns, parent)
    } yield {
      val chains = Vector(Some(table), series, topN).flatten
      pipelineOf(sourceId, s"$sourceName pipeline", cast.toVector ++ chains.flatMap(_.steps), chains.map(_.output))
    }
  }

  private def timeSeriesChain(sourceName: String, columns: Vector[ClassifiedColumn], parent: Option[String]): Either[String, Option[Chain]] =
    (columns.find(_.kind == ColumnKind.DateLike), measureOf(columns)) match {
      case (Some(date), Some(measure)) =>
        val granularity = if (date.distinctDates <= DayLimit) "day" else "month"
        timeSeriesChain(s"$sourceName over time", date.name, granularity, measure.name, "sum", "line", parent).map(Some(_))
      case _ => Right(None)
    }

  private def topNChain(sourceName: String, columns: Vector[ClassifiedColumn], parent: Option[String]): Either[String, Option[Chain]] =
    (columns.find(_.kind == ColumnKind.Categorical), measureOf(columns)) match {
      case (Some(category), Some(measure)) =>
        topNChain(s"$sourceName top ${category.name}", category.name, measure.name, "sum", TopN, "bar", parent).map(Some(_))
      case _ => Right(None)
    }

  /** A table output over exactly `fields`, in that order. Shared with `PersonaTemplates`. */
  private[firstrun] def tableChain(
      outputName: String, fields: Vector[String], parent: Option[String], pinColumnOrder: Boolean = false
  ): Either[String, Chain] =
    expand(PassthroughShape.id, JsObject("fields" -> JsArray(fields.map(JsString(_))))).map { exps =>
      val steps = chain(PassthroughShape.id, exps, parent)
      // Row JSON objects carry no key order, so without an explicit `columnOrder` the renderer lists
      // columns alphabetically.
      val config = if (pinColumnOrder) Some(JsObject("columnOrder" -> JsArray(fields.map(JsString(_))))) else None
      Chain(steps, CreatePipelineTransactionalOutputRequest(Some(steps.last.clientId), "table", outputName, config))
    }

  /** Buckets `timeField` to `granularity`, aggregates `measure` with `fn` into `<measure>_<fn>`, and
   *  charts it with an explicit `chartType`. Shared with `PersonaTemplates`. */
  private[firstrun] def timeSeriesChain(
      outputName: String, timeField: String, granularity: String, measure: String, fn: String,
      chartType: String, parent: Option[String]
  ): Either[String, Chain] = {
    val alias = s"${measure}_$fn"
    val params = JsObject(
      "timeField"   -> JsString(timeField),
      "granularity" -> JsString(granularity),
      "measures"    -> JsArray(Aggregation(alias, fn, measure).toJson)
    )
    expand(TimeSeriesShape.id, params).map { exps =>
      val steps = chain(TimeSeriesShape.id, exps, parent)
      Chain(steps, CreatePipelineTransactionalOutputRequest(
        Some(steps.last.clientId), "chart", outputName, Some(chartConfig(chartType, timeField, alias))
      ))
    }
  }

  /** `top-n` takes no group-by, so an `aggregate` pre-step collapses the category first. */
  private[firstrun] def topNChain(
      outputName: String, category: String, measure: String, fn: String, n: Int,
      chartType: String, parent: Option[String]
  ): Either[String, Chain] = {
    val alias = s"${measure}_$fn"
    val agg = step(
      AggTopNId, AggregateStep.Kind,
      AggregateConfig(Vector(AggregateField(category, "string")), Vector(Aggregation(alias, fn, measure))).toJson.asJsObject,
      parent
    )
    val params = JsObject("measure" -> JsString(alias), "direction" -> JsString("desc"), "n" -> JsNumber(n))
    expand(TopNShape.id, params).map { exps =>
      val steps = agg +: chain(TopNShape.id, exps, Some(AggTopNId))
      Chain(steps, CreatePipelineTransactionalOutputRequest(
        Some(steps.last.clientId), "chart", outputName, Some(chartConfig(chartType, category, alias))
      ))
    }
  }

  private[firstrun] def castStep(casts: Map[String, String]): CreatePipelineTransactionalStepRequest =
    step(CastId, CastStep.Kind, CastConfig(casts).toJson.asJsObject, None)

  private[firstrun] def pipelineOf(sourceId: String, name: String, steps: Vector[CreatePipelineTransactionalStepRequest], outputs: Vector[CreatePipelineTransactionalOutputRequest]): PipelineProposal =
    PipelineProposal(
      pipelineName = name,
      roots = Vector(PipelineProposalSource(
        sourceId = Some(sourceId), `type` = None, name = None, csvConfig = None,
        restConfig = None, sqlConfig = None, staticConfig = None
      )),
      steps   = steps,
      outputs = outputs
    )

  private[firstrun] def chartConfig(chartType: String, x: String, y: String): JsObject =
    JsObject("chartType" -> JsString(chartType), "fieldMapping" -> JsObject("xAxis" -> JsString(x), "yAxis" -> JsString(y)))

  private def expand(shapeId: String, params: JsObject): Either[String, Vector[ShapeStepExpansion]] =
    PipelineShape.shapeFor(shapeId).flatMap(_.expand(params))

  private def step(clientId: String, kind: String, config: JsObject, parent: Option[String]) =
    CreatePipelineTransactionalStepRequest(clientId = clientId, `type` = kind, config = config, parentStepId = parent)

  /** Wires a shape's expansion into a linear chain: ids `<shape>_<i>`, first step under `parent`. */
  private def chain(shapeId: String, exps: Vector[ShapeStepExpansion], parent: Option[String]): Vector[CreatePipelineTransactionalStepRequest] =
    exps.zipWithIndex.foldLeft(Vector.empty[CreatePipelineTransactionalStepRequest]) { case (acc, (exp, i)) =>
      acc :+ step(s"${shapeId}_$i", exp.kind, exp.config, acc.lastOption.map(_.clientId).orElse(parent))
    }

  /** Every panel gets an explicit lg layout (all-or-none: a partial layout would drop the rest) at
   *  x=0, full width, cumulative y. The default placement is half width at every breakpoint, which
   *  leaves a blank half-column on phones. md/sm/xs are derived from lg by
   *  `LayoutBreakpointScaling`, which keeps x=0 and full width, so panels stack without overlap. */
  def dashboardProposal(
      dashboardName: String,
      planned: PipelineProposal,
      created: Vector[ProposalOutputSummary],
      explicitChartTypes: Boolean = false
  ): Either[String, DashboardProposal] = {
    val ordered = planned.outputs.map(o => created.find(_.name == o.name).map(c => (o, c)))
    if (ordered.exists(_.isEmpty)) Left("applied pipeline is missing a planned output")
    else {
      val (panels, _) = ordered.flatten.foldLeft((Vector.empty[ProposalPanel], 0)) { case ((acc, y), (planned, created)) =>
        val h = if (planned.kind == "table") TableH else ChartH
        val chartType = if (explicitChartTypes) planned.config.flatMap(_.fields.get("chartType")).collect { case JsString(t) => t } else None
        (acc :+ outputPanel(created, ProposalPanelLayout(0, y, FullWidth, h), chartType), y + h)
      }
      Right(DashboardProposal(dashboardName, panels))
    }
  }

  /** A chart panel's rendered type comes from the PANEL's appearance, not the output config, so
   *  `chartType` is stated on the panel when a template asks for explicit types. */
  private def outputPanel(output: ProposalOutputSummary, layout: ProposalPanelLayout, chartType: Option[String]) =
    ProposalPanel(
      title = output.name, `type` = "output", outputId = Some(output.id), fieldMapping = None, aggregation = None,
      content = None, url = None, orientation = None, chartType = chartType, xAxisLabel = None, yAxisLabel = None,
      seriesColors = None, label = None, unit = None, sort = None, layout = Some(layout), config = None
    )
}
