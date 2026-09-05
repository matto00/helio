package com.helio.services.sources

import com.helio.api.protocols.sources.{CreateSourceRequest, RestApiConfigPayload}
import com.helio.domain.connectors.{ConnectorResolveContext, RestApiConnectorDriver}
import java.net.InetAddress
import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ConnectorCredentialRepository
import com.helio.infrastructure.persistence.sources.{ConnectorRepository, DataSourceRepository}
import com.helio.services.auth.{EncryptedSecretBackend, EnvMasterKeyProvider}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.Http
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity}
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.apache.pekko.stream.{Materializer, SystemMaterializer}
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import spray.json._

import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, Future}

/** HEL-983: `SourceService.createRest`'s bare-`url` branch (design.md D6a) builds
 *  `RestApiConfig` by hand and used to omit `parameters` entirely, so a caller-supplied
 *  `parameters` map used to resolve `{{name}}` placeholders in `queryParams`/`headers` was
 *  silently discarded at creation time. This proves the fix end to end against a REAL bound
 *  local HTTP server: create through `SourceService`, then fetch through the SAME persisted
 *  Connector/config via `RestApiConnectorDriver` (no `fetchOverride`), and assert on the
 *  query string and headers the server actually received (design.md D5). */
class SourceServiceBareUrlParametersSpec extends AnyWordSpec with Matchers with ScalatestRouteTest with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private implicit val mat: Materializer                 = SystemMaterializer(typedSystem).materializer

  private var embeddedPostgres: EmbeddedPostgres   = _
  private var db: JdbcBackend.Database             = _
  private var ctx: DbContext                       = _
  private var dataSourceRepo: DataSourceRepository = _
  private var connectorRepo: ConnectorRepository   = _
  private var credRepo: ConnectorCredentialRepository = _

  private var testServerBinding: Http.ServerBinding = _
  private var testServerPort: Int                   = _
  private def urlFor(path: String): String = s"http://localhost:$testServerPort$path"

  private val owner = UserId(UUID.randomUUID().toString)
  private val user  = AuthenticatedUser(owner)

  @volatile private var receivedQuery: String            = ""
  @volatile private var receivedHeader: Option[String]   = None

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()
    db             = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    ctx            = new DbContext(db, db)
    dataSourceRepo = new DataSourceRepository(ctx)
    credRepo       = new ConnectorCredentialRepository(ctx, new EncryptedSecretBackend(new EnvMasterKeyProvider()))
    connectorRepo  = new ConnectorRepository(ctx, credRepo)
    import slick.jdbc.PostgresProfile.api._
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES (${owner.value}::uuid, ${s"${owner.value}@bare-url-params-spec.test"}, now())"""))

    val echoRoute =
      path("data") {
        get {
          extractRequest { req =>
            receivedQuery = req.uri.rawQueryString.getOrElse("")
            receivedHeader = req.headers.find(_.is("x-account")).map(_.value())
            complete(HttpEntity(ContentTypes.`application/json`, JsObject("ok" -> JsBoolean(true)).compactPrint))
          }
        }
      }
    testServerBinding = Await.result(Http(typedSystem.classicSystem).newServerAt("localhost", 0).bind(echoRoute), 10.seconds)
    testServerPort    = testServerBinding.localAddress.getPort
  }

  override def afterAll(): Unit = {
    Await.ready(testServerBinding.unbind(), 10.seconds)
    db.close(); embeddedPostgres.close()
    super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def restConnector(response: Either[String, JsValue]): RestApiConnectorDriver =
    new RestApiConnectorDriver(fetchOverride = Some(_ => Future.successful(response)))

  "SourceService.createRest bare-url path (HEL-983)" should {

    "carries a caller-supplied parameters map through to the persisted config and resolves templates on the real fetch" in {
      val svc = new SourceService(dataSourceRepo, restConnector(Right(JsArray())), connectorRepo = connectorRepo)
      val payload = RestApiConfigPayload(
        url         = Some(urlFor("/data?account={{accountId}}")),
        method      = Some("GET"),
        headers     = Some(Map("X-Account" -> "{{accountId}}")),
        parameters  = Some(Map("accountId" -> "acct-42"))
      )
      val request = CreateSourceRequest("BareUrlParams", DataSourceKind.RestApi, payload, None)

      val created = await(svc.createRest(request, user)) match {
        case Right(r) => r
        case Left(e)  => fail(s"createRest failed: $e")
      }

      val stored = await(dataSourceRepo.findByIdOwned(DataSourceId(created.source.id), user))
        .getOrElse(fail("expected the just-created source to be found"))
      val restConfig = stored match {
        case r: RestSource => r.config
        case other          => fail(s"expected a RestSource, got $other")
      }

      // Acceptance-bearing assertion (design.md D5): what a real bound server received, via
      // the SAME persisted Connector/config, with no `fetchOverride`. Run first, ahead of the
      // narrower persisted-map assertion below, so the guard's failure signature (an
      // unresolved template variable) is what a broken build actually surfaces, rather than
      // being masked by the narrower check aborting the test first.
      val admitLocalhost: (String, InetAddress) => Boolean =
        (host, addr) => if (host == "localhost") false else ContentSourceSupport.isBlockedAddress(addr)
      val realDriver = new RestApiConnectorDriver(connectorRepoOpt = Some(connectorRepo), credentialRepoOpt = Some(credRepo), isBlocked = admitLocalhost)
      val fetchResult = await(realDriver.fetch(restConfig, ConnectorResolveContext.Owned(user)))
      fetchResult shouldBe a[Right[_, _]]
      receivedQuery shouldBe "account=acct-42"
      receivedHeader shouldBe Some("acct-42")

      // Secondary, narrower assertion (design.md D5) -- localizes a failure to persistence
      // alone if it ever regresses independently of resolution.
      restConfig.parameters shouldBe Map("accountId" -> "acct-42")
    }
  }
}
