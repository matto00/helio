package com.helio.services.pipelines

import com.helio.domain.engine.PipelineCostEstimator
import com.helio.domain.model._
import com.helio.domain.steps.{AnalyzeWithAiConfig, AnalyzeWithAiOutputField, UpsertMode, UpsertSourceConfig, UpsertTarget}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.{PipelineAutoRunDebounceRepository, PipelineRepository, PipelineRootRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.testsupport.DatasetRowsTestSupport
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

/** HEL-1093 tasks.md 2.1/3.1/3.8/3.10 -- `AutoRunTriggerService.triggerAutoRun`'s eligibility
 *  evaluation: an eligible (cheap-verdict) pipeline gets a debounce row scheduled, a denied one
 *  does not (with the denial reason logged, not silently dropped), a pipeline's own write-back
 *  step never itself schedules a further auto-run (mechanically excluded -- it never reaches this
 *  class at all, since `DataSourceRepository.applyWriteBacks` is a distinct code path from every
 *  `DataSourceService` row-mutation method), and a multi-root pipeline with roots owned by
 *  DIFFERENT users is still correctly evaluated (design.md Decision 2a -- the design-gate round 1
 *  fix: privileged `findByIdInternal` root resolution, never the writer-scoped `findByIdOwned` the
 *  original plan would have reused). */
class AutoRunTriggerServiceSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var ctx: DbContext                     = _
  private var dataSourceRepo: DataSourceRepository = _
  private var pipelineRepo: PipelineRepository       = _
  private var pipelineStepRepo: PipelineStepRepository = _
  private var pipelineRootRepo: PipelineRootRepository = _
  private var debounceRepo: PipelineAutoRunDebounceRepository = _
  private var service: AutoRunTriggerService = _

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db   = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    ctx  = new DbContext(db, db)
    dataSourceRepo   = new DataSourceRepository(ctx)
    pipelineStepRepo = new PipelineStepRepository(ctx)
    pipelineRepo      = new PipelineRepository(ctx, dataSourceRepo)
    pipelineRootRepo  = new PipelineRootRepository(ctx)
    debounceRepo      = new PipelineAutoRunDebounceRepository(ctx)
    service = new AutoRunTriggerService(pipelineRootRepo, pipelineRepo, pipelineStepRepo, dataSourceRepo, debounceRepo)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 15.seconds)

  private def cleanDb(): Unit = {
    // HEL-913 (V99): deleting `pipeline_roots` directly while a pipeline row still exists trips
    // the zero-root guard trigger -- delete `pipelines` FIRST, which CASCADEs to
    // `pipeline_roots`/`pipeline_steps`/`pipeline_auto_run_debounce` (V110) on its own.
    import PostgresProfile.api._
    await(db.run(DBIO.seq(
      sqlu"DELETE FROM pipelines",
      sqlu"DELETE FROM dataset_rows",
      sqlu"DELETE FROM data_sources",
      sqlu"DELETE FROM users"
    )))
  }

  private def seedUser(id: String = UUID.randomUUID().toString): UserId = {
    import PostgresProfile.api._
    await(db.run(sqlu"""INSERT INTO users (id, email, created_at) VALUES ($id::uuid, ${s"$id@test.local"}, now())
                          ON CONFLICT DO NOTHING"""))
    UserId(id)
  }

  /** A cheap `dataset`-kind source with `rowCount` rows, owned by `owner`. */
  private def seedDataset(owner: UserId, rowCount: Int = 1): DataSourceId = {
    import PostgresProfile.api._
    val dsId = UUID.randomUUID().toString
    val payload = s"""{"columns":[{"name":"name","type":"string"}],"rows":${(1 to rowCount).map(i => s"""["r-$i"]""").mkString("[", ",", "]")}}"""
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($dsId, 'ds', 'dataset', '{}', ${owner.value}::uuid, now(), now())""",
      DatasetRowsTestSupport.seedActionsFromRaw(dsId, payload)
    )))
    DataSourceId(dsId)
  }

  /** A pipeline owned by `owner`, with one root per `rootDsIds` entry (position-ordered). */
  private def seedPipeline(owner: UserId, rootDsIds: Vector[DataSourceId]): PipelineId = {
    import PostgresProfile.api._
    val pid = UUID.randomUUID().toString
    val rootInserts = rootDsIds.zipWithIndex.map { case (dsId, idx) =>
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position)
             VALUES (${UUID.randomUUID().toString}, $pid, ${dsId.value}, $idx)"""
    }
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO pipelines (id, name, owner_id, created_at, updated_at) VALUES ($pid, 'pipe', ${owner.value}::uuid, now(), now())""",
      DBIO.seq(rootInserts: _*)
    )))
    PipelineId(pid)
  }

  private def seedAnalyzeWithAiStep(pipelineId: PipelineId): Unit = {
    val cfg = AnalyzeWithAiConfig("name", "go", Vector(AnalyzeWithAiOutputField("sentiment", "string")))
    await(pipelineStepRepo.insertInternal(pipelineId, "analyzewithai", cfg, enabled = true, parentStepId = None, explicitRootId = None))
  }

  private def debounceRowExists(pipelineId: PipelineId): Boolean = {
    import PostgresProfile.api._
    await(db.run(sql"""SELECT 1 FROM pipeline_auto_run_debounce WHERE pipeline_id = ${pipelineId.value}""".as[Int])).nonEmpty
  }

  "triggerAutoRun" should {

    "schedules a debounce row for an eligible (cheap) pipeline reading the written data source" in {
      cleanDb()
      val owner = seedUser()
      val dsId  = seedDataset(owner)
      val pid   = seedPipeline(owner, Vector(dsId))

      await(service.triggerAutoRun(dsId, Instant.now()))

      debounceRowExists(pid) shouldBe true
    }

    "does NOT schedule a debounce row for a pipeline denied by the cost verdict (an AI step), " +
      "while an eligible sibling pipeline reading the SAME data source DOES get one -- proving " +
      "this evaluation actually distinguishes denied from eligible, not merely never scheduling " +
      "anything (HEL-1093 tasks.md 3.1)" in {
      cleanDb()
      val owner = seedUser()
      val dsId  = seedDataset(owner)
      val deniedPid   = seedPipeline(owner, Vector(dsId))
      seedAnalyzeWithAiStep(deniedPid)
      val eligiblePid = seedPipeline(owner, Vector(dsId))

      await(service.triggerAutoRun(dsId, Instant.now()))

      debounceRowExists(deniedPid) shouldBe false
      debounceRowExists(eligiblePid) shouldBe true
    }

    "evaluates every pipeline reading the data source independently in one call" in {
      cleanDb()
      val owner = seedUser()
      val dsId  = seedDataset(owner)
      val pidA = seedPipeline(owner, Vector(dsId))
      val pidB = seedPipeline(owner, Vector(dsId))
      val pidC = seedPipeline(owner, Vector(dsId))

      await(service.triggerAutoRun(dsId, Instant.now()))

      debounceRowExists(pidA) shouldBe true
      debounceRowExists(pidB) shouldBe true
      debounceRowExists(pidC) shouldBe true
    }

    // HEL-1093 tasks.md 3.10 (design-gate round 1 fix, design.md Decision 2a): a pipeline with
    // two roots -- one owned by the writer, one owned by a DIFFERENT user -- must still be
    // evaluated as autoRunnable. The original ("verbatim reuse analyze's gathering") design
    // would have resolved the co-root via `findByIdOwned` scoped to the WRITER, which returns
    // `None` for a root the writer doesn't own -> `unclassified-source` -> wrongly denied. This
    // class has NO `AuthenticatedUser`/writer concept in its signature at all (by construction,
    // per Decision 2a's fix) -- `resolveRoot = dataSourceRepo.findByIdInternal` is privileged and
    // resolves every root regardless of ownership, so a regression back to a writer-scoped
    // resolver would make this test fail red.
    "a pipeline with roots owned by DIFFERENT users is still correctly evaluated as autoRunnable " +
      "when the write lands on one of them (multi-root, mixed-ownership; HEL-1093 tasks.md 3.10)" in {
      cleanDb()
      val writer      = seedUser()
      val otherOwner  = seedUser()
      val writerDsId  = seedDataset(writer)
      val otherDsId   = seedDataset(otherOwner)
      // The PIPELINE itself is owned by `writer` here -- what matters for 3.10 is that one of
      // its ROOTS (otherDsId) is a data source `writer` does NOT own, mirroring an editor
      // grantee's own source bound as a co-root (design.md Context).
      val pid = seedPipeline(writer, Vector(writerDsId, otherDsId))

      await(service.triggerAutoRun(writerDsId, Instant.now()))

      debounceRowExists(pid) shouldBe true
    }

    "a denial reason is available (logged), not silently dropped -- the estimator's own reasons " +
      "vector is non-empty for the denied pipeline (probed via PipelineCostEstimator directly, " +
      "the same classification this service calls)" in {
      // Not a DB assertion (log output isn't queryable) -- this documents/pins the CONTRACT this
      // service's logging depends on: `PipelineCostEstimator.estimate` never returns
      // `autoRunnable = false` with an empty `reasons` vector (CostVerdict's private constructor
      // makes that combination unconstructable), so the INFO log line this service emits on
      // denial always has real content to report.
      val verdict = PipelineCostEstimator.estimate(
        PipelineCostEstimator.CostInput(
          steps = Vector(PipelineCostEstimator.StepInput("s1", "analyzewithai")),
          roots = Vector(PipelineCostEstimator.RootCost("r1", Some("dataset"), hasSourceUrl = false, datasetRowCount = Some(1L))),
          lastRunRowCount = Some(1L)
        )
      )
      verdict.autoRunnable shouldBe false
      verdict.reasons should not be empty
    }
  }

  "the non-cascade property (HEL-1093 tasks.md 3.8)" should {

    "a pipeline's own write-back step (applyWriteBacks) does not itself schedule a debounce row " +
      "for any pipeline reading the written-to dataset -- mechanically excluded because " +
      "applyWriteBacks is a code path this service is never invoked from" in {
      cleanDb()
      val owner = seedUser()
      val writeBackTargetDsId = seedDataset(owner)
      // A downstream pipeline that reads the write-back TARGET -- if the non-cascade property
      // were violated, THIS pipeline would get a debounce row scheduled as a side effect of the
      // write-back below.
      val downstreamPid = seedPipeline(owner, Vector(writeBackTargetDsId))

      val write = PendingWrite(
        "step-1",
        UpsertSourceConfig(UpsertTarget.ExistingSource(writeBackTargetDsId.value), UpsertMode.Append),
        Seq(Map("name" -> "new-row"))
      )
      val result = await(dataSourceRepo.applyWriteBacks(AuthenticatedUser(owner), Vector(write), pipelineStepRepo, maxRows = 10000))
      result shouldBe a[Right[_, _]]

      debounceRowExists(downstreamPid) shouldBe false
    }
  }
}
