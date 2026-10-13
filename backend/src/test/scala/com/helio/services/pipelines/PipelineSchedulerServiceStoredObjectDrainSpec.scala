package com.helio.services.pipelines

import com.google.cloud.storage.{BlobId, Storage}
import com.helio.infrastructure.storage.{FileSystem, GcsFileSystem, LocalFileSystem}
import com.helio.infrastructure.persistence.sources.StoredObjectDeletionRepository
import com.helio.services.sources.StoredObjectDeletionService
import com.helio.testkit.TempDirectorySupport
import org.mockito.Mockito.{mock, verify}
import org.scalatest.concurrent.Eventually
import org.scalatest.matchers.should.Matchers
import org.scalatest.time.{Millis, Seconds, Span}
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.PostgresProfile

import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path}
import java.util.UUID

/** HEL-1434 [RED-FIRST] R1-R3 (and the W1 wiring proof): rows removed from `image_uploads` / file-backed
 *  `data_sources` by a path that never touches the application (a `DELETE FROM users` cascade, a raw
 *  `DELETE FROM image_uploads`, a legacy `filePath`-only csv row) must eventually lose their stored object, driven
 *  only through entry points that exist before the fix: the real `FileSystem`, SQL deletes, and one real
 *  `PipelineSchedulerService.tick()`. Red = the object is still present (local) or `Storage.delete` is never called
 *  (GCS double). Because the pass runs from `tick()`, a missing wiring in `runPasses` turns these red too (W1). */
class PipelineSchedulerServiceStoredObjectDrainSpec
    extends AnyWordSpec with Matchers with PipelineSchedulerServiceFixture with Eventually with TempDirectorySupport {

  import PostgresProfile.api._

  override implicit val patienceConfig: PatienceConfig = PatienceConfig(timeout = Span(10, Seconds), interval = Span(100, Millis))

  private lazy val root: Path             = newTempDir("helio-hel1434-uploads")
  private lazy val local: FileSystem      = new LocalFileSystem(root)
  private val BucketName                  = "hel1434-bucket"

  /** The scheduler under test, wired exactly as `Main` wires it, over the given object store. */
  private def scheduler(fs: FileSystem): PipelineSchedulerService =
    new PipelineSchedulerService(
      scheduleRepo, pipelineRepo, pipelineStepRepo, runRepo, runServiceForHistory, fakeClock,
      storedObjectDeletionService = new StoredObjectDeletionService(new StoredObjectDeletionRepository(historyCtx), fs, fakeClock)
    )

  private def resetQueue(): Unit =
    await(db.run(sqlu"""DO $$$$ BEGIN IF to_regclass('stored_object_deletions') IS NOT NULL THEN DELETE FROM stored_object_deletions; END IF; END $$$$"""))

  private def newUser(): String = {
    val id = UUID.randomUUID().toString
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($id::uuid, ${s"$id@example.test"}, now())"""))
    id
  }

  private def seedObject(fs: FileSystem, key: String): String = {
    await(fs.write(key, "x".getBytes(StandardCharsets.UTF_8)))
    key
  }

  private def seedImage(fs: FileSystem, owner: String): String = {
    val id = UUID.randomUUID().toString
    val key = seedObject(fs, s"images/$id.png")
    await(db.run(sqlu"""INSERT INTO image_uploads (id, owner_id, storage_key, mime_type, filename, size_bytes)
                        VALUES ($id, $owner::uuid, $key, 'image/png', 'a.png', 1)"""))
    key
  }

  private def seedSource(fs: FileSystem, owner: String, kind: String, ext: String, configKey: String = "path"): String = {
    val id  = UUID.randomUUID().toString
    val key = seedObject(fs, s"$kind/$id.$ext")
    val cfg = s"""{"$configKey":"$key"}"""
    await(db.run(sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
                        VALUES ($id, 'ds', $kind, $cfg::jsonb, $owner::uuid, now(), now())"""))
    key
  }

  private def present(key: String): Boolean = Files.exists(root.resolve(key))

  private def gcs(): (Storage, FileSystem) = {
    val storage = mock(classOf[Storage])
    (storage, new GcsFileSystem(BucketName, storage))
  }

  "PipelineSchedulerService.tick (stored-object drain)" should {

    "R1 remove every stored object of a user deleted by raw SQL (local)" in {
      cleanDb(); resetQueue()
      val u    = newUser()
      val keys = Seq(seedImage(local, u), seedSource(local, u, "csv", "csv"), seedSource(local, u, "text", "txt"),
        seedSource(local, u, "pdf", "pdf"), seedSource(local, u, "image", "png"))
      keys.foreach(k => present(k) shouldBe true)
      await(db.run(sqlu"DELETE FROM users WHERE id = $u::uuid"))

      await(scheduler(local).tick())
      eventually { keys.filter(present) shouldBe empty }
    }

    "R1 remove every stored object of a user deleted by raw SQL (GCS double)" in {
      cleanDb(); resetQueue()
      val (storage, fs) = gcs()
      val u    = newUser()
      val keys = Seq(seedImage(fs, u), seedSource(fs, u, "csv", "csv"), seedSource(fs, u, "text", "txt"),
        seedSource(fs, u, "pdf", "pdf"), seedSource(fs, u, "image", "png"))
      await(db.run(sqlu"DELETE FROM users WHERE id = $u::uuid"))

      await(scheduler(fs).tick())
      eventually { keys.foreach(k => verify(storage).delete(BlobId.of(BucketName, k))) }
    }

    "R2 remove the object of an image_uploads row deleted by raw SQL (local)" in {
      cleanDb(); resetQueue()
      val u   = newUser()
      val key = seedImage(local, u)
      await(db.run(sqlu"DELETE FROM image_uploads WHERE storage_key = $key"))

      await(scheduler(local).tick())
      eventually { present(key) shouldBe false }
    }

    "R2 remove the object of an image_uploads row deleted by raw SQL (GCS double)" in {
      cleanDb(); resetQueue()
      val (storage, fs) = gcs()
      val u   = newUser()
      val key = seedImage(fs, u)
      await(db.run(sqlu"DELETE FROM image_uploads WHERE storage_key = $key"))

      await(scheduler(fs).tick())
      eventually { verify(storage).delete(BlobId.of(BucketName, key)) }
    }

    "R3 remove the object of a legacy filePath-only csv row (local)" in {
      cleanDb(); resetQueue()
      val u   = newUser()
      val key = seedSource(local, u, "csv", "csv", configKey = "filePath")
      await(db.run(sqlu"DELETE FROM users WHERE id = $u::uuid"))

      await(scheduler(local).tick())
      eventually { present(key) shouldBe false }
    }

    "R3 remove the object of a legacy filePath-only csv row (GCS double)" in {
      cleanDb(); resetQueue()
      val (storage, fs) = gcs()
      val u   = newUser()
      val key = seedSource(fs, u, "csv", "csv", configKey = "filePath")
      await(db.run(sqlu"DELETE FROM users WHERE id = $u::uuid"))

      await(scheduler(fs).tick())
      eventually { verify(storage).delete(BlobId.of(BucketName, key)) }
    }
  }
}
