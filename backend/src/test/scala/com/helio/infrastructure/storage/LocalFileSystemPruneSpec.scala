package com.helio.infrastructure.storage

import com.helio.testkit.TempDirectorySupport
import org.scalatest.wordspec.AnyWordSpec

import java.nio.file.{Files, Path}
import org.scalatest.matchers.should.Matchers
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration._
import scala.util.Try

/** HEL-1802 directory pruning, split out of `LocalFileSystemSpec` (HEL-1817) with the tests unchanged. */
class LocalFileSystemPruneSpec extends AnyWordSpec with Matchers with TempDirectorySupport {

  implicit val ec: ExecutionContext = ExecutionContext.global

  private def await[A](f: Future[A]): A =
    Await.result(f, 5.seconds)

  "LocalFileSystem directory pruning (HEL-1802)" should {

    "remove the emptied per-user folder but keep the family directory" in {
      val root = newTempDir("helio-fs-prune")
      val local = new LocalFileSystem(root)
      await(local.write("assistant-conversations/u1/c1.json", Array[Byte](1)))
      await(local.delete("assistant-conversations/u1/c1.json"))
      Files.exists(root.resolve("assistant-conversations/u1")) shouldBe false
      Files.isDirectory(root.resolve("assistant-conversations")) shouldBe true
    }

    "keep a folder that still holds a sibling object" in {
      val root = newTempDir("helio-fs-prune")
      val local = new LocalFileSystem(root)
      await(local.write("assistant-conversations/u1/c1.json", Array[Byte](1)))
      await(local.write("assistant-conversations/u1/c2.json", Array[Byte](2)))
      await(local.delete("assistant-conversations/u1/c1.json"))
      Files.exists(root.resolve("assistant-conversations/u1/c2.json")) shouldBe true
      Files.isDirectory(root.resolve("assistant-conversations/u1")) shouldBe true
    }

    "keep a flat family directory after its last object is deleted" in {
      val root = newTempDir("helio-fs-prune")
      val local = new LocalFileSystem(root)
      await(local.write("images/a.png", Array[Byte](1)))
      await(local.delete("images/a.png"))
      Files.isDirectory(root.resolve("images")) shouldBe true
    }

    "clear an empty folder even when the object is already gone, and never remove the root" in {
      val root = newTempDir("helio-fs-prune")
      val local = new LocalFileSystem(root)
      Files.createDirectories(root.resolve("assistant-conversations/u2"))
      await(local.delete("assistant-conversations/u2/missing.json"))
      Files.exists(root.resolve("assistant-conversations/u2")) shouldBe false
      Files.isDirectory(root.resolve("assistant-conversations")) shouldBe true
      await(local.delete("lonely.txt"))
      Files.isDirectory(root) shouldBe true
    }

    "not walk a path that normalizes outside the root" in {
      val root = newTempDir("helio-fs-prune")
      val outside = newTempDir("helio-fs-outside")
      val local = new LocalFileSystem(root)
      Files.createDirectories(outside.resolve("x/y"))
      val rel = root.relativize(outside).toString
      Try(await(local.delete(s"$rel/x/y/z.json")))
      Files.isDirectory(outside.resolve("x/y")) shouldBe true
    }

    "let a write succeed when a prune removes its directory between mkdir and temp-file creation" in {
      val root = newTempDir("helio-fs-race")
      var removed = 0
      val racing = new LocalFileSystem(root) {
        override private[storage] def beforeStage(dir: Path): Unit =
          if (removed == 0) { removed += 1; Files.deleteIfExists(dir); () }
      }
      await(racing.write("assistant-conversations/u3/c.json", Array[Byte](7)))
      removed shouldBe 1
      Files.readAllBytes(root.resolve("assistant-conversations/u3/c.json")).toSeq shouldBe Seq[Byte](7)
    }
  }
}
