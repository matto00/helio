package com.helio.infrastructure

import com.helio.domain.{AgentPreferences, UserId}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._

import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-472 (420-A) — `AgentPreferencesRepository` CRUD: absent-row `get`, upsert-insert,
 *  upsert-replace (not merge), and full-field round-trip (tasks.md 4.1). RLS owner-isolation
 *  itself is covered separately by `RlsOwnerTablesSpec`'s `agent_preferences` section
 *  (tasks.md 4.2). */
class AgentPreferencesRepositorySpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres          = _
  private var db: JdbcBackend.Database                    = _
  private var repo: AgentPreferencesRepository            = _

  private val owner1Id = UUID.randomUUID().toString
  private val owner1   = UserId(owner1Id)

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()
    db   = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    repo = new AgentPreferencesRepository(new DbContext(db, db))
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  private def cleanDb(): Unit = {
    import PostgresProfile.api._
    await(db.run(sqlu"DELETE FROM agent_preferences"))
    await(db.run(sqlu"DELETE FROM users"))
  }

  private def seedUser(id: String): Unit = {
    import PostgresProfile.api._
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($id::uuid, ${s"$id@helio.test"}, now())"""))
  }

  "AgentPreferencesRepository.get" should {

    "return None when the caller has no stored row" in {
      cleanDb(); seedUser(owner1Id)
      await(repo.get(owner1)) shouldBe None
    }
  }

  "AgentPreferencesRepository.put" should {

    "insert a new row for a user with none stored, round-tripping every field" in {
      cleanDb(); seedUser(owner1Id)
      val prefs = AgentPreferences(
        userId              = owner1,
        defaultSeriesColors = Some(Vector("#ff0000", "#00ff00")),
        defaultPanelStyle   = Some(JsObject("background" -> JsString("dark"))),
        namingConventions   = Some(JsObject("titleCase" -> JsBoolean(true))),
        extras              = JsObject("favoriteChart" -> JsString("bar")),
        memoryEnabled       = true
      )

      val persisted = await(repo.put(owner1, prefs))
      persisted shouldBe prefs

      val found = await(repo.get(owner1))
      found shouldBe Some(prefs)
    }

    "replace (not merge) an existing row: an omitted field on the second put is cleared" in {
      cleanDb(); seedUser(owner1Id)
      val first = AgentPreferences(
        userId              = owner1,
        defaultSeriesColors = Some(Vector("#111111")),
        defaultPanelStyle   = Some(JsObject("background" -> JsString("light"))),
        namingConventions   = Some(JsObject("titleCase" -> JsBoolean(false))),
        extras              = JsObject("note" -> JsString("first")),
        memoryEnabled       = true
      )
      await(repo.put(owner1, first))

      // Second put omits defaultPanelStyle/namingConventions/extras entirely (None/empty) --
      // a full replace must clear them, not retain the first put's values. memoryEnabled flips to
      // `false` here too, proving BOTH values round-trip correctly across a real replace (HEL-531
      // / 420-E) -- this repository-level test writes AgentPreferences directly, unlike
      // AgentPreferencesServiceSpec's own put-preserves-memoryEnabled coverage.
      val second = AgentPreferences(
        userId              = owner1,
        defaultSeriesColors = Some(Vector("#222222")),
        defaultPanelStyle   = None,
        namingConventions   = None,
        extras              = JsObject.empty,
        memoryEnabled       = false
      )
      await(repo.put(owner1, second))

      val found = await(repo.get(owner1))
      found shouldBe Some(second)

      import PostgresProfile.api._
      val count = await(db.run(sql"SELECT COUNT(*) FROM agent_preferences WHERE user_id = $owner1Id::uuid".as[Int].head))
      count shouldBe 1
    }

    "an empty AgentPreferences round-trips as all-None/empty-extras" in {
      cleanDb(); seedUser(owner1Id)
      val empty = AgentPreferences.empty(owner1, memoryEnabled = true)
      await(repo.put(owner1, empty))

      await(repo.get(owner1)) shouldBe Some(empty)
    }

    // HEL-531 (420-E): a row written before this ticket only ever has the original four fields
    // serialized (no `memoryEnabled` key at all) -- decoding that absence must fall back to
    // `true` (preserving the caller's actual prior behavior), not fail or silently default to
    // `false`.
    "decode a pre-existing row with no memoryEnabled key in its JSONB as memoryEnabled = true" in {
      cleanDb(); seedUser(owner1Id)
      import PostgresProfile.api._
      await(db.run(
        sqlu"""INSERT INTO agent_preferences (user_id, preferences, updated_at)
               VALUES ($owner1Id::uuid, '{"extras": {}}', now())"""
      ))

      await(repo.get(owner1)).map(_.memoryEnabled) shouldBe Some(true)
    }
  }
}
