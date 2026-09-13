package com.helio.services.pipelines

import com.helio.testkit.TempDirectorySupport
import com.helio.testsupport.DatasetRowsTestSupport
import com.helio.domain._
import com.helio.domain.model._
import com.helio.domain.steps.{UpsertMode, UpsertSourceConfig, UpsertTarget}
import com.helio.domain.engine.InProcessExecutionBackend
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputRepository, PipelineRepository, PipelineRunRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.spark.PipelineRunCache
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.{JdbcBackend, PostgresProfile}
import spray.json._
import spray.json.DefaultJsonProtocol._

import java.nio.file.Paths
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1100: real-run coverage of the `upsertsource` write-back step (tasks 3.2, 3.5, 3.6, 3.8,
 *  3.8a) — drives the step through `PipelineRunService.submit` exactly like a real API call
 *  would, then reads the target's persisted `dataset_rows` back to prove what actually landed. */
class PipelineRunServiceUpsertSourceSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll with TempDirectorySupport {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres     = _
  private var db: JdbcBackend.Database               = _
  private var ctx: DbContext                         = _
  private var pipelineRepo: PipelineRepository       = _
  private var stepRepo: PipelineStepRepository       = _
  private var dataSourceRepo: DataSourceRepository   = _
  private var pipelineRunRepo: PipelineRunRepository = _
  private var nodeSnapshotRepo: NodeSnapshotRepository = _
  private var outputRepo: OutputRepository           = _
  private var service: PipelineRunService            = _

  private val dummyUser = AuthenticatedUser(UserId("00000000-0000-0000-0000-000000000001"))

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db               = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    ctx              = new DbContext(db, db)
    dataSourceRepo   = new DataSourceRepository(ctx)
    stepRepo         = new PipelineStepRepository(ctx)
    pipelineRepo     = new PipelineRepository(ctx, dataSourceRepo)
    pipelineRunRepo  = new PipelineRunRepository(ctx)
    nodeSnapshotRepo = new NodeSnapshotRepository(ctx)
    outputRepo       = new OutputRepository(ctx)
    val cache        = new PipelineRunCache()
    val fileSystem   = new LocalFileSystem(Paths.get("/"))
    service = new PipelineRunService(
      pipelineRepo, stepRepo, dataSourceRepo, pipelineRunRepo,
      cache, registry = null, fileSystem,
      outputRepo = outputRepo, nodeSnapshotRepo = nodeSnapshotRepo
    )
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close()
    super.afterAll()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  // ── Fixture helpers ──────────────────────────────────────────────────────

