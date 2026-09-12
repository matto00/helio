package com.helio.testkit

import org.scalatest.{BeforeAndAfterAll, Suite}

import java.nio.file.{Files, Path}
import java.util.Comparator
import scala.jdk.CollectionConverters._

/** Shared temp-file/dir lifecycle for backend specs (HEL-1120). Every test that needs a scratch
 *  directory or file routes through [[newTempDir]]/[[newTempFile]] instead of calling
 *  `java.nio.file.Files.createTempDirectory`/`createTempFile` (or `java.io.File.createTempFile`)
 *  directly — those raw calls leak into `/tmp` with no teardown, which is exactly the incident
 *  this trait exists to close (`/tmp` is a tmpfs capped at 1,048,576 inodes; it hit 100% twice on
 *  2026-09-10/11 and stalled two delivery lanes). `scripts/check-test-temp-dir-hygiene.mjs`
 *  mechanically enforces that every direct call site in `backend/src/test/scala` is either this
 *  file or carries an explicit `// temp-dir-hygiene: reviewed — <reason>` exemption.
 *
 *  `afterAll` is used (not `afterEach`) because several specs create their scratch directory once
 *  at class-field-init time, before any test runs — `afterEach` cannot reach that lifetime, but
 *  `afterAll` always fires after every test (and every per-test `finally`) in the class has run.
 */
trait TempDirectorySupport extends BeforeAndAfterAll { self: Suite =>

  private val registered = scala.collection.mutable.Buffer.empty[Path]

  /** Creates a new temp directory via `Files.createTempDirectory` and registers it for deletion
   *  in `afterAll`. */
  def newTempDir(prefix: String): Path = {
    val dir = Files.createTempDirectory(prefix)
    registered.synchronized(registered += dir)
    dir
  }

  /** Creates a new temp file via `Files.createTempFile` and registers it for deletion in
   *  `afterAll`. */
  def newTempFile(prefix: String, suffix: String): Path = {
    val file = Files.createTempFile(prefix, suffix)
    registered.synchronized(registered += file)
    file
  }

  /** Deletes a path (recursively, if a directory) and returns any exception raised, without
   *  throwing — callers collect these across every registered entry so one failure never stops
   *  the rest from being attempted. */
  private def tryDelete(path: Path): Option[Throwable] =
    try {
      if (Files.exists(path)) {
        // Deepest-first so a directory is empty by the time its own delete runs.
        Files
          .walk(path)
          .sorted(Comparator.reverseOrder[Path]())
          .iterator()
          .asScala
          .foreach(Files.delete)
      }
      None
    } catch {
      case e: Throwable => Some(e)
    }

  /** Deletes every registered temp path, collecting (never swallowing) delete failures. A
   *  chmod-locked-down tree left non-writable by a test whose own permission-restore `finally`
   *  didn't run must surface as a real `afterAll` failure here, not disappear behind a logged-and-
   *  ignored line — that silent-swallow was the design-gate skeptic's load-bearing correction to
   *  this trait's first draft, which would have re-created the exact leak this ticket closes. */
  abstract override def afterAll(): Unit =
    try {
      val failures = registered.synchronized(registered.toList).flatMap(tryDelete)
      if (failures.nonEmpty) {
        val summary = failures.map(_.getMessage).mkString("; ")
        throw new RuntimeException(
          s"TempDirectorySupport.afterAll: failed to delete ${failures.size} temp path(s): $summary",
          failures.head
        )
      }
    } finally {
      super.afterAll()
    }
}
