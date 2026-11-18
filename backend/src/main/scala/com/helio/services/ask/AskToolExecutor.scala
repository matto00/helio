package com.helio.services.ask

import com.helio.domain.insights.{InsightHead, InsightInputs, InsightPack}
import com.helio.domain.model.{AuthenticatedUser, Output, OutputKind}
import com.helio.infrastructure.ai.ClaudeToolExecutor
import com.helio.services.insights.InsightInputAdapters
import com.helio.services.pipelines.OutputRowsQuery
import spray.json._

import java.time.Instant
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import scala.concurrent.{ExecutionContext, Future}
import scala.jdk.CollectionConverters._
import scala.util.Try

/** HEL-1745 D4/D5: runs the four read tools for ONE ask. It holds only the user and the scope key: every call resolves
 *  the scope again (access check plus the in-scope set), so a panel or grant removed between hops turns later calls into
 *  error results. A model-supplied id outside the set gets the same error text whether or not it exists. */
final class AskToolExecutor(
    user: AuthenticatedUser,
    scope: AskScope,
    access: AskAccess,
    reads: AskReads,
    ledger: AskCitationLedger
) extends ClaudeToolExecutor {

  import AskTools._

  private val served = new ConcurrentHashMap[String, Output]()

  /** Outputs whose data reached the model, by id (for the answer's `citedOutputs` and the pin). */
  def servedOutputs: Map[String, Output] = served.asScala.toMap

  /** Offer `get_history_rows` only when the caller holds a pipeline grant on at least one in-scope Output (at loop start). */
  def offersHistoryRows(implicit ec: ExecutionContext): Future[Boolean] =
    access.resolve(scope, user).flatMap {
      case Left(_)     => Future.successful(false)
      case Right(snap) => Future.traverse(snap.outputs)(o => access.pipelineGrant(o.outputId, user)).map(_.contains(true))
    }

  override def execute(name: String, input: JsValue)(implicit ec: ExecutionContext): Future[Either[String, String]] = {
    val args = input match {
      case o: JsObject => o
      case _           => JsObject.empty
    }
    name match {
      case ListBoardOutputs => listOutputs
      case GetOutputRows    => withOutput(args)(rows(args))
      case GetOutputHistory => withOutput(args)(history(args))
      case GetHistoryRows   => withOutput(args)(historyRows(args))
      case _                => Future.successful(Left("Unknown tool"))
    }
  }

  private def notAvailable(id: String): Either[String, String] = Left(s"Output ${id.take(100)} is not available to this question")

  /** Re-checks scope for this call, then runs `f` with the in-scope entry and its row. */
  private def withOutput(args: JsObject)(f: (ScopedOutput, Output) => Future[Either[String, String]])(implicit ec: ExecutionContext): Future[Either[String, String]] =
    str(args, "outputId") match {
      case None => Future.successful(Left("outputId is required"))
      case Some(id) =>
        access.resolve(scope, user).flatMap {
          case Left(_) => Future.successful(notAvailable(id))
          case Right(snap) =>
            snap.find(id) match {
              case None => Future.successful(notAvailable(id))
              case Some(scoped) =>
                access.loadOutput(id).flatMap {
                  case None         => Future.successful(notAvailable(id))
                  case Some(output) => f(scoped, output)
                }
            }
        }
    }

  private def listOutputs(implicit ec: ExecutionContext): Future[Either[String, String]] =
    access.resolve(scope, user).flatMap {
      case Left(_) => Future.successful(Left("This question's data is no longer available"))
      case Right(snap) =>
        Future.traverse(snap.outputs)(s => access.loadOutput(s.outputId).map(_.map(s -> _))).map { found =>
          val items = found.flatten.map { case (s, o) =>
            JsObject(
              "id"      -> JsString(o.id.value),
              "name"    -> JsString(o.name),
              "kind"    -> JsString(OutputKind.asString(o.kind)),
              "panels"  -> JsArray(s.panels.map(p => JsString(p.title): JsValue)),
              "columns" -> JsArray(o.schema.map(f => JsString(f.name): JsValue))
            ): JsValue
          }
          Right(JsArray(items).compactPrint)
        }
    }

  private def rows(args: JsObject)(scoped: ScopedOutput, output: Output)(implicit ec: ExecutionContext): Future[Either[String, String]] = {
    val limit = intArg(args, "limit", 1, MaxRows, DefaultRows)
    parseFilter(args) match {
      case Left(msg) => Future.successful(Left(msg))
      case Right(filter) =>
        val read = scope match {
          case AskScope.DashboardScope(dashboardId) => reads.dashboardRows(dashboardId, user, scoped.panels, limit, filter)
          case AskScope.OutputScope(_)              => reads.outputRows(output.id.value, user, limit, filter)
        }
        read.flatMap {
          case Left(msg) => Future.successful(Left(msg))
          case Right((columns, rowObjects)) =>
            reads.capturedAt(output).map(at => record(output, headInputs(output, at, columns, rowObjects))(pack => Seq("pack" -> pack.serialized)))
        }
    }
  }

  private def history(args: JsObject)(scoped: ScopedOutput, output: Output)(implicit ec: ExecutionContext): Future[Either[String, String]] = {
    val limit = intArg(args, "limit", 1, MaxHistoryPoints, DefaultHistoryPoints)
    val since: Either[String, Option[Instant]] = str(args, "since") match {
      case None    => Right(None)
      case Some(s) => Try(Instant.parse(s)).toOption.map(i => Right(Some(i))).getOrElse(Left("since must be an ISO-8601 instant"))
    }
    since match {
      case Left(msg) => Future.successful(Left(msg))
      case Right(sinceOpt) =>
        for {
          resolution <- reads.history(output, limit, sinceOpt)
          grant      <- access.pipelineGrant(output.id.value, user)
        } yield {
          val adapted = InsightInputAdapters.fromResolution(output, resolution)
          val inputs  = InsightInputs(None, adapted.compare.toVector, adapted.window.toVector)
          val label   = adapted.window.map(w => s"${w.label}.t")
          record(output, inputs) { pack =>
            val retained = pack.citations.filter(c => label.contains(c.field)).flatMap(_.date).toSet
            val points = resolution.points.filter(p => retained.contains(p.capturedAt)).map { p =>
              JsObject("pointId" -> JsString(p.id.toString), "t" -> JsString(p.capturedAt.toString)): JsValue
            }
            Seq("pack" -> pack.serialized) ++
              Option.when(grant)("points" -> JsArray(points).compactPrint) ++
              Option.when(inputs.compares.isEmpty && inputs.windows.isEmpty)("note" -> JsString("no runs are recorded for this Output").compactPrint)
          }
        }
    }
  }

  private def historyRows(args: JsObject)(scoped: ScopedOutput, output: Output)(implicit ec: ExecutionContext): Future[Either[String, String]] =
    access.pipelineGrant(output.id.value, user).flatMap {
      case false => Future.successful(Left("History rows are not available to this question"))
      case true =>
        Try(UUID.fromString(str(args, "pointId").getOrElse(""))).toOption match {
          case None => Future.successful(Left("pointId must be a point id returned by get_output_history"))
          case Some(pointId) =>
            reads.payload(output.id.value, pointId, user).map {
              case Left(err) => Left(err.message)
              case Right(payload) =>
                val objects = payload.rows.elements.collect { case o: JsObject => o }.take(MaxRows)
                record(output, headInputs(output, payload.point.capturedAt, payload.columns, objects))(pack => Seq("pack" -> pack.serialized))
            }
        }
    }

  private def headInputs(output: Output, at: Instant, columns: Vector[String], rows: Vector[JsObject]): InsightInputs =
    InsightInputs(Some(InsightHead(output.id.value, at, columns, rows)), Vector.empty, Vector.empty)

  /** Sheds and records the pack, remembers the Output as served, and renders `{key: rawJson, ...}`. */
  private def record(output: Output, inputs: InsightInputs)(parts: InsightPack => Seq[(String, String)]): Either[String, String] =
    ledger.shedAndRecord(inputs).map { pack =>
      served.put(output.id.value, output)
      parts(pack).map { case (k, raw) => s"${JsString(k).compactPrint}:$raw" }.mkString("{", ",", "}")
    }

  private def str(args: JsObject, key: String): Option[String] = args.fields.get(key).collect { case JsString(s) if s.trim.nonEmpty => s.trim }

  private def intArg(args: JsObject, key: String, min: Int, max: Int, default: Int): Int =
    args.fields.get(key).collect { case JsNumber(n) if n.isValidInt => n.toInt }.map(v => math.max(min, math.min(max, v))).getOrElse(default)

  private def parseFilter(args: JsObject): Either[String, Option[OutputRowsQuery.FilterParam]] =
    args.fields.get("filter") match {
      case None | Some(JsNull) => Right(None)
      case Some(o: JsObject) =>
        (str(o, "column"), o.fields.get("value").collect { case JsString(v) => v }) match {
          case (Some(column), Some(value)) => Right(Some(OutputRowsQuery.FilterParam(None, Map(column -> value))))
          case _                           => Left("filter needs a column and a value")
        }
      case Some(_) => Left("filter needs a column and a value")
    }
}
