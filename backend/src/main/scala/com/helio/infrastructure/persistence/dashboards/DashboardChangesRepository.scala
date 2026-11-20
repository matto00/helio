package com.helio.infrastructure.persistence.dashboards

import com.helio.domain.model.{DashboardChange, DashboardOutputChange, UserId}
import com.helio.infrastructure.persistence.DbContext
import slick.jdbc.PostgresProfile.api._
import slick.jdbc.SetParameter

import java.sql.{Timestamp, Types}
import scala.concurrent.{ExecutionContext, Future}

/** The two read queries behind `GET /api/dashboard-changes` (HEL-1575, HEL-1783). They run in two steps.
 *
 *  1. The content query runs in the caller's user context (`withUserContext`, the NOBYPASSRLS app pool), so a dashboard the
 *     caller cannot read is simply absent: there is no 403/404 oracle for an id that is not theirs. Its result is the set of
 *     dashboards the caller can read (an owner, or a dashboard grantee of any role).
 *  2. The data query runs in system context (`withSystemContext`) for exactly that set, never for the requested ids. A
 *     dashboard-only grantee cannot read `outputs` or `output_snapshot_history` (they follow pipeline access), so under their
 *     own context the data times of a shared dashboard would always be empty (HEL-1783). What it reports is limited to what
 *     the same caller's panel list for that dashboard and the per-panel `history` / `panel-status` routes already give them:
 *     each Output id is a panel's `config.outputId` (output-kind panels only, as the panel list returns it) and each time is
 *     the newest `captured_at`. No other column is read.
 *
 *  The data query is shaped so that the cost is one index probe per distinct bound Output, never a walk of history:
 *  the inner join to `outputs` only drops a panel bound to a deleted Output, and the surviving Outputs reach the LATERAL
 *  `LIMIT 1` probe of the `(output_id, captured_at DESC)` index. */
class DashboardChangesRepository(ctx: DbContext)(implicit ec: ExecutionContext) {

  private implicit val setTextArray: SetParameter[Seq[String]] = SetParameter { (v, pp) =>
    pp.setObject(pp.ps.getConnection.createArrayOf("text", v.toArray[AnyRef]), Types.ARRAY)
  }

  private def contentQuery(ids: Seq[String]) =
    sql"""SELECT d.id,
                 GREATEST(d.last_updated, (SELECT MAX(p.last_updated) FROM panels p WHERE p.dashboard_id = d.id))
          FROM dashboards d
          WHERE d.id = ANY($ids)""".as[(String, Timestamp)]

  private def dataQuery(ids: Seq[String]) =
    sql"""SELECT o.dashboard_id, o.output_id, h.captured_at
          FROM (SELECT DISTINCT p.dashboard_id, p.output_id
                FROM panels p
                JOIN outputs ot ON ot.id = p.output_id
                WHERE p.dashboard_id = ANY($ids) AND p.kind = 'output') o
          LEFT JOIN LATERAL (SELECT captured_at FROM output_snapshot_history
                             WHERE output_id = o.output_id
                             ORDER BY captured_at DESC LIMIT 1) h ON true""".as[(String, String, Option[Timestamp])]

  /** One entry per requested dashboard the caller can read, in the order of `ids`. */
  def changes(userId: UserId, ids: Vector[String]): Future[Vector[DashboardChange]] =
    ctx.withUserContext(userId.value)(contentQuery(ids)).flatMap { content =>
      val readable = content.map(_._1).distinct
      // System context, deliberately: bypass is correct here because `readable` is the set the caller's own RLS context just
      // returned (so the caller may read each of these dashboards), the query reads only (dashboard id, bound output id, newest
      // captured_at), and every output id it can return is a `config.outputId` the caller's panel list for that dashboard
      // already returns. A dashboard grant does not carry the Output/pipeline grant that `outputs_select` requires.
      val data =
        if (readable.isEmpty) Future.successful(Vector.empty[(String, String, Option[Timestamp])])
        else ctx.withSystemContext(dataQuery(readable))
      data.map { rows =>
        val outputsByDashboard = rows.groupBy(_._1)
        val contentById        = content.toMap
        ids.distinct.flatMap { id =>
          contentById.get(id).map { updated =>
            val outputs = outputsByDashboard
              .getOrElse(id, Vector.empty)
              .map { case (_, outputId, captured) => DashboardOutputChange(outputId, captured.map(_.toInstant)) }
              .sortBy(_.outputId)
            DashboardChange(id, updated.toInstant, outputs.flatMap(_.dataUpdatedAt).maxOption, outputs)
          }
        }
      }
    }
}
