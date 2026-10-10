package com.helio.services.pipelines

import com.helio.api.protocols.pipelines.{CreatePipelineRequest, CreatePipelineRootRequest, CreatePipelineTransactionalOutputRequest, CreatePipelineTransactionalStepRequest}
import com.helio.api.protocols.sources.{StaticColumnPayload, StaticDataPayload}
import com.helio.domain.engine.SchemaField
import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.ServiceError
import com.helio.services.sources.{DataSourceService, SourceService}
import com.helio.testkit.TempDirectorySupport
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.Behaviors
import org.apache.pekko.stream.{Materializer, SystemMaterializer}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.util.Try
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1469: the compensating delete of an inline root source must run on a FAILED Future (not only a
 *  `Left`) and re-raise the ORIGINAL exception, and a cleanup that itself fails must never replace the
 *  original error. Repositories are subclassed so the post-creation call can be made to throw.
 *
 *  The "cleanup fails" case is a GUARD, not a red-first test: it pins that the original error survives
 *  a failing cleanup; it was shown failable by temporarily returning the cleanup error instead. */
class PipelineCreateInlineSourceCleanupSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll with TempDirectorySupport {

  private implicit val ec: ExecutionContext = ExecutionContext.global
  private implicit val typedSystem: ActorSystem[Nothing] = ActorSystem(Behaviors.empty, "hel1469-cleanup-spec")
  private implicit val mat: Materializer = SystemMaterializer(typedSystem).materializer

  private final class FaultyDataSourceRepository(ctx: DbContext) extends DataSourceRepository(ctx) {
    @volatile var failFindInternal = false
    @volatile var failDelete       = false
    override def findByIdInternal(id: DataSourceId): Future[Option[DataSource]] =
      if (failFindInternal) Future.failed(new IllegalStateException("boom: findByIdInternal")) else super.findByIdInternal(id)
    override def delete(id: DataSourceId, user: AuthenticatedUser): Future[Boolean] =
      if (failDelete) Future.failed(new IllegalStateException("boom: delete")) else super.delete(id, user)
  }

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var dataSourceRepo: FaultyDataSourceRepository = _
  @volatile private var failPipelineCreate = false
  private var service: PipelineService = _

  private val ownerId = UUID.randomUUID().toString
  private val owner   = AuthenticatedUser(UserId(ownerId))

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx = new DbContext(db, db)
    dataSourceRepo = new FaultyDataSourceRepository(ctx)
    val pipelineRepo = new PipelineRepository(ctx, dataSourceRepo) {
      override def create(name: String, sourceDataSourceIds: Vector[DataSourceId], user: AuthenticatedUser, tag: Option[String]) =
        if (failPipelineCreate) Future.failed(new IllegalStateException("boom: pipelineRepo.create"))
        else super.create(name, sourceDataSourceIds, user, tag)
    }
    val tmp = newTempDir("hel1469-cleanup-spec")
    service = new PipelineService(
      pipelineRepo, new PipelineStepRepository(ctx), dataSourceRepo, outputRepo = new OutputRepository(ctx),
      sourceService = new SourceService(dataSourceRepo, connector = null),
      dataSourceService = new DataSourceService(dataSourceRepo, new LocalFileSystem(tmp))
    )
    import PostgresProfile.api._
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($ownerId::uuid, ${s"owner-$ownerId@helio.test"}, now())"""))
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); typedSystem.terminate(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 20.seconds)

  private def ownedSourceCount(): Int = {
    import PostgresProfile.api._
    await(db.run(sql"SELECT count(*) FROM data_sources WHERE owner_id = $ownerId::uuid".as[Int])).head
  }

  private def inlineRoot(): CreatePipelineRootRequest =
    CreatePipelineRootRequest(
      `type`       = Some("dataset"),
      name         = Some(s"inline-${UUID.randomUUID()}"),
      staticConfig = Some(StaticDataPayload(Vector(StaticColumnPayload("amount", "number")), Vector(Vector(JsNumber(1)))))
    )

  private def existingSource(): DataSourceId = {
    val now    = Instant.now()
    val source = DatasetSource(DataSourceId(UUID.randomUUID().toString), "existing", owner.id, now, now, inferredSchema = Vector(SchemaField("amount", "float")))
    await(dataSourceRepo.insert(source, owner)).id
  }

  /** A join step with a source-kind secondary (join/lookup only -- see `secondarySourceIdOf`): forces `resolveSecondarySourceSchemas` to call `findByIdInternal`. */
  private def joinStep(secondary: DataSourceId) = CreatePipelineTransactionalStepRequest(
    "j", "join",
    JsObject("secondaryInput" -> JsObject("kind" -> JsString("source"), "dataSourceId" -> JsString(secondary.value)), "joinKey" -> JsString("amount"), "joinType" -> JsString("inner"))
  )

  "PipelineService.create inline-source compensation (HEL-1469)" should {

    "delete the inline source and re-raise the ORIGINAL exception when a transactional-path post-creation call fails" in {
      val secondary = existingSource()
      val before    = ownedSourceCount()
      dataSourceRepo.failFindInternal = true
      val outcome = Try(await(service.create(CreatePipelineRequest("p", Vector(inlineRoot()), steps = Vector(joinStep(secondary))), owner)))
      dataSourceRepo.failFindInternal = false
      val thrown = outcome.failed.getOrElse(fail(s"expected a failed Future, got $outcome"))
      thrown.getMessage shouldBe "boom: findByIdInternal"
      ownedSourceCount() shouldBe before
    }

    "delete the inline source and re-raise the ORIGINAL exception when the simple path's pipelineRepo.create fails" in {
      val before = ownedSourceCount()
      failPipelineCreate = true
      val thrown =
        try intercept[IllegalStateException](await(service.create(CreatePipelineRequest("p", Vector(inlineRoot())), owner)))
        finally failPipelineCreate = false
      thrown.getMessage shouldBe "boom: pipelineRepo.create"
      ownedSourceCount() shouldBe before
    }

    // GUARD (not red-first): a failing cleanup is logged and never replaces the original error.
    "return the ORIGINAL error when the compensating delete itself fails (guard)" in {
      val out = CreatePipelineTransactionalOutputRequest(None, "metric", "o", config = Some(JsObject("fieldMapping" -> JsObject("value" -> JsString("does_not_exist")))))
      dataSourceRepo.failDelete = true
      val result =
        try await(service.create(CreatePipelineRequest("p", Vector(inlineRoot()), outputs = Vector(out)), owner))
        finally dataSourceRepo.failDelete = false
      result match {
        case Left(ServiceError.BadRequest(msg)) => msg should include("does_not_exist")
        case other                              => fail(s"expected the original 400, got $other")
      }
    }
  }
}
