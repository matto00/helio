package com.helio.domain.engine

import com.helio.domain.model.{DataSource, DataSourceId, DatasetSource, PipelineRootId, PipelineStep, PipelineStepId, UserId}
import com.helio.infrastructure.persistence.pipelines.PipelineStepRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import spray.json.{JsArray, JsBoolean, JsNull, JsNumber, JsObject, JsString, JsValue}

import java.nio.file.Paths
import java.time.Instant
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.util.{Failure, Success, Try}

import ParityCorpus.Row

/** One step of a corpus pipeline, as the corpus files describe it. */
final case class ParityStepDef(id: String, kind: String, parentStepId: Option[String], rootId: Option[String], position: Int, enabled: Boolean, config: OJ)

/** What running a tree did, from the engine's own run path. */
sealed trait ParityOutcome
object ParityOutcome {
  final case class Frames(byStep: Map[String, Seq[Row]])        extends ParityOutcome
  final case class StepFailed(stepId: String)                    extends ParityOutcome
  final case class LaneViolation(message: String)                extends ParityOutcome
  final case class ConfigUndecodable(kind: String, why: String)  extends ParityOutcome
}

/** HEL-1581: the Scala oracle. Every vector goes through `InProcessPipelineEngine.executeTree` (the engine's run path:
 *  `requiredConfigProblems` before `evaluate`, `enabled` and `position` honoured), never a bare decode + evaluate. */
object ParityRunner {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private val engine   = new InProcessPipelineEngine(new LocalFileSystem(Paths.get("/")))
  private val stepRepo = new PipelineStepRepository(null)
  private val now      = Instant.parse("2026-01-01T00:00:00Z")

  def stepDefOf(v: OJ): ParityStepDef = {
    val o = v match { case x: OJ.Obj => x; case other => throw new IllegalArgumentException(s"step must be an object: $other") }
    def optString(key: String): Option[String] = o(key) match { case OJ.Str(s) => Some(s); case OJ.Null => None; case other => throw new IllegalArgumentException(s"$key: $other") }
    ParityStepDef(
      id = optString("id").get,
      kind = optString("kind").get,
      parentStepId = optString("parentStepId"),
      rootId = optString("rootId"),
      position = o("position") match { case OJ.Num(n) => n.toInt; case other => throw new IllegalArgumentException(s"position: $other") },
      enabled = o.get("enabled") match { case Some(OJ.Bool(b)) => b; case _ => true },
      config = o("config")
    )
  }

  /** A `DataSourceRepository` double that serves each registered id as a dataset source with the given rows. */
  private def repoFor(sources: Map[String, Seq[Row]]): DataSourceRepository = {
    val owner = UserId("00000000-0000-0000-0000-000000000001")
    new DataSourceRepository(null) {
      override def findByIdInternal(id: DataSourceId): Future[Option[DataSource]] =
        Future.successful(sources.get(id.value).map(_ => DatasetSource(id, id.value, owner, now, now)))
      override def readDatasetRows(id: DataSourceId): Future[Option[JsObject]] =
        Future.successful(sources.get(id.value).map(datasetPayload))
    }
  }

  /** A source's rows pass through JSON, so they can only hold doubles, strings, booleans and nulls and need one key set. */
  private def datasetPayload(rows: Seq[Row]): JsObject = {
    val columns = rows.headOption.map(_.keys.toVector.sorted).getOrElse(Vector.empty)
    require(rows.forall(_.keySet == columns.toSet), "source secondary rows must all have the same keys")
    def js(v: Any): JsValue = v match {
      case null       => JsNull
      case b: Boolean => JsBoolean(b)
      case d: Double  => JsNumber(d)
      case s: String  => JsString(s)
      case other      => throw new IllegalArgumentException(s"a source secondary cannot hold ${other.getClass.getName} (rows pass through JSON)")
    }
    JsObject(
      "columns" -> JsArray(columns.map(c => JsObject("name" -> JsString(c), "type" -> JsString("string")))),
      "rows"    -> JsArray(rows.map(r => JsArray(columns.map(c => js(r(c))))).toVector)
    )
  }

