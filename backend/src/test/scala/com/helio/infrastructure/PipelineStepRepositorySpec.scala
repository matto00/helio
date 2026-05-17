package com.helio.infrastructure

import com.helio.domain._
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}

import java.util.UUID
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

/** End-to-end repo round-trip coverage for the read-path tolerance regression
 *  the cycle-1 evaluator caught: a persisted pipeline step row with a partial
 *  `config` JSON (legacy data, mid-edit, or seed) must decode into a typed
 *  default-valued config rather than throwing — keeping `/steps` and
 *  `/analyze` responsive instead of 500ing the entire pipeline. */
class PipelineStepRepositorySpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var stepRepo: PipelineStepRepository   = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()
    db       = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    stepRepo = new PipelineStepRepository(db)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private val systemUser = AuthenticatedUser(UserId("00000000-0000-0000-0000-000000000001"))

  /** Seed a data source / data type / pipeline and return the pipeline id —
   *  the same shape the other infrastructure specs use. */
  private def seedPipeline(): PipelineId = {
    import PostgresProfile.api._
    val ownerId = "00000000-0000-0000-0000-000000000001"
    val dsId    = UUID.randomUUID().toString
    val dtId    = UUID.randomUUID().toString
    val pid     = UUID.randomUUID().toString
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources
               (id, name, source_type, config, owner_id, created_at, updated_at)
               VALUES ($dsId, 'ds', 'static', '{"columns":[],"rows":[]}', $ownerId::uuid, now(), now())""",
      sqlu"""INSERT INTO data_types
               (id, name, fields, version, owner_id, created_at, updated_at)
               VALUES ($dtId, 'dt', '[]', 1, $ownerId::uuid, now(), now())""",
      sqlu"""INSERT INTO pipelines
               (id, name, source_data_source_id, output_data_type_id, created_at, updated_at)
               VALUES ($pid, 'pipe', $dsId, $dtId, now(), now())"""
    )))
    PipelineId(pid)
  }

  /** Insert a raw `pipeline_steps` row with the given op + config text. This
   *  simulates the legacy / mid-edit data that triggered the cycle-1 regression
   *  (the codec's typed insert path can't emit a partial config because it
   *  validates first — direct SQL is the only way to reproduce). */
  private def insertRawStep(pid: PipelineId, op: String, configJson: String, position: Int): String = {
    import PostgresProfile.api._
    val id = UUID.randomUUID().toString
    await(db.run(
      sqlu"""INSERT INTO pipeline_steps
               (id, pipeline_id, position, op, config, created_at, updated_at)
               VALUES ($id, ${pid.value}, $position, $op, $configJson::text, now(), now())"""
    ))
    id
  }

  "listByPipeline" should {

    "decode a join row persisted with config='{}' into a default JoinStep (the cycle-1 regression)" in {
      val pid    = seedPipeline()
      val stepId = insertRawStep(pid, "join", "{}", position = 0)
      val steps  = await(stepRepo.listByPipeline(pid, systemUser))

      steps should have size 1
      val step = steps.head
      step.id.value shouldBe stepId
      step shouldBe a [JoinStep]
      val join = step.asInstanceOf[JoinStep]
      join.config.rightDataSourceId shouldBe ""
      join.config.joinKey           shouldBe ""
      join.config.joinType          shouldBe "inner"
    }

    "decode rows for every step kind persisted with config='{}' without throwing" in {
      val pid = seedPipeline()
      val kinds = PipelineStepKind.All.toSeq.sorted
      kinds.zipWithIndex.foreach { case (kind, position) =>
        insertRawStep(pid, kind, "{}", position)
      }

      val steps = await(stepRepo.listByPipeline(pid, systemUser))
      steps.map(_.kind).toSet shouldBe PipelineStepKind.All
      steps should have size kinds.size.toLong
    }

    "preserve full typed configs round-tripping through insert + listByPipeline" in {
      val pid = seedPipeline()
      val joinConfig = JoinConfig("ds-right", "id", "left")
      await(stepRepo.insert(pid, PipelineStepKind.Join, joinConfig))

      val steps = await(stepRepo.listByPipeline(pid, systemUser))
      steps should have size 1
      val join = steps.head.asInstanceOf[JoinStep]
      join.config shouldBe joinConfig
    }
  }

  // ── HEL-265 CS2: cross-user ACL enforcement (JOIN to pipelines.owner_id) ──

  "PipelineStepRepository cross-user ACL (CS2)" should {

    val otherUser = AuthenticatedUser(UserId(UUID.randomUUID().toString))

    "listByPipeline returns empty vector for a non-owner" in {
      val pid = seedPipeline()
      await(stepRepo.insert(pid, PipelineStepKind.Rename, RenameConfig(Map.empty)))
      await(stepRepo.listByPipeline(pid, systemUser)) should have size 1
      await(stepRepo.listByPipeline(pid, otherUser)) shouldBe empty
    }

    "findById returns None for a non-owner" in {
      val pid  = seedPipeline()
      val step = await(stepRepo.insert(pid, PipelineStepKind.Rename, RenameConfig(Map.empty)))
      await(stepRepo.findById(step.id, systemUser)) shouldBe defined
      await(stepRepo.findById(step.id, otherUser))  shouldBe None
    }

    "update returns None and does not mutate for a non-owner" in {
      val pid  = seedPipeline()
      val step = await(stepRepo.insert(pid, PipelineStepKind.Rename, RenameConfig(Map.empty)))
      val updated = await(stepRepo.update(
        step.id,
        config   = Some(RenameConfig(Map("hijack" -> "x"))),
        position = None,
        user     = otherUser
      ))
      updated shouldBe None
      // Confirm the persisted config is still the original empty rename.
      val owned = await(stepRepo.findById(step.id, systemUser)).get
      owned.asInstanceOf[RenameStep].config.renames shouldBe empty
    }

    "delete returns false and leaves the row for a non-owner" in {
      val pid  = seedPipeline()
      val step = await(stepRepo.insert(pid, PipelineStepKind.Rename, RenameConfig(Map.empty)))
      await(stepRepo.delete(step.id, otherUser)) shouldBe false
      await(stepRepo.findById(step.id, systemUser)) shouldBe defined
    }
  }
}
