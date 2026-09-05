package com.helio.infrastructure.storage

import com.helio.infrastructure.storage.LocalFileSystem
import org.scalatest.BeforeAndAfterAll
import org.scalatest.wordspec.AnyWordSpec

import java.nio.file.{Files, Path, Paths}
import java.util.{Comparator, Map => JMap}
import java.util.concurrent.atomic.AtomicBoolean
import org.scalatest.matchers.should.Matchers
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration._
import scala.jdk.CollectionConverters._
import scala.util.Try

class LocalFileSystemSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

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
      val result = await(fs.list("list-test"))
      assert(result.names.toSet == Set("list-test/a.csv", "list-test/b.csv"))
      assert(result.nextCursor.isEmpty)
    }

    "list returns empty page for a non-existent prefix" in {
      val result = await(fs.list("no-such-prefix/"))
      assert(result.names.isEmpty)
      assert(result.nextCursor.isEmpty)
    }

    "list paginates correctly with pageSize smaller than total file count" in {
      val prefix = "paginate-test"
      // Write 5 files so we can page through them 2 at a time
      (1 to 5).foreach(i => await(fs.write(s"$prefix/file$i.txt", Array[Byte](i.toByte))))

      val page1 = await(fs.list(prefix, pageSize = 2))
      assert(page1.names.size == 2)
      assert(page1.nextCursor == Some("2"))

      val page2 = await(fs.list(prefix, cursor = page1.nextCursor, pageSize = 2))
      assert(page2.names.size == 2)
      assert(page2.nextCursor == Some("4"))

      val page3 = await(fs.list(prefix, cursor = page2.nextCursor, pageSize = 2))
      assert(page3.names.size == 1)
      assert(page3.nextCursor.isEmpty)

      // All 5 names are covered, no duplicates
      val allNames = (page1.names ++ page2.names ++ page3.names).toSet
      assert(allNames.size == 5)
    }

    "list with a prefix that resolves to a regular file returns single name on first call and empty on cursor call" in {
      val filePath = "file-prefix-test/single.csv"
      await(fs.write(filePath, Array[Byte](7)))

      val firstResult = await(fs.list(filePath))
      assert(firstResult.names == Seq(filePath))
      assert(firstResult.nextCursor.isEmpty)

      val cursorResult = await(fs.list(filePath, cursor = Some("1")))
      assert(cursorResult.names.isEmpty)
      assert(cursorResult.nextCursor.isEmpty)
    }

    "write creates intermediate parent directories" in {
      val bytes = Array[Byte](42)
      await(fs.write("deep/nested/dir/file.dat", bytes))
      assert(await(fs.exists("deep/nested/dir/file.dat")))
    }

    // HEL-881 design.md Decision 4 / tasks 3.3a, 4.5a: `write` must stage into
    // a same-directory temp file and `Files.move` it atomically — not merely
    // produce the correct final bytes (a bare `Files.write` also produces
    // correct final bytes on the happy path, so that assertion alone would
    // pass against a reversion and is explicitly rejected as a guard by
    // design.md). These two tests instead assert the temp-and-move mechanism
    // ITSELF: a same-directory staging file is observably created during a
    // large write (a bare `Files.write` never creates one, at any size — so
    // this positively FAILS if `write` reverts to a bare `Files.write`), and
    // a failed move never leaves a temp file behind nor disturbs the target.

    "stages a same-directory temp file during a large write, and leaves none behind afterward" in {
      val parentDir = tempDir.resolve("atomic-probe")
      Files.createDirectories(parentDir)
      val bytes = new Array[Byte](64 * 1024 * 1024) // 64 MiB — large enough that the blocking write+move is not instantaneous

      def tempSiblings(): List[String] =
        Files.list(parentDir).iterator().asScala.map(_.getFileName.toString).filter(_.contains(".tmp")).toList

      val observedTempFile = new AtomicBoolean(false)
      val stop             = new AtomicBoolean(false)
      val poller = new Thread(() => {
        while (!stop.get()) {
          if (Try(tempSiblings().nonEmpty).getOrElse(false)) observedTempFile.set(true)
        }
      })
      poller.start()
      try {
        await(fs.write("atomic-probe/big.bin", bytes))
      } finally {
        stop.set(true)
        poller.join(5000)
      }

      observedTempFile.get() shouldBe true
      tempSiblings() shouldBe empty
      Files.list(parentDir).iterator().asScala.map(_.getFileName.toString).toList should contain only "big.bin"
    }

    "cleans up the temp file and leaves the original untouched when the atomic move fails" in {
      val targetRelPath = "atomic-fail/blocked.bin"
      val target        = tempDir.resolve(targetRelPath)
      // Force `Files.move`'s target to be an existing, NON-EMPTY directory
      // (rather than a plain file) so the move itself fails, exercising the
      // failure/cleanup branch rather than a create-parent-dirs failure.
      Files.createDirectories(target)
      Files.write(target.resolve("inner.txt"), Array[Byte](1, 2, 3))

      val result = Try(await(fs.write(targetRelPath, Array[Byte](9, 9, 9))))
      result.isFailure shouldBe true

      val siblings = Files.list(target.getParent).iterator().asScala.map(_.getFileName.toString).toList
      siblings.count(_.contains(".tmp")) shouldBe 0
      Files.exists(target.resolve("inner.txt")) shouldBe true
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
