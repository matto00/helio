package com.helio.app

import org.slf4j.Logger
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import scala.concurrent.{ExecutionContext, Future}

/** Boot-time integrity check: log a WARNING for each `data_sources` row that
 *  has no matching `data_types` row linked back via `source_id`. These
 *  "orphaned" sources render an empty schema on the Sources page, breaking
 *  the upload-and-trust promise (HEL-256).
 *
 *  Defense-in-depth: the cycle-2 primary fixes (B′ + D) close the trigger
 *  and add a recovery primitive respectively, but historical drift already
 *  exists in dev / prod DBs. This check surfaces those rows so operators can
 *  trigger a refresh (`POST /api/data-sources/:id/refresh`) per-source.
 */
object SourceSchemaHealthCheck {

  final case class OrphanSource(
      id:       String,
      name:     String,
      ownerId:  Option[String],
      kind:     String
  )

  /** Query for sources without a linked DataType. Owner-agnostic — the boot
   *  context isn't user-scoped. Result is small (typically zero rows in a
   *  healthy DB), so a single round-trip is fine. */
  def findOrphans(db: JdbcBackend.Database)(implicit ec: ExecutionContext): Future[Vector[OrphanSource]] = {
    val query =
      sql"""
        SELECT ds.id, ds.name, ds.owner_id::text, ds.source_type
        FROM data_sources ds
        LEFT JOIN data_types dt
          ON dt.source_id = ds.id
        WHERE dt.id IS NULL
        ORDER BY ds.created_at
      """.as[(String, String, Option[String], String)]
    db.run(query).map(_.map { case (id, name, owner, kind) =>
      OrphanSource(id, name, owner, kind)
    }.toVector)
  }

  /** Run the check and emit one WARN per orphan with an actionable suggestion. */
  def run(db: JdbcBackend.Database, logger: Logger)(implicit ec: ExecutionContext): Future[Vector[OrphanSource]] =
    findOrphans(db).map { orphans =>
      if (orphans.isEmpty) {
        logger.info("SourceSchemaHealthCheck: all data sources have a linked DataType.")
      } else {
        logger.warn(
          "SourceSchemaHealthCheck: found {} data source(s) with no linked DataType. " +
          "These sources will render an empty schema on the Sources page until refreshed.",
          orphans.size
        )
        orphans.foreach { o =>
          logger.warn(
            "  orphan source id={} name='{}' owner={} kind={} — heal via POST /api/data-sources/{}/refresh",
            o.id, o.name, o.ownerId.getOrElse("<none>"), o.kind, o.id
          )
        }
      }
      orphans
    }
}
