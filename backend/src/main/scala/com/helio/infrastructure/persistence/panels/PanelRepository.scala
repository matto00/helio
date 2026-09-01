package com.helio.infrastructure.persistence.panels

import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ResourcePermissionRepository
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.api.protocols.panels.PanelProtocol
import com.helio.domain.model._
import com.helio.domain.panels._
import slick.collection.heterogeneous.HNil
import slick.collection.heterogeneous.syntax._
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

class PanelRepository(protected val ctx: DbContext)(implicit protected val ec: ExecutionContext)
    extends PanelProtocol with PanelMutationOps {

  import PanelRepository._

  protected val table     = TableQuery[PanelTable]
  private val dashTable   = TableQuery[DashboardRepository.DashboardTable]
  private val permTable   = TableQuery[ResourcePermissionRepository.ResourcePermissionTable]

  protected def rowToDomain(row: PanelRow): Panel =
    PanelRowMapper.rowToDomain(row)

  protected def domainToRow(p: Panel): PanelRow =
    PanelRowMapper.domainToRow(p)

  /** Sharing-aware paginated list. Returns panels for the dashboard only when
   *  the caller has access (owner, grantee, or anonymous with a public-viewer
   *  grant). Used by `PublicDashboardRoutes`.
   *
   *  The access check is collapsed into the data query as embedded WHERE
   *  predicates (a single JOIN) rather than the 2–3 sequential EXISTS
   *  round-trips the old implementation required, and the count + slice run in
   *  one withSystemContext session so the page total stays consistent with the
   *  returned slice.
   *
   *  Uses withSystemContext because the ACL predicate is embedded in the WHERE
   *  clause rather than relying on `app.current_user_id` RLS; the privileged
   *  pool correctly evaluates the explicit ownership/grant conditions. */
  def findAllByDashboardId(
      dashboardId: DashboardId,
      callerOpt: Option[AuthenticatedUser],
      page: Page
  ): Future[PagedResult[Panel]] = {
    // Build the owner/grantee branches of the access predicate up front.
    // LiteralColumn(false) is used for branches that can never match when
    // callerOpt is None (owner check and grantee check both require a caller id).
    val (ownerPred, granteePred): (Rep[Boolean], Rep[Boolean]) = callerOpt match {
      case Some(caller) =>
        val callerUuid = UUID.fromString(caller.id.value)
        val ownerCheck: Rep[Boolean] =
          dashTable.filter(d => d.id === dashboardId.value && d.ownerId === callerUuid).exists
        val granteeCheck: Rep[Boolean] =
          permTable.filter(p =>
            p.resourceType === "dashboard" &&
            p.resourceId   === dashboardId.value &&
            p.granteeId    === callerUuid
          ).exists
        (ownerCheck, granteeCheck)

      case None =>
        // Anonymous caller: owner and grantee branches can never match.
        (LiteralColumn(false): Rep[Boolean], LiteralColumn(false): Rep[Boolean])
    }

    // Public-viewer branch: always evaluated (EXISTS subquery for NULL grantee_id).
    val publicPred: Rep[Boolean] =
      permTable.filter(p =>
        p.resourceType === "dashboard" &&
        p.resourceId   === dashboardId.value &&
        p.granteeId.isEmpty &&
        p.role         === "viewer"
      ).exists

    val accessFiltered =
      table
        .filter(_.dashboardId === dashboardId.value)
        .filter(_ => ownerPred || granteePred || publicPred)

    val countAction = accessFiltered.length.result
    val sliceAction =
      accessFiltered.sortBy(_.lastUpdated.desc).drop(page.offset).take(page.limit).result

    ctx.withSystemContext(
      for {
        total <- countAction
        rows  <- sliceAction
      } yield PagedResult(rows.map(rowToDomain).toVector, total, page.offset, page.limit)
    )
  }

  /** No-ACL read. Documented callers:
   *  - `ResourceTypeRegistry` owner-resolver (privileged; resolves ownership for ACL check)
   *  - `PanelService.batchUpdate` (parent dashboard ACL is the authoritative gate there)
   *  Do NOT call from routes or services that own the ACL decision. */
  def findByIdInternal(id: PanelId): Future[Option[Panel]] =
    ctx.withSystemContext(table.filter(_.id === id.value).result.headOption)
      .map(_.map(rowToDomain))

  /** Sharing-aware read. Returns Some when the caller is the panel's parent
   *  dashboard's owner, has an explicit grant on that dashboard, or (when
   *  `callerOpt = None`) a public-viewer grant exists on the dashboard.
   *  Returns None otherwise — no existence leak.
   *
   *  Collapsed to a single JOIN query (one db.run for all paths) to eliminate
   *  the 2–3 sequential round-trips the old implementation required.
   *
   *  Uses withSystemContext because the ACL predicate is embedded in the WHERE
   *  clause rather than relying on `app.current_user_id` RLS; the privileged
   *  pool correctly evaluates the explicit ownership/grant conditions. */
  def findById(id: PanelId, callerOpt: Option[AuthenticatedUser]): Future[Option[Panel]] = {
    val (ownerPred, granteePred): (Rep[Boolean], Rep[Boolean]) = callerOpt match {
      case Some(caller) =>
        val callerUuid = UUID.fromString(caller.id.value)
        // Join panels → dashboards to check ownership
        val ownerCheck: Rep[Boolean] =
          (for {
            panel <- table if panel.id === id.value
            dash  <- dashTable if dash.id === panel.dashboardId && dash.ownerId === callerUuid
          } yield dash).exists
        val granteeCheck: Rep[Boolean] =
          (for {
            panel <- table if panel.id === id.value
            perm  <- permTable if
              perm.resourceType === "dashboard" &&
              perm.resourceId   === panel.dashboardId &&
              perm.granteeId    === callerUuid
          } yield perm).exists
        (ownerCheck, granteeCheck)

      case None =>
        // Anonymous caller: owner and grantee branches can never match.
        (LiteralColumn(false): Rep[Boolean], LiteralColumn(false): Rep[Boolean])
    }

    val publicPred: Rep[Boolean] =
      (for {
        panel <- table if panel.id === id.value
        perm  <- permTable if
          perm.resourceType === "dashboard" &&
          perm.resourceId   === panel.dashboardId &&
          perm.granteeId.isEmpty &&
          perm.role         === "viewer"
      } yield perm).exists

    val query =
      table
        .filter(_.id === id.value)
        .filter(_ => ownerPred || granteePred || publicPred)

    ctx.withSystemContext(query.result.headOption).map(_.map(rowToDomain))
  }

  /** ACL-bypassing lookup of every panel placement bound to an Output
   *  (HEL-906 task 2.4/2.3: `GET /api/outputs/:id/panels` and the
   *  `DELETE /api/outputs/:id` removed-placements report). Safe to call only
   *  after the caller's Output/pipeline access has been confirmed by the
   *  service layer — mirrors `findByIdInternal`'s contract. */
  def findByOutputIdInternal(outputId: String): Future[Vector[Panel]] =
    ctx.withSystemContext(table.filter(_.outputId === Option(outputId)).result).map(_.toVector.map(rowToDomain))

  /** ACL-bypassing bulk delete of every panel bound to an Output — the
   *  application-level mirror of `outputs`' `ON DELETE CASCADE` FK (V94),
   *  called BEFORE the Output row itself is deleted so the removed ids can
   *  be reported back to the caller (`DELETE /api/outputs/:id` response,
   *  HEL-906 task 2.3). Returns the ids of every panel removed. */
  def deleteByOutputIdInternal(outputId: String): Future[Vector[PanelId]] = {
    val query = table.filter(_.outputId === Option(outputId))
    ctx.withSystemContext(
      query.map(_.id).result.flatMap { ids =>
        query.delete.map(_ => ids.toVector.map(PanelId(_)))
      }.transactionally
    )
  }

  def insert(panel: Panel): Future[Panel] =
    ctx.withUserContext(panel.ownerId.value)(table += domainToRow(panel))
      .map(_ => panel)

  /** Privileged update: uses withSystemContext because PanelService has confirmed
   *  ownership before calling this. The V36 RLS UPDATE policy (dashboard ACL)
   *  would also permit this, but withSystemContext avoids the extra predicate. */
  def updateTitle(id: PanelId, title: String, lastUpdated: Instant): Future[Option[Panel]] =
    ctx.withSystemContext(
      table
        .filter(_.id === id.value)
        .map(r => (r.title, r.lastUpdated))
        .update((title, lastUpdated))
        .andThen(table.filter(_.id === id.value).result.headOption)
    ).map(_.map(rowToDomain))

  /** Privileged delete: uses withSystemContext because PanelService has confirmed
   *  ownership before calling this. The V36 RLS DELETE policy (owner's dashboard
   *  only) would enforce the same rule on the app pool. */
  def delete(id: PanelId): Future[Boolean] =
    ctx.withSystemContext(table.filter(_.id === id.value).delete).map(_ > 0)

  /** Privileged appearance update: uses withSystemContext because PanelService
   *  has confirmed ownership before calling this. The V36 RLS UPDATE policy
   *  (dashboard ACL) would also permit this on the app pool. */
  def updateAppearance(id: PanelId, appearance: PanelAppearance, lastUpdated: Instant): Future[Option[Panel]] =
    ctx.withSystemContext(
      table
        .filter(_.id === id.value)
        .map(r => (r.appearance, r.lastUpdated))
        .update((appearance, lastUpdated))
        .andThen(table.filter(_.id === id.value).result.headOption)
    ).map(_.map(rowToDomain))

  /** Persist the typed config of the supplied panel — writes every config
   *  column derived from the panel's subtype, leaving identity / metadata
   *  columns (title, appearance, type) untouched except for `lastUpdated`.
   *
   *  Used by `PanelPatchApplier` after `PanelConfigCodec.applyConfigPatch`
   *  produces an updated typed Panel from a wire-shape patch.
   *
   *  Privileged update: uses withSystemContext because PanelService has confirmed
   *  ownership before calling this. The V36 RLS UPDATE policy (dashboard ACL)
   *  would also permit this on the app pool. */
  def replace(panel: Panel, lastUpdated: Instant): Future[Option[Panel]] = {
    val row = domainToRow(panel)
    val updated = row.copy(lastUpdated = lastUpdated)
    ctx.withSystemContext(
      table
        .filter(_.id === panel.id.value)
        .map(r => (configColumnsOf(r), r.lastUpdated))
        .update((configColumnValuesOf(updated), lastUpdated))
        .andThen(table.filter(_.id === panel.id.value).result.headOption)
    ).map(_.map(rowToDomain))
  }

  // HEL-904 task 4.1: `existsBoundToType` removed outright -- no panel can
  // carry a `dataTypeId` binding anymore (Text/Markdown's data-bound
  // "Source mode" was removed in the same task), so the method had zero
  // remaining callers.
}

