package com.helio.services.sources

import com.helio.services.sources.ContentSourceSupport
import java.net.InetAddress
import com.helio.api.protocols.sources.DataSourceConfigCodec
import com.helio.domain.connectors.{ConnectorAuthShape, ConnectorResolveContext, RestApiConnectorDriver}
import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ConnectorCredentialRepository
import com.helio.infrastructure.persistence.sources.{ConnectorRepository, DataSourceRepository}
import com.helio.services.auth.{EncryptedSecretBackend, EnvMasterKeyProvider}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.Http
import org.apache.pekko.http.scaladsl.model.headers.{Authorization, OAuth2BearerToken}
import org.apache.pekko.http.scaladsl.model.{ContentTypes, HttpEntity, HttpRequest, StatusCodes, Uri}
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.apache.pekko.stream.{Materializer, SystemMaterializer}
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import org.slf4j.LoggerFactory
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.security.SecureRandom
import java.util.{Base64, UUID}
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-822 design.md Decision 7 / tasks 4.1a, 4.4, 4.5, 4.6: `RestSourceConnectorMigration`
 *  integration coverage — idempotency, the ownerless-row skip (round-3 CR5), the malformed-row
 *  skip, and a real round-trip proof (CR7 methodology: capture the legacy-path baseline BEFORE
 *  migrating, then assert the new path matches after) for a bearer-auth and an
 *  api-key-in-query legacy source against a real local stub HTTP server. */
