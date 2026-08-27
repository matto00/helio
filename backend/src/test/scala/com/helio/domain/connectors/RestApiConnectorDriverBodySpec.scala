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
import scala.concurrent.{Await, Future}

/** HEL-826 tasks 3.2/3.3/3.4/3.5 — request-body wiring, structural safety guards, and the
 *  injection-surface/credential-unreachability coverage for a REAL request body (as opposed to
 *  `TemplateInterpolator`'s own unit-level coverage, HEL-823 design.md Decision 7). Mirrors
 *  `RestApiConnectorDriverTemplatingSpec`'s DB-backed local-echo-server pattern — a
 *  `fetchOverride` stub would bypass `buildResolvedRequest`/`buildEphemeralRequest` entirely. */
class RestApiConnectorDriverBodySpec extends AnyWordSpec with Matchers with ScalatestRouteTest with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private implicit val mat: Materializer                 = SystemMaterializer(typedSystem).materializer

  private var embeddedPostgres: EmbeddedPostgres            = _
  private var db: JdbcBackend.Database                      = _
  private var ctx: DbContext                                = _
  private var connectorRepo: ConnectorRepository             = _
  private var credentialRepo: ConnectorCredentialRepository  = _
  private var driver: RestApiConnectorDriver                 = _

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
    credentialRepo = new ConnectorCredentialRepository(ctx, new EncryptedSecretBackend(new EnvMasterKeyProvider(
      Map("CONNECTOR_MASTER_KEY" -> randomKeyB64(), "CONNECTOR_MASTER_KEY_ID" -> "body-spec-key")
    )))
    connectorRepo = new ConnectorRepository(ctx, credentialRepo)
    driver        = new RestApiConnectorDriver(connectorRepoOpt = Some(connectorRepo), credentialRepoOpt = Some(credentialRepo))

    // Echoes the received Content-Type header and raw body string as a JSON object.
    val echoRoute =
      extractRequest { req =>
        entity(as[String]) { bodyStr =>
          val responseJson = JsObject(
            "contentType" -> JsString(req.entity.contentType.toString),
            "body"        -> JsString(bodyStr)
          )
          complete(HttpEntity(ContentTypes.`application/json`, responseJson.compactPrint))
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
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($id::uuid, ${s"$id@body-spec.test"}, now())"""
    ))
    UserId(id)
  }

  private def freshConnector(authConfig: String = """{"authType":"none"}""", credentialPlaintext: String = ""): (UserId, Connector) = {
    val owner = freshUser()
    val connector = await(connectorRepo.create(
      ownerId = owner, name = s"body-conn-${UUID.randomUUID()}", kind = "rest_api", baseUrl = urlFor,
      config = authConfig, credentialPlaintext = credentialPlaintext, credentialName = "body cred"
    ))
    (owner, connector)
  }

  // ── 3.2: buildResolvedRequest structural guards + body attachment ──

  "buildResolvedRequest structural guards (3.2)" should {

    "rejects a GET+body config before any HTTP request is issued" in {
      val (owner, connector) = freshConnector()
      val user   = AuthenticatedUser(owner)
      val config = RestApiConfig(connectorId = connector.id.value, endpoint = "/echo", method = "GET", body = Some("""{"a":1}"""))

      val result = await(driver.fetch(config, ConnectorResolveContext.Owned(user)))
      result.isLeft shouldBe true
    }

    "rejects an unparseable bodyContentType before any HTTP request is issued" in {
      val (owner, connector) = freshConnector()
      val user   = AuthenticatedUser(owner)
      val config = RestApiConfig(
        connectorId = connector.id.value, endpoint = "/echo", method = "POST",
        body = Some("""{"a":1}"""), bodyContentType = Some("not a content type;;;")
      )

      val result = await(driver.fetch(config, ConnectorResolveContext.Owned(user)))
      result.isLeft shouldBe true
    }

    "a POST-with-body config attaches the resolved body with the expected content-type" in {
      val (owner, connector) = freshConnector()
      val user   = AuthenticatedUser(owner)
      val config = RestApiConfig(connectorId = connector.id.value, endpoint = "/echo", method = "POST", body = Some("""{"a":1}"""))

      val Right(response) = await(driver.fetch(config, ConnectorResolveContext.Owned(user))): @unchecked
      val fields = response.asJsObject.fields
      fields("contentType").asInstanceOf[JsString].value should include("application/json")
      fields("body") shouldBe JsString("""{"a":1}""")
    }

    "a GET/no-body config's request carries no body" in {
      val (owner, connector) = freshConnector()
      val user   = AuthenticatedUser(owner)
      val config = RestApiConfig(connectorId = connector.id.value, endpoint = "/echo", method = "GET")

      val Right(response) = await(driver.fetch(config, ConnectorResolveContext.Owned(user))): @unchecked
      response.asJsObject.fields("body") shouldBe JsString("")
    }
  }

  // ── 3.3: buildEphemeralRequest identical structural guards ──

  "buildEphemeralRequest structural guards (3.3)" should {

    "rejects a GET+body ephemeral config before any HTTP request is issued" in {
      val config = EphemeralRestConfig(url = s"$urlFor/echo", method = "GET", body = Some("""{"a":1}"""))
      val result = await(driver.fetchEphemeral(config))
      result.isLeft shouldBe true
    }

    "rejects an unparseable bodyContentType before any HTTP request is issued" in {
      val config = EphemeralRestConfig(
        url = s"$urlFor/echo", method = "POST", body = Some("""{"a":1}"""), bodyContentType = Some("not a content type;;;")
      )
      val result = await(driver.fetchEphemeral(config))
      result.isLeft shouldBe true
    }

    "a POST-with-body ephemeral config attaches the body identically" in {
      val config = EphemeralRestConfig(url = s"$urlFor/echo", method = "POST", body = Some("""{"a":1}"""))
      val Right(response) = await(driver.fetchEphemeral(config)): @unchecked
      response.asJsObject.fields("body") shouldBe JsString("""{"a":1}""")
    }
  }

  // ── 3.4: real POST body, hostile-template escaping, exact echoed payload ──

  "a real POST with a templated body (3.4)" should {
    "sends the exact expected payload, and a hostile-template value re-parses as valid JSON with the value intact" in {
      val (owner, connector) = freshConnector()
      val user    = AuthenticatedUser(owner)
      val hostile = "she said \"hi\"\nline2 \\ backslash é "
      val config  = RestApiConfig(
        connectorId = connector.id.value, endpoint = "/echo", method = "POST",
        body = Some("""{"q": "{{userInput}}"}"""), parameters = Map("userInput" -> hostile)
      )

      val Right(response) = await(driver.fetch(config, ConnectorResolveContext.Owned(user))): @unchecked
      val sentBody = response.asJsObject.fields("body").asInstanceOf[JsString].value
      sentBody.parseJson.asJsObject.fields("q").asInstanceOf[JsString].value shouldBe hostile
    }
  }

  // ── 3.5: credential unreachable from a body template ──

  "credential unreachability from a body template (3.5)" should {
    "hostile templates {{apiKey}}/{{credential}}/{{secret}} in the body with no matching parameters entry fail loud" in {
      val (owner, connector) = freshConnector(authConfig = """{"authType":"bearer"}""", credentialPlaintext = "super-secret-token")
      val user = AuthenticatedUser(owner)

      Vector("apiKey", "credential", "secret").foreach { varName =>
        val config = RestApiConfig(
          connectorId = connector.id.value, endpoint = "/echo", method = "POST",
          body = Some(s"""{"q": "{{$varName}}"}""")
        )
        val result = await(driver.fetch(config, ConnectorResolveContext.Owned(user)))
        result shouldBe Left(s"Unresolved template variable: $varName")
      }
    }
  }
}
