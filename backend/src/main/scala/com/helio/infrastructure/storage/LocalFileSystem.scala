package com.helio.infrastructure.storage

import java.io.IOException
import java.nio.file.{Files, Path, Paths, StandardCopyOption}
import org.slf4j.LoggerFactory
import scala.concurrent.{ExecutionContext, Future, blocking}
import scala.jdk.CollectionConverters._
import scala.util.control.NonFatal

class LocalFileSystem(baseDir: Path)(implicit ec: ExecutionContext) extends FileSystem {

  Files.createDirectories(baseDir)

  /** HEL-881 design.md Decision 4: writes atomically — stage into a temp file
   *  in the SAME DIRECTORY as `target`, then `Files.move` with `ATOMIC_MOVE`.
   *  Same-directory placement is load-bearing: `ATOMIC_MOVE` only holds
   *  within a single filesystem, so a temp file under `/tmp` (or any other
   *  mount) would silently degrade to a copy, leaving the exact torn-read
   *  hazard this exists to close while the code claimed otherwise. This
   *  matters now that the pipeline engine's `image` run-path (a NEW, frequent
   *  caller) writes fetched bytes back to storage on every run rather than
   *  only on a user-initiated refresh — but it is a strict improvement for
   *  every pre-existing caller too (image uploads, data-source writes, the
   *  assistant transcript's write-then-record ordering), not a cost paid for
   *  the image case alone. The temp file is deleted on any failure so a
   *  failed write never litters the uploads tree. */
  def write(path: String, bytes: Array[Byte]): Future[Unit] = Future {
    blocking {
      val target = resolve(path)
      Files.createDirectories(target.getParent)
      val tmp = Files.createTempFile(target.getParent, "." + target.getFileName.toString + ".", ".tmp")
      try {
        Files.write(tmp, bytes)
        Files.move(tmp, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        ()
      } catch {
        case NonFatal(e) =>
          Files.deleteIfExists(tmp)
          throw e
      }
    }
  }

  def read(path: String): Future[Array[Byte]] = Future {
    blocking {
      Files.readAllBytes(resolve(path))
    }
  }

  def delete(path: String): Future[Unit] = Future {
    blocking {
      Files.deleteIfExists(resolve(path))
      ()
    }
  }

  def exists(path: String): Future[Boolean] = Future {
    blocking {
      Files.exists(resolve(path))
    }
  }

  def list(prefix: String, cursor: Option[String] = None, pageSize: Int = 1000): Future[ListPage] = Future {
    blocking {
      val root = resolve(prefix)
      if (!Files.exists(root)) {
        ListPage(Seq.empty, None)
      } else if (Files.isDirectory(root)) {
        val offset = cursor.map(_.toInt).getOrElse(0)
        val allNames = Files
          .walk(root)
          .filter(p => !Files.isDirectory(p))
          .iterator()
          .asScala
          .map(p => baseDir.relativize(p).toString)
          .toSeq
          .sorted
        val page = allNames.slice(offset, offset + pageSize)
        val nextCursor =
          if (offset + pageSize < allNames.size) Some((offset + pageSize).toString)
          else None
        ListPage(page, nextCursor)
      } else {
        if (cursor.isDefined) {
          ListPage(Seq.empty, None)
        } else {
          ListPage(Seq(baseDir.relativize(root).toString), None)
        }
      }
    }
  }

  private def resolve(path: String): Path =
    baseDir.resolve(path).normalize()
}

object LocalFileSystem {

  private val log = LoggerFactory.getLogger(getClass)

  /** Resolves the uploads root deterministically regardless of JVM working directory.
    *
    * Resolution order:
    *   1. `HELIO_UPLOADS_ROOT` env var (primary)
    *   2. `HELIO_UPLOADS_DIR` env var (backward-compat alias)
    *   3. `~/.helio/uploads` (home-rooted default)
    *
    * The resolved path is normalised to an absolute path, the directory tree is created if
    * absent, and writability is validated at startup. An `IllegalStateException` is thrown on
    * any fatal condition so the server fails fast rather than silently misdirecting uploads.
    *
    * When the default path is used, a one-time WARN is emitted if the legacy cwd-relative
    * directory (`./data/uploads`) exists and contains files — prompting the developer to set
    * `HELIO_UPLOADS_ROOT` or move the files.
    */
  def fromEnv()(implicit ec: ExecutionContext): LocalFileSystem = {
    val (rawPath, usingDefault) = sys.env
      .get("HELIO_UPLOADS_ROOT")
      .orElse(sys.env.get("HELIO_UPLOADS_DIR"))
      .map(p => (p, false))
      .getOrElse((s"${System.getProperty("user.home")}/.helio/uploads", true))

    val resolved = Paths.get(rawPath).toAbsolutePath.normalize()

    if (!resolved.isAbsolute)
      throw new IllegalStateException(
        s"Uploads root resolved to a non-absolute path: $resolved"
      )

    try {
      Files.createDirectories(resolved)
    } catch {
      case e: IOException =>
        throw new IllegalStateException(
          s"Cannot create uploads directory at $resolved: ${e.getMessage}",
          e
        )
    }

    if (!Files.isWritable(resolved))
      throw new IllegalStateException(
        s"Uploads directory is not writable: $resolved"
      )

    if (usingDefault)
      warnIfLegacyUploadsPresent(resolved)

    log.info("Uploads root: {}", resolved)
    new LocalFileSystem(resolved)
  }

  /** Emits a WARN if the legacy cwd-relative uploads dir exists and is non-empty. */
  private def warnIfLegacyUploadsPresent(defaultRoot: Path): Unit = {
    val legacyPath = Paths.get(System.getProperty("user.dir"), "data", "uploads")
    if (Files.exists(legacyPath) && Files.isDirectory(legacyPath)) {
      val hasFiles = Files
        .walk(legacyPath)
        .filter(p => Files.isRegularFile(p))
        .findFirst()
        .isPresent
      if (hasFiles) {
        log.warn(
          "Legacy uploads detected at {}. " +
            "Set HELIO_UPLOADS_ROOT={} to keep using it, or move files to {}. " +
            "Files will NOT be moved automatically.",
          legacyPath,
          legacyPath,
          defaultRoot
        )
      }
    }
  }
}