object PanelRepository {
  implicit val instantColumnType: BaseColumnType[Instant] =
    MappedColumnType.base[Instant, java.sql.Timestamp](
      instant => java.sql.Timestamp.from(instant),
      ts      => ts.toInstant
    )

  /** Maps Scala String ↔ PostgreSQL JSONB. Used for Option[String] JSONB columns
   *  (e.g. field_mapping) where the column type stays String. */
  implicit val jsonbStringType: BaseColumnType[String] =
    MappedColumnType.base[String, String](s => s, s => s)

  // Bring PanelAppearance Spray JSON formatter into scope.
  private val proto = new PanelProtocol {}
  import proto._

  implicit val panelAppearanceColumnType: BaseColumnType[PanelAppearance] =
    MappedColumnType.base[PanelAppearance, String](
      _.toJson.compactPrint,
      _.parseJson.convertTo[PanelAppearance]
    )

  /** Single source of truth for "the typed-config columns" — every column a
   *  panel subtype's config can populate via `PanelRowMapper.domainToRow`.
   *  Both `PanelRepository.replace` and `PanelMutationOps.batchUpdate`'s
   *  config-patch branch write back this exact set so the two paths cannot
   *  silently diverge when a new config column is added (HEL-296).
   *
   *  HEL-904 task 2.10: shrunk to the surviving literal-content/media
   *  columns only — `type_id`/`field_mapping`/`aggregation`/`metric_*`/
   *  `chart_options`/`collection_options`/`timeline_options`/
   *  `column_widths`/`table_density`/`column_order`/`chart_annotation` were
   *  dropped from `panels` (V94), and none of them were ever populated by
   *  `PanelRowMapper.domainToRow` post-collapse anyway (always written as
   *  `None`). */
  def configColumnsOf(r: PanelTable): (
      Rep[Option[String]],
      Rep[Option[String]],
      Rep[Option[String]],
      Rep[Option[Int]],
      Rep[Option[String]],
      Rep[Option[String]]
  ) =
    (r.content, r.imageUrl, r.imageFit, r.dividerWeight, r.dividerOrientation, r.dividerColor)

