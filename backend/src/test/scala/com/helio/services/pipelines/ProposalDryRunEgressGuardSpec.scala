package com.helio.services.pipelines

import com.helio.api.protocols.pipelines.{CreatePipelineTransactionalOutputRequest, PipelineProposal, PipelineProposalSource, ProposalRestApiConfig}
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ConnectorCredentialRepository
import com.helio.infrastructure.persistence.sources.{ConnectorRepository, DataSourceRepository}
import com.helio.services.ServiceError
import com.helio.services.auth.{EncryptedSecretBackend, EnvMasterKeyProvider}
import com.helio.services.ratelimit.SourceFetchBudget
import com.helio.services.sources.{ContentSourceSupport, SourceService}
import com.helio.testkit.{HelioRouteTest, VerifiedEmbeddedPostgres}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.Http
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity}
import org.apache.pekko.http.scaladsl.server.Directives._
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import spray.json._

import java.net.InetAddress
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, Future}

/** HEL-1727: pins the SSRF egress guard on the propose-time dry-run fetch of an inline REST root. The target is a REAL
 *  in-test server bound to the literal loopback address `127.0.0.1` (resolved without DNS; no outbound network call is
 *  possible) that counts the requests reaching it, and the driver is the real [[RestApiConnectorDriver]] with the default
 *  egress guard and NO `fetchOverride` (an override short-circuits before the guard and would prove nothing). If a later
 *  change routes the dry-run fetch around `issueAndParse`'s guard, the server is hit and this spec goes red. The final case
 *  admits the literal host, proving the server IS reachable when the guard allows it, so a zero hit count is not vacuous. */
class ProposalDryRunEgressGuardSpec extends AnyWordSpec with Matchers with HelioRouteTest with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped

  private var embeddedPostgres: EmbeddedPostgres   = _
  private var db: JdbcBackend.Database             = _
  private var dataSourceRepo: DataSourceRepository = _
  private var connectorRepo: ConnectorRepository   = _
  private var credRepo: ConnectorCredentialRepository = _
  private var binding: Http.ServerBinding          = _
  private var port: Int                            = _

  private val hits = new AtomicInteger(0)
  private val user = AuthenticatedUser(UserId(UUID.randomUUID().toString))

  private def url: String = s"http://127.0.0.1:$port/rows"

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure().dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres").locations("classpath:db/migration").load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx = new DbContext(db, db)
    dataSourceRepo = new DataSourceRepository(ctx)
    credRepo       = new ConnectorCredentialRepository(ctx, new EncryptedSecretBackend(new EnvMasterKeyProvider()))
    connectorRepo  = new ConnectorRepository(ctx, credRepo)
    import slick.jdbc.PostgresProfile.api._
    Await.result(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES (${user.id.value}::uuid, ${s"${user.id.value}@dry-run-egress.test"}, now())"""), 10.seconds)

    val route = pathPrefix("rows") {
      extractRequest { _ =>
        hits.incrementAndGet()
        complete(HttpEntity(ContentTypes.`application/json`, """[{"x":1,"y":2}]"""))
      }
    }
    binding = Await.result(Http(typedSystem.classicSystem).newServerAt("127.0.0.1", 0).bind(route), 10.seconds)
    port    = binding.localAddress.getPort
  }

  override def afterAll(): Unit = {
    Await.ready(binding.unbind(), 10.seconds)
    db.close(); embeddedPostgres.close()
    super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 20.seconds)

  /** The real driver; only `isBlocked` may be widened (the default guard otherwise), never `fetchOverride`. */
  private def service(isBlocked: (String, InetAddress) => Boolean): PipelineProposalService = {
    val driver        = new RestApiConnectorDriver(connectorRepoOpt = Some(connectorRepo), credentialRepoOpt = Some(credRepo), isBlocked = isBlocked)
    val sourceService = new SourceService(dataSourceRepo, driver, connectorRepo = connectorRepo)
    new PipelineProposalService(sourceService, null, null, null, dataSourceRepo, null, SourceFetchBudget.default())
  }

  private val defaultGuard: (String, InetAddress) => Boolean = (_, addr) => ContentSourceSupport.isBlockedAddress(addr)

  private def proposal: PipelineProposal = {
    val root  = PipelineProposalSource(None, Some(DataSourceKind.RestApi), Some("Inline"), None, Some(ProposalRestApiConfig(url = Some(url))), None, None, None)
    val chart = CreatePipelineTransactionalOutputRequest(
      None, "chart", "Out", Some("""{"chartType":"bar","fieldMapping":{"xAxis":"x","yAxis":"y"}}""".parseJson.asJsObject), None
    )
    PipelineProposal("P", Vector(root), Vector.empty, Vector(chart))
  }

  "the propose-time dry-run fetch of an inline REST root at a loopback URL" should {

    "be refused by the egress guard: the rejection quotes the guard's text and the server receives no request" in {
      hits.set(0)
      val guardText = ContentSourceSupport.validateAndResolve(url).left.toOption.getOrElse(fail("the guard admitted loopback"))
      val result    = await(service(defaultGuard).validate(proposal, user))

      val err = result.swap.toOption.getOrElse(fail("a loopback dry-run fetch was accepted"))
      err shouldBe a[ServiceError.BadRequest]
      err.message should include("could not read the source schema")
      err.message should include(guardText)
      hits.get shouldBe 0
    }

    "reach the server when the guard admits the host (so the zero hit count above is not vacuous)" in {
      hits.set(0)
      val admitLoopback: (String, InetAddress) => Boolean = (host, addr) => if (host == "127.0.0.1") false else ContentSourceSupport.isBlockedAddress(addr)
      val result = await(service(admitLoopback).validate(proposal, user))

      // admitted: the server's rows have columns x and y, which the chart maps, so the proposal is accepted
      result shouldBe Right(())
      hits.get should be >= 1
    }
  }
}
