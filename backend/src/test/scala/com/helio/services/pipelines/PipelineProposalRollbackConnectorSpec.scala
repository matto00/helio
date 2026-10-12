package com.helio.services.pipelines

import com.helio.api.protocols.pipelines.{NewConnectorDraft, PipelineProposal, PipelineProposalApplyResponse, PipelineProposalSource, ProposalRestApiConfig}
import com.helio.domain.connectors.{ConnectorAuthShape, RestApiConnectorDriver}
import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ConnectorCredentialRepository
import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputRepository, PipelineRepository, PipelineRootRepository, PipelineRunRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.{ConnectorRepository, DataSourceRepository}
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.ServiceError
import com.helio.services.auth.{EncryptedSecretBackend, EnvMasterKeyProvider}
import com.helio.services.sources.{DataSourceService, ImplicitConnectorConfig, SourceService}
import com.helio.spark.PipelineRunCache
import com.helio.testkit.{HelioRouteTest, TempDirectorySupport, VerifiedEmbeddedPostgres}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, Future}

/** HEL-1496 guards for the Connector a proposal leaves behind. The public `PipelineProposalService.rollback` cannot
 *  tell whether a REST source's Connector was call-created, so what removes the "Auto:" Connector on that path is
 *  `DataSourceService.delete` (HEL-1497). These specs wire `DataSourceService` the production way (with the
 *  `ConnectorRepository`) and a real `PipelineRunService`; the older cleanup spec wires neither. Apply stays on its
 *  success path because the REST fetch is stubbed to fail, which records an unrunnable run instead of rolling back.
 *  Counts are by the exact owner id. A rollback keeps a Connector the user made explicitly: that is current behaviour
 *  and an open owner question, not a requirement. */
class PipelineProposalRollbackConnectorSpec extends AnyWordSpec with Matchers with HelioRouteTest with BeforeAndAfterAll with TempDirectorySupport {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped

