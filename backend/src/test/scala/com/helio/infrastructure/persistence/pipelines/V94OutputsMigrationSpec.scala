package com.helio.infrastructure.persistence.pipelines

import com.helio.domain._
import com.helio.domain.model._
import com.helio.infrastructure.persistence.DbContext
import com.zaxxer.hikari.{HikariConfig, HikariDataSource}
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.flywaydb.core.Flyway
import org.flywaydb.core.api.MigrationVersion
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.JdbcBackend
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.time.Instant
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt
import scala.io.Source

/** HEL-904 task 2.11/2.12/2.13 -- red-first proof for the FULL V94 migration
 *  (pipeline_steps.parent_step_id backfill, outputs/node_snapshots tables +
 *  RLS, panels.kind backfill, data_sources.inferred_schema default, the full
 *  9-step data migration (task 2.9), the destructive alert_rules/binary_refs
 *  retargets, and the final table/column drops (task 2.10)).
 *
 *  Cycle-3 rewrite (evaluation-2.md, per the human coordinator's explicit,
 *  non-negotiable ruling): the fixture is now a REAL `pg_dump --data-only`
 *  snapshot of the shared dev DB (V93, 2026-08-30) --
 *  `db/fixtures/hel904-real-dump.sql` -- loaded verbatim, REPLACING (not
 *  supplementing) the previous ~800-line hand-built fixture. That hand-built
 *  fixture, no matter how many rows were added to it after each review round,
 *  only ever covered the exact instance a reviewer had already named -- never
 *  the class of defects nobody had thought to check for yet, which is exactly
 *  how both the evaluation-1 (stranded panels) and evaluation-2 (markdown
 *  binding) defects got through two review cycles. Loading the real data once
 *  closes that whole class, rather than iterating hand-written cases forever.
 *
 *  Only two things are seeded ON TOP of the dump (never as a substitute for
 *  it): (1) two `alert_rules` rows, since the dev DB carries zero rows in
 *  that table today and task 2.9(f) has no real row to exercise otherwise;
 *  (2) a `resource_permissions` sharing-grant row for the RLS "granted
 *  non-owner" branch, which needs a deliberately-controlled grantee that the
 *  dump's ambient sharing state doesn't already guarantee one way or the
 *  other. Every other required shape (every panel kind, HEL-292 aggregation
 *  panels, a `metric_id` panel, data-bound `text` AND `markdown` panels, an
 *  unbound data panel, orphan output types, companion types, a computed
 *  field, a `binary_refs` row, invalid `fieldMapping` slots, and the 60-row
 *  stranded-panel shape) is already present in the real dump -- verified
 *  below, not assumed. */
