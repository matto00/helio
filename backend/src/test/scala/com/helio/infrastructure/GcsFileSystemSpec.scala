package com.helio.infrastructure

import org.scalatest.wordspec.AnyWordSpec

import java.util.{Map => JMap}
import scala.concurrent.{Await, ExecutionContext}
import scala.concurrent.duration._

class GcsFileSystemSpec extends AnyWordSpec {

  implicit val ec: ExecutionContext = ExecutionContext.global

  private def await[A](f: scala.concurrent.Future[A]): A =
    Await.result(f, 5.seconds)

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

    // Note: Testing actual GCS operations requires real credentials and bucket access.
    // Integration tests would use a test bucket; unit tests verify delegation via
    // dependency injection of a Storage instance (constructor is accessible for
    // test doubles in integration scenarios).
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
