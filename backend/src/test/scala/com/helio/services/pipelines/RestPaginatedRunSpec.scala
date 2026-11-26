package com.helio.services.pipelines

import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ConnectorCredentialRepository
import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputRepository, PipelineRepository, PipelineRunRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.{ConnectorRepository, DataSourceRepository}
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.sources.ContentSourceSupport
import com.helio.spark.PipelineRunCache
import com.helio.testkit.{TempDirectorySupport, VerifiedEmbeddedPostgres}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.Behaviors
import org.apache.pekko.http.scaladsl.Http
import org.apache.pekko.http.scaladsl.model._
import org.apache.pekko.http.scaladsl.model.headers.RawHeader
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.net.InetAddress
import java.nio.file.Paths
import java.time.Instant
import java.util.UUID
import java.util.concurrent.ConcurrentLinkedQueue
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.jdk.CollectionConverters._

/** HEL-1013: a REAL pipeline run (`PipelineRunService.submit`) over a REST source with `pagination`, against a local paged
 *  stub and the real driver with NO `fetchOverride` (an override disables paging by design). Proves the paged-truncation
 *  signal end to end: the run result, the persisted `truncated_reads` write and the run history read, and that the api_key
 *  query parameter is re-applied on followed pages. */
class RestPaginatedRunSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll with TempDirectorySupport {

  private implicit val typedSystem: ActorSystem[Nothing] = ActorSystem(Behaviors.empty, "rest-paginated-run-spec")
  private implicit val ec: ExecutionContext              = typedSystem.executionContext

  private val log                         = new ConcurrentLinkedQueue[String]()
  private var binding: Http.ServerBinding = _
  private var port: Int                   = _

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var service: PipelineRunService        = _

  private val dummyUser = AuthenticatedUser(UserId("00000000-0000-0000-0000-000000000001"))
  private val PageRows  = 500
  private val Secret    = "sekret"

  private def rows(from: Int, n: Int): String = (from until from + n).map(i => s"""{"id":$i}""").mkString("[", ",", "]")

