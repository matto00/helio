package com.helio.infrastructure.persistence.sources

import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.{ConnectorCredentialEncryptionFailed, ConnectorCredentialRepository}
import com.helio.services.auth.{EncryptedSecretBackend, EnvMasterKeyProvider}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.Behaviors
import org.apache.pekko.http.scaladsl.Http
import org.apache.pekko.http.scaladsl.model._
import org.apache.pekko.http.scaladsl.server.Directives._
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import java.net.http.{HttpClient, HttpRequest, HttpResponse}
import java.net.URI
import java.security.SecureRandom
import java.util.{Base64, UUID}
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** `ConnectorRepository` (HEL-821): DB-direct ciphertext-at-rest proof (AC2),
 *  read-path enumeration (AC3), a genuine outbound-auth proof against a real
 *  in-process stub server (AC5, design.md Decision 6a -- never a stubbed
 *  decryptor, never a third-party endpoint), RLS cross-user proof under a
 *  real non-bypassing role (ACL requirement), and the delete-with-dependents
 *  409 seam (AC6). Uses the same two-role (`helio_app_test` non-BYPASSRLS +
 *  `helio_privileged` BYPASSRLS) topology as `ConnectorCredentialRepositorySpec`
 *  so RLS assertions are genuine. */
class ConnectorRepositorySpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global
  private implicit val typedSystem: ActorSystem[Nothing] =
    ActorSystem(Behaviors.empty, "connector-repo-spec")

  private var embeddedPostgres: EmbeddedPostgres = _
  private var privilegedDb: JdbcBackend.Database = _
  private var appDb: JdbcBackend.Database        = _
  private var ctx: DbContext                     = _
  private var credentialRepo: ConnectorCredentialRepository = _
  private var repo: ConnectorRepository          = _

  private val currentKeyId  = "connector-repo-spec-key"
  private val currentKeyB64 = randomKeyB64()

  private def randomKeyB64(): String = {
    val bytes = new Array[Byte](32)
    new SecureRandom().nextBytes(bytes)
    Base64.getEncoder.encodeToString(bytes)
  }

  private def testEnv: Map[String, String] =
    Map("CONNECTOR_MASTER_KEY" -> currentKeyB64, "CONNECTOR_MASTER_KEY_ID" -> currentKeyId)

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()

    val superDs   = embeddedPostgres.getPostgresDatabase
    val superJdbc = embeddedPostgres.getJdbcUrl("postgres", "postgres")
    Flyway.configure().dataSource(superJdbc, "postgres", "postgres").locations("classpath:db/migration").load().migrate()

    import com.zaxxer.hikari.{HikariConfig, HikariDataSource}

    val superConn = superDs.getConnection
    try {
      val stmt = superConn.createStatement()
      stmt.execute(
        """DO $$ BEGIN
          |  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'helio_app_test') THEN
          |    CREATE ROLE helio_app_test NOSUPERUSER NOCREATEDB NOCREATEROLE NOLOGIN;
          |  END IF;
          |END $$""".stripMargin
      )
      stmt.execute("GRANT helio_app_test TO postgres")
      stmt.execute("GRANT USAGE ON SCHEMA public TO helio_app_test")
      stmt.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO helio_app_test")
      stmt.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO helio_app_test")
      stmt.execute("GRANT USAGE ON SCHEMA public TO helio_privileged")
      stmt.execute("GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public TO helio_privileged")
      stmt.close()
    } finally {
      superConn.close()
    }

    val privCfg = new HikariConfig()
    privCfg.setDataSource(superDs)
    privCfg.setMaximumPoolSize(5)
    privCfg.setConnectionInitSql("SET ROLE helio_privileged")
    privilegedDb = JdbcBackend.Database.forDataSource(new HikariDataSource(privCfg), Some(5))

    val appCfg = new HikariConfig()
    appCfg.setDataSource(superDs)
    appCfg.setMaximumPoolSize(5)
    appCfg.setConnectionInitSql("SET ROLE helio_app_test")
    appDb = JdbcBackend.Database.forDataSource(new HikariDataSource(appCfg), Some(5))

    ctx = new DbContext(appDb, privilegedDb)
    val backend = new EncryptedSecretBackend(new EnvMasterKeyProvider(testEnv))
    credentialRepo = new ConnectorCredentialRepository(ctx, backend)
    repo = new ConnectorRepository(ctx, credentialRepo)
  }

  override def afterAll(): Unit = {
    appDb.close()
    privilegedDb.close()
    embeddedPostgres.close()
    typedSystem.terminate()
    super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def freshUser(): UserId = {
    val id = UUID.randomUUID().toString
    await(ctx.withSystemContext(
      sqlu"""INSERT INTO users (id, email, created_at)
             VALUES ($id::uuid, ${s"$id@test.local"}, now())
             ON CONFLICT DO NOTHING"""
    ))
    UserId(id)
  }


  "create" should {
    "persist ciphertext at the storage layer that neither equals nor contains the plaintext (task 4.1)" in {
      val owner     = freshUser()
      val plaintext = "sk_live_connector_secret_abcdef1234567890"

      val connector = await(
        repo.create(owner, "Stripe", DataSourceKind.RestApi, "https://api.stripe.com", "{}", plaintext, "Stripe credential")
      )

      val rawCiphertextText = await(ctx.withSystemContext(
        sql"""SELECT encode(cc.ciphertext, 'escape')
              FROM connector_credentials cc
              JOIN connectors c ON c.credential_id = cc.id
              WHERE c.id = ${connector.id.value}::uuid"""
          .as[String]
          .head
      ))

      rawCiphertextText should not be plaintext
      rawCiphertextText should not include plaintext

      // Not a trivial base64 re-encoding of the plaintext either.
      val trivialBase64 = Base64.getEncoder.encodeToString(plaintext.getBytes("UTF-8"))
      rawCiphertextText should not include trivialBase64
    }

    "the connectors row itself carries no ciphertext or plaintext column" in {
      val owner = freshUser()
      val connector = await(
        repo.create(owner, "Vendor", DataSourceKind.RestApi, "https://api.vendor.example", "{}", "secret-value", "Vendor credential")
      )

      // Structural proof: Connector has exactly these fields, none capable of
      // carrying ciphertext/plaintext (design.md Decision 1/2).
      connector.productElementNames.toSet shouldBe
        Set("id", "ownerId", "name", "kind", "baseUrl", "config", "credentialId", "createdAt", "updatedAt")
    }
  }

  // ── 4.2: read-path enumeration proof (AC3) ──────────────────────────────
  //
  // Forward pass: `findByIdOwned`/`findAll`/`update` all return the `Connector`
  // domain type above, structurally incapable of carrying a secret (proven
  // above). `delete` returns `Either[ConnectorHasDependents.type, Boolean]` --
  // also no secret-carrying field.
  //
  // Backward pass: this repository calls `credentialRepo.create`/`.delete`
  // only -- grep confirms no call site here reaches
  // `decryptForUse`/`EncryptedSecretBackend.decrypt`/`unwrapDataKey` (those
  // three are called from exactly nowhere in this file; the ONLY caller of
  // `decryptForUse` anywhere in this ticket's new code is the AC5 test below).
  "get/list" should {
    "return the same secret-free Connector shape from findByIdOwned and findAll (task 4.2 forward pass)" in {
      val owner = freshUser()
      val created = await(
        repo.create(owner, "Enumerated", DataSourceKind.RestApi, "https://api.example.com", "{}", "enum-secret", "Enum credential")
      )

      val fetched = await(repo.findByIdOwned(created.id, AuthenticatedUser(owner)))
      fetched shouldBe defined
      fetched.get.productElementNames.toSet shouldBe created.productElementNames.toSet

      val listed = await(repo.findAll(AuthenticatedUser(owner)))
      listed.map(_.id) should contain(created.id)
    }
  }


  "RLS on connectors" should {
    "denies cross-user reads under a real non-bypassing session (task 4.5)" in {
      val ownerA = freshUser()
      val ownerB = freshUser()

      val connA = await(repo.create(ownerA, "A's connector", DataSourceKind.RestApi, "https://a.example.com", "{}", "secret-a", "A cred"))
      await(repo.create(ownerB, "B's connector", DataSourceKind.RestApi, "https://b.example.com", "{}", "secret-b", "B cred"))

      // Direct query as ownerB's session context for a row owned by ownerA — must return zero rows,
      // proving RLS (not merely the repository's own WHERE clause) is what blocks the read.
      val rows = await(ctx.withUserContext(ownerB.value)(
        sql"SELECT id FROM connectors WHERE id = ${connA.id.value}::uuid".as[String]
      ))
      rows shouldBe empty

      await(repo.findByIdOwned(connA.id, AuthenticatedUser(ownerB))) shouldBe None
      await(repo.findByIdOwned(connA.id, AuthenticatedUser(ownerA))) shouldBe defined

      await(repo.findAll(AuthenticatedUser(ownerB))).map(_.id) should not contain connA.id
    }

    "denies cross-user delete" in {
      val ownerA = freshUser()
      val ownerB = freshUser()
      val connA  = await(repo.create(ownerA, "A's connector", DataSourceKind.RestApi, "https://a.example.com", "{}", "secret-a", "A cred"))

      await(repo.delete(connA.id, AuthenticatedUser(ownerB))) shouldBe Right(false)
      await(repo.findByIdOwned(connA.id, AuthenticatedUser(ownerA))) shouldBe defined
    }
  }


  "delete" should {
    "blocks with ConnectorHasDependents when the dependentCount collaborator returns nonzero (task 4.6)" in {
      val owner     = freshUser()
      val connector = await(repo.create(owner, "Has dependents", DataSourceKind.RestApi, "https://dep.example.com", "{}", "secret", "cred"))

      val result = await(repo.delete(connector.id, AuthenticatedUser(owner), dependentCount = _ => Future.successful(3)))
      result shouldBe Left(ConnectorHasDependents)

      await(repo.findByIdOwned(connector.id, AuthenticatedUser(owner))) shouldBe defined
    }

    "deletes the Connector and its credential when there are no dependents" in {
      val owner     = freshUser()
      val connector = await(repo.create(owner, "No dependents", DataSourceKind.RestApi, "https://nodep.example.com", "{}", "secret", "cred"))

      val result = await(repo.delete(connector.id, AuthenticatedUser(owner)))
      result shouldBe Right(true)

      await(repo.findByIdOwned(connector.id, AuthenticatedUser(owner))) shouldBe None
      await(credentialRepo.get(connector.credentialId, owner)) shouldBe None
    }
  }


  "the stored credential" should {
    "authenticates a real outbound HTTP request against a local stub server (task 4.4 / AC5)" in {
      val owner         = freshUser()
      val realCredential = "Bearer conn-outbound-proof-8f2c9a"

      val connector = await(
        repo.create(owner, "Outbound-provable", DataSourceKind.RestApi, "https://outbound.example.com", "{}", realCredential, "Outbound credential")
      )

      // In-process local stub HTTP server (Pekko HTTP Route, ephemeral port) —
      // never a third-party network dependency. Asserts the incoming
      // Authorization header equals the exact plaintext credential value.
      val stubRoute =
        path("secure") {
          get {
            optionalHeaderValueByName("Authorization") {
              case Some(value) if value == realCredential => complete(StatusCodes.OK -> "authenticated")
              case _                                       => complete(StatusCodes.Unauthorized -> "denied")
            }
          }
        }
      val binding = Await.result(Http(typedSystem).newServerAt("localhost", 0).bind(stubRoute), 10.seconds)
      val port    = binding.localAddress.getPort

      try {
        // Test-only caller of decryptForUse (design.md Decision 6a) — never
        // reached from any route.
        val decrypted = await(credentialRepo.decryptForUse(connector.credentialId, owner))
        decrypted shouldBe Some(realCredential)

        val httpClient = HttpClient.newHttpClient()
        val request = HttpRequest.newBuilder()
          .uri(URI.create(s"http://localhost:$port/secure"))
          .header("Authorization", decrypted.get)
          .GET()
          .build()
        val response = httpClient.send(request, HttpResponse.BodyHandlers.ofString())

        response.statusCode() shouldBe 200
        response.body() shouldBe "authenticated"
      } finally {
        Await.ready(binding.unbind(), 10.seconds)
      }
    }

    "a wrong credential value is rejected by the same stub server (negative control)" in {
      val owner = freshUser()
      await(
        repo.create(owner, "Negative control", DataSourceKind.RestApi, "https://outbound2.example.com", "{}", "Bearer correct-value", "cred")
      )

      val stubRoute =
        path("secure") {
          get {
            optionalHeaderValueByName("Authorization") {
              case Some(value) if value == "Bearer correct-value" => complete(StatusCodes.OK -> "authenticated")
              case _                                                => complete(StatusCodes.Unauthorized -> "denied")
            }
          }
        }
      val binding = Await.result(Http(typedSystem).newServerAt("localhost", 0).bind(stubRoute), 10.seconds)
      val port    = binding.localAddress.getPort

      try {
        val httpClient = HttpClient.newHttpClient()
        val request = HttpRequest.newBuilder()
          .uri(URI.create(s"http://localhost:$port/secure"))
          .header("Authorization", "Bearer wrong-value")
          .GET()
          .build()
        val response = httpClient.send(request, HttpResponse.BodyHandlers.ofString())

        response.statusCode() shouldBe 401
      } finally {
        Await.ready(binding.unbind(), 10.seconds)
      }
    }
  }

  // ── HEL-822 tasks 3.3/3.4: dependentCount seam's REAL implementation, end to end ──────────
  // (HEL-821 shipped `dependentCount` stubbed to always-zero; the 409-blocking branch was
  // permanently unreachable in production until this ticket wires the real query.)

  "DataSourceRepository.countRestSourcesReferencing + ConnectorRepository.delete" should {

    "blocks delete with ConnectorHasDependents when a real rest_api source references the Connector" in {
      val dsRepo    = new DataSourceRepository(ctx)
      val owner     = freshUser()
      val user      = AuthenticatedUser(owner)
      val connector = await(repo.create(
        ownerId = owner, name = "dep-conn", kind = "rest_api", baseUrl = "https://dep.test",
        config = """{"authType":"none"}""", credentialPlaintext = "", credentialName = "dep cred"
      ))
      val source = RestSource(
        id        = DataSourceId(UUID.randomUUID().toString),
        name      = "dependent-source",
        ownerId   = owner,
        createdAt = java.time.Instant.now(),
        updatedAt = java.time.Instant.now(),
        config    = RestApiConfig(connectorId = connector.id.value, endpoint = "/data")
      )
      await(dsRepo.insert(source, user))

      val dependentCount = (id: ConnectorId) => dsRepo.countRestSourcesReferencing(id)
      await(dsRepo.countRestSourcesReferencing(connector.id)) shouldBe 1

      val result = await(repo.delete(connector.id, user, dependentCount))
      result shouldBe Left(ConnectorHasDependents)
      await(repo.findByIdOwned(connector.id, user)) shouldBe defined
    }

    "allows delete once the dependent source is removed" in {
      val dsRepo    = new DataSourceRepository(ctx)
      val owner     = freshUser()
      val user      = AuthenticatedUser(owner)
      val connector = await(repo.create(
        ownerId = owner, name = "dep-conn-2", kind = "rest_api", baseUrl = "https://dep2.test",
        config = """{"authType":"none"}""", credentialPlaintext = "", credentialName = "dep cred 2"
      ))
      val source = RestSource(
        id        = DataSourceId(UUID.randomUUID().toString),
        name      = "dependent-source-2",
        ownerId   = owner,
        createdAt = java.time.Instant.now(),
        updatedAt = java.time.Instant.now(),
        config    = RestApiConfig(connectorId = connector.id.value, endpoint = "/data")
      )
      await(dsRepo.insert(source, user))
      val dependentCount = (id: ConnectorId) => dsRepo.countRestSourcesReferencing(id)

      await(repo.delete(connector.id, user, dependentCount)) shouldBe Left(ConnectorHasDependents)
      await(dsRepo.delete(source.id, user)) shouldBe true
      await(repo.delete(connector.id, user, dependentCount)) shouldBe Right(true)
      await(repo.findByIdOwned(connector.id, user)) shouldBe None
    }

    "never counts a different Connector's dependents" in {
      val dsRepo     = new DataSourceRepository(ctx)
      val owner      = freshUser()
      val user       = AuthenticatedUser(owner)
      val connectorA = await(repo.create(ownerId = owner, name = "A", kind = "rest_api", baseUrl = "https://a.test", config = "{}", credentialPlaintext = "", credentialName = "A cred"))
      val connectorB = await(repo.create(ownerId = owner, name = "B", kind = "rest_api", baseUrl = "https://b.test", config = "{}", credentialPlaintext = "", credentialName = "B cred"))
      await(dsRepo.insert(
        RestSource(
          DataSourceId(UUID.randomUUID().toString), "src-a", owner, java.time.Instant.now(), java.time.Instant.now(),
          RestApiConfig(connectorId = connectorA.id.value)
        ),
        user
      ))
      await(dsRepo.countRestSourcesReferencing(connectorB.id)) shouldBe 0
    }
  }


  "rotateCredential" should {
    "replaces the plaintext resolvable via decryptForUse and makes the old credential id unresolvable" in {
      val owner     = freshUser()
      val connector = await(
        repo.create(owner, "Rotatable", DataSourceKind.RestApi, "https://rotate.example.com", "{}", "old-plaintext-value", "cred")
      )
      val oldCredentialId = connector.credentialId

      val user     = AuthenticatedUser(owner)
      val rotated  = await(repo.rotateCredential(connector.id, "new-plaintext-value", "rotated cred", user))
      rotated.isRight shouldBe true
      val updatedConnector = rotated.toOption.get

      updatedConnector.credentialId should not be oldCredentialId

      await(credentialRepo.decryptForUse(updatedConnector.credentialId, owner)) shouldBe Some("new-plaintext-value")
      await(credentialRepo.get(oldCredentialId, owner)) shouldBe None

      // The connectors row itself now points at the new credential id.
      val fetched = await(repo.findByIdOwned(connector.id, user))
      fetched shouldBe defined
      fetched.get.credentialId shouldBe updatedConnector.credentialId
    }

    "returns not-found for another user's Connector, performing no write" in {
      val ownerA = freshUser()
      val ownerB = freshUser()
      val connA  = await(repo.create(ownerA, "A's rotate target", DataSourceKind.RestApi, "https://a-rotate.example.com", "{}", "secret-a", "A cred"))

      val result = await(repo.rotateCredential(connA.id, "attempted-new-value", "cred", AuthenticatedUser(ownerB)))
      result shouldBe Left(ConnectorRotationNotFound)

      // Original credential still resolves under the true owner -- no partial write occurred.
      val stillOwned = await(repo.findByIdOwned(connA.id, AuthenticatedUser(ownerA)))
      stillOwned shouldBe defined
      stillOwned.get.credentialId shouldBe connA.credentialId
    }

    "fails closed with no partial write when no master key is configured" in {
      val backendNoKey = new EncryptedSecretBackend(new EnvMasterKeyProvider(Map.empty))
      val credentialRepoNoKey = new ConnectorCredentialRepository(ctx, backendNoKey)
      val repoNoKey = new ConnectorRepository(ctx, credentialRepoNoKey)

      val owner     = freshUser()
      val connector = await(
        repo.create(owner, "No-key rotate target", DataSourceKind.RestApi, "https://no-key.example.com", "{}", "original-secret", "cred")
      )
      val user = AuthenticatedUser(owner)

      a[ConnectorCredentialEncryptionFailed] should be thrownBy
        await(repoNoKey.rotateCredential(connector.id, "attempted-new-value", "cred", user))

      // No partial write: the connectors row still points at the original credential id, and
      // the original credential is still resolvable via the properly-keyed repo.
      val fetched = await(repo.findByIdOwned(connector.id, user))
      fetched shouldBe defined
      fetched.get.credentialId shouldBe connector.credentialId
      await(credentialRepo.decryptForUse(connector.credentialId, owner)) shouldBe Some("original-secret")
    }

    // HEL-824 task 2.6: proves a dependent source picks up rotation transparently -- the
    // pipeline-execution outbound-auth resolution path (findByIdInternal -> decryptForUse)
    // returns the NEW plaintext after rotation, with no re-pointing of the source itself.
    "a dependent rest_api source resolves the NEW plaintext via findByIdInternal + decryptForUse after rotation" in {
      val dsRepo    = new DataSourceRepository(ctx)
      val owner     = freshUser()
      val user      = AuthenticatedUser(owner)
      val connector = await(repo.create(
        ownerId = owner, name = "dep-rotate-conn", kind = "rest_api", baseUrl = "https://dep-rotate.test",
        config = "{}", credentialPlaintext = "before-rotation-secret", credentialName = "dep rotate cred"
      ))
      val source = RestSource(
        id        = DataSourceId(UUID.randomUUID().toString),
        name      = "dependent-source-rotation",
        ownerId   = owner,
        createdAt = java.time.Instant.now(),
        updatedAt = java.time.Instant.now(),
        config    = RestApiConfig(connectorId = connector.id.value, endpoint = "/data")
      )
      await(dsRepo.insert(source, user))

      await(repo.rotateCredential(connector.id, "after-rotation-secret", "rotated dep cred", user))

      // The pipeline-execution path never re-resolves the source -- it goes straight through
      // the Connector via findByIdInternal, unscoped by design (see that method's own doc).
      val resolvedConnector = await(repo.findByIdInternal(connector.id))
      resolvedConnector shouldBe defined

      val decrypted = await(credentialRepo.decryptForUse(resolvedConnector.get.credentialId, owner))
      decrypted shouldBe Some("after-rotation-secret")
    }
  }
}
