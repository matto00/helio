package com.helio.services.pipelines

import com.helio.api.protocols.pipelines.{ConciseAnalyzeNode, CreatePipelineRootRequest, CreatePipelineRequest, CreatePipelineStepRequest, PipelineAnalyzeConciseResponse}
import com.helio.api.protocols.sources.{StaticColumnPayload, StaticDataSourceRequest}
import com.helio.domain.model.{AuthenticatedUser, PipelineId, UserId}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.{PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.sources.DataSourceService
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import spray.json._
import com.helio.api.JsonProtocols

import java.nio.file.Files
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-914 task 6.5/D6: proves the named byte budget ([[PipelineAnalyzeConciseResponse.ByteBudget]])
 *  actually distinguishes the two modes on the SAME graph -- a 12-node, 2-root pipeline whose
 *  roots carry 40 columns combined. Both directions are required (design.md D6): a budget
 *  generous enough for both modes to pass would be decorative. */
class PipelineAnalyzeConciseByteBudgetSpec extends AnyWordSpec with Matchers with ScalatestRouteTest with BeforeAndAfterAll with JsonProtocols {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped

  private var embeddedPostgres: EmbeddedPostgres       = _
  private var db: JdbcBackend.Database                 = _
  private var pipelineRepo: PipelineRepository         = _
  private var pipelineStepRepo: PipelineStepRepository = _
  private var dataSourceRepo: DataSourceRepository     = _
  private var dataSourceService: DataSourceService     = _
  private var pipelineService: PipelineService         = _

  private val user = AuthenticatedUser(UserId(UUID.randomUUID().toString))

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx = new DbContext(db, db)

    dataSourceRepo    = new DataSourceRepository(ctx)
    pipelineRepo      = new PipelineRepository(ctx, dataSourceRepo)
    pipelineStepRepo  = new PipelineStepRepository(ctx)
    val fileSystem    = new LocalFileSystem(Files.createTempDirectory("analyze-concise-budget-spec"))
    dataSourceService = new DataSourceService(dataSourceRepo, fileSystem)
    pipelineService   = new PipelineService(pipelineRepo, pipelineStepRepo, dataSourceRepo)

    import slick.jdbc.PostgresProfile.api._
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES (${user.id.value}::uuid, ${s"u-${user.id.value}@helio.test"}, now())"""))
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def wideSource(name: String, columnCount: Int): String = {
    val columns = (1 to columnCount).map(i => StaticColumnPayload(s"col_$i", "string")).toVector
    val rows    = Vector(columns.indices.map(i => JsString(s"v$i"): JsValue).toVector)
    await(dataSourceService.createStatic(StaticDataSourceRequest(name, "static", columns, rows), user)) match {
      case Right(ds) => ds.id.value
      case Left(e)   => fail(s"createStatic failed: $e")
    }
  }

  "GET /pipelines/:id/analyze concise mode" should {
    "fit a 12-node/40-column/2-root graph within the byte budget, while full mode exceeds it on the SAME graph" in {
      val root0 = wideSource("Root 0 (20 cols)", 20)
      val root1 = wideSource("Root 1 (20 cols)", 20)

      val pipeline = await(pipelineService.create(
        CreatePipelineRequest(
          "Wide two-root pipeline",
          Vector(
            CreatePipelineRootRequest(sourceId = Some(root0), clientId = Some("r0")),
            CreatePipelineRootRequest(sourceId = Some(root1), clientId = Some("r1"))
          )
        ),
        user
      )) match {
        case Right(s) => s
        case Left(e)  => fail(s"pipeline create failed: $e")
      }
      val pipelineId  = PipelineId(pipeline.id)
      val realRootIds = pipeline.roots.map(_.id)

      // 6 steps down each root -- 12 nodes total, none of them wide (limit), so the byte-size
      // difference between modes comes from the FULL response's per-step input/output schema
      // (40 columns' worth, repeated across every node) vs. concise's {path, op} triple.
      def addRealChain(rootId: String, n: Int): Unit = {
        var parent: Option[String] = None
        (1 to n).foreach { _ =>
          val req = CreatePipelineStepRequest(
            `type`       = "limit",
            config       = JsObject("count" -> JsNumber(100)),
            parentStepId = parent,
            rootId       = if (parent.isEmpty) Some(rootId) else None
          )
          val created = await(pipelineService.addStep(pipelineId, req, user)).fold(e => fail(s"addStep failed: $e"), identity)
          parent = Some(created.id)
        }
      }
      addRealChain(realRootIds.head, 6)
      addRealChain(realRootIds(1), 6)

      val full = await(pipelineService.analyze(pipelineId, user)).fold(e => fail(s"analyze failed: $e"), identity)
      val concise = await(pipelineService.analyzeConcise(pipelineId, user)).fold(e => fail(s"analyzeConcise failed: $e"), identity)

      concise.nodes should have size 12

      val fullBytes    = full.toJson.compactPrint.getBytes("UTF-8").length
      val conciseBytes = concise.toJson.compactPrint.getBytes("UTF-8").length

      withClue(s"concise ($conciseBytes bytes) should fit within the budget (${PipelineAnalyzeConciseResponse.ByteBudget})") {
        conciseBytes should be <= PipelineAnalyzeConciseResponse.ByteBudget
      }
      withClue(s"full ($fullBytes bytes) should EXCEED the budget on the same graph -- otherwise the budget is decorative") {
        fullBytes should be > PipelineAnalyzeConciseResponse.ByteBudget
      }
    }
  }
}
