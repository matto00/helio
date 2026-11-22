package com.helio.infrastructure.storage

import com.helio.testkit.TempDirectorySupport
import org.scalatest.wordspec.AnyWordSpec

import java.nio.file.{Files, Path, Paths}
import java.util.{Comparator, Map => JMap}
import org.scalatest.matchers.should.Matchers
import scala.concurrent.ExecutionContext

/** `LocalFileSystem.fromEnv` and its env-mutation helpers, split out of `LocalFileSystemSpec` (HEL-1817) with the
 *  tests unchanged. */
class LocalFileSystemFromEnvSpec extends AnyWordSpec with Matchers with TempDirectorySupport {

  implicit val ec: ExecutionContext = ExecutionContext.global

  "LocalFileSystem.fromEnv" should {

    "use HELIO_UPLOADS_ROOT when set to an absolute path" in {
      val dir = newTempDir("helio-from-env-abs")
      withEnv("HELIO_UPLOADS_ROOT" -> dir.toString) {
        val result = LocalFileSystem.fromEnv()
        assert(result.baseDir == dir.toAbsolutePath.normalize())
      }
    }

    "resolve a relative HELIO_UPLOADS_ROOT to an absolute path" in {
      withEnv("HELIO_UPLOADS_ROOT" -> "relative/path/test") {
        val result = LocalFileSystem.fromEnv()
        assert(result.baseDir.isAbsolute)
        assert(result.baseDir.toString.endsWith("relative/path/test"))
        deleteRecursively(result.baseDir)
      }
    }

    "default to ~/.helio/uploads when neither env var is set" in {
      withoutEnv("HELIO_UPLOADS_ROOT", "HELIO_UPLOADS_DIR") {
        val expected = Paths.get(System.getProperty("user.home"), ".helio", "uploads").normalize()
        val result   = LocalFileSystem.fromEnv()
        assert(result.baseDir == expected)
      }
    }

    "create the directory tree when the path does not yet exist" in {
      val base   = newTempDir("helio-from-env-create")
      val newDir = base.resolve("nested/subdir")
      withEnv("HELIO_UPLOADS_ROOT" -> newDir.toString) {
        val result = LocalFileSystem.fromEnv()
        assert(Files.isDirectory(result.baseDir))
      }
    }

    "honour the backward-compat HELIO_UPLOADS_DIR alias" in {
      val dir = newTempDir("helio-from-env-compat")
      withoutEnv("HELIO_UPLOADS_ROOT") {
        withEnv("HELIO_UPLOADS_DIR" -> dir.toString) {
          val result = LocalFileSystem.fromEnv()
          assert(result.baseDir == dir.toAbsolutePath.normalize())
        }
      }
    }
  }

  /** Expose baseDir for test assertions without touching production API surface. */
  implicit class LocalFileSystemTestOps(fs: LocalFileSystem) {
    def baseDir: Path = {
      val f = fs.getClass.getDeclaredField("baseDir")
      f.setAccessible(true)
      f.get(fs).asInstanceOf[Path]
    }
  }

  private def withEnv(pairs: (String, String)*)(block: => Unit): Unit = {
    val saved = pairs.map { case (k, _) => k -> sys.env.get(k) }
    pairs.foreach { case (k, v) => setEnv(k, v) }
    try block
    finally saved.foreach { case (k, prev) =>
      prev.fold(unsetEnv(k))(setEnv(k, _))
    }
  }

  private def withoutEnv(keys: String*)(block: => Unit): Unit = {
    val saved = keys.map(k => k -> sys.env.get(k))
    keys.foreach(unsetEnv)
    try block
    finally saved.foreach { case (k, prev) =>
      prev.fold(())(setEnv(k, _))
    }
  }

  @SuppressWarnings(Array("org.wartremover.warts.AsInstanceOf"))
  private def setEnv(key: String, value: String): Unit = {
    val envField = System.getenv().getClass.getDeclaredField("m")
    envField.setAccessible(true)
    envField
      .get(System.getenv())
      .asInstanceOf[JMap[String, String]]
      .put(key, value)
  }

  @SuppressWarnings(Array("org.wartremover.warts.AsInstanceOf"))
  private def unsetEnv(key: String): Unit = {
    val envField = System.getenv().getClass.getDeclaredField("m")
    envField.setAccessible(true)
    envField
      .get(System.getenv())
      .asInstanceOf[JMap[String, String]]
      .remove(key)
  }

  private def deleteRecursively(path: Path): Unit =
    if (Files.exists(path)) {
      Files
        .walk(path)
        .sorted(Comparator.reverseOrder[Path]())
        .forEach(Files.delete)
    }
}
