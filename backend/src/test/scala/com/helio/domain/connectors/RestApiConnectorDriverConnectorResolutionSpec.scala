package com.helio.domain.connectors

import com.helio.domain.model._
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
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.security.SecureRandom
import java.util.{Base64, UUID}
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-822 design.md Decision 3/4 — the Connector-resolving `fetch`/`testConnection` path,
 *  exercised end to end against a real Connector row (unlike `RestApiConnectorSpec`, which
 *  deliberately stays DB-free and covers only the ephemeral path). Two things a `fetchOverride`
 *  stub cannot prove because it bypasses `buildResolvedRequest` entirely:
 *
 *   1. Header precedence (Decision 4, cycle-2 skeptic CR2 — `specs/rest-api-connector/spec.md`
 *      "Non-colliding headers are both applied" / "Source header overrides Connector default on
 *      collision"): asserts the actual composed `HttpRequest`'s headers via a real local HTTP
 *      server that echoes back what it received.
 *   2. Auth application (bearer): the credential is decrypted via `ConnectorCredentialRepository.
 *      decryptForUse` and applied as `Authorization: Bearer <token>`, never a stubbed value. */
class RestApiConnectorDriverConnectorResolutionSpec extends AnyWordSpec with Matchers with ScalatestRouteTest with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private implicit val mat: Materializer                 = SystemMaterializer(typedSystem).materializer

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var ctx: DbContext                     = _
  private var connectorRepo: ConnectorRepository  = _
  private var driver: RestApiConnectorDriver      = _

  private var testServerBinding: Http.ServerBinding = _
  private var testServerPort: Int                   = _
  private def urlFor: String = s"http://localhost:$testServerPort"

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
    val credRepo = new ConnectorCredentialRepository(ctx, new EncryptedSecretBackend(new EnvMasterKeyProvider(
      Map("CONNECTOR_MASTER_KEY" -> randomKeyB64(), "CONNECTOR_MASTER_KEY_ID" -> "resolution-spec-key")
    )))
    connectorRepo = new ConnectorRepository(ctx, credRepo)
    driver        = new RestApiConnectorDriver(connectorRepoOpt = Some(connectorRepo), credentialRepoOpt = Some(credRepo))

    // Echoes every received header back as a JSON object — the assertion surface for the
    // header-precedence scenarios; also used to prove real bearer-token application.
    val echoRoute =
      path("echo") {
        get {
          extractRequest { req =>
            val headerJson = JsObject(req.headers.map(h => h.name() -> JsString(h.value())).toMap)
            complete(HttpEntity(ContentTypes.`application/json`, headerJson.compactPrint))
          }
        }
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
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($id::uuid, ${s"$id@resolution-spec.test"}, now())"""
    ))
    UserId(id)
  }

  "RestApiConnectorDriver.buildResolvedRequest header precedence (design.md Decision 4)" should {

    "applies both a non-colliding Connector default header and a non-colliding source header" in {
      val owner = freshUser()
      val user  = AuthenticatedUser(owner)
      val connector = await(connectorRepo.create(
        ownerId = owner, name = "hdr-noncollide", kind = "rest_api", baseUrl = urlFor,
        config = """{"authType":"none","defaultHeaders":{"X-Env":"prod"}}""",
        credentialPlaintext = "", credentialName = "hdr cred"
      ))
      val config = RestApiConfig(connectorId = connector.id.value, endpoint = "/echo", headers = Map("X-Request-Id" -> "abc123"))

      val Right(body) = await(driver.fetch(config, ConnectorResolveContext.Owned(user))): @unchecked
      val fields = body.asJsObject.fields
      fields.get("X-Env") shouldBe Some(JsString("prod"))
      fields.get("X-Request-Id") shouldBe Some(JsString("abc123"))
    }

    "the source header wins over the Connector's default on a colliding key" in {
      val owner = freshUser()
      val user  = AuthenticatedUser(owner)
      val connector = await(connectorRepo.create(
        ownerId = owner, name = "hdr-collide", kind = "rest_api", baseUrl = urlFor,
        config = """{"authType":"none","defaultHeaders":{"Accept":"application/xml"}}""",
        credentialPlaintext = "", credentialName = "hdr cred 2"
      ))
      val config = RestApiConfig(connectorId = connector.id.value, endpoint = "/echo", headers = Map("Accept" -> "application/json"))

      val Right(body) = await(driver.fetch(config, ConnectorResolveContext.Owned(user))): @unchecked
      body.asJsObject.fields.get("Accept") shouldBe Some(JsString("application/json"))
    }
  }

  "RestApiConnectorDriver.buildResolvedRequest bearer-auth application" should {

    "decrypts the credential and applies it as a real Authorization: Bearer header (never a stubbed value)" in {
      val owner = freshUser()
      val user  = AuthenticatedUser(owner)
      val connector = await(connectorRepo.create(
        ownerId = owner, name = "bearer-conn", kind = "rest_api", baseUrl = urlFor,
        config = """{"authType":"bearer"}""",
        credentialPlaintext = "real-decrypted-token", credentialName = "bearer cred"
      ))
      val config = RestApiConfig(connectorId = connector.id.value, endpoint = "/echo")

      val Right(body) = await(driver.fetch(config, ConnectorResolveContext.Owned(user))): @unchecked
      body.asJsObject.fields.get("Authorization") shouldBe Some(JsString("Bearer real-decrypted-token"))
    }

    // Cycle-2 skeptic non-blocking note (a): a source header colliding with the auth
    // header's own name must never produce a request carrying both.
    "a source header named Authorization never rides alongside the real bearer header" in {
      val owner = freshUser()
      val user  = AuthenticatedUser(owner)
      val connector = await(connectorRepo.create(
        ownerId = owner, name = "bearer-collide-conn", kind = "rest_api", baseUrl = urlFor,
        config = """{"authType":"bearer"}""",
        credentialPlaintext = "the-real-token", credentialName = "bearer cred 2"
      ))
      val config = RestApiConfig(
        connectorId = connector.id.value, endpoint = "/echo",
        headers = Map("Authorization" -> "Bearer client-supplied-spoof")
      )

      val Right(body) = await(driver.fetch(config, ConnectorResolveContext.Owned(user))): @unchecked
      body.asJsObject.fields.get("Authorization") shouldBe Some(JsString("Bearer the-real-token"))
    }
  }
}
