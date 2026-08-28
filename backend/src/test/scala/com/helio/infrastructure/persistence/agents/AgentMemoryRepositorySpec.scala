package com.helio.infrastructure.persistence.agents

import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.agents.AgentMemoryRepository
import com.helio.domain.model.{AgentMemoryEntry, AgentMemoryId, AgentMemoryKind, AuthenticatedUser, UserId}
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
 *  cross-user id check).
 *
 *  HEL-531 (420-E) tasks.md 5.3 — also exercises `pruneExpired`'s effect via `list`/`add`: an
 *  over-age entry is excluded from `list` and actually deleted, a within-window entry is
 *  unaffected, pruning runs before cap-and-evict, and `touch` never extends retention. */
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

  // A retention window large enough that no test above the "retention" describe-block below is
  // ever affected by pruning (tasks.md 5.3's own cases use a real, short window instead).
  private val NoPruning = 36500

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
      (1 to 3).foreach(i => await(repo.add(entry(owner1, s"note-$i", base.plusSeconds(i.toLong)), cap, NoPruning)))

      val all = await(repo.list(user1, NoPruning))
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
          await(repo.add(e, cap, NoPruning))
          e.id
        }
        (2 to 100).foreach(i => await(repo.add(entry(owner1, s"note-$i", base.plusSeconds(i.toLong)), cap, NoPruning)))

        val beforeOverflow = await(repo.list(user1, NoPruning))
        beforeOverflow.size shouldBe 100

        await(repo.add(entry(owner1, "note-101", base.plusSeconds(101L)), cap, NoPruning))

        val afterOverflow = await(repo.list(user1, NoPruning))
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
          await(repo.add(e, cap, NoPruning))
          // Touch every pre-existing entry so each has a non-null last_used_at -- the newly
          // inserted entry below is the only one that will ever have last_used_at = None.
          await(repo.touch(e.id, user1))
          e.id
        }

        val newEntry = entry(owner1, "new-entry", base.plusSeconds(100L))
        await(repo.add(newEntry, cap, NoPruning))

        val remaining = await(repo.list(user1, NoPruning))
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
      await(repo.add(oldest, cap, NoPruning))
      await(repo.add(middle, cap, NoPruning))
      await(repo.add(newest, cap, NoPruning))

      // Touch the oldest-by-created_at entry so its last_used_at becomes "now" -- more recently
      // used than middle/newest, whose last_used_at remains None.
      await(repo.touch(oldest.id, user1))

      // A 4th insert pushes the count to 4 > cap(3): "middle" (untouched, oldest created_at among
      // the still-null-last_used_at entries) must be evicted instead of "oldest".
      await(repo.add(entry(owner1, "fourth", base.plusSeconds(3)), cap, NoPruning))

      val remaining = await(repo.list(user1, NoPruning)).map(_.content).toSet
      remaining shouldBe Set("oldest", "newest", "fourth")
    }

    "be a no-op for an unknown id" in {
      cleanDb()
      await(repo.touch(AgentMemoryId(UUID.randomUUID().toString), user1))
      await(repo.list(user1, NoPruning)) shouldBe empty
    }

    "be a no-op for a cross-user id" in {
      cleanDb()
      val mine = entry(owner1, "mine", base)
      await(repo.add(mine, cap = 100, retentionDays = NoPruning))

      await(repo.touch(mine.id, user2))

      val fetched = await(repo.list(user1, NoPruning)).headOption.getOrElse(fail("expected a stored entry"))
      fetched.lastUsedAt shouldBe None
    }
  }

  "AgentMemoryRepository.delete" should {

    "remove a caller-owned entry and return true" in {
      cleanDb()
      val e = entry(owner1, "to-delete", base)
      await(repo.add(e, cap = 100, retentionDays = NoPruning))

      await(repo.delete(e.id, user1)) shouldBe true
      await(repo.list(user1, NoPruning)) shouldBe empty
    }

    "return false and remove nothing for an unknown id" in {
      cleanDb()
      await(repo.delete(AgentMemoryId(UUID.randomUUID().toString), user1)) shouldBe false
    }

    "return false and remove nothing for a cross-user id" in {
      cleanDb()
      val theirs = entry(owner2, "theirs", base)
      await(repo.add(theirs, cap = 100, retentionDays = NoPruning))

      await(repo.delete(theirs.id, user1)) shouldBe false
      await(repo.list(user2, NoPruning)).map(_.id) should contain(theirs.id)
    }
  }

  "AgentMemoryRepository.clear" should {

    "remove all of the caller's entries and return the count removed" in {
      cleanDb()
      (1 to 4).foreach(i => await(repo.add(entry(owner1, s"note-$i", base.plusSeconds(i.toLong)), cap = 100, retentionDays = NoPruning)))
      val other = entry(owner2, "not-mine", base)
      await(repo.add(other, cap = 100, retentionDays = NoPruning))

      await(repo.clear(user1)) shouldBe 4

      await(repo.list(user1, NoPruning)) shouldBe empty
      await(repo.list(user2, NoPruning)).map(_.id) should contain(other.id)
    }

    "return 0 for a user with no stored entries" in {
      cleanDb()
      await(repo.clear(user1)) shouldBe 0
    }
  }


  private def rowCount(id: AgentMemoryId): Int = {
    import PostgresProfile.api._
    await(db.run(sql"SELECT count(*) FROM agent_memory WHERE id = ${id.value}::uuid".as[Int].head))
  }

  "AgentMemoryRepository.pruneExpired (via list/add)" should {

    val retentionDays = 30

    // Relative to Instant.now(), NOT the class-level `base` (a fixed 2026-01-01 calendar date the
    // cap-and-evict tests above use purely as a relative-ordering anchor) -- pruning compares
    // created_at against a cutoff computed from the REAL current time, so a fixed past calendar
    // date would eventually (and, as of this ticket's authoring date, already does) drift outside
    // any real retention window regardless of the small per-test offsets applied to it.
    val retentionBase = Instant.now()

    "exclude an over-age entry from list, and actually delete the row" in {
      cleanDb()
      val overAge = entry(owner1, "over-age", retentionBase.minusSeconds((retentionDays + 1).toLong * 86400L))
      // Inserted with NoPruning so this add itself never prunes -- isolates the assertion to the
      // SUBSEQUENT list call's own pruning.
      await(repo.add(overAge, cap = 100, retentionDays = NoPruning))

      val result = await(repo.list(user1, retentionDays))
      result.map(_.id) should not contain overAge.id

      // Direct follow-up query (bypassing the repository's own list filtering) confirms the row
      // no longer exists at all, not merely that it was filtered out of this one result.
      rowCount(overAge.id) shouldBe 0
    }

    "leave a within-window entry unaffected" in {
      cleanDb()
      val withinWindow = entry(owner1, "within-window", retentionBase.minusSeconds(5L * 86400L))
      await(repo.add(withinWindow, cap = 100, retentionDays = NoPruning))

      val result = await(repo.list(user1, retentionDays))
      result.map(_.id) should contain(withinWindow.id)
      rowCount(withinWindow.id) shouldBe 1
    }

    "prune over-age entries before evaluating the cap, so a live entry is not evicted merely " +
      "because expired entries were still occupying cap slots" in {
        cleanDb()
        val cap = 2

        // Over-age, but recently touched -- under a WRONG cap-before-prune implementation this
        // entry's non-null, recent last_used_at makes it the LEAST likely eviction candidate, so a
        // bug would evict `liveUntouched` instead of this one.
        val overAgeTouched = entry(owner1, "over-age-touched", retentionBase.minusSeconds((retentionDays + 1).toLong * 86400L))
        await(repo.add(overAgeTouched, cap = 100, retentionDays = NoPruning))
        await(repo.touch(overAgeTouched.id, user1))

        // Within-window, never touched -- last_used_at = None, so it's the FIRST eviction
        // candidate under "ORDER BY last_used_at ASC NULLS FIRST" if the over-age entry above is
        // still counted toward the cap.
        val liveUntouched = entry(owner1, "live-untouched", retentionBase.minusSeconds(1L * 86400L))
        await(repo.add(liveUntouched, cap = 100, retentionDays = NoPruning))

        // Real prune-then-cap add: prunes overAgeTouched FIRST (age-based, independent of its
        // recent touch -- design.md Decision 6), leaving count = 1 before this insert, so the
        // insert brings count to 2 = cap -- no eviction at all.
        val newEntry = entry(owner1, "new-entry", retentionBase)
        await(repo.add(newEntry, cap = cap, retentionDays = retentionDays))

        val remaining = await(repo.list(user1, NoPruning)).map(_.id)
        remaining should contain(liveUntouched.id)
        remaining should contain(newEntry.id)
        remaining should not contain overAgeTouched.id
      }

    "still prune a frequently-touched entry once past the retention window -- touch does not " +
      "extend or reset retention" in {
        cleanDb()
        val touchedButOverAge = entry(owner1, "touched-over-age", retentionBase.minusSeconds((retentionDays + 1).toLong * 86400L))
        await(repo.add(touchedButOverAge, cap = 100, retentionDays = NoPruning))
        await(repo.touch(touchedButOverAge.id, user1))

        val result = await(repo.list(user1, retentionDays))
        result.map(_.id) should not contain touchedButOverAge.id
        rowCount(touchedButOverAge.id) shouldBe 0
      }
  }
}
