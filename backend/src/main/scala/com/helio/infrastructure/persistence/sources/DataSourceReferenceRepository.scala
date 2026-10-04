package com.helio.infrastructure.persistence.sources

import com.helio.domain.steps.{SecondaryInput, UpsertTarget}
import com.helio.infrastructure.persistence.DbContext
import org.slf4j.LoggerFactory
import slick.jdbc.PostgresProfile.api._
import slick.jdbc.SQLActionBuilder
import spray.json._

import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try

/** HEL-1252: the ONE finder of every persisted reference to a data source, shared by the data-source
 *  delete guard (`DataSourceService.delete`) and workspace-tag teardown.
 *
 *  Reference kinds (design.md D1, re-derived from migrations + domain codecs, see probe-notes.md):
 *    - `root`         `pipeline_roots.data_source_id` (FK, cascade)
 *    - `join`/`lookup`/`union`  `pipeline_steps.config` -> `secondaryInput` of kind `source`
 *    - `upsertTarget` `pipeline_steps.config` (op `upsertsource`) -> `target` of kind `existingSource`
 *    - form panel     `panels.form_config->>'dataSourceId'` (kind `form`)
 *
 *  Every read runs on the PRIVILEGED pool (`ctx.withSystemContext`), so RLS never filters a
 *  referencing row -- a hidden pipeline/panel must still BLOCK a delete. Visibility to the viewer is
 *  an EXPLICIT predicate in the SQL (never RLS, never the `app.current_user_id` GUC):
 *    - pipeline: owner = viewer, or a `resource_permissions` row (`resource_type = 'pipeline'`) with
 *      `grantee_id = viewer` -- mirrors `helio_can_access_pipeline` (V39).
 *    - form panel: its dashboard's owner = viewer, or a `resource_type = 'dashboard'` grant with
 *      `grantee_id = viewer` -- mirrors `helio_can_access_dashboard`'s AUTHENTICATED branch (V36).
 *      The anonymous branch (a grantee-less public grant) is for anonymous readers only and NEVER
 *      confers visibility here; neither does a grant to some other user.
 *
 *  A hidden referencing resource's identity is held only inside this file: [[SourceReferences]]
 *  carries VISIBLE entries plus an unnamed count, so no caller can leak a hidden id or name. */
class DataSourceReferenceRepository(ctx: DbContext)(implicit ec: ExecutionContext) {

  import DataSourceReferenceRepository._

  private val log = LoggerFactory.getLogger(getClass)

  /** References to each of `sourceIds`, as seen by `viewerId`. Every requested id is a key of the result. */
  def find(sourceIds: Set[String], viewerId: String): Future[Map[String, SourceReferences]] =
    if (sourceIds.isEmpty) Future.successful(Map.empty)
    else {
      val ids = sourceIds.toVector
      // Privileged pool: RLS must not hide a referencing row from the guard. Visibility is the explicit
      // owner/grantee predicate in each query below, never RLS.
      ctx.withSystemContext(
        for {
          roots  <- rootRows(ids, viewerId)
          steps  <- stepRows(ids, viewerId)
          panels <- panelRows(ids, viewerId)
        } yield assemble(sourceIds, roots ++ steps, panels)
      )
    }

  private def inList(ids: Vector[String]): SQLActionBuilder =
    ids.map(i => sql"$i").reduce((a, b) => a.concat(sql", ").concat(b))

  private def rootRows(ids: Vector[String], viewer: String): DBIO[Vector[PipelineHit]] =
    sql"""SELECT r.data_source_id, p.id, p.name, p.owner_id::text, p.tag, 'root',
                 (p.owner_id = $viewer::uuid OR EXISTS (
                    SELECT 1 FROM resource_permissions rp
                    WHERE rp.resource_type = 'pipeline' AND rp.resource_id = p.id AND rp.grantee_id = $viewer::uuid))
          FROM pipeline_roots r JOIN pipelines p ON p.id = r.pipeline_id
          WHERE r.data_source_id IN (""".concat(inList(ids)).concat(sql")")
      .as[(String, String, String, String, Option[String], String, Boolean)]
      .map(_.map { case (src, pid, pname, owner, tag, kind, vis) => PipelineHit(src, pid, pname, owner, tag, kind, vis) })

