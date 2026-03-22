package com.helio.infrastructure

import org.scalatest.BeforeAndAfterAll
import org.scalatest.wordspec.AnyWordSpec

import java.nio.file.Files
import scala.concurrent.{Await, ExecutionContext}
import scala.concurrent.duration._

class LocalFileSystemSpec extends AnyWordSpec with BeforeAndAfterAll {

  implicit val ec: ExecutionContext = ExecutionContext.global

  private val tempDir = Files.createTempDirectory("helio-fs-test")
  private val fs      = new LocalFileSystem(tempDir)

  private def await[A](f: scala.concurrent.Future[A]): A =
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
}
