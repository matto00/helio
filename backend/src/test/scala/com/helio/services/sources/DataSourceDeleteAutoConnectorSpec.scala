package com.helio.services.sources

import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.classic.{Logger => LogbackLogger}
import ch.qos.logback.core.read.ListAppender
import com.helio.domain.connectors.ConnectorAuthShape
import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ConnectorCredentialRepository
import com.helio.infrastructure.persistence.sources.{ConnectorHasDependents, ConnectorRepository, DataSourceRepository}
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.auth.{EncryptedSecretBackend, EnvMasterKeyProvider}
import com.helio.testkit.{HelioRouteTest, TempDirectorySupport, VerifiedEmbeddedPostgres}
import com.helio.testsupport.UserSeeding
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.stream.{Materializer, SystemMaterializer}
import org.flywaydb.core.Flyway
import org.postgresql.util.{PSQLException, PSQLState}
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import org.slf4j.LoggerFactory
import slick.jdbc.{JdbcBackend, PostgresProfile}

import java.time.Instant
import java.util.UUID
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt
import scala.jdk.CollectionConverters._

/** HEL-1497: deleting a `rest_api` source also removes its UNADOPTED auto-created Connector (and that Connector's
 *  credential row) -- `config.implicit` true AND an `Auto: ` name AND no other referencing source -- owner-scoped,
 *  without ever failing or changing the source delete, and without logging a credential. Real Postgres, real
 *  repositories, the real credential table. Fixtures are inserted directly through the repositories so the
 *  assertions never depend on the code under test to build them. */
