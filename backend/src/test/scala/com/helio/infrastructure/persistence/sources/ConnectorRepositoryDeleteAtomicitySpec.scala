package com.helio.infrastructure.persistence.sources

import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ConnectorCredentialRepository
import com.helio.services.auth.{EncryptedSecretBackend, EnvMasterKeyProvider}
import com.helio.testkit.VerifiedEmbeddedPostgres
import com.helio.testsupport.UserSeeding
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1505 item 4: `ConnectorRepository.delete` removes the Connector row and its credential row in ONE transaction
 *  (a credential-delete failure leaves both rows intact) and the delete is owner-scoped in the statement itself.
 *
 *  Dev and CI run as a BYPASSRLS superuser (MISTAKES.md), so Row Level Security never applies here: the application
 *  filters are what these cases exercise. */
class ConnectorRepositoryDeleteAtomicitySpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var ctx: DbContext                     = _
  private var credentialRepo: ConnectorCredentialRepository = _
  private var repo: ConnectorRepository          = _

  private val ownerA = UserId(UUID.randomUUID().toString)
  private val ownerB = UserId(UUID.randomUUID().toString)
  private val userA  = AuthenticatedUser(ownerA)
  private val userB  = AuthenticatedUser(ownerB)

  override def beforeAll(): Unit = {
    embeddedPostgres = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    UserSeeding.seedUsers(db, ownerA, ownerB)
    ctx            = new DbContext(db, db)
    credentialRepo = new ConnectorCredentialRepository(ctx, new EncryptedSecretBackend(new EnvMasterKeyProvider()))
    repo           = new ConnectorRepository(ctx, credentialRepo)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 15.seconds)

  private def create(owner: UserId, name: String): Connector =
    await(repo.create(owner, name, DataSourceKind.RestApi, "http://example.invalid", "{}", "test-secret-value", s"$name credential"))

  private def connectorRows(c: Connector): Int = {
    val id = c.id.value
    await(db.run(sql"SELECT count(*) FROM connectors WHERE id = $id::uuid".as[Int])).head
  }

  private def credentialRows(c: Connector): Int = {
    val id = c.credentialId.get.value
    await(db.run(sql"SELECT count(*) FROM connector_credentials WHERE id = $id::uuid".as[Int])).head
  }

  private def failingCredentialRepo: ConnectorCredentialRepository =
    new ConnectorCredentialRepository(ctx, new EncryptedSecretBackend(new EnvMasterKeyProvider())) {
      override def deleteAction(id: ConnectorCredentialId): DBIO[Int] =
        DBIO.failed(new RuntimeException("simulated credential delete failure"))
    }

  "ConnectorRepository.delete" should {

    "remove the connector row and its credential row" in {
      val connector = create(ownerA, "atomic happy")
      await(repo.delete(connector.id, userA)) shouldBe Right(true)
      connectorRows(connector) shouldBe 0
      credentialRows(connector) shouldBe 0
    }

    "leave BOTH rows intact when the credential delete fails (one transaction)" in {
      val connector = create(ownerA, "atomic fault")
      val failing   = new ConnectorRepository(ctx, failingCredentialRepo)

      val failure = the[RuntimeException] thrownBy await(failing.delete(connector.id, userA))
      failure.getMessage should include("simulated credential delete failure")

      connectorRows(connector) shouldBe 1
      credentialRows(connector) shouldBe 1
      await(credentialRepo.decryptForUse(connector.credentialId.get, ownerA)) shouldBe Some("test-secret-value")
    }

    "refuse another user's delete and leave the owner's rows intact" in {
      val connector = create(ownerA, "cross tenant i")
      await(repo.delete(connector.id, userB)) shouldBe Right(false)
      connectorRows(connector) shouldBe 1
      credentialRows(connector) shouldBe 1
    }

    "refuse another user's delete even when the precheck is bypassed (the statements themselves are owner-scoped)" in {
      val connector = create(ownerA, "cross tenant ii")
      val bypassed = new ConnectorRepository(ctx, credentialRepo) {
        override def findByIdOwned(id: ConnectorId, user: AuthenticatedUser): Future[Option[Connector]] =
          super.findByIdOwned(id, userA)
      }
      await(bypassed.delete(connector.id, userB)) shouldBe Right(false)
      connectorRows(connector) shouldBe 1
      credentialRows(connector) shouldBe 1
    }
  }
}
