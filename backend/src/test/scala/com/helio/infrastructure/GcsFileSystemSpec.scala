package com.helio.infrastructure

import com.google.api.gax.paging.Page
import com.google.cloud.storage.{Blob, BlobId, BlobInfo, Storage}
import org.mockito.ArgumentCaptor
import org.mockito.ArgumentMatchers.{any, eq => meq}
import org.mockito.Mockito.{mock, verify, when}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.nio.file.NoSuchFileException
import java.util.{Arrays => JArrays, Map => JMap}
import scala.concurrent.duration._
import scala.concurrent.{Await, ExecutionContext, Future}

class GcsFileSystemSpec extends AnyWordSpec with Matchers {

  implicit val ec: ExecutionContext = ExecutionContext.global

  private val BucketName = "test-bucket"

  private def await[A](f: Future[A]): A =
    Await.result(f, 5.seconds)

  private def newFs(storage: Storage): GcsFileSystem =
    new GcsFileSystem(BucketName, storage)

  "GcsFileSystem.write" should {

    "delegate to Storage.create with the bucket-qualified BlobInfo and bytes" in {
      val storage = mock(classOf[Storage])
      val bytes = "hello".getBytes("UTF-8")
      val infoCaptor = ArgumentCaptor.forClass(classOf[BlobInfo])
      val bytesCaptor = ArgumentCaptor.forClass(classOf[Array[Byte]])

      await(newFs(storage).write("users/1/data.csv", bytes))

      verify(storage).create(infoCaptor.capture(), bytesCaptor.capture())
      infoCaptor.getValue.getBucket shouldBe BucketName
      infoCaptor.getValue.getName shouldBe "users/1/data.csv"
      bytesCaptor.getValue shouldBe bytes
    }
  }

  "GcsFileSystem.read" should {

    "return the blob contents when the object exists" in {
      val storage = mock(classOf[Storage])
      val blob = mock(classOf[Blob])
      val bytes = "csv,data".getBytes("UTF-8")
      when(storage.get(any(classOf[BlobId]))).thenReturn(blob)
      when(blob.exists()).thenReturn(true)
      when(blob.getContent()).thenReturn(bytes)

      await(newFs(storage).read("data.csv")) shouldBe bytes
    }

    "throw NoSuchFileException when Storage.get returns null" in {
      val storage = mock(classOf[Storage])
      when(storage.get(any(classOf[BlobId]))).thenReturn(null)

      val ex = intercept[NoSuchFileException](await(newFs(storage).read("missing")))
      ex.getMessage should include("gs://test-bucket/missing")
    }

    "throw NoSuchFileException when the blob reports !exists()" in {
      val storage = mock(classOf[Storage])
      val blob = mock(classOf[Blob])
      when(storage.get(any(classOf[BlobId]))).thenReturn(blob)
      when(blob.exists()).thenReturn(false)

      assertThrows[NoSuchFileException](await(newFs(storage).read("ghost")))
    }
  }

  "GcsFileSystem.delete" should {

    "delegate to Storage.delete with the bucket-qualified BlobId" in {
      val storage = mock(classOf[Storage])
      when(storage.delete(any(classOf[BlobId]))).thenReturn(true)
      val captor = ArgumentCaptor.forClass(classOf[BlobId])

      await(newFs(storage).delete("data.csv"))

      verify(storage).delete(captor.capture())
      captor.getValue.getBucket shouldBe BucketName
      captor.getValue.getName shouldBe "data.csv"
    }
  }

  "GcsFileSystem.exists" should {

    "return true when the blob is non-null and present" in {
      val storage = mock(classOf[Storage])
      val blob = mock(classOf[Blob])
      when(storage.get(any(classOf[BlobId]))).thenReturn(blob)
      when(blob.exists()).thenReturn(true)

      await(newFs(storage).exists("data.csv")) shouldBe true
    }

    "return false when Storage.get returns null" in {
      val storage = mock(classOf[Storage])
      when(storage.get(any(classOf[BlobId]))).thenReturn(null)

      await(newFs(storage).exists("ghost")) shouldBe false
    }

    "return false when the blob reports !exists()" in {
      val storage = mock(classOf[Storage])
      val blob = mock(classOf[Blob])
      when(storage.get(any(classOf[BlobId]))).thenReturn(blob)
      when(blob.exists()).thenReturn(false)

      await(newFs(storage).exists("ghost")) shouldBe false
    }
  }

  "GcsFileSystem.list" should {

    "return every blob name produced by the prefix iterator" in {
      val storage = mock(classOf[Storage])
      val page = mock(classOf[Page[Blob]])
      val blob1 = mock(classOf[Blob])
      val blob2 = mock(classOf[Blob])
      when(blob1.getName).thenReturn("users/1/a.csv")
      when(blob2.getName).thenReturn("users/1/b.csv")
      when(page.iterateAll()).thenReturn(JArrays.asList(blob1, blob2))
      when(storage.list(meq(BucketName), any(classOf[Storage.BlobListOption])))
        .thenReturn(page)

      val names = await(newFs(storage).list("users/1/"))
      names should contain theSameElementsAs Seq("users/1/a.csv", "users/1/b.csv")
    }

    "return empty when no objects match the prefix" in {
      val storage = mock(classOf[Storage])
      val page = mock(classOf[Page[Blob]])
      when(page.iterateAll()).thenReturn(JArrays.asList[Blob]())
      when(storage.list(meq(BucketName), any(classOf[Storage.BlobListOption])))
        .thenReturn(page)

      await(newFs(storage).list("nope/")) shouldBe empty
    }
  }

  "GcsFileSystem.fromEnv" should {

    "throw IllegalStateException when HELIO_UPLOADS_BUCKET is not set" in {
      withoutEnv("HELIO_UPLOADS_BUCKET") {
        assertThrows[IllegalStateException] {
          GcsFileSystem.fromEnv()
        }
      }
    }

    "throw IllegalStateException when HELIO_UPLOADS_BUCKET is empty" in {
      withEnv("HELIO_UPLOADS_BUCKET" -> "") {
        assertThrows[IllegalStateException] {
          GcsFileSystem.fromEnv()
        }
      }
    }
  }

  // ---- helpers ----

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
}
