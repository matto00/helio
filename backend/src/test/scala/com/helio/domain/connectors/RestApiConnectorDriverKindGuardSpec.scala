package com.helio.domain.connectors

import com.helio.domain.model._
import com.helio.services.sources.ContentSourceSupport
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ConnectorCredentialRepository
import com.helio.infrastructure.persistence.sources.ConnectorRepository
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
import spray.json._
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import java.net.InetAddress
import java.security.SecureRandom
import java.util.{Base64, UUID}
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, Future}

/** HEL-845 design.md Decision 2b: a stored source bound to a non-`rest_api` Connector must be
 *  rejected at fetch time, before URI composition and before credential decryption — the only
 *  guard reachable for a mismatched row that already exists (2a only prevents new ones). Uses a
 *  real embedded-Postgres `ConnectorRepository` (mirrors
 *  `RestApiConnectorDriverConnectorResolutionSpec`) since the mismatched row must be written
 *  directly, bypassing `SourceService.createRest`'s own (now-guarding) create path entirely. */
class RestApiConnectorDriverKindGuardSpec extends AnyWordSpec with Matchers with ScalatestRouteTest with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private implicit val mat: Materializer                 = SystemMaterializer(typedSystem).materializer

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var ctx: DbContext                     = _
  private var connectorRepo: ConnectorRepository = _

  private var testServerBinding: Http.ServerBinding = _
  private var testServerPort: Int                    = _
  private def urlFor: String = s"http://localhost:$testServerPort"

  // Admits ONLY the "localhost" hostname (never widens the loopback address class) — mirrors
  // RestApiConnectorDriverConnectorResolutionSpec's own convention.
  private val admitLocalhost: (String, InetAddress) => Boolean =
    (host, addr) => if (host == "localhost") false else ContentSourceSupport.isBlockedAddress(addr)

  /** Records every `decryptForUse` invocation so the no-decrypt assertion can actually fail —
   *  design.md Decision 2b / evidence plan step 3: a fixture with no credential repo at all
   *  never decrypts regardless of the guard, so that would be a vacuous assertion. This fake
   *  delegates to the real repository (real embedded-Postgres row) while counting calls. */
  private class RecordingCredentialRepository(delegate: ConnectorCredentialRepository) extends ConnectorCredentialRepository(ctx, encryptedBackend) {
    @volatile var decryptCallCount: Int = 0
    override def decryptForUse(id: ConnectorCredentialId, userId: UserId): Future[Option[String]] = {
      decryptCallCount += 1
      delegate.decryptForUse(id, userId)
    }
  }

  private var encryptedBackend: EncryptedSecretBackend = _

  private def randomKeyB64(): String = {
    val bytes = new Array[Byte](32)
    new SecureRandom().nextBytes(bytes)
    Base64.getEncoder.encodeToString(bytes)
  }

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()
    db  = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    ctx = new DbContext(db, db)
    encryptedBackend = new EncryptedSecretBackend(new EnvMasterKeyProvider(
      Map("CONNECTOR_MASTER_KEY" -> randomKeyB64(), "CONNECTOR_MASTER_KEY_ID" -> "kind-guard-spec-key")
    ))
    val credRepo = new ConnectorCredentialRepository(ctx, encryptedBackend)
    connectorRepo = new ConnectorRepository(ctx, credRepo)

    val echoRoute = path("data") {
      get { complete(HttpEntity(ContentTypes.`application/json`, JsArray().compactPrint)) }
    }
    testServerBinding = Await.result(Http(typedSystem.classicSystem).newServerAt("localhost", 0).bind(echoRoute), 10.seconds)
    testServerPort    = testServerBinding.localAddress.getPort
  }

  override def afterAll(): Unit = {
    Await.ready(testServerBinding.unbind(), 10.seconds)
    db.close()
    embeddedPostgres.close()
    super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def freshUser(): UserId = {
    val id = UUID.randomUUID().toString
    await(ctx.withSystemContext(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($id::uuid, ${s"$id@kind-guard-spec.test"}, now())"""
    ))
    UserId(id)
  }

  private def recordingCredRepo(): RecordingCredentialRepository =
    new RecordingCredentialRepository(new ConnectorCredentialRepository(ctx, encryptedBackend))

  "RestApiConnectorDriver.resolveConnector kind guard (design.md Decision 2b)" should {

    "reject a stored source bound to a 'sql'-kind Connector, issuing no outbound request and decrypting nothing" in {
      val owner = freshUser()
      val user  = AuthenticatedUser(owner)
      val connector = await(connectorRepo.create(
        ownerId = owner, name = "mismatched-fetch-time", kind = "sql", baseUrl = "http://example.invalid",
        config = """{"authType":"none"}""", credentialPlaintext = "fake-plaintext-value", credentialName = "kind guard cred"
      ))
      val credRepo = recordingCredRepo()
      // fetchOverride = None so this reaches the guard for real rather than short-circuiting
      // before it (RestConnectorEgressGuardSpec's own convention).
      val driver = new RestApiConnectorDriver(connectorRepoOpt = Some(connectorRepo), credentialRepoOpt = Some(credRepo))
      val config = RestApiConfig(connectorId = connector.id.value, endpoint = "/data")

      val result = await(driver.fetch(config, ConnectorResolveContext.Owned(user)))
      result match {
        case Left(err) =>
          err should include("rest_api")
          err should include("sql")
          // Curated error names neither the id, the baseUrl, nor any credential material.
          err should not include connector.id.value
          err should not include "example.invalid"
          err should not include "fake-plaintext-value"
        case Right(_) => fail("expected the mismatched Connector to be rejected")
      }
      credRepo.decryptCallCount shouldBe 0
    }

    "still resolves and fetches a matching 'rest_api' Connector exactly as before (regression guard)" in {
      val owner = freshUser()
      val user  = AuthenticatedUser(owner)
      val connector = await(connectorRepo.create(
        ownerId = owner, name = "matching-fetch-time", kind = "rest_api", baseUrl = urlFor,
        config = """{"authType":"none"}""", credentialPlaintext = "", credentialName = "kind guard cred 2"
      ))
      // fetchOverride = None: this must reach the real doFetch/resolveConnector path, not
      // short-circuit before the guard (RestConnectorEgressGuardSpec's own convention).
      val driver = new RestApiConnectorDriver(connectorRepoOpt = Some(connectorRepo), isBlocked = admitLocalhost)
      val config = RestApiConfig(connectorId = connector.id.value, endpoint = "/data")

      val result = await(driver.fetch(config, ConnectorResolveContext.Owned(user)))
      result shouldBe Right(JsArray())
    }
  }
}
