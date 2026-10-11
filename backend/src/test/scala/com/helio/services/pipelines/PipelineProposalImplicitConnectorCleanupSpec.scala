package com.helio.services.pipelines

import com.helio.api.protocols.pipelines.{PipelineProposal, PipelineProposalSource, ProposalRestApiConfig}
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.domain.model.{AuthenticatedUser, UserId}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ConnectorCredentialRepository
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.{ConnectorRepository, DataSourceRepository}
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.services.ServiceError
import com.helio.services.auth.{EncryptedSecretBackend, EnvMasterKeyProvider}
import com.helio.services.sources.{DataSourceService, SourceService}
import com.helio.testkit.{HelioRouteTest, TempDirectorySupport, VerifiedEmbeddedPostgres}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, Future}

/** HEL-1475 path 2, proposal-apply site: `PipelineProposalService.apply` resolves roots left to right and, when a later
 *  root fails to resolve, rolls back the inline sources it already made. A bare-`url` REST root made an implicit "Auto:"
 *  Connector, which that rollback must remove too. No fault injection: the second root names a source that does not exist.
 *  Counts are by the exact owner id. */
class PipelineProposalImplicitConnectorCleanupSpec extends AnyWordSpec with Matchers with HelioRouteTest with BeforeAndAfterAll with TempDirectorySupport {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var proposalService: PipelineProposalService = _

  private val ownerId = UUID.randomUUID().toString
  private val owner   = AuthenticatedUser(UserId(ownerId))

  override def beforeAll(): Unit = {
    import PostgresProfile.api._
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx            = new DbContext(db, db)
    val dataSourceRepo = new DataSourceRepository(ctx)
    val connectorRepo  = new ConnectorRepository(ctx, new ConnectorCredentialRepository(ctx, new EncryptedSecretBackend(new EnvMasterKeyProvider())))
    val outputRepo     = new OutputRepository(ctx)
    val rest           = new RestApiConnectorDriver(fetchOverride = Some(_ => Future.successful(Right(JsArray(JsObject("amount" -> JsNumber(1)))))))
    val sourceService  = new SourceService(dataSourceRepo, rest, connectorRepo = connectorRepo)
    val dataSourceService = new DataSourceService(dataSourceRepo, new LocalFileSystem(newTempDir("proposal-implicit-connector-cleanup")))
    val pipelineService = new PipelineService(
      new PipelineRepository(ctx, dataSourceRepo), new PipelineStepRepository(ctx), dataSourceRepo,
      outputRepo = outputRepo, sourceService = sourceService, dataSourceService = dataSourceService
    )
    proposalService = new PipelineProposalService(sourceService, dataSourceService, pipelineService, null, dataSourceRepo, outputRepo)
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($ownerId::uuid, ${s"p-$ownerId@helio.test"}, now())"""))
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 20.seconds)

  private def count(table: String): Int = {
    import PostgresProfile.api._
    await(db.run(sql"SELECT count(*) FROM #$table WHERE owner_id = $ownerId::uuid".as[Int])).head
  }

  "PipelineProposalService.apply when a later root does not resolve (HEL-1475)" should {
    "remove the earlier bare-url REST root's source AND its implicit Connector" in {
      val sourcesBefore = count("data_sources"); val connectorsBefore = count("connectors")
      val proposal = PipelineProposal(
        pipelineName = "rolled-back-proposal",
        roots = Vector(
          PipelineProposalSource(None, Some("rest_api"), Some(s"rest-${UUID.randomUUID()}"), None,
            Some(ProposalRestApiConfig(url = Some("http://example.invalid/data"), method = Some("GET"))), None, None),
          PipelineProposalSource(Some(UUID.randomUUID().toString), None, None, None, None, None, None)
        ),
        steps = Vector.empty
      )
      await(proposalService.apply(proposal, owner)) match {
        case Left(_: ServiceError.NotFound) => succeed
        case other                          => fail(s"expected the second root to be NotFound, got $other")
      }
      count("data_sources") shouldBe sourcesBefore
      count("connectors") shouldBe connectorsBefore
    }
  }
}
