package com.helio.domain.connectors

import com.helio.api.protocols.sources.DataSourceConfigCodec
import com.helio.services.sources.ContentSourceSupport
import java.net.InetAddress
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

/** HEL-844 tasks 1.1-1.3, 4.1, 4.2: proves the query string a REAL bound local HTTP server
 *  RECEIVES for `RestApiConnectorDriver.buildResolvedRequest` (the Connector-resolving path) --
 *  never a status code, never the config shape. Every assertion reads
 *  `req.uri.rawQueryString`, the exact bytes the server was handed, so a passing result cannot
 *  be an artifact of how the test constructs its expectation.
 *
 *  Tasks 1.1-1.3 were run against `main` at `0f16b85d` (pre-fix) BEFORE this file's assertions
 *  were tightened to their current form, to record the actual collapse; see the commit body for
 *  the captured red output. This file, post-fix, encodes the green assertions the ticket
 *  requires; the historical collapse is preserved in the commit message rather than as a
 *  skipped/pending test (a red test would defeat this suite's own compile once the fix lands). */
class RestApiConnectorDriverQueryParamsSpec extends AnyWordSpec with Matchers with ScalatestRouteTest with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private implicit val mat: Materializer                 = SystemMaterializer(typedSystem).materializer

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var ctx: DbContext                     = _
  private var connectorRepo: ConnectorRepository = _
  private var driver: RestApiConnectorDriver     = _

  private var testServerBinding: Http.ServerBinding = _
  private var testServerPort: Int                   = _
  private def urlFor: String = s"http://localhost:$testServerPort"

  // HEL-879: admit only this exact hostname past the SSRF guard, same pattern as
  // RestApiConnectorDriverConnectorResolutionSpec.
  private val admitLocalhost: (String, InetAddress) => Boolean =
    (host, addr) => if (host == "localhost") false else ContentSourceSupport.isBlockedAddress(addr)

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
      Map("CONNECTOR_MASTER_KEY" -> randomKeyB64(), "CONNECTOR_MASTER_KEY_ID" -> "query-params-spec-key")
    )))
    connectorRepo = new ConnectorRepository(ctx, credRepo)
    driver        = new RestApiConnectorDriver(connectorRepoOpt = Some(connectorRepo), credentialRepoOpt = Some(credRepo), isBlocked = admitLocalhost)

    // Echoes the RAW query string the server actually received -- never a status code, never a
    // re-parsed/re-collapsed shape.
    val echoRoute =
      path("echo-query") {
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
    db.close()
    embeddedPostgres.close()
    super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def freshUser(): UserId = {
    val id = UUID.randomUUID().toString
    await(ctx.withSystemContext(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($id::uuid, ${s"$id@query-params-spec.test"}, now())"""
    ))
    UserId(id)
  }

  private def rawQueryReceived(config: RestApiConfig, user: AuthenticatedUser): String = {
    val Right(body) = await(driver.fetch(config, ConnectorResolveContext.Owned(user))): @unchecked
    body.asJsObject.fields("rawQuery").asInstanceOf[JsString].value
  }

  "RestApiConnectorDriver.buildResolvedRequest query-param composition (HEL-844)" should {

    // Task 1.1 / acceptance criterion 1: a repeated query key must issue BOTH values.
    "issues both values of a repeated query key, not just the last one" in {
      val owner     = freshUser()
      val user      = AuthenticatedUser(owner)
      val connector = await(connectorRepo.create(
        ownerId = owner, name = "qp-dup", kind = "rest_api", baseUrl = urlFor,
        config = """{"authType":"none"}""", credentialPlaintext = "", credentialName = "cred"
      ))
      val config = RestApiConfig(
        connectorId = connector.id.value,
        endpoint    = "/echo-query",
        queryParams = QueryParams(Vector("tag" -> "a", "tag" -> "b"))
      )

      rawQueryReceived(config, user) shouldBe "tag=a&tag=b"
    }

    // Task 1.2 / acceptance criterion 2: order must be preserved, chosen so alphabetical order
    // and map-iteration order both differ from the correct answer.
    "preserves the exact order of interleaved pairs, including a repeated key" in {
      val owner     = freshUser()
      val user      = AuthenticatedUser(owner)
      val connector = await(connectorRepo.create(
        ownerId = owner, name = "qp-order", kind = "rest_api", baseUrl = urlFor,
        config = """{"authType":"none"}""", credentialPlaintext = "", credentialName = "cred"
      ))
      val config = RestApiConfig(
        connectorId = connector.id.value,
        endpoint    = "/echo-query",
        queryParams = QueryParams(Vector("z" -> "1", "a" -> "2", "z" -> "3"))
      )

      rawQueryReceived(config, user) shouldBe "z=1&a=2&z=3"
    }

    // Task 1.3: the old `uri.query().toMap` fold does NOT drop a query string already carried
    // on `endpoint` -- its distinct pairs survive. It silently reorders them (`Map`'s
    // hash-based iteration order, not insertion order) and collapses any duplicate key WITHIN
    // them to its last value. This proves the fixed composition preserves both the endpoint's
    // pairs and the config's pairs, in the correct order.
    // A 2-pair fixture (endpoint carries one pair, config carries one) is NOT a failable guard
    // here: the old `uri.query().toMap` fold builds a 2-entry Scala `Map` (`Map.Map2`), which
    // happens to iterate in insertion order, so that fixture passes on pre-fix `main` too and
    // proves nothing (evaluation-1.md CR1). This fixture uses six total keys -- enough to force
    // Scala's general hash-ordered `Map` representation, whose iteration order does not match
    // insertion order -- so it genuinely fails against the old fold. Re-verified red against a
    // stashed pre-fix copy of `main`: received rawQuery was
    // 'c3=30&e1=1&c2=20&c1=10&e3=3&e2=2' (see this ticket's commit body for the full transcript).
    "preserves a query string already carried on the endpoint, followed by the config's pairs" in {
      val owner     = freshUser()
      val user      = AuthenticatedUser(owner)
      val connector = await(connectorRepo.create(
        ownerId = owner, name = "qp-endpoint-query", kind = "rest_api", baseUrl = urlFor,
        config = """{"authType":"none"}""", credentialPlaintext = "", credentialName = "cred"
      ))
      val config = RestApiConfig(
        connectorId = connector.id.value,
        endpoint    = "/echo-query?e1=1&e2=2&e3=3",
        queryParams = QueryParams(Vector("c1" -> "10", "c2" -> "20", "c3" -> "30"))
      )

      rawQueryReceived(config, user) shouldBe "e1=1&e2=2&e3=3&c1=10&c2=20&c3=30"
    }

    // Task 4.2 / design D4a: the auth query parameter still wins a name collision -- a source
    // configured with a query param sharing the auth's own name must not shadow the real
    // credential (nor must the real credential ride alongside the spoofed value).
    "the auth query parameter replaces (never rides alongside) a source-supplied param of the same name" in {
      val owner     = freshUser()
      val user      = AuthenticatedUser(owner)
      val connector = await(connectorRepo.create(
        ownerId = owner, name = "qp-auth-collide", kind = "rest_api", baseUrl = urlFor,
        config = """{"authType":"api_key","apiKeyName":"api_key","apiKeyPlacement":"query"}""",
        credentialPlaintext = "real-secret", credentialName = "api key cred"
      ))
      val config = RestApiConfig(
        connectorId = connector.id.value,
        endpoint    = "/echo-query",
        queryParams = QueryParams(Vector("api_key" -> "attacker-supplied", "other" -> "1"))
      )

      rawQueryReceived(config, user) shouldBe "other=1&api_key=real-secret"
    }

    // Acceptance criterion 3 / spec.md's matching scenario: `{{name}}` templating resolves per
    // PAIR, not per unique key, so a templated value inside a repeated key resolves at each
    // occurrence rather than being collapsed first. Failability verified by hand (skeptic-final-1.md
    // CR2): temporarily mutating `resolveQueryParams` to collapse-before-resolving (mirroring
    // mutation C from the final-gate report) turns this red; reverted before this test was
    // committed.
    "resolves a templated value at each occurrence of a repeated key, not once per unique key" in {
      val owner     = freshUser()
      val user      = AuthenticatedUser(owner)
      val connector = await(connectorRepo.create(
        ownerId = owner, name = "qp-templated-dup", kind = "rest_api", baseUrl = urlFor,
        config = """{"authType":"none"}""", credentialPlaintext = "", credentialName = "cred"
      ))
      val config = RestApiConfig(
        connectorId = connector.id.value,
        endpoint    = "/echo-query",
        queryParams = QueryParams(Vector("tag" -> "{{first}}", "tag" -> "{{second}}")),
        parameters  = Map("first" -> "a", "second" -> "b")
      )

      rawQueryReceived(config, user) shouldBe "tag=a&tag=b"
    }
  }

  // Task 8.2: a REAL, already-persisted map-shaped `config` blob (as it existed on disk before
  // this ticket) still fetches identically -- both distinct keys survive the dual-read decode
  // and the fetch, exactly as the pre-change single-value-per-key Map representation did (a
  // legacy blob never had a duplicate key to begin with -- the Map couldn't have stored one).
  "DataSourceConfigCodec.decodeRest backward compatibility with an already-persisted map-shaped row (HEL-844 task 8.2)" should {
    "fetches identically for a real legacy map-shaped `queryParams` blob" in {
      val owner     = freshUser()
      val user      = AuthenticatedUser(owner)
      val connector = await(connectorRepo.create(
        ownerId = owner, name = "qp-legacy-row", kind = "rest_api", baseUrl = urlFor,
        config = """{"authType":"none"}""", credentialPlaintext = "", credentialName = "cred"
      ))
      val legacyRawConfig =
        s"""{"connectorId":"${connector.id.value}","endpoint":"/echo-query","queryParams":{"a":"1","b":"2"}}"""

      val Right(decoded) = DataSourceConfigCodec.decodeRest(legacyRawConfig): @unchecked
      rawQueryReceived(decoded, user) shouldBe "a=1&b=2"
    }
  }
}
