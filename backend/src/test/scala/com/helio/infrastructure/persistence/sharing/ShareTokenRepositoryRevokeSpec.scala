package com.helio.infrastructure.persistence.sharing

import com.helio.domain.model.{DashboardId, ShareToken, ShareTokenId, UserId}
import com.helio.infrastructure.persistence.DbContext
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-590 evaluation-2.md CR-D: isolates `ShareTokenRepository.revoke`'s query-level `user_id`
 *  filter (CR6) from RLS. `ShareTokenRlsSpec` proves the RLS layer works under a genuinely
 *  non-bypassing role -- but that means RLS ALONE already blocks a cross-owner revoke there, so
 *  removing the query-level filter reddens nothing in that spec (evaluator-confirmed: 20
 *  succeeded, 0 failed after un-filtering `user_id`). This spec deliberately constructs
 *  `new DbContext(db, db)` with `db` pointing at the EmbeddedPostgres superuser connection --
 *  mirroring the dev/CI reality CR6 exists to compensate for, where every pool bypasses RLS --
 *  so a cross-owner revoke can succeed ONLY if the query-level filter is actually present. This is
 *  the one place in this change where a superuser-backed `DbContext(db, db)` is the CORRECT
 *  fixture, not the vacuous-RLS antipattern documented elsewhere: the property under test here is
 *  the query filter, not RLS, and BYPASSRLS is exactly the environment that isolates it. */
class ShareTokenRepositoryRevokeSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var repo: ShareTokenRepository         = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    // Deliberately the same (superuser, BYPASSRLS) connection on both sides -- see class doc.
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    val ctx = new DbContext(db, db)
    repo = new ShareTokenRepository(ctx)
  }

  override def afterAll(): Unit = { db.close(); embeddedPostgres.close() }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private def freshUser(): UserId = {
    val id = UUID.randomUUID().toString
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at)
                         VALUES ($id::uuid, ${s"$id@test.local"}, now())"""))
    UserId(id)
  }

  private def freshDashboard(owner: UserId): DashboardId = {
    val id = UUID.randomUUID().toString
    await(db.run(
      sqlu"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id)
             VALUES ($id, 'Revoke Guard Test Dashboard', ${owner.value}, now(), now(),
                     '{"background":"transparent","gridBackground":"transparent"}',
                     '{"lg":[],"md":[],"sm":[],"xs":[]}', ${owner.value}::uuid)"""
    ))
    DashboardId(id)
  }

  private def freshToken(owner: UserId, dashboardId: DashboardId): ShareToken =
    await(repo.insert(
      ShareToken(
        id          = ShareTokenId(UUID.randomUUID().toString),
        dashboardId = dashboardId,
        userId      = owner,
        tokenHash   = UUID.randomUUID().toString,
        expiresAt   = None,
        revokedAt   = None,
        createdAt   = Instant.now()
      )
    ))

  "revoke, under a BYPASSRLS pool on both sides (the dev/CI reality)" should {

    "returns false for another owner's token id -- the query-level user_id filter, not RLS, is what blocks this" in {
      val ownerA = freshUser()
      val ownerB = freshUser()
      val tokenA = freshToken(ownerA, freshDashboard(ownerA))

      await(repo.revoke(tokenA.id, ownerB)) shouldBe false

      // And the token is genuinely unrevoked afterwards -- not merely a `false` return with the
      // row mutated anyway.
      await(repo.findByDashboard(tokenA.dashboardId, ownerA)).head.revokedAt shouldBe None
    }

    "still returns true for the token's real owner, on the same BYPASSRLS pool" in {
      val ownerA = freshUser()
      val tokenA = freshToken(ownerA, freshDashboard(ownerA))

      await(repo.revoke(tokenA.id, ownerA)) shouldBe true
      await(repo.findByDashboard(tokenA.dashboardId, ownerA)).head.revokedAt shouldBe defined
    }
  }
}
