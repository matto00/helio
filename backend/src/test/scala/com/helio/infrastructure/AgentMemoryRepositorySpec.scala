package com.helio.infrastructure

import com.helio.domain.{AgentMemoryEntry, AgentMemoryId, AgentMemoryKind, AuthenticatedUser, UserId}
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

/** HEL-478 (420-B) — `AgentMemoryRepository` cap-and-evict mechanics (tasks.md 4.1). RLS
 *  owner-isolation itself is covered separately by `RlsOwnerTablesSpec`'s `agent_memory` section
 *  (tasks.md 4.3); this spec exercises `add`'s eviction ordering, `touch`'s effect on that
 *  ordering, and `delete`/`clear`'s no-op-on-unknown-id behavior against a single owner (plus one
 *  cross-user id check). */
class AgentMemoryRepositorySpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var repo: AgentMemoryRepository        = _

  private val owner1Id = UUID.randomUUID().toString
  private val owner1   = UserId(owner1Id)
  private val user1    = AuthenticatedUser(owner1)

  private val owner2Id = UUID.randomUUID().toString
  private val owner2   = UserId(owner2Id)
  private val user2    = AuthenticatedUser(owner2)

  private val base = Instant.parse("2026-01-01T00:00:00Z")

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()
    db   = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    repo = new AgentMemoryRepository(new DbContext(db, db))
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 30.seconds)

  private def cleanDb(): Unit = {
    import PostgresProfile.api._
    await(db.run(sqlu"DELETE FROM agent_memory"))
    await(db.run(sqlu"DELETE FROM users"))
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($owner1Id::uuid, ${s"$owner1Id@helio.test"}, now())"""))
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($owner2Id::uuid, ${s"$owner2Id@helio.test"}, now())"""))
  }

  private def entry(
      ownerId: UserId,
      content: String,
      createdAt: Instant,
      kind: AgentMemoryKind = AgentMemoryKind.Fact,
      lastUsedAt: Option[Instant] = None
  ): AgentMemoryEntry =
    AgentMemoryEntry(
      id         = AgentMemoryId(UUID.randomUUID().toString),
      ownerId    = ownerId,
      kind       = kind,
      content    = content,
      createdAt  = createdAt,
      lastUsedAt = lastUsedAt
    )

  "AgentMemoryRepository.add" should {

    "insert under the cap without evicting anything" in {
      cleanDb()
      val cap = 5
      (1 to 3).foreach(i => await(repo.add(entry(owner1, s"note-$i", base.plusSeconds(i.toLong)), cap)))

      val all = await(repo.list(user1))
      all.map(_.content).toSet shouldBe Set("note-1", "note-2", "note-3")
    }

    "evict exactly the least-recently-useful entry (oldest last_used_at, nulls first, created_at " +
      "tiebreak) when an insert pushes the owner's count past the cap, keeping the total at the cap" in {
        cleanDb()
        val cap = 100
        // All 100 initial entries share lastUsedAt = None (nulls) -- created_at is the sole
        // tiebreak, so the very first (oldest createdAt) is the eviction target once entry #101
        // arrives.
        val firstId = {
          val e = entry(owner1, "note-1", base.plusSeconds(1L))
          await(repo.add(e, cap))
          e.id
        }
        (2 to 100).foreach(i => await(repo.add(entry(owner1, s"note-$i", base.plusSeconds(i.toLong)), cap)))

        val beforeOverflow = await(repo.list(user1))
        beforeOverflow.size shouldBe 100

        await(repo.add(entry(owner1, "note-101", base.plusSeconds(101L)), cap))

        val afterOverflow = await(repo.list(user1))
        afterOverflow.size shouldBe 100
        afterOverflow.map(_.id) should not contain firstId
        afterOverflow.map(_.content) should contain("note-101")
      }

    // Evaluator change request 1 (cycle 2): the eviction candidate query must never select the
    // row that was just inserted in the SAME `add` call, even when that row is the only one with
    // a null `last_used_at` at query time (every pre-existing, at-cap entry has already been
    // touched). A newly-added entry always starts with `lastUsedAt = None`, so without excluding
    // its own id, "ORDER BY last_used_at ASC NULLS FIRST" would make it the sole NULLS-FIRST
    // candidate and evict IT instead of an existing entry.
    "evict an existing entry, never the newly-inserted one, when every pre-existing entry has " +
      "already been touched (non-null last_used_at)" in {
        cleanDb()
        val cap = 3
        val existingIds = (1 to cap).map { i =>
          val e = entry(owner1, s"existing-$i", base.plusSeconds(i.toLong))
          await(repo.add(e, cap))
          // Touch every pre-existing entry so each has a non-null last_used_at -- the newly
          // inserted entry below is the only one that will ever have last_used_at = None.
          await(repo.touch(e.id, user1))
          e.id
        }

        val newEntry = entry(owner1, "new-entry", base.plusSeconds(100L))
        await(repo.add(newEntry, cap))

        val remaining = await(repo.list(user1))
        remaining.size shouldBe cap
        remaining.map(_.id) should contain(newEntry.id)

        // Exactly one of the pre-existing (touched) entries was evicted to make room.
        val remainingExisting = remaining.map(_.id).toSet.intersect(existingIds.toSet)
        remainingExisting.size shouldBe cap - 1
      }
  }

  "AgentMemoryRepository.touch" should {

    "update last_used_at, protecting that entry from being the next eviction target" in {
      cleanDb()
      val cap = 3
      val oldest = entry(owner1, "oldest", base)
      val middle = entry(owner1, "middle", base.plusSeconds(1))
      val newest = entry(owner1, "newest", base.plusSeconds(2))
      await(repo.add(oldest, cap))
      await(repo.add(middle, cap))
      await(repo.add(newest, cap))

      // Touch the oldest-by-created_at entry so its last_used_at becomes "now" -- more recently
      // used than middle/newest, whose last_used_at remains None.
      await(repo.touch(oldest.id, user1))

      // A 4th insert pushes the count to 4 > cap(3): "middle" (untouched, oldest created_at among
      // the still-null-last_used_at entries) must be evicted instead of "oldest".
      await(repo.add(entry(owner1, "fourth", base.plusSeconds(3)), cap))

      val remaining = await(repo.list(user1)).map(_.content).toSet
      remaining shouldBe Set("oldest", "newest", "fourth")
    }

    "be a no-op for an unknown id" in {
      cleanDb()
      await(repo.touch(AgentMemoryId(UUID.randomUUID().toString), user1))
      await(repo.list(user1)) shouldBe empty
    }

    "be a no-op for a cross-user id" in {
      cleanDb()
      val mine = entry(owner1, "mine", base)
      await(repo.add(mine, cap = 100))

      await(repo.touch(mine.id, user2))

      val fetched = await(repo.list(user1)).headOption.getOrElse(fail("expected a stored entry"))
      fetched.lastUsedAt shouldBe None
    }
  }

  "AgentMemoryRepository.delete" should {

    "remove a caller-owned entry and return true" in {
      cleanDb()
      val e = entry(owner1, "to-delete", base)
      await(repo.add(e, cap = 100))

      await(repo.delete(e.id, user1)) shouldBe true
      await(repo.list(user1)) shouldBe empty
    }

    "return false and remove nothing for an unknown id" in {
      cleanDb()
      await(repo.delete(AgentMemoryId(UUID.randomUUID().toString), user1)) shouldBe false
    }

    "return false and remove nothing for a cross-user id" in {
      cleanDb()
      val theirs = entry(owner2, "theirs", base)
      await(repo.add(theirs, cap = 100))

      await(repo.delete(theirs.id, user1)) shouldBe false
      await(repo.list(user2)).map(_.id) should contain(theirs.id)
    }
  }

  "AgentMemoryRepository.clear" should {

    "remove all of the caller's entries and return the count removed" in {
      cleanDb()
      (1 to 4).foreach(i => await(repo.add(entry(owner1, s"note-$i", base.plusSeconds(i.toLong)), cap = 100)))
      val other = entry(owner2, "not-mine", base)
      await(repo.add(other, cap = 100))

      await(repo.clear(user1)) shouldBe 4

      await(repo.list(user1)) shouldBe empty
      await(repo.list(user2)).map(_.id) should contain(other.id)
    }

    "return 0 for a user with no stored entries" in {
      cleanDb()
      await(repo.clear(user1)) shouldBe 0
    }
  }
}
