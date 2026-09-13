package com.helio.domain.steps

import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend

import java.time.Instant
import java.util.UUID
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

/** HEL-1099: the `upsertsource` step's config model + write-path validation. This step is
 *  NOT yet registered in `PipelineStep.Registry` (see `UpsertSourceConfig`'s own top-of-file
 *  scaladoc for why) — coverage here is direct against the companion object, mirroring
 *  `ComputeStepSpec`'s "not wired into a route yet" pattern, rather than through
 *  `PipelineService.addStep`. */
class UpsertSourceConfigSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var repo: DataSourceRepository         = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()
    db   = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    repo = new DataSourceRepository(new DbContext(db, db))
  }

  override def afterAll(): Unit = {
    db.close()
    embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  // ── Read-path tolerance (HEL-1099 ticket description's own trap) ─────────

  "UpsertSourceConfig.decode" should {

    "not throw on a legacy/malformed persisted row -- a decode failure here would 500 " +
      "PipelineStepRepository.rowToDomain on every read of an unconfigured step" in {
      // A step a user added but never configured: `{}`.
      noException should be thrownBy UpsertSourceConfig.decode("{}")
      UpsertSourceConfig.decode("{}") shouldBe UpsertSourceConfig(UpsertTarget.Default, UpsertMode.Default)
    }

    "decode an absent target as the incomplete-draft default, not a decode failure" in {
      UpsertSourceConfig.decode("""{"mode":"replace"}""").target shouldBe UpsertTarget.ExistingSource("")
    }

    "decode an absent mode as the tolerant default 'append'" in {
      UpsertSourceConfig.decode(
        """{"target":{"kind":"existingSource","dataSourceId":"abc"}}"""
      ).mode shouldBe "append"
    }

    "round-trip a newSource target" in {
      val raw = """{"target":{"kind":"newSource","name":"Weekly Signups"},"mode":"append"}"""
      UpsertSourceConfig.decode(raw) shouldBe UpsertSourceConfig(UpsertTarget.NewSource("Weekly Signups"), "append")
    }

    "round-trip an existingSource target" in {
      val raw = """{"target":{"kind":"existingSource","dataSourceId":"ds-1"},"mode":"replace"}"""
      UpsertSourceConfig.decode(raw) shouldBe UpsertSourceConfig(UpsertTarget.ExistingSource("ds-1"), "replace")
    }

    "raise for a present-but-wrong-typed target (a string instead of an object)" in {
      a[StepConfigTypeMismatch] should be thrownBy UpsertSourceConfig.decode("""{"target":"ds-1"}""")
    }

    "raise for an unrecognised target.kind" in {
      a[StepConfigTypeMismatch] should be thrownBy
        UpsertSourceConfig.decode("""{"target":{"kind":"bogus","dataSourceId":"x"}}""")
    }
  }

  // ── Write-path strictness (HEL-814/HEL-860/HEL-871 class) ────────────────

  "UpsertSourceConfig.validateRawConfig" should {

    "accept a fully-specified valid newSource config" in {
      UpsertSourceConfig.validateRawConfig(
        """{"target":{"kind":"newSource","name":"Signups"},"mode":"append"}"""
      ) shouldBe None
    }

    "accept a fully-specified valid existingSource config" in {
      UpsertSourceConfig.validateRawConfig(
        """{"target":{"kind":"existingSource","dataSourceId":"ds-1"},"mode":"replace"}"""
      ) shouldBe None
    }

    "accept an absent target/mode -- an incomplete draft is not a write-time error" in {
      UpsertSourceConfig.validateRawConfig("{}") shouldBe None
    }

    "reject a wrong-typed target (a number instead of an object), naming 'target'" in {
      val problem = UpsertSourceConfig.validateRawConfig("""{"target": 42}""")
      problem shouldBe defined
      problem.get should include("target")
    }

    "reject a wrong-typed mode (a number instead of a string), naming 'mode'" in {
      val problem = UpsertSourceConfig.validateRawConfig(
        """{"target":{"kind":"existingSource","dataSourceId":"ds-1"},"mode": 1}"""
      )
      problem shouldBe defined
      problem.get should include("mode")
    }

    "reject a wrong-typed target.name (a number instead of a string)" in {
      val problem = UpsertSourceConfig.validateRawConfig(
        """{"target":{"kind":"newSource","name": 7}}"""
      )
      problem shouldBe defined
    }

    "reject a wrong-typed target.dataSourceId (a boolean instead of a string)" in {
      val problem = UpsertSourceConfig.validateRawConfig(
        """{"target":{"kind":"existingSource","dataSourceId": true}}"""
      )
      problem shouldBe defined
    }

    "reject an unrecognised target.kind, naming the offending value" in {
      val problem = UpsertSourceConfig.validateRawConfig(
        """{"target":{"kind":"otherThing","dataSourceId":"x"}}"""
      )
      problem shouldBe defined
      problem.get should include("otherThing")
    }

    "reject an unsupported mode value, naming it and the supported set -- HEL-871 class: a " +
      "typo'd mode must be rejected, not silently defaulted to 'append'" in {
      val problem = UpsertSourceConfig.validateRawConfig(
        """{"target":{"kind":"existingSource","dataSourceId":"ds-1"},"mode":"upsert"}"""
      )
      problem shouldBe defined
      problem.get should include("upsert")
      problem.get should include("append")
      problem.get should include("replace")
    }

    "accept mode absent (not the same as mode invalid)" in {
      UpsertSourceConfig.validateRawConfig(
        """{"target":{"kind":"existingSource","dataSourceId":"ds-1"}}"""
      ) shouldBe None
    }

    "reject a top-level config that is not a JSON object" in {
      val problem = UpsertSourceConfig.validateRawConfig(""""just a string"""")
      problem shouldBe defined
    }

    "return None (not raise) for malformed JSON -- the pre-existing 'invalid config' " +
      "category the calling surface already reports from its own decode Try" in {
      noException should be thrownBy UpsertSourceConfig.validateRawConfig("{not json")
      UpsertSourceConfig.validateRawConfig("{not json") shouldBe None
    }
  }

  // ── Ownership pre-flight: no cross-tenant existence oracle ────────────────

  private def cleanDb(): Unit = {
    import slick.jdbc.PostgresProfile.api._
    await(db.run(sqlu"DELETE FROM data_sources"))
  }

  private val ownerA = AuthenticatedUser(UserId(UUID.randomUUID().toString))
  private val ownerB = AuthenticatedUser(UserId(UUID.randomUUID().toString))

  private def seedOwnedSource(owner: AuthenticatedUser): DataSourceId = {
    val now = Instant.now()
    val id  = DataSourceId(UUID.randomUUID().toString)
    val source = RestSource(
      id        = id,
      name      = "Owned Source",
      ownerId   = owner.id,
      createdAt = now,
      updatedAt = now,
      config    = RestApiConfig(connectorId = "conn-1", endpoint = "https://example.test", method = "GET")
    )
    await(repo.insert(source, owner))
    id
  }

  "UpsertSourceConfig.validateTargetOwnership" should {

    "accept a NewSource target unconditionally -- nothing to own yet" in {
      cleanDb()
      await(UpsertSourceConfig.validateTargetOwnership(UpsertTarget.NewSource("New One"), ownerA, repo)) shouldBe None
    }

    "accept an empty existingSource dataSourceId as an incomplete draft, not a lookup" in {
      cleanDb()
      await(UpsertSourceConfig.validateTargetOwnership(UpsertTarget.ExistingSource(""), ownerA, repo)) shouldBe None
    }

    "accept an existingSource target the caller owns" in {
      cleanDb()
      val id = seedOwnedSource(ownerA)
      await(UpsertSourceConfig.validateTargetOwnership(UpsertTarget.ExistingSource(id.value), ownerA, repo)) shouldBe None
    }

    "reject a genuinely unknown dataSourceId" in {
      cleanDb()
      val problem = await(
        UpsertSourceConfig.validateTargetOwnership(
          UpsertTarget.ExistingSource(UUID.randomUUID().toString), ownerA, repo
        )
      )
      problem shouldBe defined
    }

    "reject another tenant's dataSourceId with the SAME message as an unknown id -- " +
      "no cross-tenant existence oracle: a non-owner cannot distinguish 'not found' from " +
      "'found, but not yours'" in {
      cleanDb()
      val othersId = seedOwnedSource(ownerB)
      val unknownId = UUID.randomUUID().toString

      val forOthersSource = await(
        UpsertSourceConfig.validateTargetOwnership(UpsertTarget.ExistingSource(othersId.value), ownerA, repo)
      )
      val forUnknown = await(
        UpsertSourceConfig.validateTargetOwnership(UpsertTarget.ExistingSource(unknownId), ownerA, repo)
      )

      forOthersSource shouldBe defined
      forUnknown shouldBe defined
      // Same shape of message either way -- both name only the id the CALLER supplied,
      // never anything about the row that actually exists under a different owner.
      forOthersSource.get shouldBe s"Data source not found: ${othersId.value}"
      forUnknown.get shouldBe s"Data source not found: $unknownId"
    }
  }
}
