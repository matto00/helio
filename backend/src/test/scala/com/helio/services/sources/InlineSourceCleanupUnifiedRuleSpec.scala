package com.helio.services.sources

import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.classic.{Logger => LogbackLogger}
import ch.qos.logback.core.read.ListAppender
import com.helio.domain.connectors.ConnectorAuthShape
import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ConnectorCredentialRepository
import com.helio.infrastructure.persistence.sources.{ConnectorRepository, DataSourceReferenceRepository, DataSourceRepository}
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

/** HEL-1505 items 2+5: every auto-Connector cleanup in `InlineSourceCleanup` applies the ONE HEL-1497 rule (implicit
 *  flag AND `Auto: ` prefix AND zero real referencing sources, owner-scoped), and no failure log line in that file
 *  carries an exception message (a PSQL DETAIL can embed a row value).
 *
 *  The `DataSourceService` here is deliberately built WITHOUT a `connectorRepo`, so its own HEL-1497 cleanup never
 *  runs and the rule under test is `InlineSourceCleanup`'s own. */
class InlineSourceCleanupUnifiedRuleSpec
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
  private var ctx: DbContext                       = _
  private var dataSourceRepo: DataSourceRepository = _
  private var connectorRepo: ConnectorRepository   = _
  private var service: DataSourceService           = _
  private var cleanup: InlineSourceCleanup         = _

  private val userA = AuthenticatedUser(UserId(UUID.randomUUID().toString))
  private val userB = AuthenticatedUser(UserId(UUID.randomUUID().toString))

  private val sentinel = "SENTINEL-1505-row-value-do-not-log"

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    UserSeeding.seedUsers(db, userA.id, userB.id)
    ctx            = new DbContext(db, db)(routeEc)
    dataSourceRepo = new DataSourceRepository(ctx)(routeEc)
    connectorRepo  = new ConnectorRepository(ctx, new ConnectorCredentialRepository(ctx, new EncryptedSecretBackend(new EnvMasterKeyProvider()))(routeEc))(routeEc)
    service        = new DataSourceService(dataSourceRepo, new LocalFileSystem(newTempDir("inline-cleanup-unified-rule")))(routeEc, mat, typedSystem)
    cleanup        = new InlineSourceCleanup(dataSourceRepo, service, connectorRepo)(routeEc)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 15.seconds)

  private def autoConnector(user: AuthenticatedUser, name: String): Connector = {
    val (cname, cfg, plain, credName) = ImplicitConnectorConfig.forLegacySource(name, "http://example.invalid", RestApiAuth.BearerAuth("test-secret-value"))
    await(connectorRepo.create(user.id, cname, DataSourceKind.RestApi, "http://example.invalid", cfg, plain, credName))
  }

  private def userConnector(user: AuthenticatedUser, name: String): Connector = {
    val cfg = ConnectorAuthShape.encode(ConnectorAuthShape(authType = "bearer"))
    await(connectorRepo.create(user.id, name, DataSourceKind.RestApi, "http://example.invalid", cfg, "test-secret-value", s"$name credential"))
  }

  private def restSource(user: AuthenticatedUser, name: String, connector: ConnectorId): RestSource = {
    val now = Instant.now()
    val cfg = RestApiConfig(
      connectorId = connector.value, endpoint = "/data", method = "GET", queryParams = QueryParams(Vector.empty),
      headers = Map.empty, body = None, bodyContentType = None, rootSelector = None, parameters = Map.empty
    )
    await(dataSourceRepo.insert(RestSource(DataSourceId(UUID.randomUUID().toString), name, user.id, now, now, cfg), user)).asInstanceOf[RestSource]
  }

  private def connectorExists(c: Connector, owner: AuthenticatedUser): Boolean = await(connectorRepo.findByIdOwned(c.id, owner)).isDefined

  private def credentialRows(c: Connector): Int = {
    import PostgresProfile.api._
    val credId = c.credentialId.get.value
    await(db.run(sql"SELECT count(*) FROM connector_credentials WHERE id = $credId::uuid".as[Int])).head
  }

  private def capturingLogs[T](body: => T): (T, Seq[String]) = {
    val loggers  = Seq(classOf[InlineSourceCleanup], classOf[ImplicitConnectorCleanup]).map(c => LoggerFactory.getLogger(c).asInstanceOf[LogbackLogger])
    val appender = new ListAppender[ILoggingEvent]()
    appender.start()
    loggers.foreach(_.addAppender(appender))
    try {
      val result = body
      (result, appender.list.asScala.toSeq.map(e => e.getFormattedMessage + Option(e.getThrowableProxy).fold("")(t => s" | ${t.getClassName}: ${t.getMessage}")))
    } finally loggers.foreach(_.detachAppender(appender))
  }

  private def boom: PSQLException = new PSQLException(s"ERROR: boom DETAIL: Key (token)=($sentinel)", PSQLState.UNEXPECTED_ERROR)

  "InlineSourceCleanup.deleteCallCreated (one auto-created rule)" should {

    "remove the Auto Connector and credential of a source that was renamed" in {
      val connector = autoConnector(userA, "Auto: original name")
      val source    = restSource(userA, "renamed since creation", connector.id)
      await(cleanup.deleteCallCreated(source.id, implicitConnector = true, userA, "test")) shouldBe true
      connectorExists(connector, userA) shouldBe false
      credentialRows(connector) shouldBe 0
    }

    "keep an adopted (renamed) implicit Connector" in {
      val connector = autoConnector(userA, "My Stripe")
      val source    = restSource(userA, "adopted", connector.id)
      await(cleanup.deleteCallCreated(source.id, implicitConnector = true, userA, "test")) shouldBe true
      connectorExists(connector, userA) shouldBe true
      credentialRows(connector) shouldBe 1
    }

    "keep a user-created Connector even when its name is exactly 'Auto: <source name>'" in {
      val connector = userConnector(userA, "Auto: lookalike source")
      val source    = restSource(userA, "lookalike source", connector.id)
      await(cleanup.deleteCallCreated(source.id, implicitConnector = true, userA, "test")) shouldBe true
      connectorExists(connector, userA) shouldBe true
      credentialRows(connector) shouldBe 1
    }

    "keep the Connector while another source references it" in {
      val connector = autoConnector(userA, "Auto: shared")
      val first     = restSource(userA, "first", connector.id)
      restSource(userA, "second", connector.id)
      await(cleanup.deleteCallCreated(first.id, implicitConnector = true, userA, "test")) shouldBe true
      connectorExists(connector, userA) shouldBe true
    }

    "never remove another user's Connector" in {
      val connectorOfA = autoConnector(userA, "Auto: tenant a")
      val forged       = restSource(userB, "forged reference", connectorOfA.id)
      await(cleanup.deleteCallCreated(forged.id, implicitConnector = true, userB, "test")) shouldBe true
      connectorExists(connectorOfA, userA) shouldBe true
      credentialRows(connectorOfA) shouldBe 1
    }
  }

  "InlineSourceCleanup.deleteIfUnreferenced (one auto-created rule)" should {

    "remove the Auto Connector of a renamed source" in {
      val connector = autoConnector(userA, "Auto: original name")
      val source    = restSource(userA, "renamed since creation", connector.id)
      await(cleanup.deleteIfUnreferenced(source.id, implicitConnector = true, userA, "test")) shouldBe a[InlineSourceDeleteResult.Removed]
      connectorExists(connector, userA) shouldBe false
      credentialRows(connector) shouldBe 0
    }

    "keep an adopted Connector and a still-shared Connector" in {
      val adopted = autoConnector(userA, "Adopted by me")
      val shared  = autoConnector(userA, "Auto: shared undo")
      val adoptedSrc = restSource(userA, "adopted src", adopted.id)
      val sharedSrc  = restSource(userA, "shared src", shared.id)
      restSource(userA, "other referrer", shared.id)
      await(cleanup.deleteIfUnreferenced(adoptedSrc.id, implicitConnector = true, userA, "test")) shouldBe a[InlineSourceDeleteResult.Removed]
      await(cleanup.deleteIfUnreferenced(sharedSrc.id, implicitConnector = true, userA, "test")) shouldBe a[InlineSourceDeleteResult.Removed]
      connectorExists(adopted, userA) shouldBe true
      connectorExists(shared, userA) shouldBe true
    }

    "keep a user-created Connector named exactly 'Auto: <source name>'" in {
      val connector = userConnector(userA, "Auto: lookalike undo")
      val source    = restSource(userA, "lookalike undo", connector.id)
      await(cleanup.deleteIfUnreferenced(source.id, implicitConnector = true, userA, "test")) shouldBe a[InlineSourceDeleteResult.Removed]
      connectorExists(connector, userA) shouldBe true
    }
  }

  "InlineSourceCleanup failure logging" should {

    def failingConnectorRepo: ConnectorRepository =
      new ConnectorRepository(ctx, new ConnectorCredentialRepository(ctx, new EncryptedSecretBackend(new EnvMasterKeyProvider()))(routeEc))(routeEc) {
        override def findByIdOwned(id: ConnectorId, user: AuthenticatedUser): Future[Option[Connector]] = Future.failed(boom)
      }

    /** The service's reference check runs first, so a failing `findReferences` fails `DataSourceService.delete`. */
    def failingSourceDelete: (DataSourceRepository, DataSourceService) = {
      val failingRepo = new DataSourceRepository(ctx)(routeEc) {
        override def findReferences(id: DataSourceId, user: AuthenticatedUser): Future[DataSourceReferenceRepository.SourceReferences] = Future.failed(boom)
      }
      (failingRepo, new DataSourceService(failingRepo, new LocalFileSystem(newTempDir("inline-cleanup-log-safety")))(routeEc, mat, typedSystem))
    }

    def failingSourceRead: DataSourceRepository =
      new DataSourceRepository(ctx)(routeEc) {
        override def findByIdOwned(id: DataSourceId, user: AuthenticatedUser): Future[Option[DataSource]] = Future.failed(boom)
      }

    def assertSafe(lines: Seq[String], idFragment: String): Unit = {
      lines.filter(_.contains(sentinel)) shouldBe empty
      lines.exists(_.contains(idFragment)) shouldBe true
    }

    "log the connector cleanup failure by id, class and SQLSTATE only" in {
      val connector = autoConnector(userA, "Auto: cleanup fails")
      val source    = restSource(userA, "cleanup fails", connector.id)
      val failing   = new InlineSourceCleanup(dataSourceRepo, service, failingConnectorRepo)(routeEc)
      val (result, lines) = capturingLogs(await(failing.deleteCallCreated(source.id, implicitConnector = true, userA, "ctx-1")))
      result shouldBe false
      assertSafe(lines, connector.id.value)
    }

    "log a source-delete failure in deleteCallCreated without the exception message" in {
      val connector = autoConnector(userA, "Auto: delete fails")
      val source    = restSource(userA, "delete fails", connector.id)
      val failing   = { val (repo, svc) = failingSourceDelete; new InlineSourceCleanup(repo, svc, connectorRepo)(routeEc) }
      val (result, lines) = capturingLogs(await(failing.deleteCallCreated(source.id, implicitConnector = false, userA, "ctx-2")))
      result shouldBe false
      assertSafe(lines, source.id.value)
    }

    "log a source-delete failure in deleteIfUnreferenced without the exception message" in {
      val connector = autoConnector(userA, "Auto: undo delete fails")
      val source    = restSource(userA, "undo delete fails", connector.id)
      val failing   = { val (repo, svc) = failingSourceDelete; new InlineSourceCleanup(repo, svc, connectorRepo)(routeEc) }
      val (result, lines) = capturingLogs(await(failing.deleteIfUnreferenced(source.id, implicitConnector = false, userA, "ctx-3")))
      result shouldBe a[InlineSourceDeleteResult.Failed]
      assertSafe(lines, source.id.value)
    }

    "log a failed source read in deleteIfUnreferenced without the exception message" in {
      val id = DataSourceId(UUID.randomUUID().toString)
      val failing = new InlineSourceCleanup(failingSourceRead, service, connectorRepo)(routeEc)
      val (result, lines) = capturingLogs(await(failing.deleteIfUnreferenced(id, implicitConnector = false, userA, "ctx-4")))
      result shouldBe InlineSourceDeleteResult.Failed(None)
      assertSafe(lines, id.value)
    }

    "log a failed implicit-connector capture read without the exception message" in {
      val id = DataSourceId(UUID.randomUUID().toString)
      val failing = new InlineSourceCleanup(failingSourceRead, service, connectorRepo)(routeEc)
      val (_, lines) = capturingLogs(await(failing.deleteCallCreated(id, implicitConnector = true, userA, "ctx-5")))
      assertSafe(lines, id.value)
    }
  }
}
