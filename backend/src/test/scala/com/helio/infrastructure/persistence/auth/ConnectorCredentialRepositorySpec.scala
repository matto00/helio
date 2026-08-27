package com.helio.infrastructure.persistence.auth

import com.helio.domain.model.UserId
import com.helio.infrastructure.persistence.DbContext
import com.helio.services.auth.{EncryptedSecretBackend, EnvMasterKeyProvider}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import java.security.SecureRandom
import java.util.{Base64, UUID}
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** `ConnectorCredentialRepository` (HEL-536): ciphertext-at-rest, fail-closed on missing master
 *  key, RLS owner scoping proven under a real non-bypassing role, and the metadata-only return
 *  shape. Uses the same two-role (`helio_app_test` non-BYPASSRLS + `helio_privileged` BYPASSRLS)
 *  topology as `RlsOwnerTablesSpec`/`AuditEventRepositorySpec` so RLS assertions are genuine — a
 *  single superuser connection is always RLS-exempt, which would make them vacuous. */
class ConnectorCredentialRepositorySpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var privilegedDb: JdbcBackend.Database = _
  private var appDb: JdbcBackend.Database = _
  private var ctx: DbContext = _
  private var repo: ConnectorCredentialRepository = _

  private val currentKeyId = "env-test-current"
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
    Flyway
      .configure()
      .dataSource(superJdbc, "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()

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
    repo = new ConnectorCredentialRepository(ctx, backend)
  }

  override def afterAll(): Unit = {
    appDb.close()
    privilegedDb.close()
    embeddedPostgres.close()
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

  // ── 4.2: DB-level ciphertext assertion ──────────────────────────────────

  "create" should {

    "persist ciphertext at the storage layer that neither equals nor contains the plaintext (task 4.2)" in {
      val owner     = freshUser()
      val plaintext = "sk_live_super_secret_value_1234567890"

      val meta = await(repo.create(owner, "Stripe API key", plaintext))

      // Query the table directly, bypassing the repository entirely, on the privileged pool.
      // encode(..., 'escape') round-trips arbitrary bytes as text without a custom GetResult,
      // while still exposing any accidentally-embedded plaintext bytes as a readable substring.
      val rawCiphertextText = await(ctx.withSystemContext(
        sql"SELECT encode(ciphertext, 'escape') FROM connector_credentials WHERE id = ${meta.id.value}::uuid"
          .as[String]
          .head
      ))

      rawCiphertextText should not be plaintext
      rawCiphertextText should not include plaintext
    }

    "round-trips through decryptForUse with the correct master key configured" in {
      val owner     = freshUser()
      val plaintext = "another-secret-value"

      val meta = await(repo.create(owner, "DB password", plaintext))
      val decrypted = await(repo.decryptForUse(meta.id, owner))

      decrypted shouldBe Some(plaintext)
    }

    "fails closed and persists zero rows when no master key is configured (task 3.2 / repository level)" in {
      val owner       = freshUser()
      val noKeyBackend = new EncryptedSecretBackend(new EnvMasterKeyProvider(env = Map.empty))
      val noKeyRepo    = new ConnectorCredentialRepository(ctx, noKeyBackend)

      val before = await(ctx.withSystemContext(
        sql"SELECT COUNT(*) FROM connector_credentials WHERE user_id = ${owner.value}::uuid".as[Int].head
      ))

      an[ConnectorCredentialEncryptionFailed] should be thrownBy
        await(noKeyRepo.create(owner, "Unconfigured key attempt", "should-never-be-stored"))

      val after = await(ctx.withSystemContext(
        sql"SELECT COUNT(*) FROM connector_credentials WHERE user_id = ${owner.value}::uuid".as[Int].head
      ))

      after shouldBe before
    }
  }

  // ── 4.3: RLS proof under a non-bypassing role ───────────────────────────

  "RLS on connector_credentials" should {

    "denies cross-user reads under a real non-bypassing session (task 4.3)" in {
      val ownerA = freshUser()
      val ownerB = freshUser()

      val metaA = await(repo.create(ownerA, "ownerA's credential", "secret-a"))
      await(repo.create(ownerB, "ownerB's credential", "secret-b"))

      // Query as ownerB's session context for a row that belongs to ownerA — must return zero rows.
      val rows = await(ctx.withUserContext(ownerB.value)(
        sql"SELECT id FROM connector_credentials WHERE id = ${metaA.id.value}::uuid".as[String]
      ))

      rows shouldBe empty
    }

    "repository.get returns None for another user's credential id" in {
      val ownerA = freshUser()
      val ownerB = freshUser()

      val metaA = await(repo.create(ownerA, "ownerA's credential", "secret-a"))

      await(repo.get(metaA.id, ownerB)) shouldBe None
      await(repo.get(metaA.id, ownerA)) shouldBe defined
    }
  }

  // ── 4.4: metadata-only return shape ─────────────────────────────────────

  "get/list" should {

    "return metadata containing no plaintext/value field (task 4.4)" in {
      val owner = freshUser()
      val meta  = await(repo.create(owner, "labelled credential", "some-secret-value"))

      // ConnectorCredentialMeta has exactly id/userId/name/keyId/createdAt/updatedAt — structurally
      // no field capable of carrying a decrypted or ciphertext value.
      val fieldNames = meta.productElementNames.toSet
      fieldNames shouldBe Set("id", "userId", "name", "keyId", "createdAt", "updatedAt")

      meta.name shouldBe "labelled credential"
      meta.keyId shouldBe currentKeyId
    }
  }

  // ── delete ───────────────────────────────────────────────────────────────

  "delete" should {
    "removes the caller's own credential and returns true" in {
      val owner = freshUser()
      val meta  = await(repo.create(owner, "to delete", "value"))

      await(repo.delete(meta.id, owner)) shouldBe true
      await(repo.get(meta.id, owner)) shouldBe None
    }

    "returns false for another user's credential id (RLS-scoped no-op)" in {
      val ownerA = freshUser()
      val ownerB = freshUser()
      val metaA  = await(repo.create(ownerA, "ownerA's", "value"))

      await(repo.delete(metaA.id, ownerB)) shouldBe false
      await(repo.get(metaA.id, ownerA)) shouldBe defined
    }
  }

  // ── 5.2: rotation re-wrap job ────────────────────────────────────────────

  "rewrapAllBelow" should {

    "re-wraps a row seeded under an old key_id/key pair to the new current key, preserving the decrypted value" in {
      val oldKeyId  = "env-old-fake"
      val oldKeyB64 = randomKeyB64()
      val newKeyId  = "env-new-fake"
      val newKeyB64 = randomKeyB64()

      // rewrapAllBelow operates on every row in the table (it's an operator-run, cross-user
      // maintenance job) — truncate first so it only sees the row this test seeds, not leftover
      // rows from earlier tests in this spec under other key_ids.
      // HEL-821: `connectors.credential_id` now FK-references this table (`ON
      // DELETE RESTRICT`), so a bare TRUNCATE here fails once any test in this
      // run has created a `connectors` row referencing a `connector_credentials`
      // row -- CASCADE removes that dependent row too, which is fine: this test
      // only cares about `connector_credentials` rows it seeds itself below.
      await(ctx.withSystemContext(sqlu"TRUNCATE TABLE connector_credentials CASCADE"))

      val owner = freshUser()

      // Seed a row under the "old" key.
      val oldBackend = new EncryptedSecretBackend(
        new EnvMasterKeyProvider(Map("CONNECTOR_MASTER_KEY" -> oldKeyB64, "CONNECTOR_MASTER_KEY_ID" -> oldKeyId))
      )
      val oldRepo = new ConnectorCredentialRepository(ctx, oldBackend)
      val meta    = await(oldRepo.create(owner, "rotation candidate", "rotate-me-secret"))

      await(ctx.withSystemContext(
        sql"SELECT key_id FROM connector_credentials WHERE id = ${meta.id.value}::uuid".as[String].head
      )) shouldBe oldKeyId

      // Rotation window: current = new key, previous = old key.
      val rotationProvider = new EnvMasterKeyProvider(
        Map(
          "CONNECTOR_MASTER_KEY"              -> newKeyB64,
          "CONNECTOR_MASTER_KEY_ID"           -> newKeyId,
          "CONNECTOR_MASTER_KEY_PREVIOUS"     -> oldKeyB64,
          "CONNECTOR_MASTER_KEY_PREVIOUS_ID"  -> oldKeyId
        )
      )
      val rotationBackend = new EncryptedSecretBackend(rotationProvider)
      val rotationRepo    = new ConnectorCredentialRepository(ctx, rotationBackend)

      val rewrappedCount = await(rotationRepo.rewrapAllBelow(newKeyId, rotationProvider))
      rewrappedCount should be >= 1

      val newKeyIdInDb = await(ctx.withSystemContext(
        sql"SELECT key_id FROM connector_credentials WHERE id = ${meta.id.value}::uuid".as[String].head
      ))
      newKeyIdInDb shouldBe newKeyId

      // Value still decrypts correctly post-rewrap, using ONLY the new key (no _PREVIOUS needed).
      val postRotationProvider = new EnvMasterKeyProvider(
        Map("CONNECTOR_MASTER_KEY" -> newKeyB64, "CONNECTOR_MASTER_KEY_ID" -> newKeyId)
      )
      val postRotationRepo = new ConnectorCredentialRepository(ctx, new EncryptedSecretBackend(postRotationProvider))
      await(postRotationRepo.decryptForUse(meta.id, owner)) shouldBe Some("rotate-me-secret")
    }
  }
}