class V94OutputsMigrationSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var superDb: JdbcBackend.Database      = _
  private var appDb: JdbcBackend.Database        = _
  private var privilegedDb: JdbcBackend.Database = _

  // ── Real ids, resolved by hand against the shared dev DB (2026-08-30) via
  //    `psql -d helio -U matt`, not invented. Each is annotated with the
  //    query used to find it so a future reader can re-derive it against a
  //    fresher dump. ──────────────────────────────────────────────────────

  // `select id, owner_id from users where id not in (...) limit 1` (any real
  // user distinct from the two below) -- used only as the RLS grantee.
  private val granteeId = "1ac099f7-4465-4a6d-acff-f52cf753dc3b"

  // A real user distinct from every other named id above -- used purely as
  // an "unrelated tenant" for the cross-tenant RLS denial assertions (`select
  // id from users where id not in (...) limit 1`).
  private val unrelatedUserId = "23925216-407a-47d7-8b62-848de81ec221"

  // A real pipeline whose `output_data_type_id` has real bound panels
  // (`select p.id, p.output_data_type_id, p.owner_id from pipelines p where
  // exists (select 1 from panels pnl where pnl.type_id = p.output_data_type_id
  // and pnl.type in (...)) limit 1`).
  private val alertPipelineId       = "0bc3b4af-403d-4147-92e3-66c23afb89fc"
  private val alertPipelineTypeId   = "b1730647-ab3e-40a6-8793-d87d8196ed79"
  private val alertPipelineOwnerId  = "d5710fad-da06-4d64-848d-433f3fb9e96e"

  // A real "orphan pipeline-output type" (task 2.9(d)'s actual meaning: a
  // pipeline DOES still claim this type as its `output_data_type_id`, but no
  // panel is bound to it) -- `select dt.id, p.id, p.owner_id from data_types
  // dt join pipelines p on p.output_data_type_id = dt.id where not exists
  // (select 1 from panels pnl where pnl.type_id = dt.id and (visual-kind or
  // data-bound text/markdown))`. Distinct from a data_type with NO owning
  // pipeline at all (that shape only feeds the stranded-panel-deletion path
  // and `orphan_data_types_no_pipeline_skipped`, never an orphan Output --
  // confirmed empirically this cycle after an initial wrong pick).
  private val orphanTypeId       = "e01eb9c6-ad56-48fc-8ac4-f9b09c62e496"
  private val orphanPipelineId   = "531e0c3c-9bb7-4720-82d9-3682d9f38382" // documents which pipeline claims orphanTypeId
  private val orphanOwnerId      = "9532cfcf-9882-45ba-8247-23706bc00113"

  // A real pipeline with many (20) steps -- used both for the RLS smoke test
  // (an arbitrary pipeline node is sufficient there) and the step-order-
  // preservation test (`select pipeline_id, count(*) from pipeline_steps
  // group by pipeline_id having count(*) >= 3 order by count(*) desc limit 3`).
  private val manyStepsPipelineId = "6ba5075b-2291-4508-881b-a517b1f300cf"

  // A real data-bound `markdown` panel whose `type_id` DOES resolve to a real
  // pipeline -- the exact shape evaluation-2.md found silently stripped of
  // its binding (`select pnl.id, pnl.type_id, (select p.id from pipelines p
  // where p.output_data_type_id = pnl.type_id) from panels pnl where
  // pnl.type = 'markdown' and pnl.type_id is not null`).
  private val markdownBoundPanelId = "2664cda2-43d6-46b8-9113-7e5ad7fa9e35"

  // A real chart panel whose fieldMapping carries slots outside chart's valid
  // set (`xAxis`/`yAxis`/`series`/`annotation`) -- `category` and `value` are
  // not chart slots (`select id, field_mapping from panels where type =
  // 'chart' and (field_mapping::jsonb ? 'category' or field_mapping::jsonb ?
  // 'value')`).
  private val invalidSlotChartPanelId = "0da8ed3a-2d6e-41f6-8aa5-c9a242b9fee4"

  // A real source with exactly ONE companion type bound to it (so the
  // 2.9(a) fold-into-inferred_schema assertion doesn't need to merge
  // multiple companion types' fields) -- `select dt.source_id, count(*) from
  // data_types dt where dt.source_id is not null and not exists (pipeline)
  // group by dt.source_id having count(*) = 1 limit 1`.
  private val singleCompanionSourceId = "18dc0d3b-ad44-48cd-bc1d-f066726fc0f1"

  override def beforeAll(): Unit = {
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()

    // ── Migrate only up to V93 (pre-V94) ────────────────────────────────────
    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .target(MigrationVersion.fromVersion("93"))
      .load()
      .migrate()

    superDb = JdbcBackend.Database.forDataSource(embeddedPostgres.getPostgresDatabase, Some(5))

    // Several earlier migrations (V10/V32/V41) seed a fixed-id baseline
    // system user (`00000000-...-0001`) into a fresh V93 schema -- the same
    // row also exists, real, in the dump (it IS the real dev DB's system
    // user). Truncate every table the dump is about to fully repopulate so
    // the dump becomes the sole source of truth for them, rather than
    // colliding with a migration-seeded duplicate PK.
    await(superDb.run(sqlu"""
      TRUNCATE TABLE users, data_sources, data_types, pipelines, pipeline_steps, panels,
        dashboards, metrics, binary_refs, data_type_rows, patch_set_applications
        RESTART IDENTITY CASCADE
    """))

    // ── Load the REAL pg_dump fixture verbatim via a raw JDBC connection.
    //    `--disable-triggers` in the dump wraps each table's INSERT block in
    //    ALTER TABLE ... DISABLE/ENABLE TRIGGER ALL, which also suspends FK
    //    enforcement (Postgres implements FKs via system triggers) -- so
    //    table load order within the dump doesn't need to be a topological
    //    sort. Executed as one big multi-statement batch via the pgjdbc
    //    simple-query protocol (no PL/pgSQL function bodies in this dump, so
    //    a bare `;`-split is safe for the driver to execute in one call). ──
    val dumpSql = {
      val src = Source.fromResource("db/fixtures/hel904-real-dump.sql")
      try src.mkString finally src.close()
    }
    val rawConn = embeddedPostgres.getPostgresDatabase.getConnection
    try {
      val stmt = rawConn.createStatement()
      try stmt.execute(dumpSql) finally stmt.close()
    } finally rawConn.close()

    // ── Seed ON TOP of the dump (never a substitute for it): the dev DB
    //    carries zero `alert_rules` rows, so task 2.9(f) has nothing real to
    //    exercise without this. ──────────────────────────────────────────
    await(superDb.run(DBIO.seq(
      sqlu"""INSERT INTO alert_rules (id, owner_id, target_data_type_id, metric, condition, name, severity)
             VALUES ('hel904-rule-real-bound', $alertPipelineOwnerId::uuid, $alertPipelineTypeId, 'value', '{}', 'real-bound', 'info')""",
      sqlu"""INSERT INTO alert_rules (id, owner_id, target_data_type_id, metric, condition, name, severity)
             VALUES ('hel904-rule-real-orphan', $orphanOwnerId::uuid, $orphanTypeId, 'value', '{}', 'real-orphan', 'info')"""
    )))

    // ── Capture pre-migration state needed by post-migration assertions --
    //    several source tables (data_types, data_type_rows, metrics,
    //    pipelines.output_data_type_id, panels' old columns) are DROPPED by
    //    this same migration file, so anything compared against them must be
    //    captured into Scala values now, before V94 runs. ─────────────────

    val panelsBefore: Vector[PanelBefore] = await(superDb.run(
      sql"""SELECT id, type, type_id, aggregation, metric_id, field_mapping FROM panels"""
        .as[(String, String, Option[String], Option[String], Option[String], Option[String])]
    )).map { case (id, t, tid, agg, mid, fm) => PanelBefore(id, t, tid, agg, mid, fm) }

    val totalPanelsBefore = panelsBefore.size

    val pipelineByOutputTypeId: Map[String, String] = await(superDb.run(
      sql"SELECT output_data_type_id, id FROM pipelines".as[(String, String)]
    )).toMap
    val pipelineOutputTypeIds: Set[String] = pipelineByOutputTypeId.keySet

    val visualKinds = Set("metric", "chart", "table", "collection", "timeline")
    def isBoundCandidate(p: PanelBefore): Boolean =
      visualKinds.contains(p.typ) || ((p.typ == "text" || p.typ == "markdown") && p.typeId.isDefined)
    val strandedCandidates: Vector[PanelBefore] =
      panelsBefore.filter(p => isBoundCandidate(p) && (p.typeId.isEmpty || !pipelineOutputTypeIds.contains(p.typeId.get)))
    val expectedStrandedCount = strandedCandidates.size

    // Per-pipeline "trunk-last step" as of the ORIGINAL (pre-V94) linear
    // `position` ordering -- mirrors `hel904_original_trunk_last` exactly,
    // since every pre-migration pipeline is a pure position-ordered chain.
    val stepsBefore: Vector[(String, String, Int)] = await(superDb.run(
      sql"SELECT id, pipeline_id, position FROM pipeline_steps".as[(String, String, Int)]
    ))
    val trunkLastByPipeline: Map[String, Option[String]] =
      stepsBefore.groupBy(_._2).map { case (pid, steps) => pid -> Some(steps.maxBy(_._3)._1) }

    val dataTypeRowsBefore: Vector[(String, Int, String)] = await(superDb.run(
      sql"SELECT data_type_id, row_index, data::text FROM data_type_rows".as[(String, Int, String)]
    ))

    val metricsBefore: Map[String, (String, String, Option[String])] = await(superDb.run(
      sql"SELECT id, measure_field, aggregation, format::text FROM metrics".as[(String, String, String, Option[String])]
    )).map { case (id, mf, agg, fmt) => id -> (mf, agg, fmt) }.toMap

    val companionFieldsBefore: String = await(superDb.run(
      sql"""SELECT fields::text FROM data_types WHERE source_id = $singleCompanionSourceId
            AND NOT EXISTS (SELECT 1 FROM pipelines p WHERE p.output_data_type_id = data_types.id)"""
        .as[String].head
    ))

    // Migration-correctness CR 5: captured so the compute-step migration
    // (section 12, `computed_fields` -> `compute` pipeline steps) has real
    // pre-migration data to assert against -- this path previously had zero
    // direct test coverage.
    val computedFieldsBefore: Vector[(String, String, String)] = await(superDb.run(
      sql"""SELECT dt.id, p.id, dt.computed_fields::text
            FROM data_types dt
            JOIN pipelines p ON p.output_data_type_id = dt.id
            WHERE dt.computed_fields <> '[]'"""
        .as[(String, String, String)]
    ))

    // ── Now migrate to latest (applies V94) ─────────────────────────────────
    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()

    // Stash captured pre-migration data on the class for use inside `it`
    // blocks (ScalaTest instantiates the spec once; `beforeAll` runs before
    // any test body).
    this.panelsBeforeCapture = panelsBefore
    this.totalPanelsBeforeCapture = totalPanelsBefore
    this.expectedStrandedCountCapture = expectedStrandedCount
    this.trunkLastByPipelineCapture = trunkLastByPipeline
    this.dataTypeRowsBeforeCapture = dataTypeRowsBefore
    this.metricsBeforeCapture = metricsBefore
    this.companionFieldsBeforeCapture = companionFieldsBefore
    this.pipelineOutputTypeIdsCapture = pipelineOutputTypeIds
    this.pipelineByOutputTypeIdCapture = pipelineByOutputTypeId
    this.stepsBeforeCapture = stepsBefore
    this.computedFieldsBeforeCapture = computedFieldsBefore

    // ── Non-superuser role for the RLS smoke test (task 2.13) -- a
    //    superuser connection would make the assertions vacuous. ───────────
    val superConn = embeddedPostgres.getPostgresDatabase.getConnection
    try {
      val stmt = superConn.createStatement()
      stmt.execute("CREATE ROLE helio_app_test_v94 NOSUPERUSER NOCREATEDB NOCREATEROLE NOLOGIN")
      stmt.execute("GRANT helio_app_test_v94 TO postgres")
      stmt.execute("GRANT USAGE ON SCHEMA public TO helio_app_test_v94")
      stmt.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO helio_app_test_v94")
      stmt.execute("GRANT USAGE ON SCHEMA public TO helio_privileged")
      stmt.execute("GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public TO helio_privileged")
      stmt.execute("GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO helio_privileged")
      stmt.close()
    } finally {
      superConn.close()
    }

    val appCfg = new HikariConfig()
    appCfg.setDataSource(embeddedPostgres.getPostgresDatabase)
    appCfg.setMaximumPoolSize(5)
    appCfg.setConnectionInitSql("SET ROLE helio_app_test_v94")
    appDb = JdbcBackend.Database.forDataSource(new HikariDataSource(appCfg), Some(5))

    val privCfg = new HikariConfig()
    privCfg.setDataSource(embeddedPostgres.getPostgresDatabase)
    privCfg.setMaximumPoolSize(5)
    privCfg.setConnectionInitSql("SET ROLE helio_privileged")
    privilegedDb = JdbcBackend.Database.forDataSource(new HikariDataSource(privCfg), Some(5))
  }

  // Populated by `beforeAll`; read-only from every `it` block.
  private var panelsBeforeCapture: Vector[_] = _
  private var totalPanelsBeforeCapture: Int = _
  private var expectedStrandedCountCapture: Int = _
  private var trunkLastByPipelineCapture: Map[String, Option[String]] = _
  private var dataTypeRowsBeforeCapture: Vector[(String, Int, String)] = _
  private var metricsBeforeCapture: Map[String, (String, String, Option[String])] = _
  private var companionFieldsBeforeCapture: String = _
  private var pipelineOutputTypeIdsCapture: Set[String] = _
  private var pipelineByOutputTypeIdCapture: Map[String, String] = _
  private var stepsBeforeCapture: Vector[(String, String, Int)] = _
  private var computedFieldsBeforeCapture: Vector[(String, String, String)] = _

  case class PanelBefore(
    id: String, typ: String, typeId: Option[String], aggregation: Option[String],
    metricId: Option[String], fieldMapping: Option[String]
  )
  private def panelsBefore: Vector[PanelBefore] = panelsBeforeCapture.asInstanceOf[Vector[PanelBefore]]

  override def afterAll(): Unit = {
    appDb.close(); privilegedDb.close(); superDb.close(); embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 60.seconds)

  "the real pg_dump fixture" should {
    "cover every required panel/data shape (verified, not assumed)" in {
      val byType = panelsBefore.groupBy(_.typ).view.mapValues(_.size).toMap
      // Every panel kind is present.
      Set("metric", "chart", "table", "collection", "timeline", "text", "markdown", "image", "divider")
        .foreach(k => withClue(s"panel kind $k: ") { byType.getOrElse(k, 0) should be > 0 })
      // >=1 HEL-292 aggregation panel, >=1 metric_id panel.
      panelsBefore.count(p => p.aggregation.isDefined) should be > 0
      panelsBefore.count(p => p.metricId.isDefined) should be > 0
      // >=1 data-bound text panel, >=1 data-bound markdown panel.
      panelsBefore.count(p => p.typ == "text" && p.typeId.isDefined) should be > 0
      panelsBefore.count(p => p.typ == "markdown" && p.typeId.isDefined) should be > 0
      // >=1 unbound data panel (visual kind, type_id NULL).
      panelsBefore.count(p => Set("metric", "chart", "table", "collection", "timeline").contains(p.typ) && p.typeId.isEmpty) should be > 0
      // The stranded-panel shape (evaluation-1.md): confirmed >= 60 on the
      // real dev DB via a standalone psql count before this fixture was built.
      expectedStrandedCountCapture should be >= 60
    }
  }

  "V94 pipeline_steps.parent_step_id backfill" should {
    "preserve the pre-existing STEP ORDER (carried by parent_step_id, not by the raw position number) for a real many-step pipeline, building a pure trunk from it" in {
      // HEL-904 binding ruling (2026-08-31): position is no longer asserted
      // untouched -- it is deliberately renumbered to 0 for every non-root
      // trunk step (see the migration's section-1 comment). What must be
      // preserved is ORDER, walked via parent_step_id, not the raw number.
      val rows = await(superDb.run(
        sql"""SELECT id, position, parent_step_id FROM pipeline_steps
              WHERE pipeline_id = $manyStepsPipelineId AND id NOT LIKE 'hel904-%'"""
          .as[(String, Int, Option[String])]
      ))
      val originalPositions = stepsBeforeCapture.filter(_._2 == manyStepsPipelineId).map(_._3).sorted

      // EVERY step -- root included -- is renumbered to position 0 (the
      // real dev data confirms a root step's original position is not
      // reliably 0 -- this pipeline's own root started at 1).
      rows.count(_._3.isEmpty) shouldBe 1 // exactly one root
      rows.map(_._2).toSet shouldBe Set(0) // every step (root + non-root) renumbered to 0

      val byId = rows.map { case (id, _, parent) => id -> parent }.toMap
      def walk(current: Option[String], acc: Vector[String]): Vector[String] = current match {
        case None => acc
        case Some(id) =>
          val next = byId.collectFirst { case (childId, Some(p)) if p == id => childId }
          walk(next, acc :+ id)
      }
      val root = rows.collectFirst { case (id, _, None) => id }.get
      val walked = walk(Some(root), Vector.empty)
      walked.size shouldBe rows.size
      walked.size shouldBe originalPositions.size
    }
  }

  // ── HEL-904 binding ruling (2026-08-31): trunk/tail position-0 proof ──────
  //
  // A tiny throwaway PipelineStep wrapper -- ONLY id/pipelineId/position/
  // parentStepId are load-bearing for `trunkOf`/`tailsOf` (both pure
  // functions over those four fields), so every row is wrapped as a
  // RenameStep regardless of its real `op`, exactly like
  // `PipelineStepRepositoryTreeOrderingSpec`'s own fixture helper. This
  // calls the REAL `PipelineStepRepository.trunkOf`/`tailsOf` (not a
  // reimplementation of the algorithm in the test), which is the point:
  // a bug in the actual code must be able to fail this test.
  private def wrapStep(id: String, position: Int, parentStepId: Option[String]): PipelineStep =
    RenameStep(
      id           = PipelineStepId(id),
      pipelineId   = PipelineId(manyStepsPipelineId), // unused by trunkOf/tailsOf
      position     = position,
      config       = RenameConfig(Map.empty),
      createdAt    = Instant.EPOCH,
      updatedAt    = Instant.EPOCH,
      enabled      = true,
      parentStepId = parentStepId.map(PipelineStepId(_))
    )

  private val stepRepo = new PipelineStepRepository(null)(ec)

  private def stepsForPipeline(pipelineId: String): Vector[PipelineStep] = {
    val rows = await(superDb.run(
      sql"SELECT id, position, parent_step_id FROM pipeline_steps WHERE pipeline_id = $pipelineId"
        .as[(String, Int, Option[String])]
    ))
    rows.map { case (id, position, parent) => wrapStep(id, position, parent) }
  }

  "PipelineStepRepository.trunkOf/tailsOf against every real multi-step pipeline (HEL-904 ruling proof)" should {
    "identify exactly 15 real multi-step pipelines in the fixture (non-negotiable per the ruling's proof requirement)" in {
      val multiStepPipelineIds = stepsBeforeCapture.groupBy(_._2).collect { case (pid, steps) if steps.size > 1 => pid }.toSet
      multiStepPipelineIds.size shouldBe 15
    }

    "walk the FULL, ORIGINAL-ORDER trunk (via trunkOf, position=0 exact match) for every one of the 15 real multi-step pipelines -- not truncated, not reordered" in {
      val multiStepPipelineIds = stepsBeforeCapture.groupBy(_._2).collect { case (pid, steps) if steps.size > 1 => pid }.toSet
      multiStepPipelineIds.size shouldBe 15 // re-asserted here so this test alone still proves the "all 15" scope if run in isolation

      multiStepPipelineIds.foreach { pipelineId =>
        withClue(s"pipeline $pipelineId: ") {
          val expectedOrder = stepsBeforeCapture.filter(_._2 == pipelineId).sortBy(_._3).map(_._1)
          val steps = stepsForPipeline(pipelineId)
          val trunk = stepRepo.trunkOf(steps).map(_.id.value)
          trunk shouldBe expectedOrder // full trunk, exact original order -- not truncated, not reordered
        }
      }
    }
  }

  "the 5 real migration-created aggregate tails (HEL-904 ruling proof)" should {
    "land at position >= 1 and be UNREACHABLE via trunkOf for their pipeline" in {
      val strandedIds: Set[String] = {
        val visualKinds = Set("metric", "chart", "table", "collection", "timeline")
        panelsBefore.filter { p =>
          (visualKinds.contains(p.typ) || ((p.typ == "text" || p.typ == "markdown") && p.typeId.isDefined)) &&
            (p.typeId.isEmpty || !pipelineOutputTypeIdsCapture.contains(p.typeId.get))
        }.map(_.id).toSet
      }
      val aggOrMetricPanels = panelsBefore.filter(p => (p.aggregation.isDefined || p.metricId.isDefined) && !strandedIds.contains(p.id))
      aggOrMetricPanels.size shouldBe 5 // the ruling's proof requirement: "all 5 real aggregate tails"

      aggOrMetricPanels.foreach { p =>
        withClue(s"panel ${p.id}: ") {
          val tailStepId = s"hel904-tail-${p.id}"
          val (position, pipelineId) = await(superDb.run(
            sql"SELECT position, pipeline_id FROM pipeline_steps WHERE id = $tailStepId".as[(Int, String)].head
          ))
          position should be >= 1

          val steps = stepsForPipeline(pipelineId)
          val trunkIds = stepRepo.trunkOf(steps).map(_.id.value).toSet
          trunkIds should not contain tailStepId

          // Also confirm it IS reachable via tailsOf -- excluded from the
          // trunk for the right reason (a real tail), not just absent.
          val tailIds = stepRepo.tailsOf(steps).flatten.map(_.id.value).toSet
          tailIds should contain(tailStepId)
        }
      }
    }
  }

  // ── HEL-904 follow-on ruling (2026-08-31): executionOrder proof ───────────
  //
  // The trunk/tail position-0 ruling above (verified by trunkOf/tailsOf) is
  // necessary but not sufficient: PipelineStepRepository.listByPipelineInternal
  // -- the method PipelineRunService/PipelineService actually call to decide
  // RUN order -- must ALSO derive its whole-pipeline order from the same
  // parent_step_id chain (executionOrder), not from a `.sortBy(_.position)`
  // (which is now meaningless whole-pipeline since every trunk step's
  // position is a constant 0). These tests call the REAL
  // `PipelineStepRepository.executionOrder` against the real fixture data.
  "PipelineStepRepository.executionOrder against every real multi-step pipeline (HEL-904 follow-on ruling proof)" should {
    // A real DbContext-backed repository (see "V94 outputs/node_snapshots RLS"
    // below for the `liveCtx` pattern) -- these assertions call the REAL
    // `listByPipelineInternal` DB method end-to-end (SQL fetch + ordering),
    // not just the pure `executionOrder` function over an in-memory Vector.
    // This is deliberate: `executionOrder`'s result does not depend on the
    // INPUT vector's order (it re-derives order purely from parentStepId/
    // position fields), so a bug that regresses `listByPipelineInternal`'s
    // own `.result` query (e.g. reverting to a raw `.sortBy(_.position)`
    // that never calls `executionOrder` at all) would NOT be caught by
    // calling `executionOrder` directly on a fetched Vector -- only by
    // calling `listByPipelineInternal` itself and checking its OUTPUT order.
    def dbStepRepo: PipelineStepRepository = new PipelineStepRepository(new DbContext(appDb, privilegedDb)(ec))(ec)

    "yield the pre-migration linear order for the pipeline's ORIGINAL steps, for every one of the 15 real multi-step pipelines" in {
      val multiStepPipelineIds = stepsBeforeCapture.groupBy(_._2).collect { case (pid, steps) if steps.size > 1 => pid }.toSet
      multiStepPipelineIds.size shouldBe 15 // re-asserted here so this test alone still proves the "all 15" scope if run in isolation
      val repo = dbStepRepo

      multiStepPipelineIds.foreach { pipelineId =>
        withClue(s"pipeline $pipelineId: ") {
          val expectedOrder = stepsBeforeCapture.filter(_._2 == pipelineId).sortBy(_._3).map(_._1)
          val originalIds    = expectedOrder.toSet
          val steps    = stepsForPipeline(pipelineId)
          // Pure-function cross-check (executionOrder over an already-fetched Vector).
          val executedPure = repo.executionOrder(steps).map(_.id.value)
          // The REAL end-to-end DB call -- listByPipelineInternal must itself
          // return this same order, not merely be consistent with a
          // downstream call to executionOrder.
          val executedLive = await(repo.listByPipelineInternal(PipelineId(pipelineId))).map(_.id.value)
          executedLive shouldBe executedPure

          // Filter down to the pipeline's ORIGINAL (pre-migration) steps only --
          // a pipeline that also received a migration-created aggregate tail
          // (proven separately below) legitimately has one extra step in its
          // post-migration executed order; the ORIGINAL steps among them must
          // still appear in their exact original relative order.
          executedLive.filter(originalIds.contains) shouldBe expectedOrder
          // Every real step actually shows up exactly once -- executionOrder
          // must not drop or duplicate any step.
          executedLive.toSet shouldBe steps.map(_.id.value).toSet
          executedLive.size shouldBe steps.size
        }
      }
    }

    "place every real migration-created aggregate tail immediately after its parent step's index, never before it or as a trunk member" in {
      val strandedIds: Set[String] = {
        val visualKinds = Set("metric", "chart", "table", "collection", "timeline")
        panelsBefore.filter { p =>
          (visualKinds.contains(p.typ) || ((p.typ == "text" || p.typ == "markdown") && p.typeId.isDefined)) &&
            (p.typeId.isEmpty || !pipelineOutputTypeIdsCapture.contains(p.typeId.get))
        }.map(_.id).toSet
      }
      val aggOrMetricPanels = panelsBefore.filter(p => (p.aggregation.isDefined || p.metricId.isDefined) && !strandedIds.contains(p.id))
      aggOrMetricPanels.size shouldBe 5 // the ruling's proof requirement: "all 5 real aggregate tails"

      aggOrMetricPanels.foreach { p =>
        withClue(s"panel ${p.id}: ") {
          val tailStepId = s"hel904-tail-${p.id}"
          val pipelineId = await(superDb.run(
            sql"SELECT pipeline_id FROM pipeline_steps WHERE id = $tailStepId".as[String].head
          ))
          val parentStepId = await(superDb.run(
            sql"SELECT parent_step_id FROM pipeline_steps WHERE id = $tailStepId".as[Option[String]].head
          ))

          val steps    = stepsForPipeline(pipelineId)
          val executed = stepRepo.executionOrder(steps).map(_.id.value)
          val tailIndex = executed.indexOf(tailStepId)
          tailIndex should be >= 0

          parentStepId match {
            case Some(parent) =>
              val parentIndex = executed.indexOf(parent)
              parentIndex should be >= 0
              tailIndex should be > parentIndex // executes AFTER its parent trunk step
            case None =>
              // The pipeline had NO pre-existing steps (trunk_last_id was
              // NULL going into the migration DML) -- this aggregate tail
              // is a root-LEVEL tail with no parent step to compare against
              // (forced to position >= 1 by the migration DML regardless,
              // so it's still never mistaken for the trunk). Such a
              // pipeline has no real trunk at all.
              stepRepo.trunkOf(steps) shouldBe empty
          }

          val trunkIds = stepRepo.trunkOf(steps).map(_.id.value).toSet
          trunkIds should not contain tailStepId // confirmed NOT a trunk member (re-proves the ruling above via executionOrder's own input)
        }
      }
    }
  }

  // ── HEL-904 cycle-8, round-5 skeptic Finding 2 (ESCALATION-CLASS, resolved
  // by the coordinator per the binding position-renumbering ruling): the
  // `PATCH /api/pipeline-steps/:id {"position": N}` write path
  // (`PipelineStepRepository.updateInternal`) must never sever a real
  // migrated trunk or silently re-root the node run-results are written
  // under. Exercised end-to-end against the real 20-step migrated pipeline
  // the round-5 report reproduced the collapse on. ──────────────────────────
  "PipelineStepRepository.updateInternal against the real 20-step migrated pipeline (HEL-904 cycle-8 proof)" should {
    def dbStepRepo: PipelineStepRepository = new PipelineStepRepository(new DbContext(appDb, privilegedDb)(ec))(ec)

    "survive a position PATCH on a mid-trunk step intact -- no truncation, run-result node key unchanged" in {
      val repo = dbStepRepo
      val before = await(repo.listByPipelineInternal(PipelineId(manyStepsPipelineId)))
      val trunkBefore = repo.trunkOf(before)
      trunkBefore.size shouldBe 20 // the real 20-step migrated trunk the round-5 report reproduced the collapse on
      val runResultNodeBefore = trunkBefore.lastOption.map(_.id)

      // Reproduce the exact round-5 repro: PATCH position=2 on the 3rd trunk step.
      val target = trunkBefore(2)
      await(repo.updateInternal(target.id, config = None, position = Some(2)))

      val after = await(repo.listByPipelineInternal(PipelineId(manyStepsPipelineId)))
      val trunkAfter = repo.trunkOf(after)

      // PRE-FIX (round-5 report): trunkOf collapsed from 20 steps to 2. The
      // fix must never produce that: `target` is an only child of its
      // parent (a pure trunk, pre-fix), so the sibling-scoped re-scope
      // clamps to index 0 (its only valid position) -- a true no-op.
      trunkAfter.size shouldBe 20
      trunkAfter.map(_.id) shouldBe trunkBefore.map(_.id)

      // The run-result node key (`trunkOf(...).lastOption`, consumed by
      // `PipelineRunService.scala` to key `node_snapshots`/`binary_refs`
      // writes) must be UNCHANGED by this position-only PATCH.
      trunkAfter.lastOption.map(_.id) shouldBe runResultNodeBefore
    }

    "MUTATION PROOF: reverting to the pre-fix raw write reproduces the exact round-5 collapse (20 -> 2 steps), confirmed red, then restored green" in {
      val repo = dbStepRepo
      val before = await(repo.listByPipelineInternal(PipelineId(manyStepsPipelineId)))
      val trunkBefore = repo.trunkOf(before)
      trunkBefore.size shouldBe 20
      val target = trunkBefore(2)

      // RED: the pre-fix `updateInternal` wrote `position` raw, unscoped --
      // simulate that directly with a raw UPDATE (bypassing the repo).
      await(superDb.run(sqlu"UPDATE pipeline_steps SET position = 2 WHERE id = ${target.id.value}"))
      val corrupted = repo.trunkOf(await(repo.listByPipelineInternal(PipelineId(manyStepsPipelineId))))
      corrupted.size shouldBe 2 // exact round-5 repro: 20-step trunk collapses to 2

      // Restore.
      await(superDb.run(sqlu"UPDATE pipeline_steps SET position = 0 WHERE id = ${target.id.value}"))
      val healed = repo.trunkOf(await(repo.listByPipelineInternal(PipelineId(manyStepsPipelineId))))
      healed.size shouldBe 20

      // GREEN: the real (fixed) `updateInternal`, exercised the same way,
      // cannot reproduce the corruption -- even an out-of-range requested
      // position clamps to the only valid sibling-scoped index.
      await(repo.updateInternal(target.id, config = None, position = Some(99)))
      val afterFixedWrite = repo.trunkOf(await(repo.listByPipelineInternal(PipelineId(manyStepsPipelineId))))
      afterFixedWrite.size shouldBe 20
    }
  }

  "V94 panels.kind backfill" should {
    "collapse the real markdown-bound panel (type_id set) to 'output' -- the evaluation-2.md fix" in {
      val kind = await(superDb.run(sql"SELECT kind FROM panels WHERE id = $markdownBoundPanelId".as[String].head))
      kind shouldBe "output"
    }

    "keep a real literal (unbound) content panel out of 'output'" in {
      val literalMarkdown = panelsBefore.find(p => p.typ == "markdown" && p.typeId.isEmpty).get
      val kind = await(superDb.run(sql"SELECT kind FROM panels WHERE id = ${literalMarkdown.id}".as[String].head))
      kind shouldBe "markdown"
    }
  }

  "V94 data migration step 2.9(b) (bound panels -> Outputs, including markdown)" should {
    "give the real markdown-bound panel a real 'markdown'-kind Output, on its pipeline's node, fieldMapping preserved" in {
      val markdownBefore = panelsBefore.find(_.id == markdownBoundPanelId).get
      val (outputId, kind) = await(superDb.run(
        sql"SELECT output_id, kind FROM panels WHERE id = $markdownBoundPanelId".as[(Option[String], String)].head
      ))
      kind shouldBe "output"
      outputId shouldBe defined

      val (outKind, config) = await(superDb.run(
        sql"SELECT kind, config::text FROM outputs WHERE id = ${outputId.get}".as[(String, String)].head
      ))
      outKind shouldBe "markdown"
      markdownBefore.fieldMapping.foreach { fm =>
        config.parseJson.asJsObject.fields("fieldMapping") shouldBe fm.parseJson
      }
    }

    "create exactly one aggregate tail, with the correctly-derived config, for every real aggregation/metric panel that survived (was not stranded)" in {
      val strandedIds: Set[String] = {
        val visualKinds = Set("metric", "chart", "table", "collection", "timeline")
        panelsBefore.filter { p =>
          (visualKinds.contains(p.typ) || ((p.typ == "text" || p.typ == "markdown") && p.typeId.isDefined)) &&
            (p.typeId.isEmpty || !pipelineOutputTypeIdsCapture.contains(p.typeId.get))
        }.map(_.id).toSet
      }
      val aggOrMetricPanels = panelsBefore.filter(p => (p.aggregation.isDefined || p.metricId.isDefined) && !strandedIds.contains(p.id))
      aggOrMetricPanels should not be empty

      aggOrMetricPanels.foreach { p =>
        withClue(s"panel ${p.id}: ") {
          val tailStepId = s"hel904-tail-${p.id}"
          val row = await(superDb.run(
            sql"SELECT op, config::text FROM pipeline_steps WHERE id = $tailStepId".as[(String, String)].headOption
          ))
          row shouldBe defined
          val (op, config) = row.get
          op shouldBe "aggregate"

          // Migration-correctness CR 1: this step must land on a TAIL, never
          // the trunk. `position` must be >= 1 (a genuine tail per the
          // trunk/tail invariant -- at most one position-0 child per node is
          // the trunk continuation; `PipelineStepRepository.trunkOf` follows
          // exactly and only that position-0 child, so `position >= 1` is
          // both necessary and sufficient for exclusion from `trunkOf`'s walk
          // and inclusion in `tailsOf` (`childrenOf(...).drop(1)`)).
          val position = await(superDb.run(
            sql"SELECT position FROM pipeline_steps WHERE id = $tailStepId".as[Int].head
          ))
          position should be >= 1

          val (expectedFn, expectedAlias, expectedField, expectedFormat) = p.metricId match {
            case Some(mid) =>
              val (measureField, aggFn, format) = metricsBeforeCapture(mid)
              (aggFn, measureField, measureField, format)
            case None =>
              val blob = p.aggregation.get.parseJson.asJsObject
              val fn = blob.fields("agg").asInstanceOf[JsString].value
              val alias = blob.fields.get("value").orElse(blob.fields.get("yField")).collect { case JsString(s) => s }.get
              (fn, alias, alias, None)
          }
          val groupBy = p.aggregation.flatMap(_.parseJson.asJsObject.fields.get("groupBy")).collect {
            case JsString(s) if s.nonEmpty => s
          }
          val expectedConfig = JsObject(
            "groupBy" -> JsArray(groupBy.map(g => JsObject("name" -> JsString(g), "type" -> JsString("string"))).toVector),
            "aggregations" -> JsArray(JsObject("alias" -> JsString(expectedAlias), "fn" -> JsString(expectedFn), "field" -> JsString(expectedField)))
          )
          config.parseJson shouldBe expectedConfig

          expectedFormat.foreach { fmt =>
            val outputId = await(superDb.run(sql"SELECT output_id FROM panels WHERE id = ${p.id}".as[Option[String]].head)).get
            val outConfig = await(superDb.run(sql"SELECT config::text FROM outputs WHERE id = $outputId".as[String].head))
            outConfig.parseJson.asJsObject.fields("format") shouldBe fmt.parseJson
          }
        }
      }
    }

    "drop and log the real invalid chart fieldMapping slots ('category'/'value'), keep the valid ones" in {
      val outputId = await(superDb.run(sql"SELECT output_id FROM panels WHERE id = $invalidSlotChartPanelId".as[Option[String]].head)).get
      val config = await(superDb.run(sql"SELECT config::text FROM outputs WHERE id = $outputId".as[String].head))
      val fm = config.parseJson.asJsObject.fields("fieldMapping").asJsObject.fields
      fm.keySet shouldBe Set.empty // this panel's fieldMapping was ONLY {value, category}, both invalid chart slots

      val dropped = await(superDb.run(
        sql"SELECT slot_key FROM hel904_dropped_field_mapping_slots WHERE panel_id = $invalidSlotChartPanelId".as[String]
      ))
      dropped.toSet shouldBe Set("value", "category")
    }
  }

  "V94 data migration step 2.9(c) (unbound / stranded data panels deleted)" should {
    "delete exactly the panels this migration's own broadened predicate identifies as stranded, and log that exact count" in {
      val logged = await(superDb.run(
        sql"SELECT count FROM hel904_migration_counts WHERE step = 'stranded_output_panels_deleted'".as[Int].head
      ))
      logged shouldBe expectedStrandedCountCapture

      val totalAfter = await(superDb.run(sql"SELECT count(*) FROM panels".as[Int].head))
      // +2 for the two alert-rule-only seeds do not add panels; total after
      // migration = total before minus exactly the stranded ones deleted.
      totalAfter shouldBe (totalPanelsBeforeCapture - expectedStrandedCountCapture)
    }

    "leave no panel in the post-migration schema with kind = 'output' and output_id NULL" in {
      val orphanedOutputKindCount = await(superDb.run(
        sql"SELECT count(*) FROM panels WHERE kind = 'output' AND output_id IS NULL".as[Int].head
      ))
      orphanedOutputKindCount shouldBe 0
    }
  }

  "V94 data migration step 2.9(a) (companion types -> inferred_schema)" should {
    "fold a real single-companion source's fields into data_sources.inferred_schema, in {name, type} shape, order preserved" in {
      val expected = companionFieldsBeforeCapture.parseJson.asInstanceOf[JsArray].elements.map { elem =>
        val o = elem.asJsObject
        JsObject("name" -> o.fields("name"), "type" -> o.fields("dataType"))
      }
      val schema = await(superDb.run(
        sql"SELECT inferred_schema::text FROM data_sources WHERE id = $singleCompanionSourceId".as[String].head
      ))
      schema.parseJson shouldBe JsArray(expected)
    }
  }

  "V94 data migration step 2.9(g) (computed_fields -> compute pipeline steps)" should {
    "create exactly one compute step per computed field, in order, config-mapped, attached as a trunk-extending sibling chain off the original trunk-last step" in {
      computedFieldsBeforeCapture should not be empty

      computedFieldsBeforeCapture.foreach { case (dataTypeId, pipelineId, fieldsJson) =>
        withClue(s"data type $dataTypeId (pipeline $pipelineId): ") {
          val fields = fieldsJson.parseJson.asInstanceOf[JsArray].elements
          val originalTrunkLast = trunkLastByPipelineCapture.getOrElse(pipelineId, None)

          var expectedParent = originalTrunkLast
          fields.zipWithIndex.foreach { case (elem, seq) =>
            val o = elem.asJsObject
            val stepId = s"hel904-compute-$dataTypeId-$seq"
            val row = await(superDb.run(
              sql"SELECT op, config::text, parent_step_id, position FROM pipeline_steps WHERE id = $stepId"
                .as[(String, String, Option[String], Int)].headOption
            ))
            row shouldBe defined
            val (op, config, parentStepId, position) = row.get
            op shouldBe "compute"
            parentStepId shouldBe expectedParent
            // HEL-904 binding ruling (2026-08-31): the FIRST compute step
            // (seq = 0) attaches directly to the pipeline's ORIGINAL
            // trunk-last step, which has no genuine trunk continuation --
            // exactly the same "no existing children" trap section 9's
            // aggregate tail guards against -- so it must land at
            // position >= 1 (in practice exactly 1, since it is the sole
            // child), never 0, or PipelineStepRepository.trunkOf would
            // wrongly walk into it. Every LATER hop in the chain (seq > 0)
            // attaches to a step this SAME migration just created, which is
            // never reachable from trunkOf regardless of its own position,
            // so it stays at position 0 (the sole child of its own
            // dedicated parent).
            if (seq == 0) position should be >= 1 else position shouldBe 0

            val expectedConfig = JsObject(
              "column" -> o.fields("name"),
              "expression" -> o.fields("expression"),
              "type" -> o.fields("dataType")
            )
            config.parseJson shouldBe expectedConfig

            expectedParent = Some(stepId)
          }
        }
      }
    }
  }

  "V94 data migration step 2.9(d)/(f) (orphan pipeline-output types -> table Output; alert rules -> target_output_id)" should {
    "create exactly one table Output for the real orphan type, and resolve the seeded alert rule to it" in {
      val outputId = s"hel904-orphan-output-$orphanTypeId"
      val kind = await(superDb.run(sql"SELECT kind FROM outputs WHERE id = $outputId".as[String].head))
      kind shouldBe "table"

      val targetOutputId = await(superDb.run(
        sql"SELECT target_output_id FROM alert_rules WHERE id = 'hel904-rule-real-orphan'".as[Option[String]].head
      ))
      targetOutputId shouldBe Some(outputId)
    }

    "resolve the seeded real-bound alert rule to the lowest-position Output on its pipeline's node" in {
      val trunkLast = trunkLastByPipelineCapture.getOrElse(alertPipelineId, None)
      val expectedOutputId = await(superDb.run(
        trunkLast match {
          case Some(nodeId) =>
            sql"""SELECT id FROM outputs WHERE pipeline_id = $alertPipelineId AND node_step_id = $nodeId
                  ORDER BY position ASC, id ASC LIMIT 1""".as[String].head
          case None =>
            sql"""SELECT id FROM outputs WHERE pipeline_id = $alertPipelineId AND node_step_id IS NULL
                  ORDER BY position ASC, id ASC LIMIT 1""".as[String].head
        }
      ))
      val targetOutputId = await(superDb.run(
        sql"SELECT target_output_id FROM alert_rules WHERE id = 'hel904-rule-real-bound'".as[Option[String]].head
      ))
      targetOutputId shouldBe Some(expectedOutputId)
    }
  }

  "V94 data migration step 2.9(e) (data_type_rows -> node_snapshots)" should {
    "preserve row-for-row equality for EVERY pipeline that had data_type_rows, onto its ORIGINAL last-trunk-step" in {
      // Only data_type_rows whose data_type_id was STILL some live pipeline's
      // output_data_type_id at migration time get carried forward -- the
      // migration's own INSERT ... SELECT (section 11) is an INNER JOIN
      // against `pipelines`, so a dangling data_type_rows entry (e.g. left
      // behind by a since-deleted pipeline) is correctly, silently dropped,
      // not an error. Real dev data has exactly this shape -- confirmed
      // empirically this cycle (37 live groups out of 44 raw data_type_id
      // groups before filtering).
      val byDataType = dataTypeRowsBeforeCapture.groupBy(_._1).filter { case (dtId, _) => pipelineOutputTypeIdsCapture.contains(dtId) }
      byDataType.nonEmpty shouldBe true

      val actualByPipelineNode = await(superDb.run(
        sql"SELECT pipeline_id, node_step_id, row_index, data::text FROM node_snapshots"
          .as[(String, Option[String], Int, String)]
      )).groupBy { case (pid, node, _, _) => (pid, node) }
        .view.mapValues(_.map { case (_, _, idx, data) => (idx, data.parseJson) }.sortBy(_._1)).toMap

      // Resolve each data_type_id's OWNING pipeline directly (captured
      // before the migration dropped `pipelines.output_data_type_id`), then
      // assert its rows landed, row-for-row, under exactly
      // (pipeline_id, that pipeline's ORIGINAL trunk-last step) -- for
      // EVERY live pipeline that had data_type_rows, not just a hand-picked
      // one or two.
      byDataType.foreach { case (dataTypeId, rows) =>
        val pipelineId = pipelineByOutputTypeIdCapture(dataTypeId)
        val expectedNode = trunkLastByPipelineCapture.getOrElse(pipelineId, None)
        withClue(s"data_type_id=$dataTypeId pipeline_id=$pipelineId node=$expectedNode: ") {
          val actualRows = actualByPipelineNode.getOrElse((pipelineId, expectedNode), Vector.empty)
          val expectedRows = rows.map { case (_, idx, data) => (idx, data.parseJson) }.sortBy(_._1)
          actualRows shouldBe expectedRows
        }
      }
    }
  }

  "V94 task 2.10 (drop panels' retired columns; drop metrics/data_types/data_type_rows/output_data_type_id)" should {
    def tableExists(name: String): Boolean = await(superDb.run(
      sql"SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $name)".as[Boolean].head
    ))
    def columnExists(table: String, column: String): Boolean = await(superDb.run(
      sql"""SELECT EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_name = $table AND column_name = $column)""".as[Boolean].head
    ))

    "drop the metrics, data_type_rows, and data_types tables entirely" in {
      tableExists("metrics") shouldBe false
      tableExists("data_type_rows") shouldBe false
      tableExists("data_types") shouldBe false
    }

    "drop pipelines.output_data_type_id" in {
      columnExists("pipelines", "output_data_type_id") shouldBe false
    }

    "drop every one of panels' retired columns (task 2.1's own cited list)" in {
      val retired = Vector(
        "type", "type_id", "field_mapping", "aggregation", "metric_id", "metric_label",
        "metric_unit", "chart_options", "collection_options", "timeline_options",
        "column_widths", "table_density", "column_order", "chart_annotation"
      )
      retired.foreach { col =>
        withClue(s"panels.$col should be dropped: ") {
          columnExists("panels", col) shouldBe false
        }
      }
    }

    "leave panels.kind NOT NULL, now the sole subtype discriminator" in {
      val isNullable = await(superDb.run(
        sql"""SELECT is_nullable FROM information_schema.columns
              WHERE table_name = 'panels' AND column_name = 'kind'""".as[String].head
      ))
      isNullable shouldBe "NO"
    }

    "drop alert_rules.target_data_type_id and alert_events.target_data_type_id" in {
      columnExists("alert_rules", "target_data_type_id") shouldBe false
      columnExists("alert_events", "target_data_type_id") shouldBe false
    }

    "drop binary_refs.data_type_id, replacing its RLS policy with a pipeline-keyed one, and backfill the real pre-existing row" in {
      columnExists("binary_refs", "data_type_id") shouldBe false
      val policyExists = await(superDb.run(
        sql"""SELECT EXISTS (SELECT 1 FROM pg_policies
              WHERE tablename = 'binary_refs' AND policyname = 'binary_refs_owner')""".as[Boolean].head
      ))
      policyExists shouldBe true

      val backfilled = await(superDb.run(
        sql"SELECT count(*) FROM binary_refs WHERE pipeline_id IS NOT NULL".as[Int].head
      ))
      backfilled should be >= 1 // the real dev-DB binary_refs row (1) must have been re-keyed
    }
  }

  "V94 outputs/node_snapshots RLS (task 2.13)" should {
    def liveCtx: DbContext = new DbContext(appDb, privilegedDb)

    "deny a non-owner from seeing another owner's Output (fails closed by default), and allow the real owner" in {
      // `manyStepsPipelineId`'s owner, resolved post-migration (owner_id is
      // never dropped from `pipelines`).
      val ownerId = await(superDb.run(sql"SELECT owner_id::text FROM pipelines WHERE id = $manyStepsPipelineId".as[String].head))

      await(privilegedDb.run(
        sqlu"""INSERT INTO outputs (id, pipeline_id, node_step_id, owner_id, name, kind)
               VALUES ('hel904-rls-output-1', $manyStepsPipelineId, NULL, $ownerId::uuid, 'Table', 'table')"""
      ))

      val asOwner = await(liveCtx.withUserContext(ownerId)(
        sql"SELECT id FROM outputs WHERE id = 'hel904-rls-output-1'".as[String]
      ))
      asOwner shouldBe Vector("hel904-rls-output-1")

      val asOther = await(liveCtx.withUserContext(unrelatedUserId)(
        sql"SELECT id FROM outputs WHERE id = 'hel904-rls-output-1'".as[String]
      ))
      asOther shouldBe empty
    }

    "prove itself red: dropping the outputs_select policy exposes no rows even to the owner, restoring it restores access" in {
      val ownerId = await(superDb.run(sql"SELECT owner_id::text FROM pipelines WHERE id = $manyStepsPipelineId".as[String].head))
      await(superDb.run(sqlu"DROP POLICY outputs_select ON outputs"))
      val asOwnerNoPolicy = await(liveCtx.withUserContext(ownerId)(
        sql"SELECT id FROM outputs WHERE id = 'hel904-rls-output-1'".as[String]
      ))
      asOwnerNoPolicy shouldBe empty

      await(superDb.run(sqlu"""
        CREATE POLICY outputs_select ON outputs
          FOR SELECT
          USING (helio_can_access_pipeline(pipeline_id))
      """))
      val asOwnerRestored = await(liveCtx.withUserContext(ownerId)(
        sql"SELECT id FROM outputs WHERE id = 'hel904-rls-output-1'".as[String]
      ))
      asOwnerRestored shouldBe Vector("hel904-rls-output-1")
    }

    "deny a non-owner from seeing another owner's node_snapshots rows, allow the owner" in {
      val ownerId = await(superDb.run(sql"SELECT owner_id::text FROM pipelines WHERE id = $alertPipelineId".as[String].head))
      val asOwner = await(liveCtx.withUserContext(ownerId)(
        sql"SELECT 1 FROM node_snapshots WHERE pipeline_id = $alertPipelineId".as[Int]
      ))
      val asOther = await(liveCtx.withUserContext(unrelatedUserId)(
        sql"SELECT 1 FROM node_snapshots WHERE pipeline_id = $alertPipelineId".as[Int]
      ))
      asOther shouldBe empty
      // `alertPipelineId` genuinely has >= 1 node_snapshots row post-migration
      // (verified against the real fixture) -- assert the owner-read side is
      // non-vacuous too, not just "denial happened".
      asOwner should not be empty
    }

    "prove itself red for node_snapshots too: dropping the node_snapshots_select policy exposes no rows even to the owner, restoring it restores access" in {
      val ownerId = await(superDb.run(sql"SELECT owner_id::text FROM pipelines WHERE id = $alertPipelineId".as[String].head))
      await(superDb.run(sqlu"DROP POLICY node_snapshots_select ON node_snapshots"))
      val asOwnerNoPolicy = await(liveCtx.withUserContext(ownerId)(
        sql"SELECT 1 FROM node_snapshots WHERE pipeline_id = $alertPipelineId".as[Int]
      ))
      asOwnerNoPolicy shouldBe empty

      await(superDb.run(sqlu"""
        CREATE POLICY node_snapshots_select ON node_snapshots
          FOR SELECT
          USING (helio_can_access_pipeline(pipeline_id))
      """))
      val asOwnerRestored = await(liveCtx.withUserContext(ownerId)(
        sql"SELECT 1 FROM node_snapshots WHERE pipeline_id = $alertPipelineId".as[Int]
      ))
      asOwnerRestored should not be empty
    }

    "allow a granted (non-owner) user to read node_snapshots via the sharing branch, deny before the grant exists" in {
      val beforeGrant = await(liveCtx.withUserContext(granteeId)(
        sql"SELECT 1 FROM node_snapshots WHERE pipeline_id = $alertPipelineId".as[Int]
      ))
      beforeGrant shouldBe empty

      await(privilegedDb.run(
        sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
               VALUES ('pipeline', $alertPipelineId, $granteeId::uuid, 'viewer', now())"""
      ))

      val afterGrant = await(liveCtx.withUserContext(granteeId)(
        sql"SELECT 1 FROM node_snapshots WHERE pipeline_id = $alertPipelineId".as[Int]
      ))
      afterGrant should not be empty
    }

    "allow a granted (non-owner) user to read outputs via the sharing branch, deny before the grant exists" in {
      val beforeGrant = await(liveCtx.withUserContext(granteeId)(
        sql"SELECT id FROM outputs WHERE id = 'hel904-rls-output-1'".as[String]
      ))
      beforeGrant shouldBe empty

      await(privilegedDb.run(
        sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
               VALUES ('pipeline', $manyStepsPipelineId, $granteeId::uuid, 'viewer', now())"""
      ))

      val afterGrant = await(liveCtx.withUserContext(granteeId)(
        sql"SELECT id FROM outputs WHERE id = 'hel904-rls-output-1'".as[String]
      ))
      afterGrant shouldBe Vector("hel904-rls-output-1")
    }
  }
}