  private def handle(req: HttpRequest): Future[HttpResponse] = {
    log.add(req.uri.toRelative.toString)
    val p = req.uri.query().get("p").fold(1)(_.toInt)
    val response = req.uri.path.toString match {
      case "/big" =>
        val key  = req.uri.query().get("key").fold("")(k => s"&key=$k")
        val next = if (p < 4) List(RawHeader("Link", s"""<http://localhost:$port/big?p=${p + 1}$key>; rel="next"""")) else Nil
        HttpResponse(entity = HttpEntity(ContentTypes.`application/json`, rows((p - 1) * PageRows + 1, PageRows)), headers = next)
      case "/single" => HttpResponse(entity = HttpEntity(ContentTypes.`application/json`, rows(1, 1500)))
      case _         => HttpResponse(StatusCodes.NotFound)
    }
    Future.successful(response)
  }

  private def connector(id: String, config: String): Connector =
    Connector(ConnectorId(id), dummyUser.id, id, DataSourceKind.RestApi, s"http://localhost:$port", config, Some(ConnectorCredentialId("cred")), Instant.EPOCH, Instant.EPOCH)

  private lazy val connectors: Map[String, Connector] = Map(
    "c-plain" -> connector("c-plain", "{}"),
    "c-key"   -> connector("c-key", """{"authType":"api_key","apiKeyName":"key","apiKeyPlacement":"query"}""")
  )

  override def beforeAll(): Unit = {
    binding = Await.result(Http(typedSystem.classicSystem).newServerAt("localhost", 0).bind(handle _), 10.seconds)
    port = binding.localAddress.getPort
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure().dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres").locations("classpath:db/migration").load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx            = new DbContext(db, db)
    val dataSourceRepo = new DataSourceRepository(ctx)
    val connectorRepo = new ConnectorRepository(null, null) {
      override def findByIdInternal(id: ConnectorId): Future[Option[Connector]] = Future.successful(connectors.get(id.value))
    }
    val credentialRepo = new ConnectorCredentialRepository(null, null) {
      override def decryptForUse(id: ConnectorCredentialId, ownerId: UserId): Future[Option[String]] = Future.successful(Some(Secret))
    }
    val driver = new RestApiConnectorDriver(
      connectorRepoOpt = Some(connectorRepo),
      credentialRepoOpt = Some(credentialRepo),
      isBlocked = (host, addr) => if (host == "localhost") false else ContentSourceSupport.isBlockedAddress(addr)
    )
    service = new PipelineRunService(
      new PipelineRepository(ctx, dataSourceRepo), new PipelineStepRepository(ctx), dataSourceRepo, new PipelineRunRepository(ctx),
      new PipelineRunCache(), registry = null, new LocalFileSystem(Paths.get("/")), connector = driver,
      isBlocked = (host, addr) => if (host == "localhost") false else ContentSourceSupport.isBlockedAddress(addr),
      outputRepo = new OutputRepository(ctx), nodeSnapshotRepo = new NodeSnapshotRepository(ctx)
    )
  }

  override def afterAll(): Unit = {
    Await.ready(binding.unbind(), 10.seconds)
    db.close(); embeddedPostgres.close(); typedSystem.terminate()
    super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 60.seconds)

  private def seedPipeline(connectorId: String, endpoint: String, queryParams: String, pagination: Option[String]): PipelineId = {
    import PostgresProfile.api._
    val dsId   = UUID.randomUUID().toString
    val pid    = UUID.randomUUID().toString
    val stepId = UUID.randomUUID().toString
    val paging = pagination.fold("")(p => s""","pagination":$p""")
    val config = s"""{"connectorId":"$connectorId","endpoint":"$endpoint","queryParams":$queryParams$paging}"""
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($dsId, 'paged-rest', 'rest_api', $config, '00000000-0000-0000-0000-000000000001', now(), now())""",
      sqlu"""INSERT INTO pipelines (id, name, created_at, updated_at) VALUES ($pid, 'pipe', now(), now())""",
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($pid, $pid, $dsId, 0)""",
      sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled, created_at, updated_at, parent_step_id, root_id)
             VALUES ($stepId, $pid, 0, 'limit', '{"count":2000}', true, now(), now(), NULL, $pid)"""
    )))
    PipelineId(pid)
  }

  private val firstPage = """[{"name":"p","value":"1"}]"""

  "A real run over a paged REST source that exceeds the row cap (HEL-1013)" should {
    "report pagesFetched and rowsRead == cap on the run result, and persist both to run history" in {
      log.clear()
      val pid    = seedPipeline("c-plain", "/big", firstPage, Some("""{"style":"link"}"""))
      val result = await(service.submit(pid, isDry = false, dummyUser))
      result shouldBe a[Right[_, _]]
      val response = result.toOption.get

      response.sourceTruncated shouldBe true
      response.sourceRowCount shouldBe 1000L
      response.truncatedReads should have size 1
      response.truncatedReads.head.rowsRead shouldBe 1000L
      response.truncatedReads.head.pagesFetched shouldBe Some(3)
      response.truncatedReads.head.availableRowCount shouldBe None
      response.truncationNotice.get should include("across 3 pages")
      log.asScala.toVector should have size 3

      val persisted = await(service.history(pid, dummyUser)).toOption.get.head.truncation.get
      persisted.reads.map(r => (r.rowsRead, r.pagesFetched)) shouldBe Vector((1000L, Some(3)))
      persisted.notice.get should include("across 3 pages")
    }

    "report no pagesFetched for a single-request truncation on the same harness" in {
      val pid      = seedPipeline("c-plain", "/single", "[]", None)
      val response = await(service.submit(pid, isDry = false, dummyUser)).toOption.get
      response.sourceTruncated shouldBe true
      response.truncatedReads.map(_.pagesFetched) shouldBe Vector(None)
      response.truncatedReads.head.availableRowCount shouldBe Some(1500L)
      await(service.history(pid, dummyUser)).toOption.get.head.truncation.get.reads.map(_.pagesFetched) shouldBe Vector(None)
    }

    "re-apply the api_key query parameter on every followed page" in {
      log.clear()
      val pid = seedPipeline("c-key", "/big", firstPage, Some("""{"style":"link"}"""))
      await(service.submit(pid, isDry = false, dummyUser)) shouldBe a[Right[_, _]]
      val requests = log.asScala.toVector
      requests should have size 3
      requests.foreach(_ should include(s"key=$Secret"))
    }
  }
}
