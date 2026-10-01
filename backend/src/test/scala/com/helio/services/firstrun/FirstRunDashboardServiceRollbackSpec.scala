package com.helio.services.firstrun

import com.helio.domain.model.{AuthenticatedUser, DataSourceId, UserId}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputRepository, PipelineRepository, PipelineRootRepository, PipelineRunRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.ServiceError
import com.helio.services.pipelines.{PipelineProposalService, PipelineRunService, PipelineService}
import com.helio.services.sources.DataSourceService
import com.helio.spark.PipelineRunCache
import com.helio.testkit.TempDirectorySupport
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.Behaviors
import org.apache.pekko.stream.SystemMaterializer
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1209 design.md Decision 2: the dashboard phase runs after the pipeline is already applied
 *  (and run), so a failure there must roll the pipeline back — and must NOT delete the caller's
 *  pre-existing source. The dashboard apply is injected as a function so a failing stand-in can
 *  be used; the real `DashboardProposalService` is exercised by `FirstRunRoutesSpec`. */
class FirstRunDashboardServiceRollbackSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll with TempDirectorySupport {

  private implicit val ec: ExecutionContext             = ExecutionContext.global
  private implicit val actorSystem: ActorSystem[Nothing] = ActorSystem(Behaviors.empty, "first-run-rollback-spec")

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var dataSourceService: DataSourceService = _
  private var proposalService: PipelineProposalService = _
  private var dataSourceRepo: DataSourceRepository = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure().dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration").load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx          = new DbContext(db, db)
    dataSourceRepo   = new DataSourceRepository(ctx)
    val pipelineRepo = new PipelineRepository(ctx, dataSourceRepo)
    val stepRepo     = new PipelineStepRepository(ctx)
    val outputRepo   = new OutputRepository(ctx)
    val fs           = new LocalFileSystem(newTempDir("helio-first-run-rollback-spec"))
    dataSourceService = new DataSourceService(dataSourceRepo, fs)(ec, SystemMaterializer(actorSystem).materializer, actorSystem)
    val pipelineService = new PipelineService(pipelineRepo, stepRepo, dataSourceRepo, outputRepo = outputRepo, pipelineRootRepo = new PipelineRootRepository(ctx))
    val runService = new PipelineRunService(
      pipelineRepo, stepRepo, dataSourceRepo, new PipelineRunRepository(ctx), new PipelineRunCache, registry = null, fs,
      outputRepo = outputRepo, nodeSnapshotRepo = new NodeSnapshotRepository(ctx)
    )
    proposalService = new PipelineProposalService(null, dataSourceService, pipelineService, runService, dataSourceRepo, outputRepo)
  }

  override def afterAll(): Unit = { db.close(); embeddedPostgres.close(); actorSystem.terminate(); super.afterAll() }

  private def await[T](f: Future[T]): T = Await.result(f, 30.seconds)

  private def newUser(): AuthenticatedUser = {
    val id = UUID.randomUUID().toString
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($id::uuid, ${s"u-$id@helio.test"}, now())"""))
    AuthenticatedUser(UserId(id))
  }

  private def count(table: String, owner: AuthenticatedUser): Int = table match {
    case "pipelines"    => await(db.run(sql"SELECT COUNT(*) FROM pipelines WHERE owner_id = ${owner.id.value}::uuid".as[Int].head))
    case "data_sources" => await(db.run(sql"SELECT COUNT(*) FROM data_sources WHERE owner_id = ${owner.id.value}::uuid".as[Int].head))
    case "outputs"      => await(db.run(sql"SELECT COUNT(*) FROM outputs WHERE owner_id = ${owner.id.value}::uuid".as[Int].head))
  }

  "FirstRunDashboardService" should {
    "roll the applied pipeline (and its outputs) back when the dashboard phase fails, keeping the source" in {
      val owner  = newUser()
      val source = await(dataSourceService.createCsv("Sales", "day,amount\n2026-01-01,1\n2026-01-02,2\n".getBytes("UTF-8"), Vector.empty, owner))
        .fold(e => fail(e.toString), identity)
      val dashboardCalls = new AtomicInteger(0)
      val service = new FirstRunDashboardService(dataSourceRepo, dataSourceService, proposalService, (_, _) => {
        dashboardCalls.incrementAndGet()
        Future.successful(Left(ServiceError.BadRequest("dashboard phase failed")))
      })

      val result = await(service.build(DataSourceId(source.id.value), owner))

      result shouldBe Left(ServiceError.BadRequest("dashboard phase failed"))
      dashboardCalls.get shouldBe 1
      count("pipelines", owner) shouldBe 0
      count("outputs", owner) shouldBe 0
      count("data_sources", owner) shouldBe 1
    }
  }
}