class RestSourceConnectorMigrationSpec extends AnyWordSpec with Matchers with ScalatestRouteTest with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private implicit val mat: Materializer                 = SystemMaterializer(typedSystem).materializer

  private val log = LoggerFactory.getLogger(getClass)

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var ctx: DbContext                     = _
  private var dataSourceRepo: DataSourceRepository = _
  private var connectorRepo: ConnectorRepository  = _
  private var driver: RestApiConnectorDriver      = _

  private var testServerBinding: Http.ServerBinding = _
  private var testServerPort: Int                   = _
  private def urlFor(path: String): String = s"http://localhost:$testServerPort/$path"

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
    dataSourceRepo = new DataSourceRepository(ctx)
    val credRepo = new ConnectorCredentialRepository(ctx, new EncryptedSecretBackend(new EnvMasterKeyProvider(
      Map("CONNECTOR_MASTER_KEY" -> randomKeyB64(), "CONNECTOR_MASTER_KEY_ID" -> "migration-spec-key")
    )))
    connectorRepo = new ConnectorRepository(ctx, credRepo)
    driver        = new RestApiConnectorDriver(connectorRepoOpt = Some(connectorRepo), credentialRepoOpt = Some(credRepo), isBlocked = admitLocalhost)

    val testRoutes = concat(
      path("bearer-endpoint") {
        get {
          optionalHeaderValueByType(Authorization) {
            case Some(Authorization(cred)) if cred.token() == "secret-bearer-token" =>
              complete(HttpEntity(ContentTypes.`application/json`, JsArray(JsObject("ok" -> JsBoolean(true))).compactPrint))
            case _ => complete(StatusCodes.Unauthorized)
          }
        }
      },
      path("echo-query") {
        get {
          extractRequest { req =>
            complete(HttpEntity(ContentTypes.`application/json`, JsObject("rawQuery" -> JsString(req.uri.rawQueryString.getOrElse(""))).compactPrint))
          }
        }
      },
      path("apikey-endpoint") {
        get {
          parameterMap { params =>
            if (params.get("api_key").contains("secret-query-key"))
              complete(HttpEntity(ContentTypes.`application/json`, JsArray(JsObject("ok" -> JsBoolean(true))).compactPrint))
            else complete(StatusCodes.Unauthorized)
          }
        }
      }
    )
    testServerBinding = Await.result(Http(typedSystem.classicSystem).newServerAt("localhost", 0).bind(testRoutes), 10.seconds)
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
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($id::uuid, ${s"$id@migration-spec.test"}, now())"""
    ))
    UserId(id)
  }

  private def seedLegacyRestSource(ownerIdOpt: Option[UserId], name: String, config: String): DataSourceId = {
    val id = UUID.randomUUID().toString
    await(ctx.withSystemContext(
      ownerIdOpt match {
        case Some(owner) =>
          sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
                 VALUES ($id, $name, 'rest_api', $config::jsonb, ${owner.value}::uuid, now(), now())"""
        case None =>
          sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
                 VALUES ($id, $name, 'rest_api', $config::jsonb, NULL, now(), now())"""
      }
    ))
    DataSourceId(id)
  }

  private def rawConfigOf(id: DataSourceId): String =
    await(dataSourceRepo.readRawConfig(id)).getOrElse(fail(s"no row for $id"))

  "RestSourceConnectorMigration.run" should {

    "migrate a legacy bearer-auth row, and the new path fetches identically to the legacy pre-migration baseline (task 4.5)" in {
      val owner = freshUser()
      val url   = urlFor("bearer-endpoint")
      val legacyConfig = s"""{"url":"$url","method":"GET","auth":{"type":"bearer","token":"secret-bearer-token"}}"""
      val srcId = seedLegacyRestSource(Some(owner), "bearer-src", legacyConfig)

      // Pre-migration baseline: fetch through the raw legacy request shape directly.
      val baselineRequest = HttpRequest(
        uri = url,
        headers = List(Authorization(OAuth2BearerToken("secret-bearer-token")))
      )
      val baseline = await(Http(typedSystem.classicSystem).singleRequest(baselineRequest).flatMap(_.entity.toStrict(5.seconds)))
        .data.utf8String.parseJson

      await(RestSourceConnectorMigration.run(dataSourceRepo, connectorRepo, ctx, log))

      val migratedConfig = DataSourceConfigCodec.decodeRest(rawConfigOf(srcId))
      migratedConfig shouldBe a[Right[_, _]]
      val Right(cfg) = migratedConfig: @unchecked

      val afterMigration = await(driver.fetch(cfg, ConnectorResolveContext.Owned(AuthenticatedUser(owner))))
      afterMigration shouldBe Right(baseline)
    }

    "migrate a legacy api-key-in-query row identically (task 4.5, CR1's most-likely-to-break case)" in {
      val owner = freshUser()
      val url   = urlFor("apikey-endpoint")
      val legacyConfig = s"""{"url":"$url","method":"GET","auth":{"type":"api_key","name":"api_key","value":"secret-query-key","in":"query"}}"""
      val srcId = seedLegacyRestSource(Some(owner), "apikey-src", legacyConfig)

      val baselineUri = Uri(url).withQuery(
        Uri.Query("api_key" -> "secret-query-key")
      )
      val baseline = await(Http(typedSystem.classicSystem).singleRequest(HttpRequest(uri = baselineUri))
        .flatMap(_.entity.toStrict(5.seconds))).data.utf8String.parseJson

      await(RestSourceConnectorMigration.run(dataSourceRepo, connectorRepo, ctx, log))

      val Right(cfg) = DataSourceConfigCodec.decodeRest(rawConfigOf(srcId)): @unchecked
      val authShapeOwner = await(connectorRepo.findByIdOwned(ConnectorId(cfg.connectorId), AuthenticatedUser(owner))).get
      ConnectorAuthShape.parse(authShapeOwner.config).authType shouldBe "api_key"

      val afterMigration = await(driver.fetch(cfg, ConnectorResolveContext.Owned(AuthenticatedUser(owner))))
      afterMigration shouldBe Right(baseline)
    }

    // HEL-844 task 5.2: a legacy URL with a repeated query key migrates a config carrying BOTH.
    "migrates a legacy URL with a repeated query key into a config carrying both values, in order" in {
      val owner = freshUser()
      val url   = urlFor("echo-query") + "?tag=a&tag=b"
      val legacyConfig = s"""{"url":"$url"}"""
      val srcId = seedLegacyRestSource(Some(owner), "dup-query-src", legacyConfig)

      await(RestSourceConnectorMigration.run(dataSourceRepo, connectorRepo, ctx, log))

      val Right(cfg) = DataSourceConfigCodec.decodeRest(rawConfigOf(srcId)): @unchecked
      cfg.queryParams.pairs should contain theSameElementsInOrderAs Vector("tag" -> "a", "tag" -> "b")

      val Right(body) = await(driver.fetch(cfg, ConnectorResolveContext.Owned(AuthenticatedUser(owner)))): @unchecked
      body.asJsObject.fields("rawQuery") shouldBe JsString("tag=a&tag=b")
    }

    "skip an ownerless legacy row without crashing (task 4.1a, round-3 CR5)" in {
      val srcId = seedLegacyRestSource(None, "ownerless-src", """{"url":"https://example.test/ownerless"}""")
      await(RestSourceConnectorMigration.run(dataSourceRepo, connectorRepo, ctx, log))
      DataSourceConfigCodec.decodeRest(rawConfigOf(srcId)) shouldBe Left("legacy-unmigrated")
    }

    "skip a malformed row without crashing (task 4.6)" in {
      val owner = freshUser()
      val srcId = seedLegacyRestSource(Some(owner), "malformed-src", """{"notAUrlOrConnectorId":"x"}""")
      await(RestSourceConnectorMigration.run(dataSourceRepo, connectorRepo, ctx, log))
      val result = DataSourceConfigCodec.decodeRest(rawConfigOf(srcId))
      result shouldBe a[Left[_, _]]
      result.left.getOrElse("") should startWith("malformed:")
    }

    "is idempotent: a second run against already-migrated rows creates zero new Connectors and leaves rows unchanged (task 4.4)" in {
      val owner = freshUser()
      val url   = urlFor("bearer-endpoint")
      val legacyConfig = s"""{"url":"$url","auth":{"type":"bearer","token":"secret-bearer-token"}}"""
      val srcId = seedLegacyRestSource(Some(owner), "idempotent-src", legacyConfig)

      await(RestSourceConnectorMigration.run(dataSourceRepo, connectorRepo, ctx, log))
      val afterFirstRun = rawConfigOf(srcId)
      val connectorsBefore = await(connectorRepo.findAll(AuthenticatedUser(owner))).size

      await(RestSourceConnectorMigration.run(dataSourceRepo, connectorRepo, ctx, log))
      val afterSecondRun = rawConfigOf(srcId)
      val connectorsAfter = await(connectorRepo.findAll(AuthenticatedUser(owner))).size

      afterSecondRun shouldBe afterFirstRun
      connectorsAfter shouldBe connectorsBefore
    }
  }
}
