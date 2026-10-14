package com.helio.testkit

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres

import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path, Paths}
import java.time.Duration
import java.util.Comparator
import java.util.concurrent.TimeUnit
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
 *  HEL-1586: a `start()` that throws after zonky launched the postmaster (zonky never returns the instance, so it
 *  cannot be closed) is cleaned up here: the server on this attempt's own data directory is stopped with
 *  `pg_ctl -D <dir> stop -m immediate` (resolved from that directory's `postmaster.opts`; never by port, process
 *  name or PID search) and confirmed with `pg_ctl -D <dir> status`, and only then is the directory deleted. If the
 *  stop cannot be confirmed the directory is kept and the reason is added as a suppressed exception.
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

  /** One attempt's data directory: same call and lifecycle as zonky's own default. */
  private def newTempDirectory(): Path =
    Files.createTempDirectory("epg") // temp-dir-hygiene: reviewed — close() deletes it, and a discarded or failed attempt is deleted below

  /** `nextPort` supplies the port for attempts after the first (0 = let zonky detect a fresh one).
   *  `newDataDirectory` is a test seam for observing the directory an attempt owns. */
  private[testkit] def startWith(
      builder: => EmbeddedPostgres.Builder,
      maxAttempts: Int,
      nextPort: () => Int,
      observeDataDirectory: EmbeddedPostgres => String,
      newDataDirectory: () => Path = () => newTempDirectory(),
      afterLibraryStart: EmbeddedPostgres => Unit = _ => (),
      postLaunchWait: Duration = Duration.ofSeconds(30)
  ): EmbeddedPostgres = {
    val log = ListBuffer.empty[String]
    var attempt = 1
    while (attempt <= maxAttempts) {
      val dir      = newDataDirectory()
      val realDir  = dir.toRealPath()
      val plainDir = dir.toAbsolutePath.normalize()
      val configured = builder.setDataDirectory(dir)
      val b          = if (attempt > 1) configured.setPort(nextPort()) else configured
      val pg =
        try { val started = b.start(); afterLibraryStart(started); started }
        catch { case t: Throwable => cleanUpFailedStart(dir, postLaunchWait, t); throw t }

      val outcome: Either[String, Unit] =
        try {
          val reported = Paths.get(observeDataDirectory(pg)).toAbsolutePath.normalize()
          if (reported == realDir || reported == plainDir) Right(())
          else Left(s"attempt $attempt on port ${pg.getPort}: expected data_directory $realDir but the server reported $reported")
        } catch {
          case NonFatal(e) =>
            Left(s"attempt $attempt on port ${pg.getPort}: expected data_directory $realDir but the ownership check failed: $e")
          case fatal: Throwable =>
            // A fatal throwable (e.g. an interruption) must not be swallowed or retried, but it must not leak this
            // attempt's postmaster or data directory either: clean up, then rethrow the same throwable.
            try pg.close()
            catch { case t: Throwable => fatal.addSuppressed(t) }
            deleteQuietly(dir)
            throw fatal
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

  /** HEL-1586: a start that throws may still have launched a postmaster (zonky 2.0.7 runs `pg_ctl start` at
   *  EmbeddedPostgres.java:275, then can throw at :335, and the caller never gets the instance to close). Stops any
   *  server running on THIS attempt's own data directory with `pg_ctl -D <dir>` (never by port, name or PID search),
   *  then deletes the directory. If the stop cannot be confirmed the directory is kept and a suppressed
   *  `IllegalStateException` on `original` says so; `original` itself is never replaced. */
  private def cleanUpFailedStart(dir: Path, wait: Duration, original: Throwable): Unit = {
    var interrupted = false
    def sleep(ms: Long): Unit =
      try Thread.sleep(ms)
      catch { case _: InterruptedException => interrupted = true }
    try {
      val lockFile = dir.resolve("epg-lock")
      val opts     = dir.resolve("postmaster.opts")
      val pidFile  = dir.resolve("postmaster.pid")
      if (!Files.exists(lockFile)) deleteQuietly(dir) // initdb-time failure: the constructor never reached the launch
      else {
        val deadline = System.nanoTime() + wait.toNanos
        while (!interrupted && !Files.exists(opts) && System.nanoTime() < deadline) sleep(100)
        if (Files.exists(opts)) {
          val outcome = stopByDirectory(dir, opts, () => interrupted = true)
          if (outcome.isEmpty) deleteQuietly(dir)
          else original.addSuppressed(unconfirmed(dir, outcome.get))
        } else if (!Files.exists(pidFile)) deleteQuietly(dir) // no server on the dir; a later launch cannot run on a deleted dir
        else original.addSuppressed(unconfirmed(dir, "postmaster.pid present but postmaster.opts never appeared within " + wait))
      }
    } catch {
      case NonFatal(e) => original.addSuppressed(unconfirmed(dir, s"cleanup itself failed: $e"))
    } finally if (interrupted) Thread.currentThread().interrupt()
  }

  private def unconfirmed(dir: Path, why: String): IllegalStateException =
    new IllegalStateException(s"Embedded Postgres start failed and its postmaster stop could not be confirmed; data directory $dir was left in place ($why)")

  /** None = confirmed stopped; Some(reason) = cannot confirm. Addresses only `dir`. */
  private def stopByDirectory(dir: Path, opts: Path, markInterrupted: () => Unit): Option[String] = {
    val first  = new String(Files.readAllBytes(opts), StandardCharsets.UTF_8).trim
    val binary = first.takeWhile(_ != '"').trim
    val pgCtl  = Paths.get(binary).resolveSibling("pg_ctl")
    if (binary.isEmpty || !Files.isRegularFile(pgCtl) || !Files.isExecutable(pgCtl))
      Some(s"cannot resolve pg_ctl from postmaster.opts ($binary)")
    else {
      def run(args: String*): Either[String, Int] = {
        val proc = new ProcessBuilder((Seq(pgCtl.toString, "-D", dir.toString) ++ args).asJava).redirectErrorStream(true).redirectOutput(ProcessBuilder.Redirect.DISCARD).start()
        try {
          if (proc.waitFor(60, TimeUnit.SECONDS)) Right(proc.exitValue())
          else Left("pg_ctl " + args.head + " timed out")
        } catch {
          case _: InterruptedException => markInterrupted(); Left("pg_ctl " + args.head + " wait interrupted")
        } finally if (proc.isAlive) proc.destroyForcibly()
      }
      run("stop", "-m", "immediate", "-w", "-t", "30") match {
        case Left(why) => Some(why)
        case Right(stopCode) =>
          run("status") match {
            case Right(3)    => None
            case Right(code) => Some(s"pg_ctl stop exited $stopCode, then pg_ctl status exited $code (3 = no server running expected)")
            case Left(why)   => Some(why)
          }
      }
    }
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
