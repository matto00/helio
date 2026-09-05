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

/** HEL-844 task 1.4 / 4b.2: `SourceService.createRest`'s bare-`url` dual-support path
 *  (design.md D6a) is the FOURTH silent collapse point in the widened repro --
 *  `SourceService.scala:113` used to destructure `splitUrl`'s query pairs away entirely, so a
 *  source created as `url = "http://host/x?tag=a&tag=b"` issued NEITHER value. This proves the
 *  fix end to end against a REAL bound local HTTP server: create through `SourceService`, then
 *  fetch through the SAME persisted Connector/config via `RestApiConnectorDriver` (no
 *  `fetchOverride`), and assert on the query string the server actually received. */
class SourceServiceBareUrlQueryParamsSpec extends AnyWordSpec with Matchers with ScalatestRouteTest with BeforeAndAfterAll {

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
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES (${owner.value}::uuid, ${s"${owner.value}@bare-url-qp-spec.test"}, now())"""))

    val echoRoute =
      path("data") {
        get {
          extractRequest { req =>
            val raw = req.uri.rawQueryString.getOrElse("")
            complete(HttpEntity(ContentTypes.`application/json`, JsObject("rawQuery" -> JsString(raw)).compactPrint))
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

  "SourceService.createRest bare-url path (HEL-844)" should {

    "carries both values of a repeated query key from the bare URL through to the persisted config and the real fetch" in {
      val svc     = new SourceService(dataSourceRepo, restConnector(Right(JsArray())), connectorRepo = connectorRepo)
      val payload = RestApiConfigPayload(url = Some(urlFor("/data?tag=a&tag=b")), method = Some("GET"))
      val request = CreateSourceRequest("BareUrlQP", DataSourceKind.RestApi, payload, None)

      val created = await(svc.createRest(request, user)) match {
        case Right(r) => r
        case Left(e)  => fail(s"createRest failed: $e")
      }

      // Read back the actual persisted domain config -- not a re-derivation -- and re-issue it
      // through a driver with NO fetchOverride, against the real bound server.
      val stored = await(dataSourceRepo.findByIdOwned(DataSourceId(created.source.id), user))
        .getOrElse(fail("expected the just-created source to be found"))
      val restConfig = stored match {
        case r: RestSource => r.config
        case other          => fail(s"expected a RestSource, got $other")
      }
      restConfig.queryParams.pairs should contain theSameElementsInOrderAs Vector("tag" -> "a", "tag" -> "b")

      val admitLocalhost: (String, InetAddress) => Boolean =
        (host, addr) => if (host == "localhost") false else ContentSourceSupport.isBlockedAddress(addr)
      val realDriver = new RestApiConnectorDriver(connectorRepoOpt = Some(connectorRepo), credentialRepoOpt = Some(credRepo), isBlocked = admitLocalhost)
      val Right(body) = await(realDriver.fetch(restConfig, ConnectorResolveContext.Owned(user))): @unchecked
      body.asJsObject.fields("rawQuery") shouldBe JsString("tag=a&tag=b")
    }
  }
}
