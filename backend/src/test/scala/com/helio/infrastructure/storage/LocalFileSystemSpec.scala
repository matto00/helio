package com.helio.infrastructure.storage

import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.testkit.TempDirectorySupport
import org.scalatest.BeforeAndAfterAll
import org.scalatest.wordspec.AnyWordSpec

import java.nio.file.Files
import org.scalatest.matchers.should.Matchers
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration._

class LocalFileSystemSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll with TempDirectorySupport {

  implicit val ec: ExecutionContext = ExecutionContext.global

  private val tempDir = newTempDir("helio-fs-test")
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
  }
}
