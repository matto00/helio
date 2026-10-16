package com.helio.infrastructure.persistence.dashboards

import com.helio.domain.model.{DashboardChange, DashboardOutputChange, UserId}
import com.helio.infrastructure.persistence.DbContext
import slick.jdbc.PostgresProfile.api._
import slick.jdbc.SetParameter

import java.sql.{Timestamp, Types}
import scala.concurrent.{ExecutionContext, Future}

/** The two read queries behind `GET /api/dashboard-changes` (HEL-1575). Both run in the caller's user context
 *  (`withUserContext`, the NOBYPASSRLS app pool), so a dashboard, panel, Output or history row the caller cannot read is
 *  simply absent: there is no 403/404 oracle for an id that is not theirs.
 *
 *  The data query is shaped so that the cost is one index probe per distinct bound Output, never a walk of history:
 *  the inner join to `outputs` applies `outputs_select` (the pipeline-access check) once per Output first, and only the
 *  surviving Outputs reach the LATERAL `LIMIT 1` probe of the `(output_id, captured_at DESC)` index. */
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
                WHERE p.dashboard_id = ANY($ids)) o
          LEFT JOIN LATERAL (SELECT captured_at FROM output_snapshot_history
                             WHERE output_id = o.output_id
                             ORDER BY captured_at DESC LIMIT 1) h ON true""".as[(String, String, Option[Timestamp])]

  /** One entry per requested dashboard the caller can read, in the order of `ids`. */
  def changes(userId: UserId, ids: Vector[String]): Future[Vector[DashboardChange]] =
    ctx.withUserContext(userId.value)(contentQuery(ids).zip(dataQuery(ids))).map { case (content, data) =>
      val outputsByDashboard = data.groupBy(_._1)
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
