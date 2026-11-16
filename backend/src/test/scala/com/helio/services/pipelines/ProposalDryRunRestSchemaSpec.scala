package com.helio.services.pipelines

import com.helio.api.protocols.pipelines.{CreatePipelineTransactionalOutputRequest, CreatePipelineTransactionalStepRequest, PipelineProposal, PipelineProposalSource, ProposalRestApiConfig}
import com.helio.api.protocols.sources.{CreateSourceRequest, RestApiConfigPayload}
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.domain.engine.SchemaField
import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ConnectorCredentialRepository
import com.helio.infrastructure.persistence.sources.{ConnectorRepository, DataSourceRepository}
import com.helio.services.ServiceError
import com.helio.services.auth.{EncryptedSecretBackend, EnvMasterKeyProvider}
import com.helio.services.ratelimit.{InMemoryRateLimiter, SourceFetchBudget}
import com.helio.services.sources.{ContentSourceSupport, SourceService}
import com.helio.testkit.{HelioRouteTest, VerifiedEmbeddedPostgres}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.Http
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, StatusCodes}
import org.apache.pekko.http.scaladsl.server.Directives._
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import spray.json._

import java.net.InetAddress
import java.time.Instant
import java.util.UUID
import java.util.concurrent.ConcurrentLinkedQueue
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.jdk.CollectionConverters._

/** HEL-1638 (C10, C11, C12, round-1 fetch-failure rule): the propose-time dry run of an inline REST root, against a REAL
 *  local HTTP stub that RECORDS every request it receives (path after templating plus the ordered raw query string) and a
 *  driver with NO `fetchOverride`, so the dry run's composed request is what is measured, not a pre-templating config.
 *  `SourceService.createRest` (apply's create path) issues its own fetch to the same stub, and the two recordings must
 *  match. Extended by the later `ProposalDryRunParitySpec`. */
