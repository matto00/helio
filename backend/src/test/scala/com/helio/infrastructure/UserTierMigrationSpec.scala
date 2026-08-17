package com.helio.infrastructure

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._

import java.sql.SQLException
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** Integration test for the V88 migration (`users.tier`, HEL-703, tasks.md 6.1): pre-existing
 *  `users` rows (seeded before V88 runs) backfill to `tier = 'free'`, a fresh insert with no
 *  explicit `tier` defaults to `'free'`, and the CHECK constraint rejects anything outside
 *  `free`/`beta`/`owner` on both INSERT and UPDATE.
 *
 *  Flyway is staged in two steps -- migrate to V86 only (this worktree's classpath has no V87;
 *  see V88's own migration comment / CLAUDE.md's merge-order note), seed a fixture directly
 *  against that pre-V88 schema (no `tier` column yet), then migrate the rest of the way (V88) --
 *  mirroring `TriggerSourceMigrationSpec`'s staged-migration pattern so the migration runs against
 *  exactly the shape it targets in production. */
class UserTierMigrationSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database = _

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private val preExistingUserId = UUID.randomUUID().toString

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    val jdbcUrl = embeddedPostgres.getJdbcUrl("postgres", "postgres")

    // Stage 1: migrate up to V86 only -- the pre-V88 users schema (no tier column).
    Flyway.configure()
      .dataSource(jdbcUrl, "postgres", "postgres")
      .locations("classpath:db/migration")
      .target("86")
      .load()
      .migrate()

    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    seedPreV88Fixture()

    // Stage 2: apply V88 (and any later migrations) against the seeded fixture.
    Flyway.configure()
      .dataSource(jdbcUrl, "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()
  }

  override def afterAll(): Unit = {
    db.close()
    embeddedPostgres.close()
  }

  private def seedPreV88Fixture(): Unit =
    await(db.run(
      sqlu"""INSERT INTO users (id, email, created_at)
             VALUES ($preExistingUserId::uuid, 'v88-migration-test@helio.internal', now())"""
    ))

  private def tierOf(userId: String): String =
    await(db.run(sql"SELECT tier FROM users WHERE id = $userId::uuid".as[String].head))

  "V88 migration" should {

    "backfill a pre-existing users row to tier = 'free'" in {
      tierOf(preExistingUserId) shouldBe "free"
    }

    "default a newly inserted row with no explicit tier to 'free'" in {
      val id = UUID.randomUUID().toString
      await(db.run(sqlu"INSERT INTO users (id, email, created_at) VALUES ($id::uuid, 'new-default@test.local', now())"))
      tierOf(id) shouldBe "free"
    }

    "accept an insert with tier = 'beta'" in {
      val id = UUID.randomUUID().toString
      await(db.run(sqlu"INSERT INTO users (id, email, created_at, tier) VALUES ($id::uuid, 'new-beta@test.local', now(), 'beta')"))
      tierOf(id) shouldBe "beta"
    }

    "accept an insert with tier = 'owner'" in {
      val id = UUID.randomUUID().toString
      await(db.run(sqlu"INSERT INTO users (id, email, created_at, tier) VALUES ($id::uuid, 'new-owner@test.local', now(), 'owner')"))
      tierOf(id) shouldBe "owner"
    }

    "reject an insert with an invalid tier via the CHECK constraint" in {
      val id = UUID.randomUUID().toString
      val result = db.run(sqlu"INSERT INTO users (id, email, created_at, tier) VALUES ($id::uuid, 'bad-insert@test.local', now(), 'admin')")
      a[SQLException] should be thrownBy await(result)
    }

    "reject an update to an invalid tier via the CHECK constraint" in {
      val result = db.run(sqlu"UPDATE users SET tier = 'admin' WHERE id = $preExistingUserId::uuid")
      a[SQLException] should be thrownBy await(result)
      // The rejected update never took effect.
      tierOf(preExistingUserId) shouldBe "free"
    }
  }
}
