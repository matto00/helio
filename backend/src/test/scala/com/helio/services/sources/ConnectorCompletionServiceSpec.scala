package com.helio.services.sources

import com.helio.domain.connectors.ConnectorAuthShape
import com.helio.domain.model._
import com.helio.infrastructure.crypto.TokenHashing
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.auth.ConnectorCredentialRepository
import com.helio.infrastructure.persistence.sources.{ConnectorCompletionTokenRepository, ConnectorRepository, ConnectorRotationPending}
import com.helio.services.ServiceError
import com.helio.services.auth.{EncryptedSecretBackend, EnvMasterKeyProvider}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import java.security.SecureRandom
import java.time.{Duration, Instant}
import java.util.{Base64, UUID}
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-955: `ConnectorCompletionService` -- D3's single-use atomic consumption, D9's atomic
 *  re-mint/supersede (including the supersede-vs-consume race, the ticket's highest-risk item),
 *  D4a's rotate/delete guards, and D10's owner-visible completion signal, kept separate from the
 *  anonymous endpoint's byte-identical refusal. Uses the same embedded-Postgres two-role-free
 *  (single privileged=app db, matching `ConnectorRepositorySpec`'s simpler variant) topology as
 *  the other Connector specs in this package. */
class ConnectorCompletionServiceSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var ctx: DbContext                     = _
  private var connectorRepo: ConnectorRepository = _
  private var tokenRepo: ConnectorCompletionTokenRepository = _
  private var service: ConnectorCompletionService = _

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
    val encryptedBackend = new EncryptedSecretBackend(new EnvMasterKeyProvider(
      Map("CONNECTOR_MASTER_KEY" -> randomKeyB64(), "CONNECTOR_MASTER_KEY_ID" -> "completion-service-spec-key")
    ))
    val credRepo = new ConnectorCredentialRepository(ctx, encryptedBackend)
    connectorRepo = new ConnectorRepository(ctx, credRepo)
    tokenRepo     = new ConnectorCompletionTokenRepository(ctx)
    service       = new ConnectorCompletionService(connectorRepo, tokenRepo, defaultExpiry = Duration.ofMinutes(60))
  }

  override def afterAll(): Unit = {
    db.close()
    embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def freshUser(label: String): AuthenticatedUser = {
    val id = UUID.randomUUID().toString
    await(ctx.withSystemContext(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($id::uuid, ${s"$id-$label@completion-service-spec.test"}, now())"""
    ))
    AuthenticatedUser(UserId(id))
  }

  "createOrRemintPending + complete (D3/D9 happy path)" should {
    "mint a pending Connector with a completion token, and complete it end to end" in {
      val user = freshUser("happy")
      val minted = await(service.createOrRemintPending(
        "My API", "rest_api", "https://api.example.test", ConnectorAuthShape(authType = "bearer"), user
      )).getOrElse(fail("expected Right"))

      val pendingBefore = await(connectorRepo.findByIdOwned(minted.connectorId, user)).get
      pendingBefore.isPending shouldBe true

      val result = await(service.complete(minted.rawToken, "the-real-secret", requestingUser = None))
      result shouldBe Right(())

      val completed = await(connectorRepo.findByIdOwned(minted.connectorId, user)).get
      completed.isPending shouldBe false
      // D10: owner-visible completion signal, anonymous completion -> "anonymous".
      completed.completedBy shouldBe Some("anonymous")
      completed.completedAt should not be empty
    }

    "record the authenticated principal as completedBy when the completing session is the owner" in {
      val user = freshUser("owner-complete")
      val minted = await(service.createOrRemintPending(
        "My API", "rest_api", "https://owner-complete.example.test", ConnectorAuthShape(authType = "bearer"), user
      )).getOrElse(fail("expected Right"))

      await(service.complete(minted.rawToken, "secret", requestingUser = Some(user))) shouldBe Right(())
      val completed = await(connectorRepo.findByIdOwned(minted.connectorId, user)).get
      completed.completedBy shouldBe Some(user.id.value)
    }
  }

  "describePending (evaluation-1.md CR4)" should {
    "return the pending Connector's actual intended auth shape for a valid token" in {
      val user = freshUser("describe")
      val minted = await(service.createOrRemintPending(
        "My API", "rest_api", "https://describe.example.test",
        ConnectorAuthShape(authType = "api_key", apiKeyName = Some("X-Api-Key"), apiKeyPlacement = Some("header")),
        user
      )).getOrElse(fail("expected Right"))

      val shape = await(service.describePending(minted.rawToken, requestingUser = None)).getOrElse(fail("expected Right"))
      shape.authType shouldBe "api_key"
      shape.apiKeyName shouldBe Some("X-Api-Key")
      shape.apiKeyPlacement shouldBe Some("header")
    }

    "refuse an invalid token with the same byte-identical refusal as complete" in {
      await(service.describePending("not-a-real-token", requestingUser = None)) shouldBe Left(ConnectorCompletionService.RefusalError)
    }

    "refuse a token whose Connector has already been completed" in {
      val user = freshUser("describe-completed")
      val minted = await(service.createOrRemintPending(
        "My API", "rest_api", "https://describe-completed.example.test", ConnectorAuthShape(authType = "bearer"), user
      )).getOrElse(fail("expected Right"))
      await(service.complete(minted.rawToken, "secret", requestingUser = None)) shouldBe Right(())

      await(service.describePending(minted.rawToken, requestingUser = None)) shouldBe Left(ConnectorCompletionService.RefusalError)
    }
  }

  "single-use consumption (D3)" should {
    "refuse a second submission of the same token after a successful completion" in {
      val user = freshUser("single-use")
      val minted = await(service.createOrRemintPending(
        "My API", "rest_api", "https://single-use.example.test", ConnectorAuthShape(authType = "bearer"), user
      )).getOrElse(fail("expected Right"))

      await(service.complete(minted.rawToken, "secret-1", requestingUser = None)) shouldBe Right(())
      val replay = await(service.complete(minted.rawToken, "secret-2", requestingUser = None))
      replay.isLeft shouldBe true
    }

    "not consume the token on a rejected (empty-credential) submission" in {
      val user = freshUser("empty-cred")
      val minted = await(service.createOrRemintPending(
        "My API", "rest_api", "https://empty-cred.example.test", ConnectorAuthShape(authType = "bearer"), user
      )).getOrElse(fail("expected Right"))

      await(service.complete(minted.rawToken, "", requestingUser = None)).isLeft shouldBe true
      // The token must still be usable -- a real submission afterwards succeeds.
      await(service.complete(minted.rawToken, "real-secret", requestingUser = None)) shouldBe Right(())
    }
  }

  "re-mint / supersede (D9)" should {
    "re-mint onto the SAME pending Connector for a matching owner+kind+baseUrl+auth-shape re-initiation" in {
      val user = freshUser("remint-match")
      val first = await(service.createOrRemintPending(
        "My API", "rest_api", "https://remint-match.example.test/", ConnectorAuthShape(authType = "bearer"), user
      )).getOrElse(fail("expected Right"))
      val second = await(service.createOrRemintPending(
        "My API", "rest_api", "https://remint-match.example.test", ConnectorAuthShape(authType = "bearer"), user
      )).getOrElse(fail("expected Right"))

      second.connectorId shouldBe first.connectorId
      first.rawToken should not be second.rawToken

      // The FIRST token must now be superseded -- caller-indistinguishable from expired/nonexistent.
      await(service.complete(first.rawToken, "attacker-secret", requestingUser = None)).isLeft shouldBe true
      // The SECOND (newest) token still works.
      await(service.complete(second.rawToken, "legit-secret", requestingUser = None)) shouldBe Right(())
    }

    "fork a SEPARATE pending Connector when the auth shape differs (never strand the human on the wrong form)" in {
      val user = freshUser("remint-fork")
      val bearer = await(service.createOrRemintPending(
        "My API", "rest_api", "https://remint-fork.example.test", ConnectorAuthShape(authType = "bearer"), user
      )).getOrElse(fail("expected Right"))
      val apiKey = await(service.createOrRemintPending(
        "My API", "rest_api", "https://remint-fork.example.test",
        ConnectorAuthShape(authType = "api_key", apiKeyName = Some("X-Api-Key"), apiKeyPlacement = Some("header")), user
      )).getOrElse(fail("expected Right"))

      apiKey.connectorId should not be bearer.connectorId
    }

    // Skeptic-final-1.md CR1: a superseded token also refuses at the SERVICE level -- kept as a
    // regression guard on the end-to-end path -- but this by itself proves nothing about the
    // write predicate: superseding BEFORE `complete()` runs means `resolveValidToken`'s in-memory
    // `token.isValid` check already rejects it, so the conditional `UPDATE` in
    // `ConnectorCompletionTokenRepository.consume` is never even reached. The mutation-verified
    // proof that the PREDICATE ITSELF (not the in-memory validator) closes the race is the
    // dedicated `ConnectorCompletionTokenRepository.consume` test below.
    "refuse a token superseded before the submission at the service level (end-to-end regression guard, not a predicate proof)" in {
      val user = freshUser("race")
      val minted = await(service.createOrRemintPending(
        "My API", "rest_api", "https://race.example.test", ConnectorAuthShape(authType = "bearer"), user
      )).getOrElse(fail("expected Right"))

      await(service.createOrRemintPending(
        "My API", "rest_api", "https://race.example.test", ConnectorAuthShape(authType = "bearer"), user
      ))

      val result = await(service.complete(minted.rawToken, "attacker-secret", requestingUser = None))
      result.isLeft shouldBe true
      val connector = await(connectorRepo.findByIdOwned(minted.connectorId, user)).get
      connector.isPending shouldBe true
    }

    // Skeptic-final-1.md CR1 (the actual fix): exercises
    // `ConnectorCompletionTokenRepository.consume`'s conditional UPDATE directly, bypassing
    // `resolveValidToken`'s in-memory check entirely -- this is the ONLY way to prove the write
    // PREDICATE itself closes the race, since any call through `ConnectorCompletionService`
    // re-validates in memory first and would never reach `consume` for an already-superseded
    // token read fresh. Mutation-verified: deleting
    // `&& r.supersededAt.isEmpty && r.expiresAt > now` from `consume`'s filter makes this go red
    // (see the executor's report for the live mutation run).
    "consume() itself refuses a token that was superseded AFTER being read as live -- the actual race the predicate closes" in {
      val user = freshUser("race-predicate")
      val minted = await(service.createOrRemintPending(
        "My API", "rest_api", "https://race-predicate.example.test", ConnectorAuthShape(authType = "bearer"), user
      )).getOrElse(fail("expected Right"))
      val hash = TokenHashing.sha256Hex(minted.rawToken)

      // "Read as live": the token is genuinely valid right now -- confirmed via the same
      // `findByHash` + `isValid` check `resolveValidToken` itself performs.
      val readAsLive = await(tokenRepo.findByHash(hash)).get
      readAsLive.isValid(Instant.now()) shouldBe true

      // NOW a concurrent re-mint supersedes it, entirely between "read as live" and "consume" --
      // the exact window D3/D9 exist to close.
      await(service.createOrRemintPending(
        "My API", "rest_api", "https://race-predicate.example.test", ConnectorAuthShape(authType = "bearer"), user
      ))

      // The predicate -- not any in-memory check -- must refuse this.
      await(tokenRepo.consume(hash)) shouldBe false
      val connector = await(connectorRepo.findByIdOwned(minted.connectorId, user)).get
      connector.isPending shouldBe true
    }

    // Skeptic-final-1.md CR1: the expiry half of the same predicate, exercised the same direct
    // way -- a token that expires AFTER being read as live must also refuse at `consume()`.
    "consume() itself refuses a token that expired AFTER being read as live" in {
      val user = freshUser("race-predicate-expiry")
      val shortLivedService = new ConnectorCompletionService(connectorRepo, tokenRepo, defaultExpiry = Duration.ofMillis(50))
      val minted = await(shortLivedService.createOrRemintPending(
        "My API", "rest_api", "https://race-predicate-expiry.example.test", ConnectorAuthShape(authType = "bearer"), user
      )).getOrElse(fail("expected Right"))
      val hash = TokenHashing.sha256Hex(minted.rawToken)

      val readAsLive = await(tokenRepo.findByHash(hash)).get
      readAsLive.isValid(Instant.now()) shouldBe true

      Thread.sleep(100) // past the 50ms expiry, AFTER the "read as live" check above.

      await(tokenRepo.consume(hash)) shouldBe false
      val connector = await(connectorRepo.findByIdOwned(minted.connectorId, user)).get
      connector.isPending shouldBe true
    }
  }

  "owner re-mint (D9/D10)" should {
    "refuse a non-owner and a nonexistent id with the standard not-found mapping" in {
      val owner    = freshUser("remint-owner")
      val nonOwner = freshUser("remint-nonowner")
      val minted = await(service.createOrRemintPending(
        "My API", "rest_api", "https://remint-owner.example.test", ConnectorAuthShape(authType = "bearer"), owner
      )).getOrElse(fail("expected Right"))

      await(service.ownerRemint(minted.connectorId, nonOwner)) shouldBe Left(ServiceError.NotFound("Connector not found"))
      await(service.ownerRemint(ConnectorId(UUID.randomUUID().toString), owner)) shouldBe Left(ServiceError.NotFound("Connector not found"))
    }

    "distinctly report 'already completed' to the owner (D10), never leaking into the anonymous endpoint's refusal" in {
      val owner = freshUser("remint-completed")
      val minted = await(service.createOrRemintPending(
        "My API", "rest_api", "https://remint-completed.example.test", ConnectorAuthShape(authType = "bearer"), owner
      )).getOrElse(fail("expected Right"))
      await(service.complete(minted.rawToken, "secret", requestingUser = None)) shouldBe Right(())

      val remintAttempt = await(service.ownerRemint(minted.connectorId, owner))
      remintAttempt shouldBe Left(ServiceError.Conflict("This Connector has already been completed"))

      // The anonymous endpoint's OWN refusal for the same (now-consumed) token stays the
      // ordinary byte-identical refusal, never the owner-facing "already completed" message.
      val anonymousReplay = await(service.complete(minted.rawToken, "another-secret", requestingUser = None))
      anonymousReplay shouldBe Left(ConnectorCompletionService.RefusalError)
    }
  }

  // Skeptic-final-1.md CR2 / ticket AC4 / task 4.7: "the completion URL expires, and expiry
  // behavior is specified and tested" -- no test anywhere previously made a token actually
  // expire. This is that test.
  "expiry recovery (task 4.7 / ticket AC4)" should {
    "refuse an expired token, then a re-mint on the SAME Connector succeeds with a fresh token" in {
      val user = freshUser("expiry-recovery")
      val shortLivedService = new ConnectorCompletionService(connectorRepo, tokenRepo, defaultExpiry = Duration.ofMillis(50))

      val firstMint = await(shortLivedService.createOrRemintPending(
        "My API", "rest_api", "https://expiry-recovery.example.test", ConnectorAuthShape(authType = "bearer"), user
      )).getOrElse(fail("expected Right"))

      Thread.sleep(100) // past the 50ms expiry

      // 1. The completion URL has genuinely expired -- refused, and it costs no partial write.
      val expiredAttempt = await(shortLivedService.complete(firstMint.rawToken, "attacker-or-late-secret", requestingUser = None))
      expiredAttempt shouldBe Left(ConnectorCompletionService.RefusalError)
      val stillPending = await(connectorRepo.findByIdOwned(firstMint.connectorId, user)).get
      stillPending.isPending shouldBe true

      // 2. Re-mint succeeds on the SAME (still-pending) Connector -- design.md D9's whole point:
      //    an expired token must never strand the pending row permanently.
      val remint = await(shortLivedService.createOrRemintPending(
        "My API", "rest_api", "https://expiry-recovery.example.test", ConnectorAuthShape(authType = "bearer"), user
      )).getOrElse(fail("expected Right"))
      remint.connectorId shouldBe firstMint.connectorId
      remint.rawToken should not be firstMint.rawToken

      // 3. The human completes with the NEW token -- succeeds.
      await(shortLivedService.complete(remint.rawToken, "the-real-secret-after-recovery", requestingUser = None)) shouldBe Right(())
      val completed = await(connectorRepo.findByIdOwned(firstMint.connectorId, user)).get
      completed.isPending shouldBe false

      // 4. The original expired token remains refused, byte-identically, even after recovery.
      await(shortLivedService.complete(firstMint.rawToken, "still-no-good", requestingUser = None)) shouldBe Left(ConnectorCompletionService.RefusalError)
    }

    "owner re-mint also recovers an expired pending Connector" in {
      val user = freshUser("expiry-recovery-owner")
      val shortLivedService = new ConnectorCompletionService(connectorRepo, tokenRepo, defaultExpiry = Duration.ofMillis(50))

      val firstMint = await(shortLivedService.createOrRemintPending(
        "My API", "rest_api", "https://expiry-recovery-owner.example.test", ConnectorAuthShape(authType = "bearer"), user
      )).getOrElse(fail("expected Right"))
      Thread.sleep(100)
      await(shortLivedService.complete(firstMint.rawToken, "too-late", requestingUser = None)) shouldBe Left(ConnectorCompletionService.RefusalError)

      val remint = await(shortLivedService.ownerRemint(firstMint.connectorId, user)).getOrElse(fail("expected Right"))
      await(shortLivedService.complete(remint.rawToken, "the-real-secret", requestingUser = None)) shouldBe Right(())
    }
  }

  "D4a guards via ConnectorRepository" should {
    "refuse rotateCredential against a pending Connector" in {
      val user = freshUser("rotate-pending")
      val minted = await(service.createOrRemintPending(
        "My API", "rest_api", "https://rotate-pending.example.test", ConnectorAuthShape(authType = "bearer"), user
      )).getOrElse(fail("expected Right"))

      val result = await(connectorRepo.rotateCredential(minted.connectorId, "new-secret", "rotated", user))
      result shouldBe Left(ConnectorRotationPending)
    }

    "delete a pending Connector, cascading its outstanding completion token" in {
      val user = freshUser("delete-pending")
      val minted = await(service.createOrRemintPending(
        "My API", "rest_api", "https://delete-pending.example.test", ConnectorAuthShape(authType = "bearer"), user
      )).getOrElse(fail("expected Right"))

      await(connectorRepo.delete(minted.connectorId, user)) shouldBe Right(true)
      await(connectorRepo.findByIdOwned(minted.connectorId, user)) shouldBe None

      // The cascade left no live token behind -- completing the deleted Connector's token now
      // refuses (indistinguishable from any other invalid token), never a dangling bind.
      val postDelete = await(service.complete(minted.rawToken, "secret", requestingUser = None))
      postDelete.isLeft shouldBe true
    }
  }
}
