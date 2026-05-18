package com.helio.infrastructure

import org.scalatest.BeforeAndAfterAll
import org.scalatest.wordspec.AnyWordSpec

import java.nio.file.{Files, Path, Paths}
import java.util.{Comparator, Map => JMap}
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration._

class LocalFileSystemSpec extends AnyWordSpec with BeforeAndAfterAll {

  implicit val ec: ExecutionContext = ExecutionContext.global

  private val tempDir = Files.createTempDirectory("helio-fs-test")
  private val fs      = new LocalFileSystem(tempDir)

  private def await[A](f: Future[A]): A =
    Await.result(f, 5.seconds)

  "LocalFileSystem" should {

    "round-trip write and read" in {
      val bytes = "hello, helio".getBytes("UTF-8")
      await(fs.write("round-trip/file.bin", bytes))
      val result = await(fs.read("round-trip/file.bin"))
      assert(result.sameElements(bytes))
    }

    "return false for exists before write, true after" in {
      assert(!await(fs.exists("exists-test/file.txt")))
      await(fs.write("exists-test/file.txt", Array[Byte](1, 2, 3)))
      assert(await(fs.exists("exists-test/file.txt")))
    }

    "delete a file so exists returns false" in {
      await(fs.write("delete-test/file.txt", Array[Byte](9)))
      assert(await(fs.exists("delete-test/file.txt")))
      await(fs.delete("delete-test/file.txt"))
      assert(!await(fs.exists("delete-test/file.txt")))
    }

    "list returns relative paths matching a prefix" in {
      await(fs.write("list-test/a.csv", Array[Byte](1)))
      await(fs.write("list-test/b.csv", Array[Byte](2)))
      val paths = await(fs.list("list-test")).toSet
      assert(paths == Set("list-test/a.csv", "list-test/b.csv"))
    }

    "list returns empty Seq for a non-existent prefix" in {
      val paths = await(fs.list("no-such-prefix/"))
      assert(paths.isEmpty)
    }

    "write creates intermediate parent directories" in {
      val bytes = Array[Byte](42)
      await(fs.write("deep/nested/dir/file.dat", bytes))
      assert(await(fs.exists("deep/nested/dir/file.dat")))
    }
  }

  "LocalFileSystem.fromEnv" should {

    "use HELIO_UPLOADS_ROOT when set to an absolute path" in {
      val dir = Files.createTempDirectory("helio-from-env-abs")
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
        // clean up
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
      val base   = Files.createTempDirectory("helio-from-env-create")
      val newDir = base.resolve("nested/subdir")
      withEnv("HELIO_UPLOADS_ROOT" -> newDir.toString) {
        val result = LocalFileSystem.fromEnv()
        assert(Files.isDirectory(result.baseDir))
      }
    }

    "honour the backward-compat HELIO_UPLOADS_DIR alias" in {
      val dir = Files.createTempDirectory("helio-from-env-compat")
      withoutEnv("HELIO_UPLOADS_ROOT") {
        withEnv("HELIO_UPLOADS_DIR" -> dir.toString) {
          val result = LocalFileSystem.fromEnv()
          assert(result.baseDir == dir.toAbsolutePath.normalize())
        }
      }
    }
  }

  // ---- helpers ----

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