  /** R2/R3. Disabled steps count (they still hold the config). The `strpos` prefilter uses bound
   *  parameters; the exact match is the domain codec's decode of ONLY the reference sub-object, so a
   *  malformed unrelated key cannot hide a real reference and one malformed TEXT row cannot make
   *  every delete error. */
  private def stepRows(ids: Vector[String], viewer: String): DBIO[Vector[PipelineHit]] = {
    val prefilter = ids.map(i => sql"strpos(s.config, $i) > 0").reduce((a, b) => a.concat(sql" OR ").concat(b))
    sql"""SELECT s.op, s.config, p.id, p.name, p.owner_id::text, p.tag,
                 (p.owner_id = $viewer::uuid OR EXISTS (
                    SELECT 1 FROM resource_permissions rp
                    WHERE rp.resource_type = 'pipeline' AND rp.resource_id = p.id AND rp.grantee_id = $viewer::uuid))
          FROM pipeline_steps s JOIN pipelines p ON p.id = s.pipeline_id
          WHERE s.op IN ('join', 'lookup', 'union', 'upsertsource') AND (""".concat(prefilter).concat(sql")")
      .as[(String, String, String, String, String, Option[String], Boolean)]
      .map(_.flatMap { case (op, config, pid, pname, owner, tag, vis) =>
        referencedSource(op, config) match {
          case Some(src) if ids.contains(src) => Some(PipelineHit(src, pid, pname, owner, tag, kindFor(op), vis))
          case _                              => None
        }
      })
  }

  private def panelRows(ids: Vector[String], viewer: String): DBIO[Vector[PanelHit]] =
    sql"""SELECT pn.form_config ->> 'dataSourceId', pn.id, pn.title, d.id, d.name, d.owner_id::text, d.tag,
                 (d.owner_id = $viewer::uuid OR EXISTS (
                    SELECT 1 FROM resource_permissions rp
                    WHERE rp.resource_type = 'dashboard' AND rp.resource_id = d.id AND rp.grantee_id = $viewer::uuid))
          FROM panels pn JOIN dashboards d ON d.id = pn.dashboard_id
          WHERE pn.kind = 'form' AND pn.form_config ->> 'dataSourceId' IN (""".concat(inList(ids)).concat(sql")")
      .as[(String, String, String, String, String, String, Option[String], Boolean)]
      .map(_.map { case (src, id, title, did, dname, downer, dtag, vis) => PanelHit(src, id, title, did, dname, downer, dtag, vis) })

  /** The source id a step's config references, or None (lane/newSource/empty draft/undecodable). Only the
   *  reference sub-object is decoded. */
  private def referencedSource(op: String, config: String): Option[String] =
    Try(config.parseJson.asJsObject).toOption.flatMap { obj =>
      if (op == "upsertsource")
        obj.fields.get("target").flatMap(v => Try(UpsertTarget.format.read(v)).toOption).collect {
          case UpsertTarget.ExistingSource(id) if id.nonEmpty => id
        }
      else
        obj.fields.get("secondaryInput").flatMap(v => Try(SecondaryInput.format.read(v)).toOption).collect {
          case SecondaryInput.Source(id) if id.nonEmpty => id
        }
    }.orElse {
      // Debug only: the owning pipeline may be hidden from the viewer, so nothing here may name it.
      log.debug("pipeline step config did not yield a source reference (op={})", op)
      None
    }

