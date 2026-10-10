package com.helio.testkit

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres

import java.nio.file.{Files, Path, Paths}
import java.util.Comparator
import scala.collection.mutable.ListBuffer
import scala.jdk.CollectionConverters._
import scala.util.control.NonFatal

/** HEL-1445: the one place a backend test starts embedded Postgres.
 *
 *  zonky's `Builder.start()` picks a free port, closes the probe socket, and only then starts the
 *  postmaster, so a concurrent instance can take the port in between. A postmaster that loses the
 *  port dies, zonky ignores `pg_ctl`'s exit status, and its readiness check only polls the port, so
 *  the instance silently adopts whichever other cluster listens there. This helper gives every
 *  attempt its own data directory, asks the server it reached for its `data_directory`, and only
 *  hands the instance back when that is its own. Anything else is discarded (our own data directory
 *  only, never the foreign cluster) and retried on a fresh port, a bounded number of times.
 *  `EmbeddedPostgresStartGuardSpec` rejects any start that bypasses this object.
 */
object VerifiedEmbeddedPostgres {

  private val MaxAttempts = 5

  /** Starts the builder's embedded Postgres and verifies it reached its own cluster.
   *  The builder is by-name because zonky's `start()` mutates it (port and data directory), so each
   *  attempt must evaluate a fresh one. */
  def start(builder: => EmbeddedPostgres.Builder): EmbeddedPostgres =
    startWith(builder, MaxAttempts, () => 0, showDataDirectory)

  /** The data directory the server behind `pg` reports, over the superuser connection. The
   *  connection is closed on every path. */
  private[testkit] def showDataDirectory(pg: EmbeddedPostgres): String = {
    val connection = pg.getPostgresDatabase.getConnection
    try {
      val rs = connection.createStatement().executeQuery("SHOW data_directory")
      rs.next()
      rs.getString(1)
    } finally connection.close()
  }

  /** `nextPort` supplies the port for attempts after the first (0 = let zonky detect a fresh one). */
  private[testkit] def startWith(
      builder: => EmbeddedPostgres.Builder,
      maxAttempts: Int,
      nextPort: () => Int,
      observeDataDirectory: EmbeddedPostgres => String
  ): EmbeddedPostgres = {
    val log = ListBuffer.empty[String]
    var attempt = 1
    while (attempt <= maxAttempts) {
      // temp-dir-hygiene: reviewed — same call and lifecycle as zonky's own default; close() deletes it, and a discarded attempt is deleted below
      val dir      = Files.createTempDirectory("epg")
      val realDir  = dir.toRealPath()
      val plainDir = dir.toAbsolutePath.normalize()
      val configured = builder.setDataDirectory(dir)
      val b          = if (attempt > 1) configured.setPort(nextPort()) else configured
      val pg =
        try b.start()
        catch { case t: Throwable => deleteQuietly(dir); throw t }

      val outcome: Either[String, Unit] =
        try {
          val reported = Paths.get(observeDataDirectory(pg)).toAbsolutePath.normalize()
          if (reported == realDir || reported == plainDir) Right(())
          else Left(s"attempt $attempt on port ${pg.getPort}: expected data_directory $realDir but the server reported $reported")
        } catch {
          case NonFatal(e) =>
            Left(s"attempt $attempt on port ${pg.getPort}: expected data_directory $realDir but the ownership check failed: $e")
        }

      outcome match {
        case Right(()) => return pg
        case Left(why) =>
          log += why
          // close() runs `pg_ctl -D <our own dir> stop` (never by port), so the foreign cluster is not addressed.
          try pg.close()
          catch { case NonFatal(e) => log += s"attempt $attempt: closing the discarded instance failed: $e" }
          deleteQuietly(dir)
      }
      attempt += 1
    }
    throw new IllegalStateException(
      s"Embedded Postgres did not start on its own cluster after $maxAttempts attempt(s):\n${log.mkString("\n")}"
    )
  }

  private def deleteQuietly(dir: Path): Unit =
    try {
      if (Files.exists(dir)) {
        val stream = Files.walk(dir)
        try stream.sorted(Comparator.reverseOrder[Path]()).iterator().asScala.foreach(p => Files.deleteIfExists(p))
        finally stream.close()
      }
    } catch { case NonFatal(_) => () }
}
