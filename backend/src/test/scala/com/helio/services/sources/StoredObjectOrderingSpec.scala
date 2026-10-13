package com.helio.services.sources

import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.assistant.AssistantConversationRepository
import com.helio.infrastructure.persistence.assistant.AssistantConversationRepository.AssistantConversationRecord
import com.helio.infrastructure.persistence.sources.{DataSourceRepository, ImageUploadRepository}
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.assistant.AssistantConversationService
import com.helio.testkit.{HelioRouteTest, TempDirectorySupport, VerifiedEmbeddedPostgres}
import com.helio.testsupport.UserSeeding
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.stream.{Materializer, SystemMaterializer}
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend

import java.nio.file.{Files, Path}
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.jdk.CollectionConverters._
import scala.util.Try

/** HEL-1434: the object/row ORDER on the paths that touch both.
 *
 *  - [RED-FIRST] R4: `DataSourceService.delete` removed the file BEFORE the row, so a failing row delete left a
 *    source pointing at a deleted file. After the fix the row delete goes first and a failure leaves row AND file.
 *  - [RED-FIRST] R5/R6: `ImageUploadService.upload` and `AssistantConversationService.create` wrote the object and
 *    then inserted the row with no compensation; a failing insert leaked the object. After the fix the just-written
 *    object is removed and the ORIGINAL failure is surfaced unchanged.
 *  - [GUARD] G3: a normal delete still removes the object; success paths of the two creates keep their object.
 *
 *  Real Postgres and repositories; only the repository call under test is fault-injected. */
class StoredObjectOrderingSpec extends AnyWordSpec with Matchers with HelioRouteTest with BeforeAndAfterAll with TempDirectorySupport {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private implicit val mat: Materializer                 = SystemMaterializer(typedSystem).materializer
  private def routeEc: ExecutionContext                  = typedSystem.executionContext

  private final class FaultyDataSourceRepository(ctx: DbContext) extends DataSourceRepository(ctx)(routeEc) {
    @volatile var failDelete    = false
    @volatile var zeroRowDelete = false
    override def delete(id: DataSourceId, user: AuthenticatedUser): Future[Boolean] =
      if (failDelete) Future.failed(new IllegalStateException("boom: repo delete"))
      else if (zeroRowDelete) Future.successful(false)
      else super.delete(id, user)
  }
  private final class FaultyImageRepository(ctx: DbContext) extends ImageUploadRepository(ctx)(routeEc) {
    @volatile var failInsert = false
    override def insert(upload: ImageUpload): Future[ImageUpload] =
      if (failInsert) Future.failed(new IllegalStateException("boom: image insert")) else super.insert(upload)
  }
  private final class FaultyConversationRepository(ctx: DbContext) extends AssistantConversationRepository(ctx)(routeEc) {
    @volatile var failCreate = false
    override def create(record: AssistantConversationRecord): Future[AssistantConversationRecord] =
      if (failCreate) Future.failed(new IllegalStateException("boom: conversation create")) else super.create(record)
  }

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var root: Path                         = _
  private var sourceRepo: FaultyDataSourceRepository = _
  private var imageRepo: FaultyImageRepository   = _
  private var convRepo: FaultyConversationRepository = _
  private var sourceService: DataSourceService   = _
  private var imageService: ImageUploadService   = _
  private var convService: AssistantConversationService = _

  private val user = AuthenticatedUser(UserId(UUID.randomUUID().toString))

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    UserSeeding.seedUsers(db, user.id)
    val ctx = new DbContext(db, db)(routeEc)
    root = newTempDir("helio-hel1434-order")
    val fs = new LocalFileSystem(root)(routeEc)
    sourceRepo    = new FaultyDataSourceRepository(ctx)
    imageRepo     = new FaultyImageRepository(ctx)
    convRepo      = new FaultyConversationRepository(ctx)
    sourceService = new DataSourceService(sourceRepo, fs)(routeEc, mat, typedSystem)
    imageService  = new ImageUploadService(imageRepo, fs)(routeEc)
    convService   = new AssistantConversationService(convRepo, fs)(routeEc)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 20.seconds)

  private def files(): Set[String] = {
    val stream = Files.walk(root)
    try stream.iterator().asScala.filter(Files.isRegularFile(_)).map(p => root.relativize(p).toString).toSet
    finally stream.close()
  }

  private def newCsv(): CsvSource =
    await(sourceService.createCsv("orders", "a,b\n1,2\n".getBytes("UTF-8"), Vector.empty, user)) match {
      case Right(c: CsvSource) => c
      case other               => fail(s"expected a csv source, got $other")
    }

  private def rowExists(id: DataSourceId): Boolean = await(sourceRepo.findByIdOwned(id, user)).isDefined

  "DataSourceService.delete" should {

    "R4 keep the row AND its file when the row delete fails" in {
      val source = newCsv()
      val path   = source.config.path
      files() should contain(path)
      sourceRepo.failDelete = true
      try Try(await(sourceService.delete(source.id, user))).isFailure shouldBe true
      finally sourceRepo.failDelete = false
      rowExists(source.id) shouldBe true
      files() should contain(path)
    }

    "keep the file when the row delete removed no row" in {
      val source = newCsv()
      val path   = source.config.path
      sourceRepo.zeroRowDelete = true
      try await(sourceService.delete(source.id, user)) shouldBe Right(())
      finally sourceRepo.zeroRowDelete = false
      rowExists(source.id) shouldBe true
      files() should contain(path)
    }

    "G3 [guard] still remove the file once the row is deleted" in {
      val source = newCsv()
      val path   = source.config.path
      await(sourceService.delete(source.id, user)) shouldBe Right(())
      rowExists(source.id) shouldBe false
      files() should not contain path
    }
  }

  "ImageUploadService.upload" should {

    "R5 remove the just-written object and surface the original failure when the insert fails" in {
      val before = files()
      imageRepo.failInsert = true
      val failure =
        try Try(await(imageService.upload(Array[Byte](1, 2, 3), "a.png", user))).failed.get
        finally imageRepo.failInsert = false
      failure shouldBe a[IllegalStateException]
      failure.getMessage shouldBe "boom: image insert"
      files() shouldBe before
    }

    "G3 [guard] keep the object of a successful upload" in {
      val Right(upload) = await(imageService.upload(Array[Byte](1, 2, 3), "b.png", user)): @unchecked
      files() should contain(upload.storageKey)
    }
  }

  "AssistantConversationService.create" should {

    "R6 remove the just-written transcript blob and surface the original failure when the row create fails" in {
      val before = files()
      convRepo.failCreate = true
      val failure =
        try Try(await(convService.create(user, None, Some("t")))).failed.get
        finally convRepo.failCreate = false
      failure shouldBe a[IllegalStateException]
      failure.getMessage shouldBe "boom: conversation create"
      files() shouldBe before
    }

    "G3 [guard] keep the blob of a successful create" in {
      val before = files()
      await(convService.create(user, None, Some("ok")))
      (files() -- before) should have size 1
    }
  }
}
