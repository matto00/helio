package com.helio.infrastructure.storage

import com.helio.infrastructure.storage.LocalFileSystem
import org.scalatest.BeforeAndAfterAll
import org.scalatest.wordspec.AnyWordSpec

import java.nio.file.{Files, Path, Paths}
import java.util.{Comparator, Map => JMap}
import org.scalatest.matchers.should.Matchers
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration._
import scala.jdk.CollectionConverters._
import scala.util.{Try, Using}

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
    // design.md).
    //
    // HEL-984: the previous guard tried to CATCH the staged temp file mid-write
    // with a busy-spinning poller racing a 64 MiB write. That was inherently a
    // wall-clock race — the intermediate state it polled for is exactly what an
    // atomic operation is designed to make unobservable — and CI run 33948170131
    // showed it is also the CONCRETE cause of an intermittent whole-suite abort:
    // the poller's `Files.list(parentDir).iterator()` returns a `Stream` backed
    // by an open `DirectoryStream` that is never closed, and the poller spins
    // that call with no sleep for the duration of the write, leaking two file
    // descriptors per iteration until the process hits `Too many open files`
    // (measured on this machine: 20,000 unclosed calls leak 40,002 descriptors,
    // never reclaimed — see fd-leak-evidence.md). It never reproduced on a dev
    // box because `ulimit -n` there is typically in the hundreds of thousands;
    // CI's much lower limit is what made it bite.
    //
    // The poller, the 64 MiB buffer and the `AtomicBoolean`s are deleted below
    // and replaced with two DETERMINISTIC, synchronous discriminators (design.md
    // Decision 2) that need no window and no scheduler cooperation: fixtures in
    // which a temp-file-plus-rename implementation and a bare `Files.write` have
    // opposite, immediate outcomes, because the kernel's own permission check
    // decides the outcome rather than a race between two threads.
    //
    //   - D1 rules out a bare in-place `Files.write` (the plausible reversion
    //     AC2 guards against): writing to a read-only (0444) target file
    //     inside a writable directory succeeds via a rename — `rename(2)`
    //     checks write permission on the directory, not the file being
    //     replaced — while a bare `Files.write` opening that file for writing
    //     is denied. (This does not rule out every conceivable
    //     implementation, e.g. delete-then-write would also pass; it
    //     positively discriminates against the one reversion in question.)
    //   - D2 proves that publishing requires write permission on the TARGET's
    //     own directory: staging a temp file in a non-writable (0555) directory
    //     fails even though the target file itself is writable, which a bare
    //     `Files.write` would not need to do.
    //
    // Both discriminators first prove their own precondition against a scratch
    // fixture (design.md Decision 3), so a platform where POSIX permissions are
    // not enforced (e.g. running as root) fails loudly naming the unmet
    // precondition, never silently reporting atomicity as satisfied.
    //
    // Same-directory staging (P2 — `ATOMIC_MOVE` only holds within one
    // filesystem) is NOT covered by an automated guard after this change, and
    // per design.md Decision 2b that is stated plainly rather than engineered
    // around: every candidate discriminator for "staged in the same directory"
    // vs. "staged elsewhere then renamed in" collapses, because `rename(2)`
    // requires write permission on the destination directory either way, and
    // catching the staged file in the act is exactly the racy observation this
    // change removes. P2 remains true by construction — see the code comment
    // above `LocalFileSystem.write`, which passes `target.getParent` to
    // `Files.createTempFile` — but is not, and is not claimed to be, guarded by
    // a test.

    "publishes via rename: a write to a read-only target file succeeds" in {
      // Precondition (design.md Decision 3): prove POSIX permissions are
      // actually enforced here before relying on them to discriminate.
      val precondScratch = tempDir.resolve("d1-precondition.txt")
      Files.write(precondScratch, Array[Byte](0))
      precondScratch.toFile.setWritable(false)
      try {
        val precondDenied = Try(Files.write(precondScratch, Array[Byte](1))).isFailure
        assert(
          precondDenied,
          "precondition not met: POSIX permissions are not enforced here (running as root?) — this guard cannot discriminate"
        )
      } finally {
        precondScratch.toFile.setWritable(true)
      }

      val parentDir = tempDir.resolve("d1-readonly-target")
      Files.createDirectories(parentDir)
      val target      = parentDir.resolve("target.bin")
      val originalBytes = Array[Byte](1, 2, 3)
      Files.write(target, originalBytes)
      target.toFile.setWritable(false)

      try {
        // A bare `Files.write(target, bytes)` would open `target` for writing
        // and be denied by the 0444 permission bit. `write` succeeding here,
        // with the target afterward holding the NEW bytes, therefore rules out
        // a bare in-place `Files.write` — the plausible reversion this guards
        // against. (It does not rule out every conceivable implementation —
        // e.g. `Files.delete` followed by a fresh `Files.write` would also
        // succeed here and would be neither atomic nor a rename — but it is a
        // real, positive discriminator against the reversion in question.)
        await(fs.write("d1-readonly-target/target.bin", Array[Byte](9, 9, 9)))
        val resultBytes = Files.readAllBytes(target)
        resultBytes should contain theSameElementsInOrderAs Array[Byte](9, 9, 9)
      } finally {
        target.toFile.setWritable(true)
      }
    }

    "requires write permission on the target directory: staging fails even though the target file itself is writable" in {
      // Precondition (design.md Decision 3): prove a 0555 directory actually
      // refuses new-file creation here before relying on it to discriminate.
      val precondDir = tempDir.resolve("d2-precondition")
      Files.createDirectories(precondDir)
      precondDir.toFile.setWritable(false)
      try {
        val precondDenied = Try(Files.createTempFile(precondDir, ".probe", ".tmp")).isFailure
        assert(
          precondDenied,
          "precondition not met: POSIX permissions are not enforced here (running as root?) — this guard cannot discriminate"
        )
      } finally {
        precondDir.toFile.setWritable(true)
      }

      val parentDir = tempDir.resolve("d2-readonly-dir")
      Files.createDirectories(parentDir)
      val target        = parentDir.resolve("target.bin")
      val originalBytes = Array[Byte](4, 5, 6)
      Files.write(target, originalBytes)
      // The target FILE is writable (0644); only the DIRECTORY is not (0555).
      // A bare `Files.write(target, bytes)` never consults the directory's
      // permissions and would succeed; the temp-file-plus-rename path must
      // first create a staging file in this directory and fails to do so.
      parentDir.toFile.setWritable(false)

      try {
        val result = Try(await(fs.write("d2-readonly-dir/target.bin", Array[Byte](7, 7, 7))))
        withClue(
          "the staged write unexpectedly SUCCEEDED against a non-writable target directory — " +
            "this indicates `write` no longer stages via a temp file: "
        ) {
          result.isFailure shouldBe true
        }
        val ex = result.failed.get
        ex shouldBe a[java.nio.file.AccessDeniedException]
        // Positive identification, not just the exception class (design.md
        // "Risks" — a typo'd fixture path could also throw AccessDeniedException):
        // the message must name the staging directory itself.
        ex.getMessage should include(parentDir.toString)

        // The target must be untouched — byte comparison, not `Files.exists`.
        Files.readAllBytes(target) should contain theSameElementsInOrderAs originalBytes
      } finally {
        parentDir.toFile.setWritable(true)
      }
    }

    "leaves no .tmp residue in the target directory after a successful write" in {
      val parentDir = tempDir.resolve("no-residue-probe")
      Files.createDirectories(parentDir)
      await(fs.write("no-residue-probe/file.bin", Array[Byte](1, 2, 3)))
      val names = Using.resource(Files.list(parentDir))(_.iterator().asScala.map(_.getFileName.toString).toList)
      names should contain only "file.bin"
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
