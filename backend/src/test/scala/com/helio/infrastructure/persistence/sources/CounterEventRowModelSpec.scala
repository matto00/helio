package com.helio.infrastructure.persistence.sources

import com.helio.domain.engine.DatasetRowValidator
import com.helio.domain.model.{AuditSource, AuthenticatedUser, DataFieldType, DataSourceId, DatasetFieldDeclaration, UserId}
import com.helio.domain.panels.{FormFieldSpec, FormPanelConfig, FormSubmission, FormSubmitSpec}
import com.helio.infrastructure.persistence.DbContext
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.apache.pekko.actor.ActorSystem
import org.flywaydb.core.Flyway
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1089 tasks.md 2.1-2.5/2.7: repository-level coverage for the counter event-row model's
 *  core AC — append-not-mutate, rapid/concurrent submissions never coalesced, same-millisecond
 *  ordering via `seq`, and the running total's independence from any stored `value` cell — all
 *  exercised against a real, locked `DataSourceRepository.appendBuiltRow` and a real
 *  `EmbeddedPostgres`, never a hand-rolled simulation of the lock. Domain-layer rules for
 *  `FormSubmission.buildRow`/`FormSchemaConsistency.check` themselves are covered exhaustively by
 *  `FormSubmissionSpec`/`FormSchemaConsistencySpec`; `FormSubmitRoutesSpec` covers the HTTP-level
 *  counter submit path (task 2.6, no UI chrome to drive an e2e test through yet — HEL-1088). */
class CounterEventRowModelSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val system: ActorSystem   = ActorSystem("counter-event-row-model-spec")
  private implicit val ec: ExecutionContext  = system.dispatcher

  private var embeddedPostgres: EmbeddedPostgres = _
  private var db: JdbcBackend.Database           = _
  private var ctx: DbContext                     = _
  private var repo: DataSourceRepository         = _

  private val ownerId = UUID.randomUUID().toString
  private val owner   = AuthenticatedUser(UserId(ownerId), AuditSource.Ui, None)

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
    Flyway.configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration").load().migrate()
    db   = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(10))
    ctx  = new DbContext(db, db)(ec)
    repo = new DataSourceRepository(ctx)(ec)

    await(ctx.withSystemContext(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($ownerId::uuid, 'counter-owner@helio.test', now())"""
    ))
  }

  override def afterAll(): Unit = {
    db.close(); embeddedPostgres.close(); system.terminate()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 20.seconds)

  private val counterSchemaJson =
    """[{"name":"delta","type":"integer","required":true},
      | {"name":"occurred_at","type":"timestamp","required":true},
      | {"name":"value","type":"integer","required":false}]"""
      .stripMargin.replaceAll("\n", "")

  private def seedCounterDataset(name: String): DataSourceId = {
    val id = UUID.randomUUID().toString
    await(ctx.withSystemContext(
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at, dataset_schema)
             VALUES ($id::uuid, $name, 'dataset', '{}'::jsonb, ${ownerId}::uuid, now(), now(), $counterSchemaJson::jsonb)"""
    ))
    DataSourceId(id)
  }

  private val counterConfig = FormPanelConfig(
    DataSourceId("unused"),
    Vector(FormFieldSpec("delta", "counter")),
    FormSubmitSpec.Default
  )

  /** `build` closure identical in shape to `PanelService.submitForm`'s own — the real,
   *  unmodified `FormSubmission.buildRow`, run through the real `appendBuiltRow` lock. */
  private def counterBuild(delta: Int): (Vector[DatasetFieldDeclaration], Instant) => Either[Vector[DatasetRowValidator.FieldError], Vector[JsValue]] =
    (declaration, now) => FormSubmission.buildRow(counterConfig, declaration, Map("delta" -> JsNumber(delta)), now)

  private def submitDelta(id: DataSourceId, delta: Int): Future[Either[DataSourceRepository.FormRowBuildFailure, Unit]] =
    repo.appendBuiltRow(id, counterBuild(delta), maxRows = 10000, updatedAt = Instant.now(), user = owner).map {
      case None                  => throw new IllegalStateException("data source not found")
      case Some(Left(failure))   => Left(failure)
      case Some(Right(_))        => Right(())
    }

  private def rows(id: DataSourceId): Seq[(String, Long, String, Instant)] =
    await(ctx.withSystemContext(
      sql"""SELECT id, seq, data, updated_at FROM dataset_rows WHERE data_source_id = ${id.value} ORDER BY seq"""
        .as[(String, Long, String, java.sql.Timestamp)]
    )).map { case (rid, seq, data, ts) => (rid, seq, data, ts.toInstant) }

  "counter event-row model — append not mutate" should {
    "produce exactly one row per submission across a mixed +/- sequence, none of the earlier rows changed" in {
      val id = seedCounterDataset("seq-src")
      Seq(1, 1, -1, 1, -1).foreach(d => await(submitDelta(id, d)) shouldBe Right(()))

      val before = rows(id)
      before.size shouldBe 5

      await(submitDelta(id, 1)) shouldBe Right(())
      val after = rows(id)
      after.size shouldBe 6

      // Every earlier row's id, seq AND byte-for-byte `data` payload is untouched — a pure
      // INSERT, never a read-modify-write.
      before.zip(after.take(5)).foreach { case ((idB, seqB, dataB, _), (idA, seqA, dataA, _)) =>
        idA shouldBe idB
        seqA shouldBe seqB
        dataA shouldBe dataB
      }
    }
  }

  "counter event-row model — rapid/concurrent submissions" should {
    "never coalesce N concurrent submissions into fewer than N rows with N distinct seq values" in {
      val id = seedCounterDataset("concurrent-src")
      val n  = 20

      // C7: manually verified red — with `appendBuiltRowAction`'s `lockSource(id)` call
      // replaced by a no-op (`DBIO.successful(())`), running this exact test against real
      // EmbeddedPostgres produced `org.postgresql.util.PSQLException: duplicate key value
      // violates unique constraint "dataset_rows_data_source_id_seq_key"` — concurrent
      // transactions raced `maxExistingSeq`, computed the same next `seq`, and the DB's own
      // `UNIQUE (data_source_id, seq)` constraint (V106) caught the collision as an exception
      // rather than a silent coalesce. `results.foreach(_ shouldBe Right(()))` below fails on
      // that `Future` failure, so this test is not vacuously green: it fails loudly whichever
      // way the lock is skipped. The lock is restored (unmodified) for this run.
      val results = await(Future.sequence((1 to n).map(i => submitDelta(id, i))))
      results.foreach(_ shouldBe Right(()))

      val persisted = rows(id)
      persisted.size shouldBe n
      persisted.map(_._2).distinct.size shouldBe n
    }
  }

  "counter event-row model — millisecond-collision ordering" should {
    "keep two same-millisecond events distinguishable and correctly ordered via seq" in {
      val id = seedCounterDataset("collision-src")
      val frozen = Instant.parse("2026-09-18T12:00:00.500Z")

      // Both submissions force the SAME `now` — a real millisecond collision — through the same
      // `FormSubmission.buildRow` call the production path uses, so only `seq` (assigned inside
      // the same lock as the insert) can distinguish and order them.
      def buildAt(delta: Int): (Vector[DatasetFieldDeclaration], Instant) => Either[Vector[DatasetRowValidator.FieldError], Vector[JsValue]] =
        (declaration, _) => FormSubmission.buildRow(counterConfig, declaration, Map("delta" -> JsNumber(delta)), frozen)

      await(repo.appendBuiltRow(id, buildAt(1), 10000, Instant.now(), owner))
      await(repo.appendBuiltRow(id, buildAt(2), 10000, Instant.now(), owner))

      val persisted = rows(id).map { case (_, seq, data, _) =>
        val cells = data.parseJson.asInstanceOf[JsArray].elements
        (seq, cells.head, cells(1))
      }
      persisted.size shouldBe 2
      // Both rows' stored `occurred_at` is the SAME frozen instant.
      persisted.forall(_._3 == JsString(frozen.toString)) shouldBe true
      // Yet `seq` differs and reproduces submission order — sorted by (occurred_at, seq) equals
      // sorted by seq alone here since occurred_at ties.
      val sortedBySeq = persisted.sortBy(_._1)
      sortedBySeq.map(_._2) shouldBe Vector(JsNumber(1), JsNumber(2))
    }
  }

  "counter event-row model — running total is pipeline-derivable, never stored authoritative state" should {
    "reproduce the true running total via a real aggregate/sum step over delta, independent of stored value" in {
      import com.helio.domain.engine.InProcessPipelineEngine
      import com.helio.domain.steps.{AggregateStep, AggregateConfig}
      import com.helio.api.protocols.pipelines.PipelineStepConfigCodec
      import com.helio.domain.model.{PipelineId, PipelineStepId}
      import com.helio.infrastructure.storage.LocalFileSystem

      val id = seedCounterDataset("aggregate-src")
      // Deltas +1, +1, -1, +1, -1 => true running total = 1. One row's `value` is absent, one
      // carries a deliberately WRONG stored snapshot — the aggregate must ignore `value` entirely.
      val builds: Seq[(Vector[DatasetFieldDeclaration], Instant) => Either[Vector[DatasetRowValidator.FieldError], Vector[JsValue]]] = Seq(
        (d, now) => FormSubmission.buildRow(counterConfig, d, Map("delta" -> JsNumber(1)), now),
        (d, now) => FormSubmission.buildRow(counterConfig, d, Map("delta" -> JsNumber(1), "value" -> JsNumber(999)), now),
        (d, now) => FormSubmission.buildRow(counterConfig, d, Map("delta" -> JsNumber(-1)), now),
        (d, now) => FormSubmission.buildRow(counterConfig, d, Map("delta" -> JsNumber(1)), now),
        (d, now) => FormSubmission.buildRow(counterConfig, d, Map("delta" -> JsNumber(-1)), now)
      )
      builds.foreach(b => await(repo.appendBuiltRow(id, b, 10000, Instant.now(), owner)))

      val declaration = Vector(
        DatasetFieldDeclaration("delta", DataFieldType.IntegerType, required = true),
        DatasetFieldDeclaration("occurred_at", DataFieldType.TimestampType, required = true),
        DatasetFieldDeclaration("value", DataFieldType.IntegerType, required = false)
      )
      val engineRows: Seq[Map[String, Any]] = rows(id).map { case (_, _, data, _) =>
        val cells = data.parseJson.asInstanceOf[JsArray].elements
        declaration.zip(cells).map { case (field, cell) =>
          field.name -> (cell match {
            case JsNumber(n) => n.toDouble
            case JsString(s) => s
            case JsNull       => null
            case other        => other
          })
        }.toMap
      }

      val fileSystem = new LocalFileSystem(java.nio.file.Paths.get("/"))
      val engine     = new InProcessPipelineEngine(fileSystem)
      val cfg        = PipelineStepConfigCodec.decode(
        "aggregate",
        """{ "groupBy": [], "aggregations": [{"alias":"total","fn":"sum","field":"delta"}] }"""
      ).get.asInstanceOf[AggregateConfig]
      val step = AggregateStep(PipelineStepId("agg"), PipelineId("pipe"), 0, cfg, Instant.now(), Instant.now())

      val result = await(engine.execute(engineRows, Seq(step), null))
      result should have size 1
      result.head("total") shouldBe 1.0 // 1 + 1 - 1 + 1 - 1, independent of any stored `value`
    }

    "render a time-series Output ordered by (occurred_at, seq) with one point per submitted event, in submission order" in {
      import com.helio.domain.engine.InProcessPipelineEngine
      import com.helio.domain.steps.{SortStep, SortConfig}
      import com.helio.api.protocols.pipelines.PipelineStepConfigCodec
      import com.helio.domain.model.{PipelineId, PipelineStepId}
      import com.helio.infrastructure.storage.LocalFileSystem

      val id = seedCounterDataset("output-src")
      Seq(1, 1, -1, 1, -1).foreach(d => await(submitDelta(id, d)))

      val declaration = Vector(
        DatasetFieldDeclaration("delta", DataFieldType.IntegerType, required = true),
        DatasetFieldDeclaration("occurred_at", DataFieldType.TimestampType, required = true),
        DatasetFieldDeclaration("value", DataFieldType.IntegerType, required = false)
      )
      val persisted = rows(id) // already ORDER BY seq — submission order
      val engineRows: Seq[Map[String, Any]] = persisted.zipWithIndex.map { case ((_, seq, data, _), _) =>
        val cells = declaration.zip(data.parseJson.asInstanceOf[JsArray].elements)
        cells.map { case (field, cell) =>
          field.name -> (cell match {
            case JsNumber(n) => n.toDouble
            case JsString(s) => s
            case JsNull       => null
            case other        => other
          })
        }.toMap ++ Map("seq" -> seq.toDouble)
      }

      val fileSystem = new LocalFileSystem(java.nio.file.Paths.get("/"))
      val engine     = new InProcessPipelineEngine(fileSystem)
      val cfg = PipelineStepConfigCodec.decode(
        "sort",
        """{ "sortBy": [{"field":"occurred_at","direction":"asc"},{"field":"seq","direction":"asc"}] }"""
      ).get.asInstanceOf[SortConfig]
      val step = SortStep(PipelineStepId("sort"), PipelineId("pipe"), 0, cfg, Instant.now(), Instant.now())

      val result = await(engine.execute(engineRows, Seq(step), null))
      result.map(_("delta")) shouldBe Seq(1.0, 1.0, -1.0, 1.0, -1.0)
    }
  }
}