  private def assemble(sourceIds: Set[String], pipelineHits: Vector[PipelineHit], panelHits: Vector[PanelHit]): Map[String, SourceReferences] =
    sourceIds.map { src =>
      val ph = pipelineHits.filter(_.sourceId == src).groupBy(_.pipelineId)
      val pipelines = ph.values.toVector.map { hits =>
        val h = hits.head
        (h.visible, VisiblePipelineRef(h.pipelineId, h.pipelineName, h.ownerId, h.tag, KindOrder.filter(k => hits.exists(_.kind == k))))
      }
      val pn = panelHits.filter(_.sourceId == src).groupBy(_.panelId).values.toVector.map(_.head)
      src -> SourceReferences(
        pipelines = pipelines.collect { case (true, p) => p }.sortBy(p => (p.name, p.id)),
        hiddenPipelineCount = pipelines.count(!_._1),
        panels = pn.filter(_.visible).map(h => VisiblePanelRef(h.panelId, h.title, h.dashboardId, h.dashboardName, h.dashboardOwnerId, h.dashboardTag)).sortBy(p => (p.title, p.id)),
        hiddenPanelCount = pn.count(!_.visible)
      )
    }.toMap
}

object DataSourceReferenceRepository {

  /** Wire/protocol names of the pipeline reference kinds, in display order. */
  val KindOrder: Vector[String] = Vector("root", "join", "lookup", "union", "upsertTarget")

  private def kindFor(op: String): String = if (op == "upsertsource") "upsertTarget" else op

  /** A pipeline the viewer may see, with the reference kinds it holds on the source. `ownerId`/`tag` let
   *  teardown decide whether this same call deletes it. */
  final case class VisiblePipelineRef(id: String, name: String, ownerId: String, tag: Option[String], references: Vector[String])

  /** A form panel the viewer may see (its dashboard is visible). */
  final case class VisiblePanelRef(id: String, title: String, dashboardId: String, dashboardName: String, dashboardOwnerId: String, dashboardTag: Option[String])

  /** Visible referencing resources by identity; hidden ones ONLY as counts of distinct resources
   *  (pipelines, panels -- never reference edges). */
  final case class SourceReferences(
      pipelines: Vector[VisiblePipelineRef],
      hiddenPipelineCount: Int,
      panels: Vector[VisiblePanelRef],
      hiddenPanelCount: Int
  ) {
    def isEmpty: Boolean = pipelines.isEmpty && panels.isEmpty && hiddenPipelineCount == 0 && hiddenPanelCount == 0
    def hiddenCount: Int = hiddenPipelineCount + hiddenPanelCount

    /** Human text naming each VISIBLE referencing pipeline/panel and counting hidden ones (of RESOURCES, never
     *  reference edges). One definition shared by the delete 409 and the teardown conflict, so a hidden
     *  identity -- absent from this type -- has no path into either message. */
    def describe: String = {
      def unseen(n: Int, one: String, many: String) = if (n == 1) s"a $one you cannot access" else s"$n $many you cannot access"
      val named = if (pipelines.isEmpty) None else Some(
        "pipeline(s) " + pipelines.map { p =>
          s"'${p.name}' (${p.id}; as ${p.references.map(k => KindLabels.getOrElse(k, k)).mkString(", ")})"
        }.mkString(", ")
      )
      val namedPanels = if (panels.isEmpty) None else Some(
        "form panel(s) " + panels.map(p => s"'${p.title}' (${p.id}) on dashboard '${p.dashboardName}' (${p.dashboardId})").mkString(", ")
      )
      Vector(
        named, namedPanels,
        Some(hiddenPipelineCount).filter(_ > 0).map(unseen(_, "pipeline", "pipelines")),
        Some(hiddenPanelCount).filter(_ > 0).map(unseen(_, "form panel", "form panels"))
      ).flatten.mkString("; ")
    }
  }

  private val KindLabels = Map(
    "root" -> "root", "join" -> "join input", "lookup" -> "lookup input", "union" -> "union input", "upsertTarget" -> "upsert target"
  )

  // Internal rows: carry hidden identities, never exposed outside the repository.
  private final case class PipelineHit(sourceId: String, pipelineId: String, pipelineName: String, ownerId: String, tag: Option[String], kind: String, visible: Boolean)
  private final case class PanelHit(sourceId: String, panelId: String, title: String, dashboardId: String, dashboardName: String, dashboardOwnerId: String, dashboardTag: Option[String], visible: Boolean)
}
