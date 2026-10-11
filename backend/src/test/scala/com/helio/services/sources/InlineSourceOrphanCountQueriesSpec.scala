package com.helio.services.sources

import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ConnectorCredentialRepository
import com.helio.infrastructure.persistence.pipelines.PipelineRepository
import com.helio.infrastructure.persistence.sources.{ConnectorRepository, DataSourceRepository}
import com.helio.services.auth.{EncryptedSecretBackend, EnvMasterKeyProvider}
import com.helio.testkit.VerifiedEmbeddedPostgres
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}

import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1475: the read-only orphan-count queries in `openspec/changes/inline-source-leak-paths/prod-count-queries.md`
 *  (the statements below are copied verbatim from it) run on the current schema and count what they claim to. */
class InlineSourceOrphanCountQueriesSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _

  private val ownerId = UUID.randomUUID().toString

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(5))
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 20.seconds)

  private val implicitConnectorOrphans =
    """SELECT count(*) FROM connectors c
      |WHERE c.name LIKE 'Auto: %'
      |  AND NOT EXISTS (
      |    SELECT 1 FROM data_sources d
      |    WHERE d.source_type = 'rest_api' AND d.config ->> 'connectorId' = c.id::text
      |  )""".stripMargin

  private val unreferencedSourcesUpperBound =
    """SELECT count(*) FROM data_sources d
      |WHERE d.source_type IN ('sql', 'rest_api', 'dataset')
      |  AND NOT EXISTS (SELECT 1 FROM pipeline_roots r WHERE r.data_source_id = d.id)""".stripMargin

  private def run(query: String): Int = {
    import PostgresProfile.api._
    await(db.run(sql"#$query".as[Int])).head
  }

  "the HEL-1475 read-only count queries" should {

    "count an unreferenced Auto Connector but not a referenced one, and an unreferenced source but not a rooted one" in {
      import PostgresProfile.api._
      val ctx            = new DbContext(db, db)
      val dataSourceRepo = new DataSourceRepository(ctx)
      val connectorRepo  = new ConnectorRepository(ctx, new ConnectorCredentialRepository(ctx, new EncryptedSecretBackend(new EnvMasterKeyProvider())))
      val pipelineRepo   = new PipelineRepository(ctx, dataSourceRepo)
      val owner          = AuthenticatedUser(UserId(ownerId))
      await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($ownerId::uuid, ${s"q-$ownerId@helio.test"}, now())"""))

      def autoConnector(name: String) = {
        val (cname, cfg, plain, credName) = ImplicitConnectorConfig.forLegacySource(s"Auto: $name", "http://example.invalid", RestApiAuth.NoAuth)
        await(connectorRepo.create(owner.id, cname, DataSourceKind.RestApi, "http://example.invalid", cfg, plain, credName))
      }
      def dataset(name: String): DataSourceId = {
        val now = Instant.now()
        await(dataSourceRepo.insert(DatasetSource(DataSourceId(UUID.randomUUID().toString), name, owner.id, now, now), owner)).id
      }

      val before = (run(implicitConnectorOrphans), run(unreferencedSourcesUpperBound))
      autoConnector("orphan")
      val used = autoConnector("used")
      val now  = Instant.now()
      val referrerConfig = RestApiConfig(used.id.value, "/data", "GET", QueryParams(Vector.empty), Map.empty, None, None, None, Map.empty)
      await(dataSourceRepo.insert(RestSource(DataSourceId(UUID.randomUUID().toString), "used", owner.id, now, now, referrerConfig), owner))
      dataset("unrooted")
      val rooted = dataset("rooted")
      await(pipelineRepo.create("p", Vector(rooted), owner, None))

      // the referencing RestSource has no pipeline root either, so it counts toward the upper bound with the unrooted dataset
      run(implicitConnectorOrphans) shouldBe before._1 + 1
      run(unreferencedSourcesUpperBound) shouldBe before._2 + 2
    }
  }
}