  private def seedSourceDs(rows: Vector[Vector[String]]): String = {
    import PostgresProfile.api._
    val dsId        = UUID.randomUUID().toString
    val dsConfig    = s"""{"columns":[{"name":"name","type":"string"}],"rows":${rows.map(_.map(v => "\"" + v + "\"").mkString("[", ",", "]")).mkString("[", ",", "]")}}"""
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($dsId, 'ds-source', 'dataset', '{}', '00000000-0000-0000-0000-000000000001', now(), now())""",
      DatasetRowsTestSupport.seedActionsFromRaw(dsId, dsConfig)
    )))
    dsId
  }

  /** Seeds a target `dataset`-kind source with a declared schema and optional pre-existing rows. */
  private def seedTargetDs(columns: Vector[(String, String)], rows: Vector[Vector[String]] = Vector.empty): String = {
    import PostgresProfile.api._
    val dsId = UUID.randomUUID().toString
    val columnsJson = columns.map { case (name, typ) => s"""{"name":"$name","type":"$typ"}""" }.mkString("[", ",", "]")
    val payload = s"""{"columns":$columnsJson,"rows":${rows.map(_.map(v => "\"" + v + "\"").mkString("[", ",", "]")).mkString("[", ",", "]")}}"""
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($dsId, 'ds-target', 'dataset', '{}', '00000000-0000-0000-0000-000000000001', now(), now())""",
      DatasetRowsTestSupport.seedActionsFromRaw(dsId, payload)
    )))
    dsId
  }

  private def seedPipeline(sourceDsId: String): PipelineId = {
    import PostgresProfile.api._
    val pid = UUID.randomUUID().toString
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO pipelines (id, name, created_at, updated_at) VALUES ($pid, 'upsert-pipe', now(), now())""",
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position) VALUES ($pid, $pid, $sourceDsId, 0)"""
    )))
    PipelineId(pid)
  }

  private def insertUpsertStep(pipelineId: PipelineId, target: UpsertTarget, mode: String = UpsertMode.Append): PipelineStep = {
    val existing = await(stepRepo.listByPipelineInternal(pipelineId))
    val parent   = stepRepo.trunkOf(existing).lastOption.map(_.id)
    await(stepRepo.insertInternal(
      pipelineId, "upsertsource", UpsertSourceConfig(target, mode),
      enabled = true, parent, explicitRootId = None, actingUserId = dummyUser.id.value
    ))
  }

  private def targetRows(dsId: String): Vector[JsValue] = {
    val obj = await(dataSourceRepo.readDatasetRows(DataSourceId(dsId))).get
    obj.fields("rows").asInstanceOf[JsArray].elements
  }

  private def targetName(dsId: String): String = {
    import PostgresProfile.api._
    await(db.run(sql"SELECT name FROM data_sources WHERE id = $dsId".as[String].head))
  }

  /** Appends an arbitrary (non-upsertsource) step onto the CURRENT trunk-last node -- the
   *  generic counterpart to `insertUpsertStep`, used to chain a later-failing step after an
   *  upsertsource step (skeptic-final-1.md CR3). */
  private def insertStep(pipelineId: PipelineId, kind: String, config: Any): PipelineStep = {
    val existing = await(stepRepo.listByPipelineInternal(pipelineId))
    val parent   = stepRepo.trunkOf(existing).lastOption.map(_.id)
    await(stepRepo.insertInternal(pipelineId, kind, config, enabled = true, parent, explicitRootId = None))
  }

  private def lastRunStatus(pid: PipelineId): Option[String] = {
    import PostgresProfile.api._
    await(db.run(sql"SELECT last_run_status FROM pipelines WHERE id = ${pid.value}".as[Option[String]].head))
  }

  private def nodeSnapshotCount(pid: PipelineId): Int = {
    import PostgresProfile.api._
    await(db.run(sql"SELECT count(*) FROM node_snapshots WHERE pipeline_id = ${pid.value}".as[Int].head))
  }

  // ── Tests ────────────────────────────────────────────────────────────────

  "an 'append' upsertsource step" should {
    "preserve existing rows and add the new ones (3.2)" in {
      val sourceId = seedSourceDs(Vector(Vector("carol")))
      val targetId = seedTargetDs(Vector("name" -> "string"), rows = Vector(Vector("alice"), Vector("bob")))
      val pid      = seedPipeline(sourceId)
      insertUpsertStep(pid, UpsertTarget.ExistingSource(targetId))

      val result = await(service.submit(pid, isDry = false, dummyUser))
      result shouldBe a[Right[_, _]]

      val rows = targetRows(targetId).map(_.asInstanceOf[JsArray].elements.head.asInstanceOf[JsString].value)
      rows should contain theSameElementsAs Vector("alice", "bob", "carol")
    }
  }

  "a dry run and a preview" should {
    "leave the target dataset unchanged (3.5)" in {
      val sourceId = seedSourceDs(Vector(Vector("carol")))
      val targetId = seedTargetDs(Vector("name" -> "string"), rows = Vector(Vector("alice")))
      val pid      = seedPipeline(sourceId)
      insertUpsertStep(pid, UpsertTarget.ExistingSource(targetId))

      await(service.submit(pid, isDry = true, dummyUser)) shouldBe a[Right[_, _]]

      targetRows(targetId) should have size 1
    }
  }

  "validation" should {
    "fail the run when upstream rows carry a column the target hasn't declared (3.6)" in {
      val sourceId = seedSourceDs(Vector(Vector("carol")))
      // Target declares no columns at all -- source's "name" column is therefore undeclared.
      val targetId = seedTargetDs(Vector.empty)
      val pid      = seedPipeline(sourceId)
      insertUpsertStep(pid, UpsertTarget.ExistingSource(targetId))

      val result = await(service.submit(pid, isDry = false, dummyUser))
      result shouldBe a[Left[_, _]]
      targetRows(targetId) shouldBe empty
      // skeptic-final-1.md non-blocking note: a write-back failure must leave the SAME
      // terminal bookkeeping as any other run failure -- persisted status and no node snapshot.
      lastRunStatus(pid) shouldBe Some("failed")
      nodeSnapshotCount(pid) shouldBe 0
    }
  }

  "a later-failing sibling step after an upsertsource step" should {
    "leave the target byte-identical -- the run fails, but the upsertsource step's own write never landed (3.5, CR3)" in {
      val sourceId = seedSourceDs(Vector(Vector("carol")))
      val targetId = seedTargetDs(Vector("name" -> "string"), rows = Vector(Vector("alice")))
      val pid      = seedPipeline(sourceId)
      insertUpsertStep(pid, UpsertTarget.ExistingSource(targetId))
      // A statically-unparseable compute expression (HEL-888) -- fails deterministically at
      // evaluation time, AFTER the upsertsource step has already evaluated (and deferred its
      // write into the sink) but before the run's Success branch (and therefore the
      // write-applying `onRunSuccess`) is ever reached.
      insertStep(pid, "compute", ComputeConfig("bad", "stats.adp_ppr - stats.pts_ppr", None))

      val result = await(service.submit(pid, isDry = false, dummyUser))
      result shouldBe a[Left[_, _]]

      targetRows(targetId).map(_.asInstanceOf[JsArray].elements.head.asInstanceOf[JsString].value) shouldBe Vector("alice")
      lastRunStatus(pid) shouldBe Some("failed")
      nodeSnapshotCount(pid) shouldBe 0
    }
  }

  "previewStep on an upsertsource step" should {
    "leave the target unchanged (3.5, CR3)" in {
      val sourceId = seedSourceDs(Vector(Vector("carol")))
      val targetId = seedTargetDs(Vector("name" -> "string"), rows = Vector(Vector("alice")))
      val pid      = seedPipeline(sourceId)
      val upsertStep = insertUpsertStep(pid, UpsertTarget.ExistingSource(targetId))

      val result = await(service.previewStep(pid, upsertStep.id.value, dummyUser))
      result shouldBe a[Right[_, _]]

      targetRows(targetId).map(_.asInstanceOf[JsArray].elements.head.asInstanceOf[JsString].value) shouldBe Vector("alice")
    }
  }

  "a new-source target" should {
    "create the dataset on first run and append to it on a second run (3.8)" in {
      val sourceId = seedSourceDs(Vector(Vector("carol")))
      val pid      = seedPipeline(sourceId)
      insertUpsertStep(pid, UpsertTarget.NewSource("brand-new-target"))

      val first = await(service.submit(pid, isDry = false, dummyUser))
      first shouldBe a[Right[_, _]]

      val steps = await(stepRepo.listByPipelineInternal(pid))
      val rewritten = steps.collectFirst { case s if s.kind == "upsertsource" => s }.get
      val rewrittenConfig = rewritten.configValue.asInstanceOf[UpsertSourceConfig]
      rewrittenConfig.target shouldBe a[UpsertTarget.ExistingSource]
      val newId = rewrittenConfig.target.asInstanceOf[UpsertTarget.ExistingSource].dataSourceId
      targetName(newId) shouldBe "brand-new-target"
      targetRows(newId) should have size 1

      val second = await(service.submit(pid, isDry = false, dummyUser))
      second shouldBe a[Right[_, _]]
      targetRows(newId) should have size 2
    }

    "be a no-op when the source produces zero rows (3.8)" in {
      val sourceId = seedSourceDs(Vector.empty)
      val pid      = seedPipeline(sourceId)
      insertUpsertStep(pid, UpsertTarget.NewSource("never-created"))

      val result = await(service.submit(pid, isDry = false, dummyUser))
      result shouldBe a[Right[_, _]]

      import PostgresProfile.api._
      val count = await(db.run(sql"SELECT count(*) FROM data_sources WHERE name = 'never-created'".as[Int].head))
      count shouldBe 0
    }
  }

  "a 'replace' upsertsource step" should {
    "clear the target when the source produces zero rows (3.8a)" in {
      val sourceId = seedSourceDs(Vector.empty)
      val targetId = seedTargetDs(Vector("name" -> "string"), rows = Vector(Vector("alice"), Vector("bob")))
      val pid      = seedPipeline(sourceId)
      insertUpsertStep(pid, UpsertTarget.ExistingSource(targetId), mode = UpsertMode.Replace)

      val result = await(service.submit(pid, isDry = false, dummyUser))
      result shouldBe a[Right[_, _]]
      targetRows(targetId) shouldBe empty
    }

    "fully replace existing rows with the new set" in {
      val sourceId = seedSourceDs(Vector(Vector("carol"), Vector("dave")))
      val targetId = seedTargetDs(Vector("name" -> "string"), rows = Vector(Vector("alice"), Vector("bob")))
      val pid      = seedPipeline(sourceId)
      insertUpsertStep(pid, UpsertTarget.ExistingSource(targetId), mode = UpsertMode.Replace)

      val result = await(service.submit(pid, isDry = false, dummyUser))
      result shouldBe a[Right[_, _]]

      val rows = targetRows(targetId).map(_.asInstanceOf[JsArray].elements.head.asInstanceOf[JsString].value)
      rows should contain theSameElementsAs Vector("carol", "dave")
    }
  }

  "two upsertsource steps targeting the same dataset in one run" should {
    "apply in walk (trunk) order -- first step's append lands before second step's (3.8a)" in {
      val sourceId = seedSourceDs(Vector(Vector("carol")))
      val targetId = seedTargetDs(Vector("name" -> "string"), rows = Vector(Vector("alice")))
      val pid      = seedPipeline(sourceId)
      // Step 1 (trunk position 0): appends the source's row ("carol").
      insertUpsertStep(pid, UpsertTarget.ExistingSource(targetId))
      // Step 2 (trunk position 1, chained onto step 1 by insertUpsertStep's own trunk-last
      // anchor): REPLACES the target -- if step 1's write had not already landed before step 2
      // evaluates/applies, step 2's replace would see (and preserve) only the ORIGINAL
      // "alice" row, not "carol". Walk order requires step 2 to overwrite with exactly what
      // step 1 already wrote.
      insertUpsertStep(pid, UpsertTarget.ExistingSource(targetId), mode = UpsertMode.Replace)

      val result = await(service.submit(pid, isDry = false, dummyUser))
      result shouldBe a[Right[_, _]]

      // Both steps see the SAME input rows (upsertsource is pass-through, D8) -- step 2's
      // replace therefore writes ["carol"] again, but critically the FINAL state must be
      // step 2's replace applied AFTER step 1's append committed, not interleaved/racing --
      // proven by the target ending at exactly one "carol" row (step 1's append then step 2's
      // replace-with-the-same-input), never two (which would mean step 2 replaced BEFORE step
      // 1's append, then step 1 re-appended afterward -- the reversed order).
      val rows = targetRows(targetId).map(_.asInstanceOf[JsArray].elements.head.asInstanceOf[JsString].value)
      rows shouldBe Vector("carol")
    }
  }
}