  private var embeddedPostgres: EmbeddedPostgres       = _
  private var db: JdbcBackend.Database                 = _
  private var proposalService: PipelineProposalService = _
  private var dataSourceService: DataSourceService     = _
  private var dataSourceRepo: DataSourceRepository     = _
  private var connectorRepo: ConnectorRepository       = _

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx      = new DbContext(db, db)
    dataSourceRepo = new DataSourceRepository(ctx)
    connectorRepo  = new ConnectorRepository(ctx, new ConnectorCredentialRepository(ctx, new EncryptedSecretBackend(new EnvMasterKeyProvider())))
    val fs           = new LocalFileSystem(newTempDir("proposal-rollback-connector"))
    val outputRepo   = new OutputRepository(ctx)
    val pipelineRepo = new PipelineRepository(ctx, dataSourceRepo)
    val stepRepo     = new PipelineStepRepository(ctx)
    // A failed fetch keeps the source (fetchError) and apply answers Right with a blocked run.
    val rest          = new RestApiConnectorDriver(fetchOverride = Some(_ => Future.successful(Left("no HTTP"))))
    val sourceService = new SourceService(dataSourceRepo, rest, connectorRepo = connectorRepo)
    dataSourceService = new DataSourceService(dataSourceRepo, fs, connectorRepo = connectorRepo)
    val pipelineService = new PipelineService(
      pipelineRepo, stepRepo, dataSourceRepo, outputRepo = outputRepo, pipelineRootRepo = new PipelineRootRepository(ctx),
      sourceService = sourceService, dataSourceService = dataSourceService
    )
    val runService = new PipelineRunService(
      pipelineRepo, stepRepo, dataSourceRepo, new PipelineRunRepository(ctx), new PipelineRunCache, registry = null, fs,
      outputRepo = outputRepo, nodeSnapshotRepo = new NodeSnapshotRepository(ctx)
    )
    proposalService = new PipelineProposalService(sourceService, dataSourceService, pipelineService, runService, dataSourceRepo, outputRepo)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 30.seconds)

  private def newUser(): AuthenticatedUser = {
    val id = UUID.randomUUID().toString
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($id::uuid, ${s"hel1496-$id@example.test"}, now())"""))
    AuthenticatedUser(UserId(id))
  }

  private def count(table: String, owner: AuthenticatedUser): Int = {
    val id = owner.id.value
    table match {
      case "data_sources"          => await(db.run(sql"SELECT count(*) FROM data_sources WHERE owner_id = $id::uuid".as[Int].head))
      case "connectors"            => await(db.run(sql"SELECT count(*) FROM connectors WHERE owner_id = $id::uuid".as[Int].head))
      case "connector_credentials" => await(db.run(sql"SELECT count(*) FROM connector_credentials WHERE user_id = $id::uuid".as[Int].head))
      case "pipelines"             => await(db.run(sql"SELECT count(*) FROM pipelines WHERE owner_id = $id::uuid".as[Int].head))
    }
  }

  private def connectorNames(owner: AuthenticatedUser): Vector[String] =
    await(db.run(sql"SELECT name FROM connectors WHERE owner_id = ${owner.id.value}::uuid".as[String])).toVector

  private def restProposal(rest: ProposalRestApiConfig): PipelineProposal =
    PipelineProposal(
      pipelineName = s"hel1496-${UUID.randomUUID()}",
      roots = Vector(PipelineProposalSource(None, Some("rest_api"), Some(s"rest-${UUID.randomUUID()}"), None, Some(rest), None, None)),
      steps = Vector.empty
    )

  private def applied(result: Either[ServiceError, PipelineProposalApplyResponse]): PipelineProposalApplyResponse =
    result match {
      case Right(response) => response
      case Left(error)     => fail(s"apply was expected to succeed on the blocked-run path, got $error")
    }

  "PipelineProposalService.rollback after a successful apply (HEL-1496 gap 1)" should {
    "remove the bare-url REST root's source, its Auto Connector and the credential row" in {
      val user = newUser()
      val sourcesBefore = count("data_sources", user); val connectorsBefore = count("connectors", user)
      val credentialsBefore = count("connector_credentials", user)

      val response = applied(await(proposalService.apply(restProposal(ProposalRestApiConfig(url = Some("http://example.invalid/data"), method = Some("GET"))), user)))

      response.sources should have size 1
      count("data_sources", user) shouldBe sourcesBefore + 1
      count("connectors", user) shouldBe connectorsBefore + 1
      count("connector_credentials", user) shouldBe credentialsBefore + 1
      connectorNames(user).forall(_.startsWith("Auto: ")) shouldBe true

      await(proposalService.rollback(response, user))

      count("pipelines", user) shouldBe 0
      count("data_sources", user) shouldBe sourcesBefore
      count("connectors", user) shouldBe connectorsBefore
      count("connector_credentials", user) shouldBe credentialsBefore
    }
  }

  "A proposal's newConnector draft (HEL-1496 gap 2)" should {
    "create no Connector and no source: the draft is rejected with a 400 before any write" in {
      val user = newUser()
      val draft = NewConnectorDraft("Draft", "http://example.invalid", "none", None, None, "no key needed")

      val result = await(proposalService.apply(restProposal(ProposalRestApiConfig(newConnector = Some(draft), endpoint = Some("/data"))), user))

      result.left.toOption.exists(_.isInstanceOf[ServiceError.BadRequest]) shouldBe true
      count("connectors", user) shouldBe 0
      count("connector_credentials", user) shouldBe 0
      count("data_sources", user) shouldBe 0
      count("pipelines", user) shouldBe 0
    }

    // Current behaviour, not a requirement: whether a rollback should also remove a Connector the user created
    // explicitly for the proposal (in the UI, or by an agent via create_connector) is an open owner question.
    "currently keep a user-explicit Connector on rollback while removing the source that references it" in {
      val user = newUser()
      val cfg  = ConnectorAuthShape.encode(ConnectorAuthShape(authType = "none"))
      val explicit = await(connectorRepo.create(user.id, "My own API", DataSourceKind.RestApi, "http://example.invalid", cfg, "", "My own API credential"))
      val sourcesBefore = count("data_sources", user); val connectorsBefore = count("connectors", user)

      val response = applied(await(proposalService.apply(restProposal(ProposalRestApiConfig(connectorId = Some(explicit.id.value), endpoint = Some("/data"))), user)))
      count("data_sources", user) shouldBe sourcesBefore + 1
      count("connectors", user) shouldBe connectorsBefore

      await(proposalService.rollback(response, user))

      count("data_sources", user) shouldBe sourcesBefore
      count("connectors", user) shouldBe connectorsBefore
      val kept = await(connectorRepo.findByIdOwned(explicit.id, user)).getOrElse(fail("the explicit Connector was removed"))
      kept.name shouldBe "My own API"
      ConnectorAuthShape.parse(kept.config).`implicit` shouldBe false
    }
  }

  "DataSourceService.delete (HEL-1496 cross-tenant)" should {
    "never delete another user's unadopted Auto Connector, even when the deleting user's source references it" in {
      val userA = newUser(); val userB = newUser()
      val (name, cfg, plain, credName) = ImplicitConnectorConfig.forLegacySource(s"Auto: ${UUID.randomUUID()}", "http://example.invalid", RestApiAuth.NoAuth)
      val foreign = await(connectorRepo.create(userB.id, name, DataSourceKind.RestApi, "http://example.invalid", cfg, plain, credName))
      val now     = Instant.now()
      val restCfg = RestApiConfig(
        connectorId = foreign.id.value, endpoint = "/data", method = "GET", queryParams = QueryParams(Vector.empty),
        headers = Map.empty, body = None, bodyContentType = None, rootSelector = None, parameters = Map.empty
      )
      val source = await(dataSourceRepo.insert(RestSource(DataSourceId(UUID.randomUUID().toString), "forged reference", userA.id, now, now, restCfg), userA))
      count("connectors", userB) shouldBe 1
      count("connector_credentials", userB) shouldBe 1

      await(dataSourceService.delete(source.id, userA)).isRight shouldBe true

      await(dataSourceRepo.findByIdOwned(source.id, userA)) shouldBe None
      count("connectors", userB) shouldBe 1
      count("connector_credentials", userB) shouldBe 1
      await(connectorRepo.findByIdOwned(foreign.id, userB)).map(_.name) shouldBe Some(name)
    }
  }
}
