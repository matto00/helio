package com.helio.services.patchsets

import com.helio.api.protocols.panels.PanelResponse
import com.helio.api.protocols.pipelines.PipelineStepResponse
import com.helio.api.protocols.dashboards.DashboardResponse
import com.helio.api.protocols.sources.DataSourceResponse
import com.helio.domain.model.{AuthenticatedUser, Dashboard, DataSource, DatasetFieldDeclaration, DatasetSource, Panel, PipelineStep}
import DatasetFieldDeclaration.datasetFieldDeclarationFormat
import com.helio.infrastructure.persistence.pipelines.PipelineRepository.PipelineSummary
import PatchSetApplyServiceJson._
import spray.json._

import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import scala.concurrent.{ExecutionContext, Future}

/** The preview fingerprint of an update/delete target (HEL-1458): `"v1:" + sha256hex` of the canonical JSON of the
 *  fields that kind's update request can write. The ONE implementation behind both preview (which issues it) and
 *  apply (which recomputes it from the freshly resolved prior state), so the two cannot drift.
 *
 *  An allowlist, not a denylist: server-maintained fields (timestamps, `lastRun*`, ownership, ids, a dashboard's
 *  `layoutVersion`) are excluded by construction, so a field added to a response later cannot cause false
 *  conflicts. A dataSource covers its name, type, redacted config, tag and schema; a pipeline covers its name, tag,
 *  roots and the steps, Outputs and schedule that are deleted with it (see [[PatchSetPipelineDefinition]]). Dataset
 *  rows, stored file bytes and run history are data, not definition, and are not covered. A different `v` prefix is
 *  stale by comparison. */
