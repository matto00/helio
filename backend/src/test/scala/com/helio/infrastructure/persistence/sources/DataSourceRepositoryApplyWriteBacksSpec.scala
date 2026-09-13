package com.helio.infrastructure.persistence.sources

import com.helio.domain.model._
import com.helio.domain.steps.{UpsertMode, UpsertSourceConfig, UpsertTarget}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.pipelines.PipelineStepRepository
import com.helio.testsupport.DatasetRowsTestSupport
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

/** HEL-1100 tasks 3.3/3.4/3.10: atomicity coverage for `DataSourceRepository.applyWriteBacks`
 *  against a REAL Postgres instance -- both properties are database-transaction guarantees
 *  that cannot be asserted from reading the code, only observed. */
class DataSourceRepositoryApplyWriteBacksSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres   = _
  private var db: JdbcBackend.Database             = _
  private var ctx: DbContext                       = _
  private var dataSourceRepo: DataSourceRepository = _
  private var stepRepo: PipelineStepRepository     = _

  private val owner = AuthenticatedUser(UserId("00000000-0000-0000-0000-000000000001"))

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load().migrate()
    db             = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    ctx            = new DbContext(db, db)
    dataSourceRepo = new DataSourceRepository(ctx)
    stepRepo       = new PipelineStepRepository(ctx)
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 30.seconds)

  private def seedTargetDs(rows: Int): String = {
    import PostgresProfile.api._
    val dsId    = UUID.randomUUID().toString
    val columns = """[{"name":"name","type":"string"}]"""
    val payload = s"""{"columns":$columns,"rows":${(1 to rows).map(i => s"""["row-$i"]""").mkString("[", ",", "]")}}"""
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($dsId, 'ds-target', 'dataset', '{}', '00000000-0000-0000-0000-000000000001', now(), now())""",
      DatasetRowsTestSupport.seedActionsFromRaw(dsId, payload)
    )))
    dsId
  }

  private def rowCount(dsId: String): Int = {
    import PostgresProfile.api._
    Await.result(db.run(sql"SELECT count(*) FROM dataset_rows WHERE data_source_id = $dsId".as[Int].head), 5.seconds)
  }

  /** HEL-1100 skeptic-final-1.md CR4: reads the FULL set of `name` values currently persisted
   *  for `dsId`, not just a count -- `rowCount == 0 < n < 300` would already have caught a
   *  literally-empty mid-swap window, but a half-written state where SOME old rows and SOME
   *  new rows coexist (same size as either "pure" set, or not) would not. Reading the actual
   *  values is what makes "exactly the old set XOR exactly the new set, never a mix" checkable. */
  private def targetNames(dsId: String): Set[String] = {
    import PostgresProfile.api._
    val rows = await(db.run(sql"SELECT data FROM dataset_rows WHERE data_source_id = $dsId".as[String]))
    rows.map(json => json.parseJson.asInstanceOf[JsArray].elements.head.asInstanceOf[JsString].value).toSet
  }

  "applyWriteBacks replace" should {
    "never let a concurrent reader observe an empty, half-written, or mixed-old/new dataset mid-swap (3.3, CR4)" in {
      val existingRowCount = 400
      val newRowCount      = 300
      val targetId = seedTargetDs(existingRowCount)
      val oldNames = (1 to existingRowCount).map(i => s"row-$i").toSet
      val newNames = (1 to newRowCount).map(i => s"new-$i").toSet
      val newRows: Seq[Map[String, Any]] = (1 to newRowCount).map(i => Map("name" -> s"new-$i"))
      val write = PendingWrite("step-1", UpsertSourceConfig(UpsertTarget.ExistingSource(targetId), UpsertMode.Replace), newRows)

      // Concurrent reader loop on a SEPARATE connection (a separate `db.run` per iteration, not
      // reusing a session/transaction) -- a real, independent `SELECT` each time, exactly the
      // design.md Risks note's "single SELECT of the rows on a separate connection per
      // iteration" requirement. Every observed set is classified: exactly the OLD set, exactly
      // the NEW set, or NEITHER (a genuine half-written/mixed state) -- a mix of read counts
      // alone (the pre-CR4 version of this test) cannot distinguish "0 rows" from "200 old + 100
      // new" if the sizes happened to coincide; reading the actual VALUES can.
      @volatile var invalidReads      = 0
      // Every read taken while `keepPolling` is true happens strictly BEFORE the write's own
      // `await` below returns -- i.e. strictly during `applyWriteBacks`'s call, which for this
      // replace write IS the transaction's own lifetime (lock -> delete -> insert -> commit, all
      // inside one `ctx.withUserContext(...).transactionally`). So every count in this loop is,
      // by construction, a read that overlapped the write actually being in flight -- not merely
      // "a read that happened at some point in the test."
      @volatile var overlappingReads = 0
      @volatile var keepPolling      = true
      val pollFuture = Future {
        while (keepPolling) {
          val observed = targetNames(targetId)
          overlappingReads += 1
          if (observed != oldNames && observed != newNames) invalidReads += 1
        }
      }

      val result = await(dataSourceRepo.applyWriteBacks(owner, Vector(write), stepRepo, maxRows = 10000))
      keepPolling = false
      Await.result(pollFuture, 5.seconds)

      result shouldBe Right(())
      // The critical assertion this test exists to make: every single observed read, across the
      // WHOLE polling window (which genuinely overlapped the write -- see below), was exactly
      // one of the two valid sets. Zero tolerance for "neither."
      withClue(s"$invalidReads of $overlappingReads reads observed neither the old nor the new set: ") {
        invalidReads shouldBe 0
      }
      // Proves the polling loop actually raced the write, rather than trivially passing because
      // it happened to run entirely before or after it (a fast enough machine could otherwise
      // make this test pass vacuously). 400+300 rows is sized to make at least one read land
      // during the transaction's open window in practice; a suspiciously low count here would
      // itself be a signal this bound needs revisiting.
      withClue(s"only $overlappingReads reads overlapped the write -- the polling loop may not have genuinely raced it: ") {
        overlappingReads should be > 0
      }
      targetNames(targetId) shouldBe newNames
    }
  }

  "applyWriteBacks" should {
    "fail the WHOLE batch atomically -- an earlier, otherwise-valid write commits nothing when a later write in the same batch fails (3.4)" in {
      val goodTargetId = seedTargetDs(rows = 0)
      val badTargetId  = seedTargetDs(rows = 0) // declares only "name" -- an undeclared "extra" column will fail it

      val goodWrite = PendingWrite("step-1", UpsertSourceConfig(UpsertTarget.ExistingSource(goodTargetId), UpsertMode.Append), Seq(Map("name" -> "ok")))
      val badWrite  = PendingWrite("step-2", UpsertSourceConfig(UpsertTarget.ExistingSource(badTargetId), UpsertMode.Append), Seq(Map("name" -> "ok", "extra" -> "boom")))

      val result = await(dataSourceRepo.applyWriteBacks(owner, Vector(goodWrite, badWrite), stepRepo, maxRows = 10000))

      result shouldBe a[Left[_, _]]
      // The critical assertion: the FIRST write's rows never persisted, even though it was
      // individually valid and evaluated before the failing second write -- the whole batch is
      // one transaction (design.md Decision 4).
      rowCount(goodTargetId) shouldBe 0
      rowCount(badTargetId) shouldBe 0
    }
  }

  // HEL-1100 evaluation-1.md CR3: a genuine concurrent race, not two sequential calls -- both
  // Futures are STARTED before either is awaited, so they actually overlap in real wall-clock
  // time against the real Postgres instance.
  private def seedNewSourceStep(name: String): PipelineStepId = {
    import PostgresProfile.api._
    val pid       = UUID.randomUUID().toString
    val sourceDs  = seedTargetDs(rows = 0)
    val stepId    = UUID.randomUUID().toString
    val configJson = s"""{"target":{"kind":"newSource","name":"$name"},"mode":"append"}"""
    await(db.run(DBIO.seq(
      sqlu"""INSERT INTO pipelines (id, name, owner_id, created_at, updated_at)
             VALUES ($pid, 'race-pipe', '00000000-0000-0000-0000-000000000001', now(), now())""",
      sqlu"""INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position)
             VALUES ($pid, $pid, $sourceDs, 0)""",
      sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, created_at, updated_at, root_id)
             VALUES ($stepId, $pid, 0, 'upsertsource', $configJson::text, now(), now(), $pid)"""
    )))
    PipelineStepId(stepId)
  }

  private def currentStepConfig(stepId: PipelineStepId): String = {
    import PostgresProfile.api._
    await(db.run(sql"SELECT config FROM pipeline_steps WHERE id = ${stepId.value}".as[String].head))
  }

  "applyWriteBacks new-source path (D7 CAS)" should {
    "serialize two runs racing to create the SAME new-source dataset to exactly one created dataset (3.8, CR3)" in {
      val stepId = seedNewSourceStep("race-target")
      val evaluatedConfig = UpsertSourceConfig(UpsertTarget.NewSource("race-target"), UpsertMode.Append)
      val write1 = PendingWrite(stepId.value, evaluatedConfig, Seq(Map("name" -> "from-run-1")))
      val write2 = PendingWrite(stepId.value, evaluatedConfig, Seq(Map("name" -> "from-run-2")))

      // Both started before either is awaited -- genuinely concurrent against the SAME step row.
      val fut1 = dataSourceRepo.applyWriteBacks(owner, Vector(write1), stepRepo, maxRows = 10000)
      val fut2 = dataSourceRepo.applyWriteBacks(owner, Vector(write2), stepRepo, maxRows = 10000)
      val (result1, result2) = (await(fut1), await(fut2))

      // The step-row `FOR UPDATE` lock serializes the two transactions: whichever commits
      // first wins the "create" branch and rewrites the step to `ExistingSource(newId)`;
      // whichever commits second re-reads the NOW-rewritten step, sees the name already
      // matches, and writes into that SAME dataset instead of creating a second one (D7's
      // reuse branch) -- both succeed, but only one dataset is ever created.
      Vector(result1, result2).foreach(_ shouldBe Right(()))

      import PostgresProfile.api._
      val createdCount = await(db.run(sql"SELECT count(*) FROM data_sources WHERE name = 'race-target'".as[Int].head))
      createdCount shouldBe 1

      val newId = await(db.run(sql"SELECT id FROM data_sources WHERE name = 'race-target'".as[String].head))
      rowCount(newId) shouldBe 2 // one row from each racing write, both landed in the ONE dataset

      // The step itself was rewritten to ExistingSource(newId) exactly once (not left dangling
      // or double-rewritten to a different id by the loser).
      val finalConfig = currentStepConfig(stepId).parseJson.asJsObject
      finalConfig.fields("target").asJsObject.fields("dataSourceId") shouldBe JsString(newId)
    }

    "fail the run, with nothing committed, when the step's config changed mid-run (3.8)" in {
      import PostgresProfile.api._
      val stepId = seedNewSourceStep("mid-run-original")
      // Simulate a user editing the step's target AFTER the engine evaluated it (captured into
      // `evaluatedConfig`, per design.md D2) but BEFORE `applyWriteBacks` runs -- the persisted
      // row now names a DIFFERENT new-source name than what was evaluated.
      await(db.run(sqlu"""UPDATE pipeline_steps SET config = '{"target":{"kind":"newSource","name":"mid-run-edited"},"mode":"append"}'::text WHERE id = ${stepId.value}"""))

      val evaluatedConfig = UpsertSourceConfig(UpsertTarget.NewSource("mid-run-original"), UpsertMode.Append)
      val write = PendingWrite(stepId.value, evaluatedConfig, Seq(Map("name" -> "should-not-land")))

      val result = await(dataSourceRepo.applyWriteBacks(owner, Vector(write), stepRepo, maxRows = 10000))

      result shouldBe a[Left[_, _]]
      result.left.toOption.get should include("configuration changed during the run")

      import PostgresProfile.api._
      // Nothing committed: no dataset named after either the evaluated or the edited name.
      await(db.run(sql"SELECT count(*) FROM data_sources WHERE name IN ('mid-run-original', 'mid-run-edited')".as[Int].head)) shouldBe 0
      // The user's edit is KEPT (never overwritten by the failed run).
      val keptConfig = currentStepConfig(stepId).parseJson.asJsObject
      keptConfig.fields("target").asJsObject.fields("name") shouldBe JsString("mid-run-edited")
    }
  }
}
