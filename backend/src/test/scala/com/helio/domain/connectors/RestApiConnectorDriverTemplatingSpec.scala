package com.helio.domain.connectors

import com.helio.services.sources.ContentSourceSupport
import java.net.InetAddress
import com.helio.domain.engine.InProcessPipelineEngine
import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ConnectorCredentialRepository
import com.helio.infrastructure.persistence.sources.ConnectorRepository
import com.helio.services.auth.{EncryptedSecretBackend, EnvMasterKeyProvider}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.Http
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, Uri}
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
import java.time.Instant
import java.util.{Base64, UUID}
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-823: `{{name}}` request templating coverage — resolution, escaping, fail-loud,
 *  credential unreachability, and run-time/authoring-time parity. DB-backed (like
 *  `RestApiConnectorDriverConnectorResolutionSpec`) because `buildResolvedRequest`'s
 *  templating happens after Connector resolution; a `fetchOverride` stub would bypass the
 *  code under test entirely. */
class RestApiConnectorDriverTemplatingSpec extends AnyWordSpec with Matchers with ScalatestRouteTest with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private implicit val mat: Materializer                 = SystemMaterializer(typedSystem).materializer

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var ctx: DbContext                     = _
  private var connectorRepo: ConnectorRepository  = _
  private var credentialRepo: ConnectorCredentialRepository = _
  private var driver: RestApiConnectorDriver      = _
  private var engine: InProcessPipelineEngine     = _

  private var testServerBinding: Http.ServerBinding = _
  private var testServerPort: Int                   = _
  private def urlFor: String = s"http://localhost:$testServerPort"

  // HEL-879: this spec's local test server binds to "localhost", which real DNS resolves to a
  // loopback address the SSRF guard added here would otherwise reject by default. Admit ONLY
  // this hostname (keyed on the hostname string, per design.md Decision 5 -- never widen the
  // loopback address CLASS) so the guard runs for real (`resolveHost` is still real DNS) without
  // breaking this fixture.
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
    credentialRepo = new ConnectorCredentialRepository(ctx, new EncryptedSecretBackend(new EnvMasterKeyProvider(
      Map("CONNECTOR_MASTER_KEY" -> randomKeyB64(), "CONNECTOR_MASTER_KEY_ID" -> "templating-spec-key")
    )))
    connectorRepo = new ConnectorRepository(ctx, credentialRepo)
    driver        = new RestApiConnectorDriver(connectorRepoOpt = Some(connectorRepo), credentialRepoOpt = Some(credentialRepo), isBlocked = admitLocalhost)
    engine        = new InProcessPipelineEngine(fileSystem = null, connector = driver)

    // Echoes the request's path, raw query string, and headers as a JSON object — the
    // assertion surface for every resolution/escaping scenario below.
    val echoRoute =
      extractRequest { req =>
        val headerJson = JsObject(req.headers.map(h => h.name() -> JsString(h.value())).toMap)
        val body = JsObject(
          "path"    -> JsString(req.uri.path.toString),
          "query"   -> JsString(req.uri.rawQueryString.getOrElse("")),
          "headers" -> headerJson
        )
        get { complete(HttpEntity(ContentTypes.`application/json`, body.compactPrint)) }
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
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($id::uuid, ${s"$id@templating-spec.test"}, now())"""
    ))
    UserId(id)
  }

  private def freshConnector(authConfig: String = """{"authType":"none"}""", credentialPlaintext: String = ""): (UserId, Connector) = {
    val owner = freshUser()
    val connector = await(connectorRepo.create(
      ownerId = owner, name = s"tmpl-conn-${UUID.randomUUID()}", kind = "rest_api", baseUrl = urlFor,
      config = authConfig, credentialPlaintext = credentialPlaintext, credentialName = "tmpl cred"
    ))
    (owner, connector)
  }

  // ── 4.1 / 4.2: endpoint/query/header resolution — connectorId path AND run-time pipeline path ──

  "RestApiConnectorDriver.buildResolvedRequest templating (4.1)" should {
    "resolves {{name}} placeholders in endpoint, query params, and headers" in {
      val (owner, connector) = freshConnector()
      val user = AuthenticatedUser(owner)
      val config = RestApiConfig(
        connectorId = connector.id.value,
        endpoint    = "/echo/{{userId}}",
        queryParams = Map("tag" -> "{{tagValue}}"),
        headers     = Map("X-Custom" -> "{{headerValue}}"),
        parameters  = Map("userId" -> "42", "tagValue" -> "gold", "headerValue" -> "custom-header-value")
      )

      val Right(body) = await(driver.fetch(config, ConnectorResolveContext.Owned(user))): @unchecked
      val fields = body.asJsObject.fields
      fields("path")                                      shouldBe JsString("/echo/42")
      fields("query")                                      shouldBe JsString("tag=gold")
      fields("headers").asJsObject.fields.get("X-Custom")  shouldBe Some(JsString("custom-header-value"))
    }
  }

  "InProcessPipelineEngine.loadRows RestSource arm templating (4.2)" should {
    "resolves the same placeholders through the real run-time (pipeline) path, not just buildResolvedRequest directly" in {
      val (_, connector) = freshConnector()
      val ds = RestSource(
        id        = DataSourceId("ds-tmpl-1"),
        name      = "tmpl-rest-src",
        ownerId   = UserId("00000000-0000-0000-0000-000000000001"),
        createdAt = Instant.now(),
        updatedAt = Instant.now(),
        config = RestApiConfig(
          connectorId = connector.id.value,
          endpoint    = "/echo/{{userId}}",
          queryParams = Map("tag" -> "{{tagValue}}"),
          headers     = Map("X-Custom" -> "{{headerValue}}"),
          parameters  = Map("userId" -> "42", "tagValue" -> "gold", "headerValue" -> "custom-header-value")
        )
      )
      val rows = await(engine.loadRows(ds, null))
      rows should have size 1
      rows.head("path")  shouldBe "/echo/42"
      rows.head("query") shouldBe "tag=gold"
      // HEL-599: `headers` is now flattened by `JsonFlattener`/`jsRowToRow` rather than
      // serialized back to compact JSON text — the dotted `headers.X-Custom` column carries the
      // resolved value directly, matching what schema inference already advertised.
      rows.head("headers.X-Custom") shouldBe "custom-header-value"
    }
  }

  // ── 4.3: unresolved variable fails loud, names the variable, no HTTP call issued ──

  "unresolved-variable fail-loud (4.3)" should {
    "fails with a curated message naming the variable for an unresolved endpoint placeholder, without issuing an HTTP call" in {
      val (owner, connector) = freshConnector()
      val user   = AuthenticatedUser(owner)
      val config = RestApiConfig(connectorId = connector.id.value, endpoint = "/echo/{{missingVar}}")

      val result = await(driver.fetch(config, ConnectorResolveContext.Owned(user)))
      result shouldBe Left("Unresolved template variable: missingVar")
    }

    "fails with a curated message naming the variable for an unresolved query-param placeholder" in {
      val (owner, connector) = freshConnector()
      val user   = AuthenticatedUser(owner)
      val config = RestApiConfig(connectorId = connector.id.value, endpoint = "/echo", queryParams = Map("tag" -> "{{missingTag}}"))

      val result = await(driver.fetch(config, ConnectorResolveContext.Owned(user)))
      result shouldBe Left("Unresolved template variable: missingTag")
    }

    "fails with a curated message naming the variable for an unresolved header placeholder" in {
      val (owner, connector) = freshConnector()
      val user   = AuthenticatedUser(owner)
      val config = RestApiConfig(connectorId = connector.id.value, endpoint = "/echo", headers = Map("X-Custom" -> "{{missingHeader}}"))

      val result = await(driver.fetch(config, ConnectorResolveContext.Owned(user)))
      result shouldBe Left("Unresolved template variable: missingHeader")
    }

    "TemplateInterpolator.resolve against body content fails Left naming the unresolved variable" in {
      TemplateInterpolator.resolveJsonBody("""{"name": "{{userName}}"}""", Map.empty) shouldBe Left("userName")
    }
  }


  "escaping (4.4)" should {
    "query param value containing &, a quote, a newline, and unicode round-trips through Uri.Query's own percent-encoding" in {
      val (owner, connector) = freshConnector()
      val user   = AuthenticatedUser(owner)
      val hostile = "a&b\"c\ndé"
      val config = RestApiConfig(connectorId = connector.id.value, endpoint = "/echo", queryParams = Map("q" -> "{{v}}"), parameters = Map("v" -> hostile))

      val Right(body) = await(driver.fetch(config, ConnectorResolveContext.Owned(user))): @unchecked
      // The server echoes the raw query string it received; decoding it must recover the
      // original hostile value, and it must not have introduced a second `&`-delimited param.
      val rawQuery = body.asJsObject.fields("query").asInstanceOf[JsString].value
      val decoded  = Uri.Query(rawQuery).toMap
      decoded.get("q") shouldBe Some(hostile)
    }

    "header value containing CRLF is rejected, never sent" in {
      val (owner, connector) = freshConnector()
      val user   = AuthenticatedUser(owner)
      val config = RestApiConfig(connectorId = connector.id.value, endpoint = "/echo", headers = Map("X-Custom" -> "{{v}}"), parameters = Map("v" -> "line1\r\nline2"))

      val result = await(driver.fetch(config, ConnectorResolveContext.Owned(user)))
      result.isLeft shouldBe true
      result.left.getOrElse("") should include("CR/LF")
    }

    "JSON body value with a quote, a newline, and unicode is escaped via TemplateInterpolator.resolveJsonBody" in {
      val hostile = "she said \"hi\"\nline2 é"
      val result  = TemplateInterpolator.resolveJsonBody("""{"note": "{{v}}"}""", Map("v" -> hostile))
      result.isRight shouldBe true
      val Right(resolved) = result: @unchecked
      // Splicing the result back into a JSON document must produce a valid, round-trippable string.
      resolved.parseJson.asJsObject.fields("note").asInstanceOf[JsString].value shouldBe hostile
    }

    "endpoint value containing a space and a * is RFC 3986 path-segment encoded (space -> %20, not +)" in {
      val (owner, connector) = freshConnector()
      val user   = AuthenticatedUser(owner)
      val config = RestApiConfig(connectorId = connector.id.value, endpoint = "/echo/{{v}}", parameters = Map("v" -> "New York*"))

      val Right(body) = await(driver.fetch(config, ConnectorResolveContext.Owned(user))): @unchecked
      val path = body.asJsObject.fields("path").asInstanceOf[JsString].value
      path should include("%20")
      path should not include "+"
    }

    // skeptic-final-1 CR1: pekko-http-core's Uri.Path.Segment throws IllegalArgumentException on
    // an empty head; an empty resolved value previously reached that call directly and crashed
    // with a raw exception (violating the "never a raw exception" contract) instead of completing.
    "an empty resolved parameter value in the endpoint completes as an empty splice, never throws" in {
      val (owner, connector) = freshConnector()
      val user   = AuthenticatedUser(owner)
      val config = RestApiConfig(connectorId = connector.id.value, endpoint = "/echo/{{v}}", parameters = Map("v" -> ""))

      val result = await(driver.fetch(config, ConnectorResolveContext.Owned(user)))
      result.isRight shouldBe true
      val Right(body) = result: @unchecked
      body.asJsObject.fields("path").asInstanceOf[JsString].value shouldBe "/echo/"
    }
  }


  "credential unreachability (4.5)" should {
    "hostile templates {{apiKey}}/{{credential}}/{{secret}} with no matching parameters entry fail loud like any other unresolved variable" in {
      val (owner, connector) = freshConnector(authConfig = """{"authType":"bearer"}""", credentialPlaintext = "super-secret-token")
      val user = AuthenticatedUser(owner)

      Vector("apiKey", "credential", "secret").foreach { varName =>
        val config = RestApiConfig(connectorId = connector.id.value, endpoint = s"/echo?x={{$varName}}")
        val result = await(driver.fetch(config, ConnectorResolveContext.Owned(user)))
        result shouldBe Left(s"Unresolved template variable: $varName")
      }
    }

    "the decrypted credential string never appears anywhere in a built request, even when parameters happens to define a same-named key" in {
      // authType "none" still decrypts the Connector credential (`buildResolvedRequest`
      // decrypts unconditionally) but never places it in any header/query — real-auth
      // decryption exercised, with no legitimate channel for the value to appear via, so
      // this proves it is not reachable through templating either.
      val (owner, connector) = freshConnector(authConfig = """{"authType":"none"}""", credentialPlaintext = "super-secret-token")
      val user   = AuthenticatedUser(owner)
      // A parameters map deliberately carrying a key named "apiKey" — the decrypted credential
      // must still never leak in, since it is never merged into this map (design.md Decision 4).
      val config = RestApiConfig(
        connectorId = connector.id.value, endpoint = "/echo/{{apiKey}}",
        parameters = Map("apiKey" -> "not-the-real-credential")
      )

      val Right(body) = await(driver.fetch(config, ConnectorResolveContext.Owned(user))): @unchecked
      body.compactPrint should not include "super-secret-token"
      body.asJsObject.fields("path").asInstanceOf[JsString].value shouldBe "/echo/not-the-real-credential"
    }
  }

  // ── 4.6 / 4.6a: no-parameters byte-identical + decode regression ──

  "no-parameters source (4.6)" should {
    "a source with no template syntax and no parameters behaves exactly as before" in {
      val (owner, connector) = freshConnector()
      val user   = AuthenticatedUser(owner)
      val config = RestApiConfig(connectorId = connector.id.value, endpoint = "/echo", queryParams = Map("plain" -> "value"), headers = Map("X-Plain" -> "yes"))

      val Right(body) = await(driver.fetch(config, ConnectorResolveContext.Owned(user))): @unchecked
      val fields = body.asJsObject.fields
      fields("path")  shouldBe JsString("/echo")
      fields("query") shouldBe JsString("plain=value")
      fields("headers").asJsObject.fields.get("X-Plain") shouldBe Some(JsString("yes"))
    }
  }

  "decode regression (4.6a)" should {
    "a stored rest_api config blob with no parameters key decodes to RestApiConfig(parameters = Map.empty)" in {
      import com.helio.api.protocols.sources.DataSourceConfigCodec

      val storedBlobWithoutParametersKey =
        """{"connectorId":"some-connector-id","endpoint":"/foo","method":"GET","queryParams":{},"headers":{}}"""

      val decoded = DataSourceConfigCodec.decodeRest(storedBlobWithoutParametersKey)
      decoded shouldBe Right(RestApiConfig(connectorId = "some-connector-id", endpoint = "/foo", parameters = Map.empty))
    }
  }


  "TemplateInterpolator.resolve applied to body string content (4.7)" should {
    "resolves placeholders in a JSON body template with per-value JSON escaping" in {
      val result = TemplateInterpolator.resolveJsonBody("""{"name": "{{userName}}", "age": {{age}}}""", Map("userName" -> "Ada", "age" -> "30"))
      result shouldBe Right("""{"name": "Ada", "age": 30}""")
    }
  }

  // ── 4.8: auth-header collision regression, now with a templated header value ──

  "auth-header-collision-with-templated-value regression (4.8)" should {
    "a templated source header named Authorization never rides alongside the real bearer header" in {
      val (owner, connector) = freshConnector(authConfig = """{"authType":"bearer"}""", credentialPlaintext = "the-real-token")
      val user   = AuthenticatedUser(owner)
      val config = RestApiConfig(
        connectorId = connector.id.value, endpoint = "/echo",
        headers = Map("Authorization" -> "Bearer {{spoof}}"), parameters = Map("spoof" -> "client-supplied-spoof")
      )

      val Right(body) = await(driver.fetch(config, ConnectorResolveContext.Owned(user))): @unchecked
      body.asJsObject.fields.get("headers").flatMap(_.asJsObject.fields.get("Authorization")) shouldBe Some(JsString("Bearer the-real-token"))
    }
  }

  // ── 4.9: ephemeral path literal passthrough ──

  "ephemeral path literal passthrough (4.9)" should {
    "a bare-url infer/test request containing {{...}} in url/headers sends the placeholder as literal text, not resolved and not failed" in {
      val config = EphemeralRestConfig(url = s"$urlFor/echo/{{userId}}", method = "GET", headers = Map("X-Custom" -> "{{headerValue}}"))

      val Right(body) = await(driver.fetchEphemeral(config)): @unchecked
      val fields = body.asJsObject.fields
      // `Uri(config.url)` percent-encodes the raw `{`/`}` characters as part of normal URI
      // parsing (unrelated to templating) — the point under test is that `{{userId}}` was never
      // looked up against any parameter map or reported as an unresolved variable; it is carried
      // through as literal (percent-encoded) text end to end, unchanged by `TemplateInterpolator`.
      fields("path")                                     shouldBe JsString("/echo/%7B%7BuserId%7D%7D")
      fields("headers").asJsObject.fields.get("X-Custom") shouldBe Some(JsString("{{headerValue}}"))
    }
  }
}
