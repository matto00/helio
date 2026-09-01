package com.helio.domain.steps

import com.helio.domain.engine.{ExpressionEvaluator, PipelineRowJson}
import com.helio.domain.model.{PipelineExecutionContext, PipelineId, PipelineStep, PipelineStepId}
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** Typed config for the `compute` step. `type` is an optional output-type
 *  hint historically emitted by the frontend editor; the engine ignores it
 *  but preserving it on the wire keeps the editor round-trip clean. */
final case class ComputeConfig(column: String, expression: String, `type`: Option[String])

object ComputeConfig {
  implicit val format: RootJsonFormat[ComputeConfig] = jsonFormat3(ComputeConfig.apply)

  def decode(raw: String): ComputeConfig = {
    val obj        = StepCodecUtil.asObject(raw)
    val column     = StepCodecUtil.str(obj, "column", "")
    val expression = StepCodecUtil.str(obj, "expression", "")
    val typ        = StepCodecUtil.strOpt(obj, "type")
    ComputeConfig(column, expression, typ)
  }
}

/** Compute step — adds a new column whose value is the per-row evaluation of
 *  `expression`. A row-DEPENDENT evaluation failure (unknown field,
 *  divide-by-zero, null operand, type error) yields `null` for that row and
 *  the run continues. A row-INDEPENDENT static parse failure — the
 *  expression cannot parse under either grammar, identical for every row —
 *  is a different case (HEL-888): it is rejected on the write path and fails
 *  the run rather than becoming a column of nulls; see `companion` below. */
final case class ComputeStep(
    id: PipelineStepId,
    pipelineId: PipelineId,
    position: Int,
    config: ComputeConfig,
    createdAt: Instant,
    updatedAt: Instant,
    parentStepId: Option[PipelineStepId] = None,
    enabled: Boolean = true
) extends PipelineStep {
  val kind: String = ComputeStep.Kind

  def configValue: Any = config

  def evaluate(rows: Seq[Map[String, Any]], ctx: PipelineExecutionContext)(implicit
      ec: ExecutionContext
  ): Future[Seq[Map[String, Any]]] =
    Future.successful(ComputeStep.apply(rows, config))
}

object ComputeStep {
  val Kind: String = "compute"

  /** HEL-888 design.md Decision 6: parse `cfg.expression` once, not once per
   *  row — the parse result cannot vary across rows of the same step. Stays
   *  total: if the expression does not parse, every row gets `null` for
   *  `column`, exactly as before this change. That fallback is unreachable
   *  from run/preview/analyze once the `companion` gates below reject the
   *  step first, but a direct caller of this pure function sees no behavior
   *  change either way. */
  def apply(rows: Seq[PipelineRowJson.Row], cfg: ComputeConfig): Seq[PipelineRowJson.Row] = {
    val column = cfg.column
    ExpressionEvaluator.compile(cfg.expression) match {
      case Right(compiled) =>
        rows.map { row =>
          val jsRow = PipelineRowJson.rowToJsMap(row)
          val value = compiled.eval(jsRow) match {
            case Right(v) => PipelineRowJson.jsValueToAny(v)
            case Left(_)  => null
          }
          row + (column -> value)
        }
      case Left(_) =>
        rows.map(row => row + (column -> null))
    }
  }

  val companion: PipelineStep.Companion = new PipelineStep.Companion {
    val kind: String                      = Kind
    def decodeConfig(raw: String): Any    = ComputeConfig.decode(raw)
    def encodeConfig(config: Any): String = config.asInstanceOf[ComputeConfig].toJson.compactPrint
    def readFromWire(json: JsValue): Any  = json.convertTo[ComputeConfig]
    def writeToWire(config: Any): JsValue = config.asInstanceOf[ComputeConfig].toJson

    /** HEL-888 design.md Decision 3. A non-empty `expression` that cannot
     *  parse under either grammar is identical for every row and knowable
     *  before any row is touched, so it is rejected here rather than paid
     *  per-row and discarded (the defect this change closes). `.trim.isEmpty`
     *  (not `.isEmpty`) so a whitespace-only draft is treated as empty
     *  (savable) rather than 422ing on a parse error about blank input —
     *  production holds `compute` steps with both `column` and `expression`
     *  empty. Composed with `super` so the shared shape check still wins. */
    override def validateRawConfig(raw: String): Option[String] =
      super.validateRawConfig(raw).orElse {
        val expr = ComputeConfig.decode(raw).expression
        if (expr.trim.isEmpty) None
        else ExpressionEvaluator.parseProblem(expr).map(m => s"compute: invalid expression: $m")
      }

    /** HEL-814 D3 (missing/empty) + HEL-888 design.md Decision 4 (unparseable).
     *  An empty `column` makes the shipped requirement ("SHALL append a new
     *  field named `column` to every row") write a field named `""` into the
     *  output DataType — HEL-888's originally-reported bug. A step stored
     *  before write-path expression validation existed may also hold an
     *  expression that parses under neither grammar; running it must fail
     *  naming the reason rather than nulling the column for every row. The
     *  missing/empty check runs first so an empty expression still reports
     *  "missing expression" rather than a confusing parse message. */
    override def requiredConfigProblems(raw: String): Vector[String] = {
      val cfg  = ComputeConfig.decode(raw)
      val base = StepCodecUtil.missingRequired(Kind, "column" -> cfg.column, "expression" -> cfg.expression)
      if (base.nonEmpty) base
      else ExpressionEvaluator.parseProblem(cfg.expression).map(m => s"invalid expression: $m").toVector
    }
  }
}
