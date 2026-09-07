package com.helio.domain.connectors

import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ConnectorCredentialRepository
import com.helio.infrastructure.persistence.sources.ConnectorRepository
import com.helio.services.auth.{EncryptedSecretBackend, EnvMasterKeyProvider}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.server.Directives._
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.apache.pekko.stream.{Materializer, SystemMaterializer}
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import java.security.SecureRandom
import java.util.{Base64, UUID}
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, Future}

/** HEL-955 design.md D4: the authoritative fetch-time guard against a pending Connector --
 *  `RestApiConnectorDriver.resolveConnector` must reject it on BOTH the `Owned` and `Internal`
 *  branches, before URI composition and before any `decryptForUse` call. Mirrors
 *  `RestApiConnectorDriverKindGuardSpec`'s evidence shape exactly: a *recording* credential
 *  repository so "no decryption occurred" can actually fail (a repo-less fixture never decrypts
 *  and would pass vacuously -- the HEL-845 lesson, called out again for this ticket). */
class RestApiConnectorDriverPendingGuardSpec extends AnyWordSpec with Matchers with ScalatestRouteTest with BeforeAndAfterAll {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  private implicit val mat: Materializer                 = SystemMaterializer(typedSystem).materializer

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var ctx: DbContext                     = _
  private var connectorRepo: ConnectorRepository = _
  private var encryptedBackend: EncryptedSecretBackend = _

  private class RecordingCredentialRepository(delegate: ConnectorCredentialRepository) extends ConnectorCredentialRepository(ctx, encryptedBackend) {
    @volatile var decryptCallCount: Int = 0
    override def decryptForUse(id: ConnectorCredentialId, userId: UserId): Future[Option[String]] = {
      decryptCallCount += 1
      delegate.decryptForUse(id, userId)
    }
  }

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
    encryptedBackend = new EncryptedSecretBackend(new EnvMasterKeyProvider(
      Map("CONNECTOR_MASTER_KEY" -> randomKeyB64(), "CONNECTOR_MASTER_KEY_ID" -> "pending-guard-spec-key")
    ))
    val credRepo = new ConnectorCredentialRepository(ctx, encryptedBackend)
    connectorRepo = new ConnectorRepository(ctx, credRepo)
  }

  override def afterAll(): Unit = {
    db.close()
    embeddedPostgres.close()
    super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def freshUser(): UserId = {
    val id = UUID.randomUUID().toString
    await(ctx.withSystemContext(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($id::uuid, ${s"$id@pending-guard-spec.test"}, now())"""
    ))
    UserId(id)
  }

  private def recordingCredRepo(): RecordingCredentialRepository =
    new RecordingCredentialRepository(new ConnectorCredentialRepository(ctx, encryptedBackend))

  "RestApiConnectorDriver.resolveConnector pending guard (design.md D4)" should {

    "reject a pending Connector on the Owned branch, decrypting nothing" in {
      val owner = freshUser()
      val user  = AuthenticatedUser(owner)
      val pending = await(connectorRepo.createPending(
        ownerId = owner, name = "pending-owned", kind = "rest_api", baseUrl = "http://example.invalid",
        config = """{"authType":"bearer"}"""
      ))
      val credRepo = recordingCredRepo()
      val driver   = new RestApiConnectorDriver(connectorRepoOpt = Some(connectorRepo), credentialRepoOpt = Some(credRepo))
      val config   = RestApiConfig(connectorId = pending.id.value, endpoint = "/data")

      val result = await(driver.fetch(config, ConnectorResolveContext.Owned(user)))
      result match {
        case Left(err) =>
          err should include("pending")
          err should not include pending.id.value
          err should not include "example.invalid"
        case Right(_) => fail("expected the pending Connector to be rejected")
      }
      credRepo.decryptCallCount shouldBe 0
    }

    "reject a pending Connector on the Internal branch too, decrypting nothing" in {
      val owner = freshUser()
      val pending = await(connectorRepo.createPending(
        ownerId = owner, name = "pending-internal", kind = "rest_api", baseUrl = "http://example.invalid",
        config = """{"authType":"bearer"}"""
      ))
      val credRepo = recordingCredRepo()
      val driver   = new RestApiConnectorDriver(connectorRepoOpt = Some(connectorRepo), credentialRepoOpt = Some(credRepo))
      val config   = RestApiConfig(connectorId = pending.id.value, endpoint = "/data")

      val result = await(driver.fetch(config, ConnectorResolveContext.Internal))
      // Evaluation-1.md CR3: `result.isLeft` alone is vacuous here -- `buildResolvedRequest`'s
      // defensive `case (_, None) => Left("Connector credential not found")` arm ALSO returns a
      // `Left` and never decrypts, regardless of whether the `resolveConnector` guard ran at
      // all. Asserting the MESSAGE (as the Owned case does) is what actually distinguishes "the
      // guard rejected it" from "the guard never ran, but happened to fail closed anyway" --
      // deleting the guard changes the message from "... is pending completion ..." to the bare
      // "Connector credential not found" fallback, which does NOT include "pending".
      result match {
        case Left(err) =>
          err should include("pending")
          err should not include pending.id.value
          err should not include "example.invalid"
        case Right(_) => fail("expected the pending Connector to be rejected")
      }
      credRepo.decryptCallCount shouldBe 0
    }

    "does not reject a complete (non-pending) Connector -- regression guard against a mutated always-reject guard" in {
      val owner = freshUser()
      val user  = AuthenticatedUser(owner)
      val complete = await(connectorRepo.create(
        ownerId = owner, name = "complete-not-pending", kind = "rest_api", baseUrl = "http://example.invalid",
        config = """{"authType":"none"}""", credentialPlaintext = "", credentialName = "not pending cred"
      ))
      val driver = new RestApiConnectorDriver(connectorRepoOpt = Some(connectorRepo), credentialRepoOpt = Some(new ConnectorCredentialRepository(ctx, encryptedBackend)))
      val config = RestApiConfig(connectorId = complete.id.value, endpoint = "/data")

      // A complete Connector against an unreachable host fails for a DIFFERENT (network) reason,
      // never the pending message -- proving the guard is scoped to pendingness, not everything.
      val result = await(driver.fetch(config, ConnectorResolveContext.Owned(user)))
      result match {
        case Left(err) => err should not include "pending"
        case Right(_)  => // also acceptable if the network call unexpectedly succeeds
      }
    }
  }
}
