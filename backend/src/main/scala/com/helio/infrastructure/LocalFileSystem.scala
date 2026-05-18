package com.helio.infrastructure

import java.io.IOException
import java.nio.file.{Files, Path, Paths}
import org.slf4j.LoggerFactory
import scala.concurrent.{ExecutionContext, Future, blocking}
import scala.jdk.CollectionConverters._

class LocalFileSystem(baseDir: Path)(implicit ec: ExecutionContext) extends FileSystem {

  Files.createDirectories(baseDir)

  def write(path: String, bytes: Array[Byte]): Future[Unit] = Future {
    blocking {
      val target = resolve(path)
      Files.createDirectories(target.getParent)
      Files.write(target, bytes)
      ()
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

  def list(prefix: String): Future[Seq[String]] = Future {
    blocking {
      val root = resolve(prefix)
      if (!Files.exists(root)) {
        Seq.empty
      } else if (Files.isDirectory(root)) {
        Files
          .walk(root)
          .filter(p => !Files.isDirectory(p))
          .iterator()
          .asScala
          .map(p => baseDir.relativize(p).toString)
          .toSeq
      } else {
        // prefix points to a file directly
        Seq(baseDir.relativize(root).toString)
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