  /** `executeTree` over the given root frames and steps; `sources` backs source secondaries. */
  def run(rootFrames: Vector[(String, Seq[Row])], defs: Vector[ParityStepDef], sources: Map[String, Seq[Row]] = Map.empty): ParityOutcome = {
    val steps: Vector[PipelineStep] =
      try defs.map(d => ParityStepBuilder.build(d.kind, d.id, d.position, d.parentStepId, d.enabled, OJ.compact(d.config)))
      catch { case e: ParityConfigDecodeFailure => return ParityOutcome.ConfigUndecodable(e.kind, e.getMessage) }
    val rootIdOfStep: Map[PipelineStepId, PipelineRootId] =
      defs.filter(_.parentStepId.isEmpty).map(d => PipelineStepId(d.id) -> PipelineRootId(d.rootId.getOrElse(rootFrames.head._1))).toMap
    Try(Await.result(engine.executeTree(rootFrames, steps, stepRepo, rootIdOfStep, repoFor(sources)), 30.seconds)) match {
      case Success(result) =>
        ParityOutcome.Frames(defs.map(d => d.id -> result.nodeOutcomes(StepKey(d.id)).rows).toMap)
      case Failure(e: StepExecutionException) => ParityOutcome.StepFailed(e.stepId)
      case Failure(e: LaneReferenceError)     => ParityOutcome.LaneViolation(e.getMessage)
      case Failure(e)                         => throw e
    }
  }

  /** The step ids to remove together with everything that depends on them (a child, or a lane reference). */
  def closure(roots: Set[String], defs: Vector[ParityStepDef]): Set[String] = {
    val laneOf: Map[String, String] = defs.flatMap { d =>
      Try(ParityStepBuilder.build(d.kind, d.id, d.position, d.parentStepId, d.enabled, OJ.compact(d.config))).toOption
        .flatMap(InProcessPipelineEngine.laneDependencyOf).map(d.id -> _)
    }.toMap
    var out = roots
    var grew = true
    while (grew) {
      val next = out ++ defs.filter(d => d.parentStepId.exists(out.contains) || laneOf.get(d.id).exists(out.contains)).map(_.id)
      grew = next.size > out.size
      out = next
    }
    out
  }

  /** A corpus step vector as a one-root tree: the step under test, plus a second root and a `limit 0` step when the
   *  vector has a lane secondary. */
  def runStepVector(kind: String, vec: OJ.Obj): ParityOutcome = {
    val config  = vec("config")
    val enabled = vec.get("enabled") match { case Some(OJ.Bool(b)) => b; case _ => true }
    val input   = ParityCorpus.decodeRows(vec("inputRows"))
    val under   = ParityStepDef("under-test", kind, None, Some("main"), 0, enabled, config)
    val secondary = vec.get("secondary").collect { case o: OJ.Obj => o }
    secondary.map(_("kind")) match {
      case Some(OJ.Str("lane")) =>
        val laneId = config match {
          case c: OJ.Obj => c("secondaryInput") match { case si: OJ.Obj => si("stepId") match { case OJ.Str(s) => s; case other => throw new IllegalArgumentException(s"stepId: $other") }; case other => throw new IllegalArgumentException(s"secondaryInput: $other") }
          case other     => throw new IllegalArgumentException(s"config: $other")
        }
        val lane = ParityStepDef(laneId, "limit", None, Some("lane-root"), 0, enabled = true, OJ.Obj(Vector("count" -> OJ.Num("0"))))
        val laneRows = ParityCorpus.decodeRows(secondary.get("rows"))
        run(Vector("main" -> input, "lane-root" -> laneRows), Vector(under, lane))
      case Some(OJ.Str("source")) =>
        val id = secondary.get("id") match { case OJ.Str(s) => s; case other => throw new IllegalArgumentException(s"source id: $other") }
        run(Vector("main" -> input), Vector(under), Map(id -> ParityCorpus.decodeRows(secondary.get("rows"))))
      case _ => run(Vector("main" -> input), Vector(under))
    }
  }
}
