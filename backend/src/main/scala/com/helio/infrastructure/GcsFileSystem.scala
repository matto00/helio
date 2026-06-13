package com.helio.infrastructure

import com.google.cloud.storage.{BlobId, BlobInfo, Storage, StorageOptions}
import org.slf4j.LoggerFactory

import java.nio.file.NoSuchFileException
import scala.concurrent.{ExecutionContext, Future, blocking}
import scala.jdk.CollectionConverters._

class GcsFileSystem(bucketName: String, storage: Storage)(implicit ec: ExecutionContext) extends FileSystem {

  def write(path: String, bytes: Array[Byte]): Future[Unit] = Future {
    blocking {
      val blobId = BlobId.of(bucketName, path)
      val blobInfo = BlobInfo.newBuilder(blobId).build()
      storage.create(blobInfo, bytes)
      ()
    }
  }

  def read(path: String): Future[Array[Byte]] = Future {
    blocking {
      val blobId = BlobId.of(bucketName, path)
      val blob = storage.get(blobId)
      if (blob == null || !blob.exists()) {
        throw new NoSuchFileException(s"GCS object not found: gs://$bucketName/$path")
      }
      blob.getContent()
    }
  }

  def delete(path: String): Future[Unit] = Future {
    blocking {
      val blobId = BlobId.of(bucketName, path)
      storage.delete(blobId)
      ()
    }
  }

  def exists(path: String): Future[Boolean] = Future {
    blocking {
      val blobId = BlobId.of(bucketName, path)
      val blob = storage.get(blobId)
      blob != null && blob.exists()
    }
  }

  def list(prefix: String, cursor: Option[String] = None, pageSize: Int = 1000): Future[ListPage] = Future {
    blocking {
      val baseOptions = Seq(
        Storage.BlobListOption.prefix(prefix),
        Storage.BlobListOption.pageSize(pageSize.toLong)
      )
      val options = cursor match {
        case Some(token) => baseOptions :+ Storage.BlobListOption.pageToken(token)
        case None        => baseOptions
      }
      val page = storage.list(bucketName, options: _*)
      val names = page.getValues.asScala.map(_.getName).toSeq
      val nextCursor = Option(page.getNextPageToken).filter(_.nonEmpty)
      ListPage(names, nextCursor)
    }
  }
}

object GcsFileSystem {

  private val log = LoggerFactory.getLogger(getClass)

  /** Constructs a GcsFileSystem from environment variables using Application Default Credentials.
    *
    * Reads `HELIO_UPLOADS_BUCKET` to determine the target bucket. Throws `IllegalStateException`
    * if the variable is absent or empty.
    *
    * Authentication relies on Application Default Credentials (ADC):
    *   - On Cloud Run: runtime service account credentials are available automatically
    *   - Local dev: run `gcloud auth application-default login` to configure user credentials
    */
  def fromEnv()(implicit ec: ExecutionContext): GcsFileSystem = {
    val bucketName = sys.env
      .get("HELIO_UPLOADS_BUCKET")
      .filter(_.nonEmpty)
      .getOrElse {
        log.error("HELIO_UPLOADS_BUCKET is required when HELIO_UPLOADS_BACKEND=gcs")
        throw new IllegalStateException(
          "Missing required environment variable: HELIO_UPLOADS_BUCKET"
        )
      }

    val storage = StorageOptions.getDefaultInstance.getService

    log.info("GCS filesystem configured for bucket: {}", bucketName)
    new GcsFileSystem(bucketName, storage)
  }
}