class ProposalDryRunRestSchemaSpec extends AnyWordSpec with Matchers with HelioRouteTest with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped

  private var embeddedPostgres: EmbeddedPostgres      = _
  private var db: JdbcBackend.Database                = _
  private var dataSourceRepo: DataSourceRepository    = _
  private var connectorRepo: ConnectorRepository      = _
  private var sourceService: SourceService            = _
  private var binding: Http.ServerBinding             = _
  private var port: Int                               = _

  private val seen = new ConcurrentLinkedQueue[String]()
  private def recorded: Vector[String] = seen.asScala.toVector
  private def urlFor(path: String): String = s"http://localhost:$port$path"

  private val owner = UserId(UUID.randomUUID().toString)
  private val user  = AuthenticatedUser(owner)

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure().dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres").locations("classpath:db/migration").load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx      = new DbContext(db, db)
    dataSourceRepo = new DataSourceRepository(ctx)
    val credRepo = new ConnectorCredentialRepository(ctx, new EncryptedSecretBackend(new EnvMasterKeyProvider()))
    connectorRepo = new ConnectorRepository(ctx, credRepo)
    import slick.jdbc.PostgresProfile.api._
    Await.result(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES (${owner.value}::uuid, ${s"${owner.value}@dry-run-rest.test"}, now())"""), 10.seconds)

    val route =
      pathPrefix("boom") {
        extractRequest { req => seen.add(s"${req.uri.path}?${req.uri.rawQueryString.getOrElse("")}"); complete(StatusCodes.InternalServerError, "nope") }
      } ~ pathPrefix("items") {
        extractRequest { req =>
          seen.add(s"${req.uri.path}?${req.uri.rawQueryString.getOrElse("")}")
          complete(HttpEntity(ContentTypes.`application/json`, """[{"id":1,"name":"x"}]"""))
        }
      }
    binding = Await.result(Http(typedSystem.classicSystem).newServerAt("localhost", 0).bind(route), 10.seconds)
    port    = binding.localAddress.getPort

    val admitLocalhost: (String, InetAddress) => Boolean = (host, addr) => if (host == "localhost") false else ContentSourceSupport.isBlockedAddress(addr)
    val driver = new RestApiConnectorDriver(connectorRepoOpt = Some(connectorRepo), credentialRepoOpt = Some(credRepo), isBlocked = admitLocalhost)
    sourceService = new SourceService(dataSourceRepo, driver, connectorRepo = connectorRepo)
  }

  override def afterAll(): Unit = {
    Await.ready(binding.unbind(), 10.seconds)
    db.close(); embeddedPostgres.close()
    super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 20.seconds)

  private def service(limit: Int = 100) =
    new PipelineProposalService(sourceService, null, null, null, dataSourceRepo, null, new SourceFetchBudget(new InMemoryRateLimiter(), limit, 60))

  private def restRoot(rest: ProposalRestApiConfig, clientId: Option[String] = None) =
    PipelineProposalSource(None, Some(DataSourceKind.RestApi), Some("Inline"), None, Some(rest), None, None, clientId)

  private def chart(node: Option[String], x: String, y: String, root: Option[String] = None) =
    CreatePipelineTransactionalOutputRequest(node, "chart", "Out",
      Some(s"""{"chartType":"bar","fieldMapping":{"xAxis":"$x","yAxis":"$y"}}""".parseJson.asJsObject), root)

  "propose-time dry run of an inline REST root" should {

    // C10: the discriminating entry. Dry run and `createRest` must put the SAME request on the wire; the recording is of the
    // composed request (templated `page`, the URL's own pair first, ordered), not of the un-templated config.
    "issue the same composed request as apply's create (queryParams + parameters templating), through the real driver" in {
      seen.clear()
      val rest = ProposalRestApiConfig(
        url         = Some(urlFor("/items?a=1")),
        queryParams = Some(QueryParams(Vector("page" -> "{{p}}", "a" -> "2"))),
        parameters  = Some(Map("p" -> "2"))
      )
      await(service().validate(PipelineProposal("P", Vector(restRoot(rest)), Vector.empty, Vector.empty), user)) shouldBe Right(())
      val dry = recorded
      dry shouldBe Vector("/items?a=1&page=2&a=2")

      seen.clear()
      val payload = RestApiConfigPayload(url = rest.url, queryParams = rest.queryParams, parameters = rest.parameters)
      val created = await(sourceService.createRest(CreateSourceRequest("Inline", DataSourceKind.RestApi, payload, None), user))
      created.map(_.fetchError) shouldBe Right(None)
      recorded shouldBe dry
    }

    // C12: the (N+1)th propose-time fetch in the window is refused with a 429-class error and does NOT fetch.
    "refuse the (N+1)th propose-time fetch in the window without fetching, charging the shared source-fetch budget" in {
      seen.clear()
      val svc      = service(limit = 2)
      val proposal = PipelineProposal("P", Vector(restRoot(ProposalRestApiConfig(url = Some(urlFor("/items"))))), Vector.empty, Vector.empty)
      val other    = AuthenticatedUser(UserId(UUID.randomUUID().toString))
      await(svc.validate(proposal, other)) shouldBe Right(())
      await(svc.validate(proposal, other)) shouldBe Right(())
      recorded.size shouldBe 2
      val third = await(svc.validate(proposal, other))
      third.swap.toOption.get shouldBe a[ServiceError.TooManyRequests]
      third.swap.toOption.get.message should include("Source fetch rate limit exceeded")
      recorded.size shouldBe 2
      // another principal has its own bucket
      await(svc.validate(proposal, AuthenticatedUser(UserId(UUID.randomUUID().toString)))) shouldBe Right(())
      recorded.size shouldBe 3
    }

    "fetch-failure rule: a failed root plus an Output on a healthy root is accepted (apply keeps the source with an empty schema)" in {
      val healthy = DataSourceId(UUID.randomUUID().toString)
      val now     = Instant.now()
      await(dataSourceRepo.insert(DatasetSource(healthy, "Healthy", owner, now, now), user))
      await(dataSourceRepo.upsertInferredSchema(healthy, Vector(SchemaField("team", "string"), SchemaField("wins", "integer")), now, user))
      val bad  = restRoot(ProposalRestApiConfig(url = Some(urlFor("/boom"))), Some("bad"))
      val good = PipelineProposalSource(Some(healthy.value), None, None, None, None, None, None, Some("good"))
      def proposal(outputs: Vector[CreatePipelineTransactionalOutputRequest], steps: Vector[CreatePipelineTransactionalStepRequest] = Vector.empty) =
        PipelineProposal("P", Vector(bad, good), steps, outputs)
      val svc = service()

      await(svc.validate(proposal(Vector(chart(None, "team", "wins", Some("good")))), user)) shouldBe Right(())

      // a column the failed root's step produces is known at that node, exactly as apply's check sees it
      val compute = CreatePipelineTransactionalStepRequest("c", "compute", """{"column":"total","expression":"1 + 1"}""".parseJson.asJsObject, rootClientId = Some("bad"))
      await(svc.validate(proposal(Vector(chart(Some("c"), "total", "total")), Vector(compute)), user)) shouldBe Right(())

      // a source column of the failed root cannot be checked: rejected, naming the fetch failure rather than "no columns"
      val err = await(svc.validate(proposal(Vector(chart(None, "team", "wins", Some("bad")))), user)).swap.toOption.getOrElse(fail("accepted"))
      err.message should include("roots[0]: could not read the source schema")
      err.message should include("HTTP 500")
      err.message should include("so fieldMapping cannot be checked")
    }
  }
}
