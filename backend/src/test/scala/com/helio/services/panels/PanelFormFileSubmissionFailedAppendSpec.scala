package com.helio.services.panels

import com.helio.domain.model.{AuthenticatedUser, DashboardId, DataSourceId, PanelAppearance, PanelId, ResourceMeta, UserId}
import com.helio.domain.panels.{FormFieldSpec, FormPanel, FormPanelConfig, FormSubmitSpec}
import com.helio.domain.util.Clock
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.{PipelineAutoRunDebounceRepository, PipelineRepository, PipelineRootRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.{DataSourceRepository, StoredObjectDeletionRepository}
import com.helio.infrastructure.storage.{FileSystem, ListPage}
import com.helio.services.pipelines.AutoRunTriggerService
import com.helio.services.sources.{DataSourceService, StoredObjectDeletionService}
import com.helio.testkit.VerifiedEmbeddedPostgres
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.Behaviors
import org.mockito.Mockito.mock
import org.mockito.invocation.InvocationOnMock
import org.mockito.stubbing.Answer
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.util.{Failure, Success, Try}

/** HEL-1530 tasks.md 3.3 (service level; the route-level flip lives in `FormSubmitRoutesSpec`): a form submit whose
 *  append FUTURE fails queues its stored objects behind a grace window, and the drain deletes one only if no committed
 *  row references its key.
 *
 *  - rolled-back append: the future fails and no row exists -> after the grace + a pass the object is deleted;
 *  - committed-then-failed: a SYNCHRONOUS throw from `AutoRunTriggerService.triggerAutoRun` (a mocked
 *    `PipelineRootRepository`) escapes `appendFormRow`'s flatMap AFTER the row committed -> the row exists, the queue
 *    row is a new-style `form_submit_failed` row, and after the grace + a pass the object is STILL there;
 *  - a partial `storeFormFiles` write failure removes every written file, even one whose write was still in flight. */
class PanelFormFileSubmissionFailedAppendSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  import PostgresProfile.api._

  private implicit val ec: ExecutionContext = ExecutionContext.global
  // DataSourceService needs an implicit typed ActorSystem (and a Materializer derived from it).
  private implicit val actorSystem: ActorSystem[Nothing] = ActorSystem[Nothing](Behaviors.empty[Nothing], "hel1530-form-append")

  /** Real time plus a settable offset (the queue's `not_before` is stamped from the app clock + grace). */
  private final class OffsetClock extends Clock {
    @volatile var offsetSeconds: Long = 0L
    def now(): Instant                = Instant.now().plusSeconds(offsetSeconds)
  }

  /** In-memory storage whose per-call write behaviour can be scripted. */
  private final class ScriptedFileSystem extends FileSystem {
    val files = new ConcurrentHashMap[String, Array[Byte]]()
    @volatile var onWrite: (Int, String, Array[Byte]) => Future[Unit] = (_, p, b) => { files.put(p, b); Future.unit }
    private val calls = new AtomicInteger(0)
    def resetCalls(): Unit = calls.set(0)
    def write(path: String, bytes: Array[Byte]): Future[Unit]                         = onWrite(calls.getAndIncrement(), path, bytes)
    def read(path: String): Future[Array[Byte]]                                       = Future.successful(Option(files.get(path)).getOrElse(Array.empty))
    def exists(path: String): Future[Boolean]                                         = Future.successful(files.containsKey(path))
    def list(prefix: String, cursor: Option[String], pageSize: Int): Future[ListPage] = Future.successful(ListPage(Seq.empty, None))
    def delete(path: String): Future[Unit]                                            = { files.remove(path); Future.unit }
  }

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var ctx: DbContext                     = _
  private var dataSourceRepo: DataSourceRepository = _
  private var queueRepo: StoredObjectDeletionRepository = _
  private val fs    = new ScriptedFileSystem
  private val clock = new OffsetClock
  private var drain: StoredObjectDeletionService = _

  private val ownerId = UUID.randomUUID().toString
  private val user    = AuthenticatedUser(UserId(ownerId))

  private val schemaJson =
    """[{"name":"quantity","type":"integer","required":true},
      | {"name":"photo","type":"binary-ref","required":false},
      | {"name":"photo2","type":"binary-ref","required":false}]""".stripMargin.replaceAll("\n", "")

  private val panelFields = Vector(
    FormFieldSpec("quantity", "number", required = Some(true)),
    FormFieldSpec("photo", "file"),
    FormFieldSpec("photo2", "file")
  )

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration").load().migrate()
    db            = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    ctx           = new DbContext(db, db)
    dataSourceRepo = new DataSourceRepository(ctx)
    queueRepo     = new StoredObjectDeletionRepository(ctx)
    drain         = new StoredObjectDeletionService(queueRepo, fs, clock)
    Await.result(db.run(sqlu"INSERT INTO users (id, email) VALUES ($ownerId::uuid, ${s"$ownerId@example.test"})"), 10.seconds)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); actorSystem.terminate()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 20.seconds)

  private def seedSource(declared: String = schemaJson): String = {
    val id = UUID.randomUUID().toString
    await(db.run(sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at, dataset_schema)
                        VALUES ($id, 'ds', 'dataset', '{}'::jsonb, $ownerId::uuid, now(), now(), $declared::jsonb)"""))
    id
  }

  private def panelFor(sourceId: String): FormPanel =
    FormPanel(PanelId("p-1"), DashboardId("d-1"), "t", ResourceMeta(ownerId, Instant.now(), Instant.now()), PanelAppearance.Default,
              UserId(ownerId), FormPanelConfig(DataSourceId(sourceId), panelFields, FormSubmitSpec("append")))

  /** A service whose `triggerAutoRun` throws SYNCHRONOUSLY when `syncThrow`, else has no auto-run at all. */
  private def submission(syncThrow: Boolean, repo: StoredObjectDeletionRepository = queueRepo): PanelFormFileSubmission = {
    val trigger =
      if (!syncThrow) null
      else {
        // every call throws synchronously (a stub answer, since the id parameter is a value class matchers cannot fake)
        val roots = mock(classOf[PipelineRootRepository], new Answer[AnyRef] {
          def answer(invocation: InvocationOnMock): AnyRef = throw new IllegalStateException("boom: synchronous trigger failure")
        })
        val pipelineRepo = new PipelineRepository(ctx, dataSourceRepo)
        new AutoRunTriggerService(roots, pipelineRepo, new PipelineStepRepository(ctx), dataSourceRepo, new PipelineAutoRunDebounceRepository(ctx))
      }
    val dataSourceService = new DataSourceService(dataSourceRepo, fs, autoRunTriggerService = trigger)
    new PanelFormFileSubmission(dataSourceRepo, dataSourceService, fs, repo)
  }

  private def submit(sub: PanelFormFileSubmission, sourceId: String, files: Map[String, (String, Array[Byte])]): Try[Either[_, _]] =
    Try(Await.result(sub.submitFormWithFiles(PanelId("p-1"), panelFor(sourceId), Map("quantity" -> JsNumber(3)), files, user), 20.seconds))

  private def rowCount(sourceId: String): Int =
    await(db.run(sql"SELECT count(*) FROM dataset_rows WHERE data_source_id = $sourceId".as[Int])).head

  private def queueRows(): Vector[(String, String, Boolean, Timestamp)] =
    await(db.run(sql"""SELECT storage_key, source_table, claimed_at = 'infinity', not_before
                       FROM stored_object_deletions WHERE source_table = 'form_submit_failed'""".as[(String, String, Boolean, Timestamp)])).toVector

  private def newFormKeys(before: Set[String]): Set[String] = fs.files.keySet().toArray.map(_.toString).toSet.diff(before)
  private def clearQueue(): Unit = await(db.run(sqlu"DELETE FROM stored_object_deletions WHERE source_table = 'form_submit_failed'")).intValue()

  private def pass(offsetSeconds: Long): Int = {
    clock.offsetSeconds = offsetSeconds
    try await(drain.runPass()) finally clock.offsetSeconds = 0L
  }

  "a form submit whose append future fails" should {

    "queue the objects behind the grace window when the append rolled back, delete them after the grace, and leave no row" in {
      clearQueue()
      val src = seedSource(); fs.files.clear()
      // a wrong-shaped (valid JSONB) declared schema makes the in-lock append throw after phase 1 read it fine
      val sub = submission(syncThrow = false)
      val before = fs.files.keySet().toArray.map(_.toString).toSet
      fs.onWrite = (_, p, b) => {
        fs.files.put(p, b)
        db.run(sqlu"""UPDATE data_sources SET dataset_schema = '{"x":1}'::jsonb WHERE id = $src""").map(_ => ())
      }
      val result = try submit(sub, src, Map("photo" -> (("report.pdf", "bytes".getBytes("UTF-8"))))) finally fs.onWrite = (_, p, b) => { fs.files.put(p, b); Future.unit }
      result.isFailure shouldBe true
      rowCount(src) shouldBe 0
      val keys = newFormKeys(before)
      keys should have size 1
      val queued = queueRows()
      queued.map(_._1).toSet shouldBe keys
      queued.head._3 shouldBe true
      val secondsAhead = (queued.head._4.toInstant.toEpochMilli - Instant.now().toEpochMilli) / 1000
      secondsAhead should (be >= 800L and be <= 900L)
      pass(0)                               // inside the grace window: untouched
      fs.files.containsKey(keys.head) shouldBe true
      pass(1000)                            // past it: no committed row holds the key -> deleted
      fs.files.containsKey(keys.head) shouldBe false
      queueRows() shouldBe empty
    }

    "queue the objects when the append COMMITTED and a synchronous post-commit throw failed the future, and keep them" in {
      clearQueue()
      val src = seedSource(); fs.files.clear()
      val sub = submission(syncThrow = true)
      val result = submit(sub, src, Map("photo" -> (("report.pdf", "bytes".getBytes("UTF-8")))))
      result match {
        case Failure(e) => e.getMessage should include("synchronous trigger failure")
        case Success(v) => fail(s"expected the future to fail, got $v")
      }
      rowCount(src) shouldBe 1
      val keys = fs.files.keySet().toArray.map(_.toString).toSet
      keys should have size 1
      val queued = queueRows()
      queued.map(_._1).toSet shouldBe keys
      queued.head._3 shouldBe true
      ((queued.head._4.toInstant.toEpochMilli - Instant.now().toEpochMilli) / 1000) should (be >= 800L and be <= 900L)
      pass(1000)                            // grace over: the committed row holds the key -> dequeued, NOT deleted
      fs.files.containsKey(keys.head) shouldBe true
      queueRows() shouldBe empty
    }

    "return the original failure even when queueing the objects itself fails" in {
      clearQueue()
      val src = seedSource(); fs.files.clear()
      val brokenQueue = new StoredObjectDeletionRepository(ctx) {
        override def enqueue(keys: Seq[String], sourceTable: String, notBefore: Instant): Future[Unit] =
          Future.failed(new IllegalStateException("boom: enqueue"))
      }
      val result = submit(submission(syncThrow = true, brokenQueue), src, Map("photo" -> (("report.pdf", "bytes".getBytes("UTF-8")))))
      result match {
        case Failure(e) => e.getMessage should include("synchronous trigger failure")
        case Success(v) => fail(s"expected the future to fail, got $v")
      }
      fs.files.size() shouldBe 1 // left in place: a leak, never a wrong delete
    }
  }

  "storing several files" should {
    "remove every file already written when a sibling write fails, even one still in flight" in {
      clearQueue()
      val src = seedSource(); fs.files.clear(); fs.resetCalls()
      // call 0: slow success (lands AFTER the failing sibling has already failed); call 1: immediate failure
      fs.onWrite = (n, p, b) =>
        if (n == 0) Future { Thread.sleep(400); fs.files.put(p, b); () }
        else Future.failed(new IllegalStateException("boom: write"))
      val sub = submission(syncThrow = false)
      val result = try submit(sub, src, Map("photo" -> (("a.pdf", "a".getBytes("UTF-8"))), "photo2" -> (("b.pdf", "b".getBytes("UTF-8")))))
                   finally fs.onWrite = (_, p, b) => { fs.files.put(p, b); Future.unit }
      result.isFailure shouldBe true
      Thread.sleep(600)                                   // let any straggler land
      fs.files.size() shouldBe 0
      rowCount(src) shouldBe 0
    }
  }
}