class DataSourceDeleteAutoConnectorSpec
    extends AnyWordSpec
    with Matchers
    with HelioRouteTest
    with BeforeAndAfterAll
    with TempDirectorySupport {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private implicit val mat: Materializer                 = SystemMaterializer(typedSystem).materializer
  private def routeEc: ExecutionContext                  = typedSystem.executionContext

  private var embeddedPostgres: EmbeddedPostgres   = _
  private var db: JdbcBackend.Database             = _
  private var dataSourceRepo: DataSourceRepository = _
  private var connectorRepo: ConnectorRepository   = _
  private var service: DataSourceService           = _

  private val userA = AuthenticatedUser(UserId(UUID.randomUUID().toString))
  private val userB = AuthenticatedUser(UserId(UUID.randomUUID().toString))

  private val sentinel = "SENTINEL-bearer-1497-do-not-log"

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    UserSeeding.seedUsers(db, userA.id, userB.id)
    val ctx = new DbContext(db, db)(routeEc)
    dataSourceRepo = new DataSourceRepository(ctx)(routeEc)
    connectorRepo  = newConnectorRepo(ctx)
    service        = buildService(connectorRepo)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def newConnectorRepo(ctx: DbContext): ConnectorRepository =
    new ConnectorRepository(ctx, new ConnectorCredentialRepository(ctx, new EncryptedSecretBackend(new EnvMasterKeyProvider())))(routeEc)

  private def buildService(connectors: ConnectorRepository): DataSourceService =
    new DataSourceService(
      dataSourceRepo, new LocalFileSystem(newTempDir("data-source-delete-auto-connector-spec")),
      connectorRepo = connectors
    )(routeEc, mat, typedSystem)

  private def await[T](f: Future[T]): T = Await.result(f, 15.seconds)

  /** An implicit connector exactly as `SourceService.createRest` makes one, but with a real bearer token. */
  private def autoConnector(user: AuthenticatedUser, name: String = s"Auto: ${UUID.randomUUID()}"): Connector = {
    val (cname, cfg, plain, credName) = ImplicitConnectorConfig.forLegacySource(name, "http://example.invalid", RestApiAuth.BearerAuth(sentinel))
    await(connectorRepo.create(user.id, cname, DataSourceKind.RestApi, "http://example.invalid", cfg, plain, credName))
  }

  /** A user-created (non-implicit) connector. */
  private def userConnector(user: AuthenticatedUser, name: String): Connector = {
    val cfg = ConnectorAuthShape.encode(ConnectorAuthShape(authType = "bearer"))
    await(connectorRepo.create(user.id, name, DataSourceKind.RestApi, "http://example.invalid", cfg, sentinel, s"$name credential"))
  }

  private def restSource(user: AuthenticatedUser, name: String, connector: ConnectorId): RestSource = {
    val now = Instant.now()
    val cfg = RestApiConfig(
      connectorId = connector.value, endpoint = "/data", method = "GET", queryParams = QueryParams(Vector.empty),
      headers = Map.empty, body = None, bodyContentType = None, rootSelector = None, parameters = Map.empty
    )
    await(dataSourceRepo.insert(RestSource(DataSourceId(UUID.randomUUID().toString), name, user.id, now, now, cfg), user)).asInstanceOf[RestSource]
  }

  private def connectorExists(id: ConnectorId, owner: AuthenticatedUser): Boolean =
    await(connectorRepo.findByIdOwned(id, owner)).isDefined

  private def credentialRows(c: Connector): Int = {
    import PostgresProfile.api._
    val credId = c.credentialId.get.value
    await(db.run(sql"SELECT count(*) FROM connector_credentials WHERE id = $credId::uuid".as[Int])).head
  }

  /** Captures the two loggers the cleanup path writes to. */
  private def capturingLogs[T](body: => T): (T, Seq[String]) = {
    val loggers = Seq(classOf[DataSourceService], classOf[ImplicitConnectorCleanup]).map(c => LoggerFactory.getLogger(c).asInstanceOf[LogbackLogger])
    val appender = new ListAppender[ILoggingEvent]()
    appender.start()
    loggers.foreach(_.addAppender(appender))
    try {
      val result = body
      (result, appender.list.asScala.toSeq.map(e => e.getFormattedMessage + Option(e.getThrowableProxy).fold("")(t => s" | ${t.getClassName}: ${t.getMessage}")))
    } finally loggers.foreach(_.detachAppender(appender))
  }

  "DataSourceService.delete (HEL-1497)" should {

    "remove the source's unadopted Auto Connector and its credential row" in {
      val connector = autoConnector(userA)
      val source    = restSource(userA, "bare-url source", connector.id)
      credentialRows(connector) shouldBe 1

      await(service.delete(source.id, userA)) shouldBe Right(())

      await(dataSourceRepo.findByIdOwned(source.id, userA)) shouldBe None
      connectorExists(connector.id, userA) shouldBe false
      credentialRows(connector) shouldBe 0
    }

    "keep a reused Auto Connector while another source references it, and remove it with the last one" in {
      val connector = autoConnector(userA)
      val first     = restSource(userA, "first", connector.id)
      val second    = restSource(userA, "second", connector.id)

      await(service.delete(first.id, userA)) shouldBe Right(())
      connectorExists(connector.id, userA) shouldBe true
      credentialRows(connector) shouldBe 1

      await(service.delete(second.id, userA)) shouldBe Right(())
      connectorExists(connector.id, userA) shouldBe false
      credentialRows(connector) shouldBe 0
    }

    "keep an implicit Connector the user renamed so it no longer starts with 'Auto: '" in {
      val connector = autoConnector(userA)
      val source    = restSource(userA, "adopted", connector.id)
      await(connectorRepo.update(connector.id, "My Stripe", connector.baseUrl, connector.config, Instant.now(), userA)).isDefined shouldBe true

      await(service.delete(source.id, userA)) shouldBe Right(())

      connectorExists(connector.id, userA) shouldBe true
      credentialRows(connector) shouldBe 1
    }

    "still clean up when only the source was renamed" in {
      val connector = autoConnector(userA, name = "Auto: original name")
      val source    = restSource(userA, "a completely different source name", connector.id)

      await(service.delete(source.id, userA)) shouldBe Right(())

      connectorExists(connector.id, userA) shouldBe false
    }

    "keep a user-created Connector even when its name starts with 'Auto: '" in {
      val connector = userConnector(userA, "Auto: lookalike")
      val source    = restSource(userA, "uses lookalike", connector.id)

      await(service.delete(source.id, userA)) shouldBe Right(())

      connectorExists(connector.id, userA) shouldBe true
      credentialRows(connector) shouldBe 1
    }

    "never remove another user's Connector, even when the deleter's own source is forged to reference it" in {
      // A's Auto Connector has NO referencing source, so the global dependents count is 0: only the owner filter
      // protects it from B's delete.
      val connectorOfA = autoConnector(userA)
      val forged       = restSource(userB, "forged reference", connectorOfA.id)

      await(service.delete(forged.id, userB)) shouldBe Right(())

      await(dataSourceRepo.findByIdOwned(forged.id, userB)) shouldBe None
      connectorExists(connectorOfA.id, userA) shouldBe true
      credentialRows(connectorOfA) shouldBe 1
    }

    "leave the source delete's outcome unchanged and log no credential when the Connector cleanup fails" in {
      val connector = autoConnector(userA)
      val source    = restSource(userA, "cleanup will fail", connector.id)
      // The injected failure's MESSAGE embeds the credential value, as a PSQL DETAIL could embed a row value.
      val failing = new ConnectorRepository(new DbContext(db, db)(routeEc), new ConnectorCredentialRepository(new DbContext(db, db)(routeEc), new EncryptedSecretBackend(new EnvMasterKeyProvider()))(routeEc))(routeEc) {
        override def delete(
            id: ConnectorId, user: AuthenticatedUser, dependentCount: ConnectorId => Future[Int]
        ): Future[Either[ConnectorHasDependents.type, Boolean]] =
          Future.failed(new PSQLException(s"ERROR: boom DETAIL: Key (token)=($sentinel)", PSQLState.UNEXPECTED_ERROR))
      }

      val (result, lines) = capturingLogs(await(buildService(failing).delete(source.id, userA)))

      result shouldBe Right(())
      await(dataSourceRepo.findByIdOwned(source.id, userA)) shouldBe None
      lines.exists(l => l.contains("failed to delete unadopted connector") && l.contains(connector.id.value)) shouldBe true
      lines.filter(_.contains(sentinel)) shouldBe empty
      connectorExists(connector.id, userA) shouldBe true
    }

    "not touch Connectors when no connector repository is wired" in {
      val connector = autoConnector(userA)
      val source    = restSource(userA, "no repo", connector.id)

      await(buildService(null).delete(source.id, userA)) shouldBe Right(())

      connectorExists(connector.id, userA) shouldBe true
    }
  }

  "InlineSourceCleanup compensation (HEL-1497)" should {

    "remove an unreferenced Auto Connector named by connectorId, and keep a user-created one" in {
      val cleanup = new InlineSourceCleanup(dataSourceRepo, service, connectorRepo)(routeEc)
      val auto    = autoConnector(userA)
      val mine    = userConnector(userA, "Auto: user created")
      val autoSrc = restSource(userA, "inline on auto", auto.id)
      val mineSrc = restSource(userA, "inline on mine", mine.id)

      await(cleanup.deleteCallCreated(autoSrc.id, implicitConnector = false, userA, "test")) shouldBe true
      await(cleanup.deleteCallCreated(mineSrc.id, implicitConnector = false, userA, "test")) shouldBe true

      connectorExists(auto.id, userA) shouldBe false
      connectorExists(mine.id, userA) shouldBe true
    }
  }
}
