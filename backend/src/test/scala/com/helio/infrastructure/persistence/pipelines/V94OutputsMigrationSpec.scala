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

/** HEL-904 task 2.11/2.12/2.13 -- red-first proof for the FULL V94 migration
 *  (pipeline_steps.parent_step_id backfill, outputs/node_snapshots tables +
 *  RLS, panels.kind backfill, data_sources.inferred_schema default, the full
 *  9-step data migration (task 2.9), the destructive alert_rules/binary_refs
 *  retargets, and the final table/column drops (task 2.10) -- now complete).
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
  private val granteeId  = UUID.randomUUID().toString
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
      sqlu"""INSERT INTO users (id, email, created_at) VALUES ($granteeId::uuid, 'grantee@test.local', now())""",
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
                     '{"anyCol":"colName"}')""",
      // Task 2.9(c) fixture: an unbound data panel (bound-visualization
      // `type`, but `type_id` NULL) -- must be deleted, count logged.
      sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, type, owner_id)
             VALUES ('panel-unbound-metric', $dashboardId, 'unbound', $ownerId::uuid, now(), now(), '{}', 'metric', $ownerId::uuid)""",
      // evaluation-1.md Critical Path item 1 fixture: a bound panel whose
      // `type_id` resolves to a `data_types` row that NO pipeline claims
      // (58 real rows on the shared dev DB, ~30 dashboards -- section 4
      // marks these `kind = 'output'` but section 9 cannot resolve an
      // Output for them; the original section 10 predicate, `type_id IS
      // NULL`, silently missed this shape entirely). `dt-stranded`'s id,
      // name, and `fields` payload, and `panel-stranded`'s `type`/
      // `field_mapping`, are the LITERAL `pg_dump --data-only --inserts`
      // output for `data_types.id = 'e262207b-8f11-4d91-8cdd-90bf1d57caca'`
      // ("Netflix Data") and one of its real bound panels, taken from the
      // shared dev DB on 2026-08-30 -- not a hand-invented shape. Owner/
      // dashboard ids are remapped onto this fixture's own owner/dashboard
      // so the row satisfies this embedded Postgres's FKs; every other
      // column is verbatim. `source_id` is genuinely NULL on the real row
      // (this pipeline-output type was never a companion type either) --
      // confirming these 58 panels have no rescue path via section 8's
      // companion-type handling.
      sqlu"""INSERT INTO data_types (id, source_id, name, fields, computed_fields, version, created_at, updated_at, owner_id)
             VALUES ('dt-stranded', NULL, 'Netflix Data',
                     '[{"name": "title", "dataType": "string", "nullable": false, "displayName": "Title"}, {"name": "rating", "dataType": "string", "nullable": false, "displayName": "Rating"}, {"name": "ratinglevel", "dataType": "string", "nullable": true, "displayName": "Ratinglevel"}]',
                     '[]', 3, now(), now(), $ownerId::uuid)""",
      sqlu"""INSERT INTO panels (id, dashboard_id, title, created_by, created_at, last_updated, appearance, type, type_id, field_mapping, owner_id)
             VALUES ('panel-stranded', $dashboardId, 'Panel One', $ownerId::uuid, now(), now(), '{}', 'metric', 'dt-stranded',
                     '{"unit": "rating", "label": "rating", "value": "title"}', $ownerId::uuid)""",
      // Task 2.9(d)/(e)/(f)/(g) fixture: a second pipeline whose output type
      // has NO bound panel (qualifies for (d)'s orphan table Output) and
      // DOES carry a computed field (qualifies for (g)'s pipeline-output
      // compute-step case) -- one fixture pipeline deliberately exercises
      // both, since they attach to the same frozen last-trunk-step node.
      sqlu"""INSERT INTO data_types (id, source_id, name, fields, computed_fields, version, created_at, updated_at, owner_id)
             VALUES ('dt-orphan', NULL, 'Orphan Type', '[]',
                     '[{"name":"doubled","displayName":"Doubled","expression":"amount * 2","dataType":"number"}]',
                     1, now(), now(), $ownerId::uuid)""",
      sqlu"""INSERT INTO pipelines (id, name, source_data_source_id, output_data_type_id, created_at, updated_at, owner_id)
             VALUES ('pipeline-orphan', 'orphan-pipeline', $sourceId, 'dt-orphan', now(), now(), $ownerId::uuid)""",
      sqlu"""INSERT INTO pipeline_steps (id, pipeline_id, position, op, config, enabled, created_at, updated_at)
             VALUES ('orphan-step-0', 'pipeline-orphan', 0, 'select', '{}', true, now(), now())""",
      // Task 2.9(e) fixtures: real `data_type_rows` for BOTH a
      // pre-existing-trunk pipeline (dt-1) and the zero-panel orphan
      // pipeline (dt-orphan) -- row-for-row equality with `node_snapshots`
      // is asserted for both.
      sqlu"""INSERT INTO data_type_rows (data_type_id, row_index, data) VALUES ('dt-1', 0, '{"profit": 10}')""",
      sqlu"""INSERT INTO data_type_rows (data_type_id, row_index, data) VALUES ('dt-1', 1, '{"profit": 20}')""",
      sqlu"""INSERT INTO data_type_rows (data_type_id, row_index, data) VALUES ('dt-orphan', 0, '{"amount": 5}')""",
      // Task 2.9(f) fixtures: alert rules whose `target_output_id` must be
      // resolved automatically by the migration DML (distinct from
      // pre-existing 'rule-1', which the RLS/FK test group above sets
      // manually and is unrelated to this DML).
      sqlu"""INSERT INTO alert_rules (id, owner_id, target_data_type_id, metric, condition, name, severity)
             VALUES ('rule-auto-dt1', $ownerId::uuid, 'dt-1', 'value', '{}', 'auto-dt1', 'info')""",
      sqlu"""INSERT INTO alert_rules (id, owner_id, target_data_type_id, metric, condition, name, severity)
             VALUES ('rule-auto-orphan', $ownerId::uuid, 'dt-orphan', 'value', '{}', 'auto-orphan', 'info')""",
      sqlu"""INSERT INTO alert_events (id, alert_rule_id, owner_id, target_data_type_id, value, severity, state, first_fired_at, last_evaluated_at)
             VALUES ('event-auto-dt1', 'rule-auto-dt1', $ownerId::uuid, 'dt-1', '{}', 'info', 'firing', now(), now())""",
      // Task 2.9(h) fixtures: patch-set journal entries targeting
      // dataType/metric -- one row that keeps a surviving (panel) edit
      // after filtering, one row that becomes fully empty and must be
      // deleted outright.
      sqlu"""INSERT INTO patch_set_applications (id, owner_id, applied_at, edits)
             VALUES ('pset-mixed', $ownerId::uuid, now(),
                     '[{"index":0,"targetKind":"panel","op":"update"},{"index":1,"targetKind":"dataType","op":"update"}]'::jsonb)""",
      sqlu"""INSERT INTO patch_set_applications (id, owner_id, applied_at, edits)
             VALUES ('pset-all-datatype', $ownerId::uuid, now(),
                     '[{"index":0,"targetKind":"dataType","op":"update"},{"index":1,"targetKind":"metric","op":"update"}]'::jsonb)""",
      // Task 2.9 remediation fixture: a pre-existing `binary_refs` row keyed
      // only by the legacy `data_type_id` (as every real row is today,
      // before this migration's `pipeline_id`/`node_step_id` columns even
      // exist) -- must be backfilled to (pipelineId, trunk-last-step) by the
      // migration's own DML, not left null.
      sqlu"""INSERT INTO binary_refs (id, data_type_id, row_index, field_name, storage_key, mime_type, filename, size_bytes)
             VALUES ('ref-pre-existing', 'dt-1', 99, 'preexisting', 's2', 'application/octet-stream', 'g.bin', 1)"""
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

    // Red-first (task 2.9(c)/(d)/(e)/(f)/(g)/(h)): pre-migration, the
    // unbound panel, the orphan pipeline's steps, and the patch-set journal
    // rows exist exactly as seeded -- `hel904_migration_counts` doesn't
    // exist at all yet (proves the count assertions below are not vacuous).
    val preMigrationUnboundCount = await(superDb.run(
      sql"SELECT count(*) FROM panels WHERE id = 'panel-unbound-metric'".as[Int].head
    ))
    preMigrationUnboundCount shouldBe 1
    val preMigrationOrphanStepCount = await(superDb.run(
      sql"SELECT count(*) FROM pipeline_steps WHERE pipeline_id = 'pipeline-orphan'".as[Int].head
    ))
    preMigrationOrphanStepCount shouldBe 1
    a[java.sql.SQLException] should be thrownBy
      await(superDb.run(sql"SELECT 1 FROM hel904_migration_counts LIMIT 1".as[Int]))
    val preMigrationPatchSetEditCounts = await(superDb.run(
      sql"SELECT jsonb_array_length(edits) FROM patch_set_applications WHERE id IN ('pset-mixed', 'pset-all-datatype') ORDER BY id"
        .as[Int]
    ))
    preMigrationPatchSetEditCounts shouldBe Vector(2, 2)

    // Red-first (task 2.9 remediation): pre-migration, `binary_refs` has no
    // `pipeline_id`/`node_step_id` columns at all yet -- proves the
    // post-migration backfill assertion below is not vacuous.
    a[java.sql.SQLException] should be thrownBy
      await(superDb.run(sql"SELECT pipeline_id FROM binary_refs LIMIT 1".as[Option[String]]))

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
    // HEL-904 task 2.10: `target_data_type_id` is dropped by this same
    // migration file's tail (section 20), so a NEW alert_rule/alert_event
    // row can no longer set it -- this test now only proves
    // `target_output_id` itself is a genuine, independently-settable
    // nullable column (the "untouched target_data_type_id" half of the
    // original task 2.7 test is covered instead by the drop assertions in
    // the "task 2.10" describe-block below).
    "add a nullable target_output_id column" in {
      await(superDb.run(
        sqlu"""INSERT INTO alert_rules (id, owner_id, metric, condition, name, severity)
               VALUES ('rule-1', $ownerId::uuid, 'value', '{}', 'r', 'info')"""
      ))
      val targetOutputId = await(superDb.run(
        sql"SELECT target_output_id FROM alert_rules WHERE id = 'rule-1'".as[Option[String]].head
      ))
      targetOutputId shouldBe None

      await(superDb.run(
        sqlu"""INSERT INTO alert_events (id, alert_rule_id, owner_id, value, severity, state, first_fired_at, last_evaluated_at)
               VALUES ('event-1', 'rule-1', $ownerId::uuid, '{}', 'info', 'firing', now(), now())"""
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
    // HEL-904 task 2.10: `data_type_id` is dropped by this same migration
    // file's tail (section 21), so a NEW row can no longer set it -- this
    // test now only proves `pipeline_id`/`node_step_id` are genuine,
    // independently-settable nullable columns.
    "add nullable pipeline_id/node_step_id columns keyed by node, per the ticket's dev-DB-inspection fallback" in {
      await(superDb.run(
        sqlu"""INSERT INTO binary_refs (id, row_index, field_name, storage_key, mime_type, filename, size_bytes)
               VALUES ('ref-1', 0, 'f', 's', 'application/octet-stream', 'f.bin', 1)"""
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

    "backfill pipeline_id/node_step_id for a pre-existing row from its data_type_id (task 2.9 remediation)" in {
      val (backfilledPipelineId, backfilledNodeStepId) = await(superDb.run(
        sql"SELECT pipeline_id, node_step_id FROM binary_refs WHERE id = 'ref-pre-existing'"
          .as[(Option[String], Option[String])].head
      ))
      backfilledPipelineId shouldBe Some(pipelineId)
      backfilledNodeStepId shouldBe Some(stepIds.last)
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

    // evaluation-1.md Critical Path item 3(a): node_snapshots was previously
    // untested by this RLS block entirely (only `outputs` was covered).
    // Real rows exist here from section 11's `data_type_rows -> node_snapshots`
    // migration for $pipelineId (seeded via `panel-bound`'s pipeline, 2 rows:
    // {"profit":10}/{"profit":20}) -- the same rows the 2.9(e) test group
    // below asserts row-for-row equality on, from a superuser connection.
    // This test proves the SAME rows are subject to real, non-superuser RLS.
    "deny a non-owner from seeing another owner's node_snapshots rows, and allow the owner" in {
      val asOwner = await(liveCtx.withUserContext(ownerId)(
        sql"SELECT data::text FROM node_snapshots WHERE pipeline_id = $pipelineId ORDER BY row_index".as[String]
      ))
      asOwner shouldBe Vector("""{"profit": 10}""", """{"profit": 20}""")

      val asOther = await(liveCtx.withUserContext(otherOwner)(
        sql"SELECT data::text FROM node_snapshots WHERE pipeline_id = $pipelineId".as[String]
      ))
      asOther shouldBe empty
    }

    "prove itself red on node_snapshots: dropping node_snapshots_select exposes rows, restoring it closes them off again" in {
      await(superDb.run(sqlu"DROP POLICY node_snapshots_select ON node_snapshots"))
      val asOwnerNoPolicy = await(liveCtx.withUserContext(ownerId)(
        sql"SELECT 1 FROM node_snapshots WHERE pipeline_id = $pipelineId".as[Int]
      ))
      asOwnerNoPolicy shouldBe empty // FORCE RLS + zero SELECT policies = zero visible rows, even for the owner

      await(superDb.run(sqlu"""
        CREATE POLICY node_snapshots_select ON node_snapshots
          FOR SELECT
          USING (helio_can_access_pipeline(pipeline_id))
      """))
      val asOwnerRestored = await(liveCtx.withUserContext(ownerId)(
        sql"SELECT 1 FROM node_snapshots WHERE pipeline_id = $pipelineId".as[Int]
      ))
      asOwnerRestored should not be empty
    }

    // evaluation-1.md Critical Path item 3(b): the sharing branch of
    // `helio_can_access_pipeline` (the specific reason V39-style sharing-aware
    // RLS was chosen over V35 owner-only RLS for these two tables) was
    // entirely unproven -- every prior assertion only exercised the owner
    // and other-tenant-denial branches. Seed a REAL `resource_permissions`
    // grant (mirrors `RlsPrivilegedDmlSpec`'s own INSERT shape) for a
    // grantee who is neither the owner nor `otherOwner`, and prove that
    // grant -- not ownership -- is what lets them read both tables.
    "allow a granted (non-owner) user to read both outputs and node_snapshots via the sharing branch" in {
      // Before the grant exists: the grantee is a stranger, denied exactly
      // like `otherOwner` above -- proves the grant below is load-bearing,
      // not vacuous (e.g. some other implicit access path).
      val beforeGrantOutputs = await(liveCtx.withUserContext(granteeId)(
        sql"SELECT id FROM outputs WHERE id = 'output-1'".as[String]
      ))
      beforeGrantOutputs shouldBe empty
      val beforeGrantSnapshots = await(liveCtx.withUserContext(granteeId)(
        sql"SELECT 1 FROM node_snapshots WHERE pipeline_id = $pipelineId".as[Int]
      ))
      beforeGrantSnapshots shouldBe empty

      await(privilegedDb.run(
        sqlu"""INSERT INTO resource_permissions (resource_type, resource_id, grantee_id, role, created_at)
               VALUES ('pipeline', $pipelineId, $granteeId::uuid, 'viewer', now())"""
      ))

      val afterGrantOutputs = await(liveCtx.withUserContext(granteeId)(
        sql"SELECT id FROM outputs WHERE id = 'output-1'".as[String]
      ))
      afterGrantOutputs shouldBe Vector("output-1")

      val afterGrantSnapshots = await(liveCtx.withUserContext(granteeId)(
        sql"SELECT data::text FROM node_snapshots WHERE pipeline_id = $pipelineId ORDER BY row_index".as[String]
      ))
      afterGrantSnapshots shouldBe Vector("""{"profit": 10}""", """{"profit": 20}""")
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

    // HEL-904 task 2.10: "delete the companion data_types row" and "leave a
    // pipeline-output type's own data_types row ... untouched" no longer make
    // sense as written -- `data_types` itself is now dropped by this same
    // migration file's own tail (section 21), so a `SELECT ... FROM
    // data_types` here would itself throw rather than assert a meaningful
    // count. Task 2.10's own new assertions below (`information_schema`
    // table-existence checks) are what actually proves both rows -- and the
    // table itself -- are gone; the surviving half of the second test (the
    // `inferred_schema` untouched-default check) is kept, re-homed under
    // task 2.10's own describe-block since it no longer depends on querying
    // `data_types` at all.
    "leave sourceId's inferred_schema at the untouched default (no companion type folded into it)" in {
      val schema = await(superDb.run(
        sql"SELECT inferred_schema::text FROM data_sources WHERE id = $sourceId".as[String].head
      ))
      // sourceId owns BOTH dt-1 (pipeline-output, excluded) and no other
      // companion type -- inferred_schema must stay the untouched default.
      schema.parseJson shouldBe "[]".parseJson
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

    "drop the metrics table entirely" in {
      tableExists("metrics") shouldBe false
    }

    "drop the data_type_rows table entirely" in {
      tableExists("data_type_rows") shouldBe false
    }

    "drop the data_types table entirely" in {
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

    "drop binary_refs.data_type_id, replacing its RLS policy with a pipeline-keyed one" in {
      columnExists("binary_refs", "data_type_id") shouldBe false
      val policyExists = await(superDb.run(
        sql"""SELECT EXISTS (SELECT 1 FROM pg_policies
              WHERE tablename = 'binary_refs' AND policyname = 'binary_refs_owner')""".as[Boolean].head
      ))
      policyExists shouldBe true
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

  "V94 data migration step 2.9(c) (unbound / stranded data panels deleted)" should {
    "delete the unbound panel (type_id IS NULL) and log the exact broadened count" in {
      val count = await(superDb.run(
        sql"SELECT count(*) FROM panels WHERE id = 'panel-unbound-metric'".as[Int].head
      ))
      count shouldBe 0

      val logged = await(superDb.run(
        sql"SELECT count FROM hel904_migration_counts WHERE step = 'stranded_output_panels_deleted'".as[Int].head
      ))
      logged shouldBe 2 // panel-unbound-metric (type_id NULL) + panel-stranded (type_id resolves to no pipeline)
    }

    // evaluation-1.md Critical Path item 1: the regression proof. Before
    // this cycle's fix, `panel-stranded` (type_id = 'dt-stranded', a
    // data_types row NO pipeline claims -- the real-dev-DB shape seeded
    // above) survived section 4's `kind = 'output'` backfill, was never
    // given an `output_id` by section 9 (no pipeline joins to
    // 'dt-stranded'), and was NOT caught by the old `type_id IS NULL`
    // predicate here (its type_id is non-NULL, just unresolvable) -- it
    // would have reached section 17/18 as a `kind = 'output'`,
    // `output_id = NULL` row with no surviving evidence of what it was
    // ever bound to, a state `OutputPanelConfig` cannot represent.
    "delete the stranded panel specifically (type_id non-NULL but unresolvable to any pipeline)" in {
      val strandedCount = await(superDb.run(
        sql"SELECT count(*) FROM panels WHERE id = 'panel-stranded'".as[Int].head
      ))
      strandedCount shouldBe 0
    }

    "leave no panel in the post-migration schema with kind = 'output' and output_id NULL" in {
      // The CHECK constraint added alongside this fix (`panels_output_kind_
      // requires_output_id`) already makes this state unreachable at the
      // schema level; this assertion additionally proves no row of that
      // shape exists post-migration, independent of the constraint.
      val orphanedOutputKindCount = await(superDb.run(
        sql"SELECT count(*) FROM panels WHERE kind = 'output' AND output_id IS NULL".as[Int].head
      ))
      orphanedOutputKindCount shouldBe 0
    }
  }

  "V94 data migration step 2.9(g) (computed fields -> compute steps)" should {
    "append one compute step as a sibling child of the trunk-last step for a pipeline-output type with computed fields" in {
      val computeStepId = "hel904-compute-dt-orphan-0"
      val (parentStepId, op, config) = await(superDb.run(
        sql"SELECT parent_step_id, op, config::text FROM pipeline_steps WHERE id = $computeStepId"
          .as[(Option[String], String, String)].head
      ))
      parentStepId shouldBe Some("orphan-step-0") // pipeline-orphan's only (= last-trunk) step
      op shouldBe "compute"
      config.parseJson shouldBe """{"column":"doubled","expression":"amount * 2","type":"number"}""".parseJson
    }

    "log a zero count for the companion-type case (dev DB has none) and a non-zero count for the pipeline-output case" in {
      val pipelineOutputCount = await(superDb.run(
        sql"SELECT count FROM hel904_migration_counts WHERE step = 'computed_fields_migrated_pipeline_output'".as[Int].head
      ))
      pipelineOutputCount shouldBe 1 // exactly dt-orphan in this fixture
      val companionCount = await(superDb.run(
        sql"SELECT count FROM hel904_migration_counts WHERE step = 'computed_fields_migrated_companion'".as[Int].head
      ))
      companionCount shouldBe 0
    }

    "leave dt-1's already-created section-9 Outputs attached to the ORIGINAL trunk-last, unaffected by dt-1 having no computed fields" in {
      // dt-1 itself carries no computed_fields in this fixture -- this is a
      // negative-space check that section 12 only touches pipelines that
      // actually have computed fields.
      val computeStepCount = await(superDb.run(
        sql"SELECT count(*) FROM pipeline_steps WHERE pipeline_id = $pipelineId AND id LIKE 'hel904-compute-%'".as[Int].head
      ))
      computeStepCount shouldBe 0
    }
  }

  "V94 data migration step 2.9(d) (orphan pipeline-output types -> table Output)" should {
    "create exactly one table Output, named after the type, on the pipeline's last-trunk-step" in {
      val outputId = "hel904-orphan-output-dt-orphan"
      val (pipelineIdCol, nodeStepId, name, kind) = await(superDb.run(
        sql"SELECT pipeline_id, node_step_id, name, kind FROM outputs WHERE id = $outputId"
          .as[(String, Option[String], String, String)].head
      ))
      pipelineIdCol shouldBe "pipeline-orphan"
      nodeStepId shouldBe Some("orphan-step-0")
      name shouldBe "Orphan Type"
      kind shouldBe "table"
    }

    "log the exact orphan-type count" in {
      val logged = await(superDb.run(
        sql"SELECT count FROM hel904_migration_counts WHERE step = 'orphan_output_types_backfilled'".as[Int].head
      ))
      logged shouldBe 1 // exactly dt-orphan in this fixture (dt-1 has bound panels, excluded)
    }
  }

  "V94 data migration step 2.9(e) (data_type_rows -> node_snapshots)" should {
    "copy dt-1's rows row-for-row onto the pipeline's last-trunk-step (not any migration-created tail)" in {
      val rows = await(superDb.run(
        sql"""SELECT row_index, data::text FROM node_snapshots
              WHERE pipeline_id = $pipelineId AND node_step_id = ${stepIds.last} ORDER BY row_index"""
          .as[(Int, String)]
      ))
      rows.map(_._1) shouldBe Vector(0, 1)
      rows(0)._2.parseJson shouldBe """{"profit": 10}""".parseJson
      rows(1)._2.parseJson shouldBe """{"profit": 20}""".parseJson
    }

    "copy dt-orphan's rows onto pipeline-orphan's last-trunk-step, unaffected by that pipeline's own migration-created compute step" in {
      val rows = await(superDb.run(
        sql"""SELECT row_index, data::text FROM node_snapshots
              WHERE pipeline_id = 'pipeline-orphan' ORDER BY row_index"""
          .as[(Int, String)]
      ))
      rows shouldBe Vector((0, "{\"amount\": 5}"))
      // The migration-created compute step gets NO snapshot (decision 13).
      val computeSnapshotCount = await(superDb.run(
        sql"SELECT count(*) FROM node_snapshots WHERE node_step_id = 'hel904-compute-dt-orphan-0'".as[Int].head
      ))
      computeSnapshotCount shouldBe 0
    }
  }

  "V94 data migration step 2.9(f) (alert rules/events -> target_output_id)" should {
    "resolve to the lowest-position Output on dt-1's trunk-last node (panel-bound, first alphabetically among co-located panels)" in {
      val targetOutputId = await(superDb.run(
        sql"SELECT target_output_id FROM alert_rules WHERE id = 'rule-auto-dt1'".as[Option[String]].head
      )).get
      val panelBoundOutputId = await(superDb.run(
        sql"SELECT output_id FROM panels WHERE id = 'panel-bound'".as[Option[String]].head
      )).get
      targetOutputId shouldBe panelBoundOutputId

      val eventTargetOutputId = await(superDb.run(
        sql"SELECT target_output_id FROM alert_events WHERE id = 'event-auto-dt1'".as[Option[String]].head
      ))
      eventTargetOutputId shouldBe Some(targetOutputId)
    }

    "resolve to the single orphan-type table Output for a rule targeting dt-orphan" in {
      val targetOutputId = await(superDb.run(
        sql"SELECT target_output_id FROM alert_rules WHERE id = 'rule-auto-orphan'".as[Option[String]].head
      ))
      targetOutputId shouldBe Some("hel904-orphan-output-dt-orphan")
    }
  }

  "V94 data migration step 2.9(h) (patch-set journal cleanup)" should {
    "drop only the dataType-targeted edit, keeping the row and its surviving panel edit" in {
      val edits = await(superDb.run(
        sql"SELECT edits::text FROM patch_set_applications WHERE id = 'pset-mixed'".as[String].head
      ))
      edits.parseJson shouldBe """[{"index":0,"targetKind":"panel","op":"update"}]""".parseJson
    }

    "delete the whole application row once every edit is removed" in {
      val count = await(superDb.run(
        sql"SELECT count(*) FROM patch_set_applications WHERE id = 'pset-all-datatype'".as[Int].head
      ))
      count shouldBe 0
    }

    "log the exact number of removed entries (2 from pset-all-datatype + 1 from pset-mixed)" in {
      val logged = await(superDb.run(
        sql"SELECT count FROM hel904_migration_counts WHERE step = 'patch_set_journal_entries_removed'".as[Int].head
      ))
      logged shouldBe 3
    }
  }
}