  def configColumnValuesOf(row: PanelRow): (
      Option[String],
      Option[String],
      Option[String],
      Option[Int],
      Option[String],
      Option[String]
  ) =
    (row.content, row.imageUrl, row.imageFit, row.dividerWeight, row.dividerOrientation, row.dividerColor)

  case class PanelRow(
      id: String,
      dashboardId: String,
      title: String,
      createdBy: String,
      createdAt: Instant,
      lastUpdated: Instant,
      appearance: PanelAppearance,
      ownerId: UUID,
      content: Option[String],
      imageUrl: Option[String],
      imageFit: Option[String],
      dividerOrientation: Option[String],
      dividerWeight: Option[Int],
      dividerColor: Option[String],
      imageCaption: Option[String],
      // The placement's Output binding (`panels.output_id`, added by V94 §4
      // — nullable FK; set only for `kind = 'output'` rows).
      outputId: Option[String] = None,
      // HEL-904 task 2.10: `panels.kind` (`output | text | markdown | image |
      // divider`) is now the sole subtype discriminator (`type`/`type_id`
      // dropped) and NOT NULL — every write sets it via
      // `PanelRowMapper.domainToRow`.
      kind: String
  )

  class PanelTable(tag: Tag) extends Table[PanelRow](tag, "panels") {
    def id           = column[String]("id", O.PrimaryKey)
    def dashboardId  = column[String]("dashboard_id")
    def title        = column[String]("title")
    def createdBy    = column[String]("created_by")
    def createdAt    = column[Instant]("created_at")
    def lastUpdated  = column[Instant]("last_updated")
    def appearance   = column[PanelAppearance]("appearance")
    def ownerId      = column[UUID]("owner_id")
    def content      = column[Option[String]]("content")
    def imageUrl            = column[Option[String]]("image_url")
    def imageFit            = column[Option[String]]("image_fit")
    def dividerOrientation  = column[Option[String]]("divider_orientation")
    def dividerWeight       = column[Option[Int]]("divider_weight")
    def dividerColor        = column[Option[String]]("divider_color")
    def imageCaption        = column[Option[String]]("image_caption")
    def outputId            = column[Option[String]]("output_id")
    def kind                = column[String]("kind")

    def * =
      (id :: dashboardId :: title :: createdBy :: createdAt :: lastUpdated :: appearance ::
        ownerId :: content :: imageUrl :: imageFit :: dividerOrientation :: dividerWeight ::
        dividerColor :: imageCaption :: outputId :: kind :: HNil).mapTo[PanelRow]
  }
}
