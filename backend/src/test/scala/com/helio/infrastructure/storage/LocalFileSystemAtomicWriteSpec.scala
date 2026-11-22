package com.helio.infrastructure.storage

import com.helio.testkit.TempDirectorySupport
import org.scalatest.wordspec.AnyWordSpec

import java.nio.file.Files
import org.scalatest.matchers.should.Matchers
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration._
import scala.jdk.CollectionConverters._
import scala.util.{Try, Using}

/** HEL-881/HEL-984 atomic-publish guards for `LocalFileSystem.write`, split out of `LocalFileSystemSpec`
 *  (HEL-1817) with the tests unchanged. */
class LocalFileSystemAtomicWriteSpec extends AnyWordSpec with Matchers with TempDirectorySupport {

  implicit val ec: ExecutionContext = ExecutionContext.global

  private val tempDir = newTempDir("helio-fs-test")
  private val fs      = new LocalFileSystem(tempDir)

  private def await[A](f: Future[A]): A =
    Await.result(f, 5.seconds)

  "LocalFileSystem" should {

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
        // temp-dir-hygiene: reviewed — created inside `tempDir`, swept by TempDirectorySupport's recursive delete of `tempDir` itself.
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
}
