package com.helio.domain.insights

import spray.json._

import java.time.Instant
import java.util.UUID
import scala.util.Try

/** What started a render (the `trigger` column's closed set). */
sealed abstract class InsightTrigger(val wire: String)
object InsightTrigger {
  case object OnRun  extends InsightTrigger("on_run")
  case object Daily  extends InsightTrigger("daily")
  case object Manual extends InsightTrigger("manual")
  case object Pin    extends InsightTrigger("pin")

  val all: Vector[InsightTrigger] = Vector(OnRun, Daily, Manual, Pin)

  def fromString(s: String): Option[InsightTrigger] = all.find(_.wire == s)
}

/** The outcome of one render attempt (the `status` column's closed set). */
sealed abstract class InsightStatus(val wire: String)
object InsightStatus {
  case object Ok               extends InsightStatus("ok")
  case object Failed           extends InsightStatus("failed")
  case object SkippedQuota     extends InsightStatus("skipped_quota")
  case object SkippedUnchanged extends InsightStatus("skipped_unchanged")
  case object SkippedBudget    extends InsightStatus("skipped_budget")

  /** HEL-1743 R3b: a read-side projection only (never stored, so not in [[all]]): what a viewer grantee sees for a quota or
   *  budget skip, so a viewer cannot tell the owner hit a limit. */
  case object NotUpdated extends InsightStatus("not_updated")

  val all: Vector[InsightStatus] = Vector(Ok, Failed, SkippedQuota, SkippedUnchanged, SkippedBudget)

  def fromString(s: String): Option[InsightStatus] = all.find(_.wire == s)
}

/** One citation as stored in `output_insights.citations`. Built only from the L3 [[Citation]]
 *  (`from`), so the stored shape cannot drift from what the validator produced. `outputId` may name
 *  an Output that is not on the dashboard serving a public read, so the public projection drops it. */
final case class StoredInsightCitation(
    id: String,
    outputId: String,
    field: String,
    number: Option[Double],
    date: Option[Instant],
    capturedAt: Option[Instant],
    isPct: Boolean
)

object StoredInsightCitation {

  def from(c: Citation): StoredInsightCitation =
    StoredInsightCitation(c.id, c.outputId, c.field, c.number, c.date, c.capturedAt, c.isPct)

  def toJson(c: StoredInsightCitation): JsObject =
    JsObject(
      Vector[(String, JsValue)](
        "id"       -> JsString(c.id),
        "outputId" -> JsString(c.outputId),
        "field"    -> JsString(c.field),
        "isPct"    -> JsBoolean(c.isPct)
      ) ++
        c.number.filter(n => !n.isNaN && !n.isInfinite).map(n => "number" -> (JsNumber(n): JsValue)) ++
        c.date.map(d => "date" -> (JsString(d.toString): JsValue)) ++
        c.capturedAt.map(d => "capturedAt" -> (JsString(d.toString): JsValue)): _*
    )

  def toJsonArray(cs: Vector[StoredInsightCitation]): JsArray = JsArray(cs.map(toJson))

  /** A malformed element is dropped, never fatal: the store is written only through [[toJson]], so
   *  this only guards a row edited by hand. */
  def fromJson(v: JsValue): Option[StoredInsightCitation] = v match {
    case o: JsObject =>
      def str(k: String): Option[String]  = o.fields.get(k).collect { case JsString(s) => s }
      def inst(k: String): Option[Instant] = str(k).flatMap(s => Try(Instant.parse(s)).toOption)
      for {
        id    <- str("id")
        out   <- str("outputId")
        field <- str("field")
      } yield StoredInsightCitation(
        id, out, field, o.fields.get("number").collect { case JsNumber(n) => n.toDouble },
        inst("date"), inst("capturedAt"), o.fields.get("isPct").collect { case JsBoolean(b) => b }.getOrElse(false)
      )
    case _ => None
  }

  def fromJsonArray(v: JsValue): Vector[StoredInsightCitation] = v match {
    case JsArray(items) => items.flatMap(fromJson)
    case _              => Vector.empty
  }
}

/** One `output_insights` row. */
final case class OutputInsightRecord(
    id: UUID,
    outputId: String,
    pipelineId: String,
    runId: Option[String],
    trigger: InsightTrigger,
    status: InsightStatus,
    markdown: Option[String],
    citations: Vector[StoredInsightCitation],
    inputDigest: Option[String],
    model: Option[String],
    inputTokens: Option[Int],
    outputTokens: Option[Int],
    cacheCreationTokens: Option[Int],
    cacheReadTokens: Option[Int],
    costMicros: Option[Long],
    createdAt: Instant
) {

  /** HEL-1743 R3/R3b: the viewer-grantee shape, built by REMOVING what a viewer may not see (model, token counts, cost, run id,
   *  input digest) and mapping a quota or budget skip to [[InsightStatus.NotUpdated]]. Done on the record, before it reaches any
   *  response writer, so no writer can leak a field it was never given. */
  def forViewer: OutputInsightRecord =
    copy(
      runId = None, inputDigest = None, model = None, inputTokens = None, outputTokens = None,
      cacheCreationTokens = None, cacheReadTokens = None, costMicros = None,
      status = if (status == InsightStatus.SkippedQuota || status == InsightStatus.SkippedBudget) InsightStatus.NotUpdated else status
    )
}

/** One row to insert (everything but the generated `id`); the write seam L4 uses. */
final case class OutputInsightInsert(
    outputId: String,
    pipelineId: String,
    runId: Option[String],
    trigger: InsightTrigger,
    status: InsightStatus,
    markdown: Option[String],
    citations: Vector[StoredInsightCitation] = Vector.empty,
    inputDigest: Option[String] = None,
    model: Option[String] = None,
    inputTokens: Option[Int] = None,
    outputTokens: Option[Int] = None,
    cacheCreationTokens: Option[Int] = None,
    cacheReadTokens: Option[Int] = None,
    costMicros: Option[Long] = None,
    createdAt: Instant = Instant.now()
)
