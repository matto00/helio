package com.helio.infrastructure.persistence.pipelines

import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json.{JsObject, JsString}

import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-913 task 5.8c: proves the R12 rebind is actually root-scoped, not merely present as a
 *  column. Every assertion here is against a GENUINELY two-root pipeline (via
 *  `PipelineRootRepository.add`, which exists from Stage 1 even though no HTTP route creates a
 *  second root yet) -- design.md R12's named bug is "writing one root's snapshots leaves the
 *  other root's intact... whichever root writes second wipes the other" when the delete
 *  predicate is bare `node_step_id IS NULL`, so a single-root test cannot exercise this at all.
 */
class MultiRootIsolationSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database = _
  private var ctx: DbContext = _
  private var pipelineRepo: PipelineRepository = _
  private var rootRepo: PipelineRootRepository = _
  private var snapshotRepo: NodeSnapshotRepository = _
  private var outputRepo: OutputRepository = _

  private val ownerId = UserId(UUID.randomUUID().toString)
  private val owner = AuthenticatedUser(ownerId)

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()
    db = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    ctx = new DbContext(db, db)
    val dataSourceRepo = new DataSourceRepository(ctx)
    pipelineRepo = new PipelineRepository(ctx, dataSourceRepo)
    rootRepo = new PipelineRootRepository(ctx)
    snapshotRepo = new NodeSnapshotRepository(ctx)
    outputRepo = new OutputRepository(ctx)

    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES (${ownerId.value}::uuid, 'mri@test.local', now())"""))
  }

  override def afterAll(): Unit = { db.close(); embeddedPostgres.close() }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  /** Seed a two-root pipeline: pipe-create's own root (position 0) plus one appended root
   *  (position 1) via `PipelineRootRepository.add`. Returns (pipelineId, root0Id, root1Id). */
  private def seedTwoRootPipeline(): (PipelineId, PipelineRootId, PipelineRootId) = {
    val src0Id = UUID.randomUUID().toString
    val src1Id = UUID.randomUUID().toString
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, created_at, updated_at, owner_id)
             VALUES ($src0Id, 'src0', 'static', '{}', now(), now(), ${ownerId.value}::uuid)""",
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, created_at, updated_at, owner_id)
             VALUES ($src1Id, 'src1', 'static', '{}', now(), now(), ${ownerId.value}::uuid)"""
    )))
    val summary = await(pipelineRepo.create("multi-root-isolation-pipe", Vector(DataSourceId(src0Id)), owner))
      .getOrElse(fail("expected Right from pipelineRepo.create"))
    val pipelineId = PipelineId(summary.id)
    val roots = await(rootRepo.list(pipelineId, owner))
    val root0Id = roots.head.id
    val root1 = await(rootRepo.add(pipelineId, DataSourceId(src1Id), owner))
    (pipelineId, root0Id, root1.id)
  }

  "NodeSnapshotRepository.overwriteRows, scoped by explicit root id" should {

    "leave root 1's snapshot intact when root 0's snapshot is (re)written (task 5.8c)" in {
      val (pipelineId, root0Id, root1Id) = seedTwoRootPipeline()
      await(snapshotRepo.overwriteRows(pipelineId.value, None, Vector(JsObject("v" -> JsString("root0-a"))), Some(root0Id.value)))
      await(snapshotRepo.overwriteRows(pipelineId.value, None, Vector(JsObject("v" -> JsString("root1-a"))), Some(root1Id.value)))

      // Re-write root 0's snapshot -- root 1's must be UNTOUCHED (design.md R12's named bug:
      // without explicit root scoping, this second write would wipe root 1's rows too, since
      // both match the bare `node_step_id IS NULL` predicate).
      await(snapshotRepo.overwriteRows(pipelineId.value, None, Vector(JsObject("v" -> JsString("root0-b"))), Some(root0Id.value)))

      val root0Rows = await(db.run(
        sql"SELECT data->>'v' FROM node_snapshots WHERE pipeline_id = ${pipelineId.value} AND root_id = ${root0Id.value}".as[String]
      ))
      val root1Rows = await(db.run(
        sql"SELECT data->>'v' FROM node_snapshots WHERE pipeline_id = ${pipelineId.value} AND root_id = ${root1Id.value}".as[String]
      ))
      root0Rows shouldBe Vector("root0-b")
      root1Rows shouldBe Vector("root1-a") // NOT wiped by root 0's second write
    }

    "let two roots each hold their own row_index 0 without a unique-index collision (task 5.8c)" in {
      val (pipelineId, root0Id, root1Id) = seedTwoRootPipeline()
      // Both write to row_index 0 -- the recreated `idx_node_snapshots_root_unique`
      // (`UNIQUE (pipeline_id, root_id, row_index) WHERE node_step_id IS NULL`) must permit
      // this (two DIFFERENT roots), where the pre-V98 index (keyed only on pipeline_id) would
      // have collided.
      noException should be thrownBy await(
        snapshotRepo.overwriteRows(pipelineId.value, None, Vector(JsObject("v" -> JsString("r0"))), Some(root0Id.value))
      )
      noException should be thrownBy await(
        snapshotRepo.overwriteRows(pipelineId.value, None, Vector(JsObject("v" -> JsString("r1"))), Some(root1Id.value))
      )
      val count = await(db.run(sql"SELECT count(*) FROM node_snapshots WHERE pipeline_id = ${pipelineId.value} AND row_index = 0".as[Int].head))
      count shouldBe 2
    }
  }

  "OutputRepository" should {

    // CORRECTED (evaluation-1.md cycle 2, Priority 2 Site A): this test used to assert the
    // silent-default-to-root-0 behavior AS THE INTENDED CONTRACT ("both land on the pipeline's
    // FIRST root today ... deferred"), locking in a defect a green run then certified as
    // correct -- exactly why the ticket's own sweep never flagged it. That framing is now false:
    // `OutputService.requireUnambiguousRootWhenNeither` (added this cycle) refuses this exact
    // ambiguity with a named 400 at the SERVICE layer, mirroring `PipelineService.persistNewStep`'s
    // sibling guard on steps (see `OutputRoutesSpec`'s "multi-root ambiguity" tests for that
    // behavior, mutation-proven). This test calls `OutputRepository.insertInternal` DIRECTLY --
    // one layer BELOW the new guard -- so its own `explicitRootId = None` auto-resolve-to-first-
    // root behavior is unchanged and legitimate: it is a low-level primitive whose caller (the
    // service layer) is now responsible for refusing the ambiguous case before ever reaching it
    // with `explicitRootId = None` on a multi-root pipeline. This test therefore documents the
    // REPOSITORY's own fallback contract, not the end-to-end multi-root create behavior.
    "the repository's own explicitRootId=None fallback still auto-resolves to the first root -- gated one layer up, at OutputService, not here" in {
      val (pipelineId, root0Id, _) = seedTwoRootPipeline()
      val out0 = await(outputRepo.insertInternal(pipelineId, None, ownerId, "out-a", OutputKind.Table, explicitRootId = None))
      val out1 = await(outputRepo.insertInternal(pipelineId, None, ownerId, "out-b", OutputKind.Table, explicitRootId = None))

      val actualRootIds = await(db.run(
        sql"SELECT root_id FROM outputs WHERE id IN (${out0.id.value}, ${out1.id.value})".as[Option[String]]
      )).flatten.toSet
      actualRootIds shouldBe Set(root0Id.value)

      val allOutputs = await(outputRepo.listByPipelineInternal(pipelineId))
      allOutputs.map(_.name).toSet shouldBe Set("out-a", "out-b")
    }
  }
}