private[services] object PatchSetTargetFingerprint {

  private val Version = "v1:"

  /** Per target kind, the keys of that kind's response JSON that its update request can write. */
  private[services] val Allowlist: Map[String, Vector[String]] = Map(
    "panel"        -> Vector("title", "appearance", "type", "config"),
    "dashboard"    -> Vector("name", "appearance", "layout"),
    "dataSource"   -> Vector("name", "type", "config", "tag", "inferredSchema", "declaredSchema"),
    "pipeline"     -> Vector("name", "tag", "roots", "steps", "outputs", "schedule"),
    "pipelineStep" -> Vector("type", "config", "position", "enabled"),
    "output"       -> Vector("name", "config")
  )

  /** `None` for a `create` edit. An output delete reads the stored config (the resolver omits it from its prior
   *  state), solely for this hash. */
  def forEdit(edit: ResolvedEdit, user: AuthenticatedUser, ctx: PatchSetApplyContext)(implicit
      ec: ExecutionContext
  ): Future[Option[String]] =
    edit.action match {
      case ResolvedAction.PanelUpdate(_, _, prior)  => ready("panel", panelState(prior))
      case ResolvedAction.PanelDelete(_, prior)     => ready("panel", panelState(prior))
      case ResolvedAction.DashboardUpdate(_, _, prior) => ready("dashboard", dashboardState(prior))
      case ResolvedAction.DashboardDelete(_, prior)    => ready("dashboard", dashboardState(prior))
      case ResolvedAction.DataSourceUpdate(_, _, prior) => dataSourceFingerprint(prior, user, ctx)
      case ResolvedAction.DataSourceDelete(_, prior)    => dataSourceFingerprint(prior, user, ctx)
      case ResolvedAction.PipelineUpdate(_, _, prior)   => pipelineFingerprint(prior, ctx)
      case ResolvedAction.PipelineDelete(_, prior)      => pipelineFingerprint(prior, ctx)
      case ResolvedAction.PipelineStepUpdate(_, _, prior) => ready("pipelineStep", stepState(prior))
      case ResolvedAction.PipelineStepDelete(_, prior)    => ready("pipelineStep", stepState(prior))
      case ResolvedAction.OutputUpdate(_, _, prior, priorConfig) =>
        ready("output", JsObject("name" -> JsString(prior.name), "config" -> priorConfig))
      case ResolvedAction.OutputDelete(id, prior) =>
        ctx.outputRepo.findConfigById(id, user).map { configOpt =>
          Some(of("output", JsObject("name" -> JsString(prior.name), "config" -> configOpt.getOrElse(JsObject.empty))))
        }
      case _: ResolvedAction.PanelCreate | _: ResolvedAction.DashboardCreate | _: ResolvedAction.DataSourceCreate |
          _: ResolvedAction.PipelineCreate | _: ResolvedAction.PipelineStepCreate =>
        Future.successful(None)
    }

  /** `DataSourceResponse.fromDomain` redacts secrets before this is hashed: a client-visible hash must never be a
   *  function of a credential. The consequence is that a change to a secret alone is not noticed.
   *
   *  A dataset is hashed on its DECLARED schema (`dataset_schema`: name, type, required, default), read after the owned
   *  resolution. Its `inferredSchema` is dropped: it is recomputed from the row contents on every row write, including
   *  pipeline write-backs, so it would both miss declaration edits and go stale on data writes. */
  private def dataSourceFingerprint(prior: DataSource, user: AuthenticatedUser, ctx: PatchSetApplyContext)(implicit
      ec: ExecutionContext
  ): Future[Option[String]] = {
    val response = dataSourceResponseFormat.write(DataSourceResponse.fromDomain(prior)).asJsObject
    prior match {
      case dataset: DatasetSource =>
        ctx.dataSourceRepo.getDeclaredSchema(dataset.id, user).map { declared =>
          val withoutRowDerived = JsObject(response.fields - "inferredSchema")
          Some(of("dataSource", JsObject(withoutRowDerived.fields + ("declaredSchema" -> declared.getOrElse(Vector.empty).toJson))))
        }
      case _ => Future.successful(Some(of("dataSource", response)))
    }
  }

  private def pipelineFingerprint(prior: PipelineSummary, ctx: PatchSetApplyContext)(implicit ec: ExecutionContext): Future[Option[String]] =
    PatchSetPipelineDefinition.of(prior, ctx).map(state => Some(of("pipeline", state)))

  /** The fingerprint of `state` as seen through `kind`'s allowlist. */
  private[services] def of(kind: String, state: JsObject): String = {
    val projected = JsObject(Allowlist(kind).flatMap(key => state.fields.get(key).map(key -> _)).toMap)
    val digest    = MessageDigest.getInstance("SHA-256").digest(canonical(projected).getBytes(StandardCharsets.UTF_8))
    Version + digest.map(b => f"${b & 0xff}%02x").mkString
  }

  private def ready(kind: String, state: JsObject): Future[Option[String]] =
    Future.successful(Some(of(kind, state)))

  /** Object keys sorted recursively: spray's `JsObject.fields` is an unordered `Map`. */
  private[services] def canonical(value: JsValue): String = value match {
    case JsObject(fields) =>
      fields.toVector.sortBy(_._1).map { case (k, v) => JsString(k).compactPrint + ":" + canonical(v) }.mkString("{", ",", "}")
    case JsArray(items) => items.map(canonical).mkString("[", ",", "]")
    case other          => other.compactPrint
  }

  /** `metricDeprecated` is server-materialized and never patch-decodable, so it is stripped (as the undo conflict
   *  check does). */
  private def panelState(prior: Panel): JsObject = {
    val json = panelResponseFormat.write(PanelResponse.fromDomain(prior)).asJsObject
    json.fields.get("config") match {
      case Some(JsObject(config)) => JsObject(json.fields + ("config" -> JsObject(config - "metricDeprecated")))
      case _                      => json
    }
  }

  private def dashboardState(prior: Dashboard): JsObject =
    dashboardResponseFormat.write(DashboardResponse.fromDomain(prior)).asJsObject

  private def stepState(prior: PipelineStep): JsObject =
    pipelineStepResponseFormat.write(PipelineStepResponse.fromDomain(prior, Map.empty)).asJsObject
}
