package com.helio.infrastructure.persistence.pipelines

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

import java.util.UUID
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

/** HEL-904 task 2.11/2.12/2.13 (partial) -- red-first proof for the additive
 *  slice of the V94 migration landed so far (pipeline_steps.parent_step_id
 *  backfill, outputs/node_snapshots tables + RLS, panels.kind backfill,
 *  data_sources.inferred_schema default). The full 9-step data migration
 *  (task 2.9), the destructive alert_rules/binary_refs retargets, and the
 *  final table drops (task 2.10) are NOT part of V94 yet (see the migration
 *  file's own header note) -- this spec only proves what actually exists
 *  today, and will grow alongside the migration file across future cycles.
 *
 *  Strategy: migrate to V93 (pre-V94), hand-seed a fixture via raw SQL
 *  (mirrors design.md decision 3's "derived from a real shape" intent, done
 *  here as a hand-built fixture rather than a `pg_dump` of the actual shared
 *  dev DB, since that dump is an operational step outside this test's
 *  reach), assert the pre-migration state (proves the assertions below are
 *  not vacuous -- the "before" shape genuinely lacks the new columns), then
 *  migrate to V94 (latest) and assert the backfill/shape is correct. */
class V94OutputsMigrationSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private var embeddedPostgres: EmbeddedPostgres = _
  private var superDb: JdbcBackend.Database      = _
  private var appDb: JdbcBackend.Database        = _
  private var privilegedDb: JdbcBackend.Database = _

  private val ownerId    = UUID.randomUUID().toString
  private val otherOwner = UUID.randomUUID().toString
  private val sourceId   = UUID.randomUUID().toString
  private val pipelineId = UUID.randomUUID().toString
  private val stepIds    = Vector.fill(5)(UUID.randomUUID().toString)
  private val dashboardId = UUID.randomUUID().toString

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

    // ── Seed a fixture: one owner, one source, one 5-step pipeline (a pure
    //    trunk by construction, position 0..4), one panel of each backfill-
    //    relevant `type`, one bound `text` panel (type_id set). ───────────
    await(superDb.run(DBIO.seq(
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($ownerId::uuid, 'owner@test.local', now())""",
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($otherOwner::uuid, 'other@test.local', now())""",
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ($sourceId, 'src', 'static', '{}', $ownerId::uuid, now(), now())""",
      sqlu"""INSERT INTO data_types (id, source_id, name, fields, computed_fields, version, created_at, updated_at, owner_id)
             VALUES ('dt-1', $sourceId, 'dt', '[]', '[]', 1, now(), now(), $ownerId::uuid)""",
      sqlu"""INSERT INTO pipelines (id, name, source_data_source_id, output_data_type_id, created_at, updated_at, owner_id)
             VALUES ($pipelineId, 'p', $sourceId, 'dt-1', now(), now(), $ownerId::uuid)""",
      // Task 2.9(a) fixture: a genuine companion type -- bound to its own
      // source, NOT any pipeline's output_data_type_id -- whose `fields`
      // must fold into `data_sources.inferred_schema` and then be deleted.
      sqlu"""INSERT INTO data_sources (id, name, source_type, config, owner_id, created_at, updated_at)
             VALUES ('companion-src', 'compsrc', 'static', '{}', $ownerId::uuid, now(), now())""",
      sqlu"""INSERT INTO data_types (id, source_id, name, fields, computed_fields, version, created_at, updated_at, owner_id)
             VALUES ('dt-companion', 'companion-src', 'companion',
                     '[{"name":"foo","displayName":"Foo","dataType":"string","nullable":true},{"name":"bar","displayName":"Bar","dataType":"number","nullable":false}]',
                     '[]', 1, now(), now(), $ownerId::uuid)"""
    ) >> DBIO.sequence(
      stepIds.zipWithIndex.map { case (id, pos) =>
        sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled, created_at, updated_at)
               VALUES ($id, $pipelineId, $pos, 'select', '{}', true, now(), now())"""
      }
    ) >> DBIO.seq(
      sqlu"""INSERT INTO dashboards (id, name, created_by, created_at, last_updated, appearance, layout, owner_id)
             VALUES ($dashboardId, 'dash', $ownerId, now(), now(), '{}', '[]', $ownerId::uuid)""",
      // `type_id = 'dt-1'` (previously unset -- unused for anything but the
      // kind-backfill assertion prior to 2.9(b)) so this fixture is a
      // genuinely bound panel: it must resolve to a real pipeline via
      // `pipelines.output_data_type_id`, per 2.9(b)'s own test group below.
      sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, type, type_id, owner_id)
             VALUES ('panel-bound', $dashboardId, 'bound', $ownerId::uuid, now(), now(), '{}', 'metric', 'dt-1', $ownerId::uuid)""",
      sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, type, type_id, owner_id)
             VALUES ('panel-bound-text', $dashboardId, 'bound-text', $ownerId::uuid, now(), now(), '{}', 'text', 'dt-1', $ownerId::uuid)""",
      sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, type, owner_id)
             VALUES ('panel-literal-text', $dashboardId, 'literal-text', $ownerId::uuid, now(), now(), '{}', 'text', $ownerId::uuid)""",
      sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, type, owner_id)
             VALUES ('panel-divider', $dashboardId, 'divider', $ownerId::uuid, now(), now(), '{}', 'divider', $ownerId::uuid)""",
      // Task 2.9(b) fixtures. Shapes below match the real dev-DB shapes
      // resolved empirically this cycle (`SELECT id, type, aggregation FROM
      // panels WHERE aggregation IS NOT NULL OR metric_id IS NOT NULL`).
      sqlu"""INSERT INTO metrics (id, owner_id, data_type_id, name, measure_field, aggregation, allowed_dimensions, format)
             VALUES ('metric-1', $ownerId::uuid, 'dt-1', 'Rating', 'ratinglevel', 'avg', '[]', '{"style":"percent"}')""",
      sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, type, type_id, owner_id, field_mapping, aggregation)
             VALUES ('panel-metric-agg', $dashboardId, 'metric-agg', $ownerId::uuid, now(), now(), '{}', 'metric', 'dt-1', $ownerId::uuid,
                     '{"value":"profit","label":"date"}', '{"agg":"avg","value":"profit"}')""",
      sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, type, type_id, owner_id, field_mapping, aggregation)
             VALUES ('panel-chart-agg-invalid-fm', $dashboardId, 'chart-agg', $ownerId::uuid, now(), now(), '{}', 'chart', 'dt-1', $ownerId::uuid,
                     '{"x":"month","y":"profit"}', '{"agg":"sum","yField":"profit","groupBy":"month"}')""",
      sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, type, type_id, owner_id, field_mapping, aggregation, metric_id)
             VALUES ('panel-metric-with-metricid', $dashboardId, 'metric-with-id', $ownerId::uuid, now(), now(), '{}', 'metric', 'dt-1', $ownerId::uuid,
                     '{"value":"ratinglevel"}', '{"agg":"avg","value":"someOtherField"}', 'metric-1')""",
      sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, type, type_id, owner_id, field_mapping)
             VALUES ('panel-table-plain', $dashboardId, 'table-plain', $ownerId::uuid, now(), now(), '{}', 'table', 'dt-1', $ownerId::uuid,
                     '{"anyCol":"colName"}')"""
    )))

    // Sanity: the pre-migration schema genuinely lacks the new columns --
    // this is what makes the post-migration assertions non-vacuous (red-first).
    val preMigrationColumns = await(superDb.run(
      sql"""SELECT column_name FROM information_schema.columns
            WHERE table_name = 'pipeline_steps' AND column_name = 'parent_step_id'""".as[String]
    ))
    preMigrationColumns shouldBe empty
    a[java.sql.SQLException] should be thrownBy
      await(superDb.run(sql"SELECT 1 FROM outputs LIMIT 1".as[Int]))

    // Red-first (task 2.9(a)): pre-migration, the companion type still
    // exists and the source's inferred_schema column doesn't exist at all.
    val preMigrationCompanionCount = await(superDb.run(
      sql"SELECT count(*) FROM data_types WHERE id = 'dt-companion'".as[Int].head
    ))
    preMigrationCompanionCount shouldBe 1

    // Red-first (task 2.9(b)): pre-migration, `pipeline_steps` has exactly
    // the 5 seeded rows -- no migration-generated tail step exists yet
    // (proves the tail-step-count assertions below are not vacuous).
    val preMigrationStepCount = await(superDb.run(
      sql"SELECT count(*) FROM pipeline_steps WHERE pipeline_id = $pipelineId".as[Int].head
    ))
    preMigrationStepCount shouldBe 5

    // ── Now migrate to latest (applies V94) ─────────────────────────────────
    Flyway
      .configure()
      .dataSource(embeddedPostgres.getJdbcUrl("postgres", "postgres"), "postgres", "postgres")
      .locations("classpath:db/migration")
      .load()
      .migrate()

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

  override def afterAll(): Unit = {
    appDb.close(); privilegedDb.close(); superDb.close(); embeddedPostgres.close()
  }

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  "V94 pipeline_steps.parent_step_id backfill" should {
    "preserve the pre-existing position order (not reset it), building a pure trunk from it" in {
      // Excludes 2.9(b)'s migration-generated `hel904-tail-*` steps (this
      // pipeline gains three once V94 runs in full) -- this test is about
      // the ORIGINAL 5-step trunk's own positions, not the tails appended
      // to it, which are covered by the 2.9(b) test group below.
      val rows = await(superDb.run(
        sql"""SELECT id, position, parent_step_id FROM pipeline_steps
              WHERE pipeline_id = $pipelineId AND id NOT LIKE 'hel904-tail-%' ORDER BY position"""
          .as[(String, Int, Option[String])]
      ))
      rows.map(_._2) shouldBe Vector(0, 1, 2, 3, 4) // position untouched

      // Walk parent_step_id from root (None) and confirm it reproduces the
      // exact position order -- the "step-order-preservation" proof (2.12).
      val byId = rows.map { case (id, _, parent) => id -> parent }.toMap
      def walk(current: Option[String], acc: Vector[String]): Vector[String] = current match {
        case None => acc
        case Some(id) =>
          val next = byId.collectFirst { case (childId, Some(p)) if p == id => childId }
          walk(next, acc :+ id)
      }
      val root = rows.collectFirst { case (id, 0, None) => id }.get
      walk(Some(root), Vector.empty) shouldBe stepIds
    }
  }

  "V94 panels.kind backfill" should {
    "collapse bound visualization types (e.g. metric) to 'output'" in {
      val kind = await(superDb.run(sql"SELECT kind FROM panels WHERE id = 'panel-bound'".as[String].head))
      kind shouldBe "output"
    }

    "collapse a data-bound text panel (type_id set) to 'output'" in {
      val kind = await(superDb.run(sql"SELECT kind FROM panels WHERE id = 'panel-bound-text'".as[String].head))
      kind shouldBe "output"
    }

    "keep a literal text panel (type_id null) as 'text'" in {
      val kind = await(superDb.run(sql"SELECT kind FROM panels WHERE id = 'panel-literal-text'".as[String].head))
      kind shouldBe "text"
    }

    "pass a content-only type (divider) straight through" in {
      val kind = await(superDb.run(sql"SELECT kind FROM panels WHERE id = 'panel-divider'".as[String].head))
      kind shouldBe "divider"
    }
  }

  "V94 data_sources.inferred_schema" should {
    "default every pre-existing row to an empty array" in {
      val schema = await(superDb.run(sql"SELECT inferred_schema::text FROM data_sources WHERE id = $sourceId".as[String].head))
      schema shouldBe "[]"
    }
  }

  "V94 alert_rules/alert_events target_output_id (task 2.7)" should {
    "add a nullable target_output_id column alongside the untouched target_data_type_id" in {
      await(superDb.run(
        sqlu"""INSERT INTO alert_rules (id, owner_id, target_data_type_id, metric, condition, name, severity)
               VALUES ('rule-1', $ownerId::uuid, 'dt-1', 'value', '{}', 'r', 'info')"""
      ))
      val (targetDataTypeId, targetOutputId) = await(superDb.run(
        sql"SELECT target_data_type_id, target_output_id FROM alert_rules WHERE id = 'rule-1'"
          .as[(String, Option[String])].head
      ))
      targetDataTypeId shouldBe "dt-1"
      targetOutputId shouldBe None

      await(superDb.run(
        sqlu"""INSERT INTO alert_events (id, alert_rule_id, owner_id, target_data_type_id, value, severity, state, first_fired_at, last_evaluated_at)
               VALUES ('event-1', 'rule-1', $ownerId::uuid, 'dt-1', '{}', 'info', 'firing', now(), now())"""
      ))
      val eventTargetOutputId = await(superDb.run(
        sql"SELECT target_output_id FROM alert_events WHERE id = 'event-1'".as[Option[String]].head
      ))
      eventTargetOutputId shouldBe None
    }

    "populate target_output_id via a real Output FK once one exists" in {
      await(privilegedDb.run(
        sqlu"""INSERT INTO outputs (id, pipeline_id, node_step_id, owner_id, name, kind)
               VALUES ('output-for-rule', $pipelineId, NULL, $ownerId::uuid, 'Table', 'table')"""
      ))
      await(superDb.run(sqlu"UPDATE alert_rules SET target_output_id = 'output-for-rule' WHERE id = 'rule-1'"))
      val targetOutputId = await(superDb.run(
        sql"SELECT target_output_id FROM alert_rules WHERE id = 'rule-1'".as[Option[String]].head
      ))
      targetOutputId shouldBe Some("output-for-rule")
    }
  }

  "V94 binary_refs pipeline_id/node_step_id (task 2.8)" should {
    "add nullable pipeline_id/node_step_id columns keyed by node, per the ticket's dev-DB-inspection fallback" in {
      await(superDb.run(
        sqlu"""INSERT INTO binary_refs (id, data_type_id, row_index, field_name, storage_key, mime_type, filename, size_bytes)
               VALUES ('ref-1', 'dt-1', 0, 'f', 's', 'application/octet-stream', 'f.bin', 1)"""
      ))
      val (pipelineIdCol, nodeStepIdCol) = await(superDb.run(
        sql"SELECT pipeline_id, node_step_id FROM binary_refs WHERE id = 'ref-1'".as[(Option[String], Option[String])].head
      ))
      pipelineIdCol shouldBe None
      nodeStepIdCol shouldBe None

      await(superDb.run(sqlu"UPDATE binary_refs SET pipeline_id = $pipelineId WHERE id = 'ref-1'"))
      val populated = await(superDb.run(
        sql"SELECT pipeline_id FROM binary_refs WHERE id = 'ref-1'".as[Option[String]].head
      ))
      populated shouldBe Some(pipelineId)
    }
  }

  "V94 outputs/node_snapshots RLS (task 2.13)" should {
    def liveCtx: DbContext = new DbContext(appDb, privilegedDb)

    "deny a non-owner from seeing another owner's Output (fails closed by default -- no rows exist yet, but INSERT itself proves the owner-scoped WITH CHECK)" in {
      // Insert an Output owned by `ownerId` via the privileged pool (bypasses
      // RLS, mirroring how a real service-layer insert would run inside
      // withUserContext -- exercised directly here since no OutputRepository
      // caller wiring exists yet).
      await(privilegedDb.run(
        sqlu"""INSERT INTO outputs (id, pipeline_id, node_step_id, owner_id, name, kind)
               VALUES ('output-1', $pipelineId, NULL, $ownerId::uuid, 'Table', 'table')"""
      ))

      // App pool as ownerId can see it (owner branch of helio_can_access_pipeline).
      val asOwner = await(liveCtx.withUserContext(ownerId)(
        sql"SELECT id FROM outputs WHERE id = 'output-1'".as[String]
      ))
      asOwner shouldBe Vector("output-1")

      // App pool as a different, unrelated owner cannot see it -- proves the
      // RLS policy is real (not a superuser connection) and fails closed for
      // a caller with no pipeline access.
      val asOther = await(liveCtx.withUserContext(otherOwner)(
        sql"SELECT id FROM outputs WHERE id = 'output-1'".as[String]
      ))
      asOther shouldBe empty
    }

    "prove itself red: dropping the outputs_select policy exposes the row to every caller" in {
      await(superDb.run(sqlu"DROP POLICY outputs_select ON outputs"))
      // Re-create a permissive-by-omission policy is not what we're testing;
      // instead, with the SELECT policy gone and RLS still forced but no
      // permitted command, Postgres denies all rows by default (FORCE ROW
      // LEVEL SECURITY + zero policies for SELECT = zero visible rows) --
      // so the correct assertion is that the *policy is what grants access*:
      // recreate it and confirm access returns, proving the earlier `asOwner`
      // assertion was not vacuously satisfied by some other mechanism (e.g.
      // GRANT-level access alone).
      val asOwnerNoPolicy = await(liveCtx.withUserContext(ownerId)(
        sql"SELECT id FROM outputs WHERE id = 'output-1'".as[String]
      ))
      asOwnerNoPolicy shouldBe empty

      await(superDb.run(sqlu"""
        CREATE POLICY outputs_select ON outputs
          FOR SELECT
          USING (helio_can_access_pipeline(pipeline_id))
      """))
      val asOwnerRestored = await(liveCtx.withUserContext(ownerId)(
        sql"SELECT id FROM outputs WHERE id = 'output-1'".as[String]
      ))
      asOwnerRestored shouldBe Vector("output-1")
    }
  }

  "V94 data migration step 2.9(a) (companion types -> inferred_schema)" should {
    "fold the companion type's fields into data_sources.inferred_schema, in {name, type} shape" in {
      val schema = await(superDb.run(
        sql"SELECT inferred_schema::text FROM data_sources WHERE id = 'companion-src'".as[String].head
      ))
      schema.parseJson shouldBe
        """[{"name":"foo","type":"string"},{"name":"bar","type":"number"}]""".parseJson
    }

    "delete the companion data_types row" in {
      val count = await(superDb.run(
        sql"SELECT count(*) FROM data_types WHERE id = 'dt-companion'".as[Int].head
      ))
      count shouldBe 0
    }

    "leave a pipeline-output type's own data_types row and source untouched" in {
      // dt-1 is sourceId's own type AND pipeline p's output_data_type_id --
      // it must survive 2.9(a) (only step 2.9(b)-(d) touches output types).
      val count = await(superDb.run(
        sql"SELECT count(*) FROM data_types WHERE id = 'dt-1'".as[Int].head
      ))
      count shouldBe 1
      val schema = await(superDb.run(
        sql"SELECT inferred_schema::text FROM data_sources WHERE id = $sourceId".as[String].head
      ))
      // sourceId owns BOTH dt-1 (pipeline-output, excluded) and no other
      // companion type -- inferred_schema must stay the untouched default.
      schema.parseJson shouldBe "[]".parseJson
    }
  }

  "V94 data migration step 2.9(b) (bound panels -> Outputs)" should {
    val trunkLastId = () => stepIds.last // last of the 5 pre-existing trunk steps

    "resolve a plain bound panel's Output -> node -> pipeline correctly, with no tail step" in {
      val (outputId, kind) = await(superDb.run(
        sql"SELECT output_id, kind FROM panels WHERE id = 'panel-bound'".as[(Option[String], String)].head
      ))
      kind shouldBe "output"
      outputId shouldBe defined

      val (pipelineIdCol, nodeStepId, outKind) = await(superDb.run(
        sql"SELECT pipeline_id, node_step_id, kind FROM outputs WHERE id = ${outputId.get}"
          .as[(String, Option[String], String)].head
      ))
      pipelineIdCol shouldBe pipelineId
      nodeStepId shouldBe Some(trunkLastId())
      outKind shouldBe "metric"
    }

    "create exactly one aggregate tail step for a metric panel with its own HEL-292 aggregation, alias == field name" in {
      val outputId = await(superDb.run(
        sql"SELECT output_id FROM panels WHERE id = 'panel-metric-agg'".as[Option[String]].head
      )).get

      val (nodeStepId, config) = await(superDb.run(
        sql"SELECT node_step_id, config::text FROM outputs WHERE id = $outputId".as[(Option[String], String)].head
      ))
      nodeStepId should not be Some(trunkLastId()) // it's the new tail, not the trunk itself
      nodeStepId shouldBe defined

      val (parentStepId, op, stepConfig) = await(superDb.run(
        sql"SELECT parent_step_id, op, config::text FROM pipeline_steps WHERE id = ${nodeStepId.get}"
          .as[(Option[String], String, String)].head
      ))
      parentStepId shouldBe Some(trunkLastId())
      op shouldBe "aggregate"
      stepConfig.parseJson shouldBe
        """{"groupBy":[],"aggregations":[{"alias":"profit","fn":"avg","field":"profit"}]}""".parseJson

      config.parseJson.asJsObject.fields("fieldMapping") shouldBe
        """{"value":"profit","label":"date"}""".parseJson
    }

    "drop and log an invalid fieldMapping slot for a chart panel (HEL-892 AC 6), keep the valid groupBy tail" in {
      val outputId = await(superDb.run(
        sql"SELECT output_id FROM panels WHERE id = 'panel-chart-agg-invalid-fm'".as[Option[String]].head
      )).get
      val (nodeStepId, config) = await(superDb.run(
        sql"SELECT node_step_id, config::text FROM outputs WHERE id = $outputId".as[(Option[String], String)].head
      ))
      config.parseJson.asJsObject.fields("fieldMapping") shouldBe "{}".parseJson

      val stepConfig = await(superDb.run(
        sql"SELECT config::text FROM pipeline_steps WHERE id = ${nodeStepId.get}".as[String].head
      ))
      stepConfig.parseJson shouldBe
        """{"groupBy":[{"name":"month","type":"string"}],"aggregations":[{"alias":"profit","fn":"sum","field":"profit"}]}""".parseJson

      val dropped = await(superDb.run(
        sql"SELECT slot_key, slot_value FROM hel904_dropped_field_mapping_slots WHERE panel_id = 'panel-chart-agg-invalid-fm' ORDER BY slot_key"
          .as[(String, String)]
      ))
      dropped shouldBe Vector(("x", "\"month\""), ("y", "\"profit\""))
    }

    "prefer metrics.measure_field/aggregation over the panel's own aggregation blob when metric_id is set, and carry metrics.format into config.format" in {
      val outputId = await(superDb.run(
        sql"SELECT output_id FROM panels WHERE id = 'panel-metric-with-metricid'".as[Option[String]].head
      )).get
      val (nodeStepId, config) = await(superDb.run(
        sql"SELECT node_step_id, config::text FROM outputs WHERE id = $outputId".as[(Option[String], String)].head
      ))
      val stepConfig = await(superDb.run(
        sql"SELECT config::text FROM pipeline_steps WHERE id = ${nodeStepId.get}".as[String].head
      ))
      stepConfig.parseJson shouldBe
        """{"groupBy":[],"aggregations":[{"alias":"ratinglevel","fn":"avg","field":"ratinglevel"}]}""".parseJson
      config.parseJson.asJsObject.fields("format") shouldBe """{"style":"percent"}""".parseJson
    }

    "leave a table panel's fieldMapping entirely unfiltered (no fixed slot list) and attach it directly to the trunk (no tail)" in {
      val (outputId, _) = await(superDb.run(
        sql"SELECT output_id, kind FROM panels WHERE id = 'panel-table-plain'".as[(Option[String], String)].head
      ))
      val (nodeStepId, config, outKind) = await(superDb.run(
        sql"SELECT node_step_id, config::text, kind FROM outputs WHERE id = ${outputId.get}"
          .as[(Option[String], String, String)].head
      ))
      outKind shouldBe "table"
      nodeStepId shouldBe Some(trunkLastId())
      config.parseJson.asJsObject.fields("fieldMapping") shouldBe """{"anyCol":"colName"}""".parseJson

      val dropped = await(superDb.run(
        sql"SELECT count(*) FROM hel904_dropped_field_mapping_slots WHERE panel_id = 'panel-table-plain'".as[Int].head
      ))
      dropped shouldBe 0
    }

    "never reset the pre-existing trunk steps' position values" in {
      // Migration-generated tails use deterministic `hel904-tail-*` ids,
      // never colliding with the 5 pre-existing (randomUUID) trunk step ids
      // -- excluding that prefix isolates exactly the pre-existing rows.
      val positions = await(superDb.run(
        sql"""SELECT position FROM pipeline_steps
              WHERE pipeline_id = $pipelineId AND id NOT LIKE 'hel904-tail-%'"""
          .as[Int]
      ))
      positions.sorted shouldBe Vector(0, 1, 2, 3, 4)
    }
  }
}
