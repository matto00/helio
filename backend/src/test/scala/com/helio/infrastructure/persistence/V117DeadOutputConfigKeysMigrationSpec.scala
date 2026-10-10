package com.helio.infrastructure.persistence

import com.helio.domain.model.OutputKind
import com.helio.services.pipelines.OutputConfigValidation
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import com.helio.testkit.VerifiedEmbeddedPostgres
import org.flywaydb.core.Flyway
import org.flywaydb.core.api.MigrationVersion
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.sql.{Connection, DriverManager, ResultSet}
import scala.io.Source

/** HEL-1387: V117 repairs the dead Output config keys V94 (HEL-904) and HEL-877 left behind.
 *
 *  Why this shape (see FlywayNonSuperuserMigrationSpec's header for the full story): `outputs` has
 *  FORCE ROW LEVEL SECURITY with `missing_ok` policies, so an UPDATE by Flyway's non-BYPASSRLS,
 *  table-owning `helio` connection matches ZERO rows silently when the NO FORCE bracket is missing,
 *  and V117's own in-migration guard shares that blindness. So: the chain runs as a genuine
 *  NOSUPERUSER/NOBYPASSRLS schema owner, and every dead-key count is read over the superuser
 *  connection, which RLS cannot hide anything from. The pre-V94 fixture is the real
 *  `hel904-real-dump.sql`, with the legacy panel columns set so V94 ITSELF writes the dead keys.
 */
class V117DeadOutputConfigKeysMigrationSpec extends AnyWordSpec with Matchers {

  private val DeadWhere =
    """(jsonb_typeof(config) = 'object' AND (jsonb_exists_any(config, ARRAY['metricLabel', 'metricUnit', 'chartAnnotation', 'collectionOptions', 'timelineOptions',
      |   'columnWidths', 'tableDensity', 'legend', 'tooltip', 'seriesColors', 'axisLabels'])
      | OR (kind NOT IN ('metric', 'collection') AND jsonb_exists(config, 'format'))
      | OR (kind <> 'table' AND jsonb_exists(config, 'columnOrder'))
      | OR (kind <> 'chart' AND jsonb_exists(config, 'chartOptions'))))""".stripMargin

  private def rows[T](c: Connection, sql: String)(f: ResultSet => T): Vector[T] = {
    val st = c.createStatement()
    try {
      val rs = st.executeQuery(sql)
      try Iterator.continually(rs).takeWhile(_.next()).map(f).toVector
      finally rs.close()
    } finally st.close()
  }
  private def exec(c: Connection, sql: String): Unit = { val st = c.createStatement(); try st.execute(sql) finally st.close() }
  private def count(c: Connection, sql: String): Int = rows(c, sql)(_.getInt(1)).head
  private def json(s: String): JsObject = s.parseJson.asJsObject

  private type AuditRow = (String, String, String, Option[String], JsValue)
  private def auditRows(c: Connection, where: String = "true"): Set[AuditRow] =
    rows(c, s"SELECT output_id, config_key, action, live_key, config_value::text FROM hel1387_dropped_output_config_keys WHERE $where") { rs =>
      (rs.getString(1), rs.getString(2), rs.getString(3), Option(rs.getString(4)), rs.getString(5).parseJson)
    }.toSet
  private def configs(c: Connection): Map[String, (String, JsObject)] =
    rows(c, "SELECT id, kind, config::text FROM outputs WHERE jsonb_typeof(config) = 'object'")(rs => rs.getString(1) -> (rs.getString(2), json(rs.getString(3)))).toMap

  private val RenameKind = Map("metricLabel" -> ("metric", "label"), "metricUnit" -> ("metric", "unit"),
    "chartAnnotation" -> ("chart", "annotation"), "collectionOptions" -> ("collection", "layout"), "timelineOptions" -> ("timeline", "sort"))
  private val NoEquivalent = Set("columnWidths", "tableDensity", "legend", "tooltip", "seriesColors", "axisLabels")
  private val Accepts = Map("format" -> Set("metric", "collection"), "columnOrder" -> Set("table"), "chartOptions" -> Set("chart"))

  /** Independent statement of the contract for a hel904 Output (every dead value valid, no live key present). */
  private def expectedAction(kind: String, key: String): Option[(String, Option[String])] =
    if (RenameKind.contains(key)) {
      val (rk, live) = RenameKind(key)
      if (kind == rk) Some(("renamed", Some(live))) else Some(("kind-inapplicable", None))
    } else if (NoEquivalent.contains(key)) Some(("no-live-equivalent", None))
    else if (Accepts.contains(key)) { if (Accepts(key).contains(kind)) None else Some(("kind-inapplicable", None)) }
    else None

  "V117, run as a NOBYPASSRLS table-owning role over a real pre-V94 dump" should {
    "rename/drop the dead keys, audit them, stay idempotent and keep the audit table admin-only" in {
      val pg = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified"))
      try {
        val superDs = pg.getPostgresDatabase
        val su = superDs.getConnection
        try {
          exec(su, "CREATE ROLE helio_migration_test LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD 'test'")
          exec(su, "ALTER SCHEMA public OWNER TO helio_migration_test")
          exec(su, "GRANT CREATE, USAGE ON SCHEMA public TO helio_migration_test")
          exec(su, "CREATE ROLE helio_privileged BYPASSRLS NOLOGIN")
          exec(su, "GRANT helio_privileged TO helio_migration_test WITH ADMIN OPTION")
        } finally su.close()

        val url = pg.getJdbcUrl("helio_migration_test", "postgres")
        def flyway(target: Option[String]) = {
          val b = Flyway.configure().dataSource(url, "helio_migration_test", "test").locations("classpath:db/migration")
          target.foreach(t => b.target(MigrationVersion.fromVersion(t)))
          b.load()
        }
        // Prove the migration role really is the prod shape, and that helio_privileged really bypasses RLS.
        val sc0 = superDs.getConnection
        try {
          rows(sc0, "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'helio_migration_test'")(r => (r.getBoolean(1), r.getBoolean(2))) shouldBe Vector((false, false))
          rows(sc0, "SELECT rolbypassrls FROM pg_roles WHERE rolname = 'helio_privileged'")(_.getBoolean(1)) shouldBe Vector(true)
        } finally sc0.close()

        flyway(Some("93")).migrate()

        // ── Real dump + legacy panel columns set on every panel so V94 itself writes the dead keys ──
        val sc = superDs.getConnection
        var chartPanelId, metricPanelId = ""
        try {
          exec(sc, """TRUNCATE TABLE users, data_sources, data_types, pipelines, pipeline_steps, panels,
                     |dashboards, metrics, binary_refs, data_type_rows, patch_set_applications RESTART IDENTITY CASCADE""".stripMargin)
          val dump = { val s = Source.fromResource("db/fixtures/hel904-real-dump.sql"); try s.mkString finally s.close() }
          exec(sc, dump)
          exec(sc, "SET search_path TO public")
          exec(sc,
            """UPDATE panels SET metric_label = 'Fixture label', metric_unit = 'Fixture unit', chart_annotation = 'Fixture note',
              |  column_widths = '{"a": 100}', table_density = 'compact', column_order = '["a"]', chart_options = '{"legend": true}',
              |  collection_options = '{"baseType": "metric", "layout": "list", "itemOptions": {"x": 1}}', timeline_options = '{"sort": "desc"}'""".stripMargin)
          // Q3 `format` only comes from `metric_id` panels: bind one chart and one metric panel to a real metrics row.
          def outputPanel(kind: String) = rows(sc,
            s"""SELECT p.id FROM panels p JOIN pipelines pl ON pl.output_data_type_id = p.type_id
               |WHERE p.type = '$kind' AND p.metric_id IS NULL ORDER BY p.id LIMIT 1""".stripMargin)(_.getString(1)).head
          chartPanelId = outputPanel("chart"); metricPanelId = outputPanel("metric")
          exec(sc, s"UPDATE panels SET metric_id = '6df6f851-b58a-4448-b249-e44369f9bc82' WHERE id IN ('$chartPanelId', '$metricPanelId')")
        } finally sc.close()

        flyway(Some("116")).migrate()

        // ── Post-V94 edge Outputs (superuser insert) ──
        val ec = superDs.getConnection
        try {
          // Copy a real Output's placement (node_step_id/root_id must satisfy outputs_root_id_matches_node_step_id).
          val (pipelineId, ownerId, nodeStep, rootId) = rows(ec, "SELECT pipeline_id, owner_id::text, node_step_id, root_id FROM outputs LIMIT 1")(
            r => (r.getString(1), r.getString(2), r.getString(3), r.getString(4))).head
          def lit(o: String) = if (o == null) "NULL" else s"'$o'"
          def ins(id: String, kind: String, cfg: String): Unit =
            exec(ec, s"""INSERT INTO outputs (id, pipeline_id, node_step_id, root_id, owner_id, name, kind, config, position, created_at, updated_at)
                        |VALUES ('$id', '$pipelineId', ${lit(nodeStep)}, ${lit(rootId)}, '$ownerId'::uuid, '$id', '$kind', '$cfg'::jsonb, 900, now(), '2026-01-02T03:04:05Z')""".stripMargin)
          ins("e-null-live", "chart", """{"annotation": null, "chartAnnotation": "Q3 dip", "chartType": "bar"}""")
          ins("e-live-wins", "collection", """{"layout": "grid", "collectionOptions": {"layout": "list", "baseType": "metric"}}""")
          ins("e-bad-layout", "collection", """{"collectionOptions": {"layout": "tile"}}""")
          ins("e-bad-label", "metric", """{"metricLabel": 42}""")
          ins("e-wrong-kind", "chart", """{"metricLabel": "x"}""")
          ins("e-table", "table", """{"columnOrder": ["a"], "chartOptions": {"legend": true}}""")
          ins("e-markdown", "markdown", """{"format": "x", "content": "hi"}""")
          ins("e-legend", "chart", """{"chartType": "bar", "legend": {"show": true}, "tooltip": false, "seriesColors": ["#fff"], "axisLabels": {}}""")
          ins("e-null-sort", "timeline", """{"timelineOptions": {"sort": null}}""")
          ins("e-null-unit", "metric", """{"metricUnit": null}""")
          ins("e-nonhel904", "metric", """{"metricLabel": "Revenue", "metricUnit": "USD"}""")
          ins("e-sort", "timeline", """{"timelineOptions": {"sort": "desc"}, "sort": null}""")
          ins("e-readd", "metric", """{"unit": "u"}""")
          ins("e-array-config", "metric", """["metricLabel"]""")
          ins("e-bad-sort", "timeline", """{"timelineOptions": {"sort": "sideways"}}""")
          ins("e-table-format", "table", """{"format": "x", "columnOrder": ["a"]}""")
          ins("e-control", "metric", """{"label": "Keep", "unit": "u", "format": "x", "aggregation": null}""")
        } finally ec.close()

        // ── Snapshot over the superuser connection before V117 ──
        val sPre = superDs.getConnection
        val (preConfigs, preUpdated, preDead, preDeadKeys, chartFormatPre, metricFormatPre) =
          try {
            val cfgs = configs(sPre)
            val upd = rows(sPre, "SELECT id, updated_at::text FROM outputs")(r => r.getString(1) -> r.getString(2)).toMap
            val deadKeyCounts = Seq("metricLabel", "metricUnit", "chartAnnotation", "collectionOptions", "timelineOptions", "columnWidths",
              "tableDensity", "legend", "tooltip", "seriesColors", "axisLabels", "format", "columnOrder", "chartOptions")
            (cfgs, upd, count(sPre, s"SELECT count(*) FROM outputs WHERE $DeadWhere"), deadKeyCounts,
              cfgs(s"hel904-output-$chartPanelId")._2.fields.get("format"), cfgs(s"hel904-output-$metricPanelId")._2.fields.get("format"))
          } finally sPre.close()
        withClue("fixture must put dead keys on real Outputs: ") { preDead should be > 10 }
        chartFormatPre should not be empty
        metricFormatPre should not be empty
        val hel904Pre = preConfigs.filter(_._1.startsWith("hel904-output-"))
        hel904Pre.values.map(_._1).toSet should contain allOf ("metric", "chart")
        info(s"pre-V117: ${preConfigs.size} outputs, $preDead with dead keys; hel904 kinds ${hel904Pre.values.map(_._1).groupBy(identity).view.mapValues(_.size).toMap}")
        preDeadKeys should not be empty

        // AC7 non-vacuity: before V117 the key-set and (empty stored) validation checks FAIL.
        def keysOk(kind: String, cfg: JsObject) = cfg.fields.keySet.subsetOf(OutputConfigValidation.KnownKeys(OutputKind.fromString(kind).toOption.get))
        def valid(kind: String, cfg: JsObject, stored: JsObject) = OutputConfigValidation.validate(OutputKind.fromString(kind).toOption.get, cfg, stored)
        preConfigs.values.exists { case (k, c) => !keysOk(k, c) } shouldBe true
        preConfigs.values.exists { case (k, c) => valid(k, c, JsObject.empty).isLeft } shouldBe true

        // ── V117 via Flyway, as the NOBYPASSRLS owner ──
        noException should be thrownBy flyway(Some("117")).migrate() // HEL-1410: pinned -- V118 rewrites the metric `format` this spec asserts byte-identical

        val sPost = superDs.getConnection
        try {
          // Backstop: dead keys counted over a connection RLS cannot hide anything from.
          count(sPost, s"SELECT count(*) FROM outputs WHERE $DeadWhere") shouldBe 0
          val post = configs(sPost)
          post.keySet shouldBe preConfigs.keySet
          rows(sPost, "SELECT id, updated_at::text FROM outputs")(r => r.getString(1) -> r.getString(2)).toMap shouldBe preUpdated

          // hel904 Outputs: exact audit contract + exact resulting configs.
          val allAudit = auditRows(sPost)
          for ((id, (kind, cfgPre)) <- hel904Pre) {
            val expected = cfgPre.fields.keys.toSeq.flatMap(k => expectedAction(kind, k).map(a => (id, k, a._1, a._2, cfgPre.fields(k)))).toSet
            withClue(s"$id ($kind) audit rows: ") { allAudit.filter(_._1 == id) shouldBe expected }
            val cfgPost = post(id)._2
            withClue(s"$id ($kind) config: ") {
              val renamed = expected.collect { case (_, k, "renamed", Some(live), v) =>
                live -> (if (k == "collectionOptions") v.asJsObject.fields("layout") else if (k == "timelineOptions") v.asJsObject.fields("sort") else v) }
              val kept = cfgPre.fields.filter { case (k, _) => expectedAction(kind, k).isEmpty }
              cfgPost.fields shouldBe (kept ++ renamed)
            }
          }
          allAudit.exists(r => r._1 == s"hel904-output-$chartPanelId" && r._2 == "format" && r._3 == "kind-inapplicable") shouldBe true
          post(s"hel904-output-$metricPanelId")._2.fields.get("format") shouldBe metricFormatPre
          post(s"hel904-output-$chartPanelId")._2.fields.get("format") shouldBe None
          post(s"hel904-output-$chartPanelId")._2.fields("annotation") shouldBe JsString("Fixture note")

          // Edge Outputs: exact configs.
          def cfgOf(id: String) = post(id)._2
          cfgOf("e-null-live") shouldBe json("""{"annotation": "Q3 dip", "chartType": "bar"}""")
          cfgOf("e-live-wins") shouldBe json("""{"layout": "grid"}""")
          cfgOf("e-bad-layout") shouldBe json("{}")
          cfgOf("e-bad-label") shouldBe json("{}")
          cfgOf("e-wrong-kind") shouldBe json("{}")
          cfgOf("e-table") shouldBe json("""{"columnOrder": ["a"]}""")
          cfgOf("e-markdown") shouldBe json("""{"content": "hi"}""")
          cfgOf("e-legend") shouldBe json("""{"chartType": "bar"}""")
          cfgOf("e-null-sort") shouldBe json("{}")
          cfgOf("e-null-unit") shouldBe json("{}")
          cfgOf("e-nonhel904") shouldBe json("""{"label": "Revenue", "unit": "USD"}""")
          cfgOf("e-sort") shouldBe json("""{"sort": "desc"}""")
          cfgOf("e-readd") shouldBe json("""{"unit": "u"}""")
          // A non-object config is neither crashed on nor touched: byte-identical, no audit row.
          rows(sPost, "SELECT config::text FROM outputs WHERE id = 'e-array-config'")(_.getString(1)) shouldBe Vector("""["metricLabel"]""")
          auditRows(sPost, "output_id = 'e-array-config'") shouldBe Set.empty[AuditRow]
          cfgOf("e-bad-sort") shouldBe json("{}")
          a0("e-bad-sort") shouldBe Set(("e-bad-sort", "timelineOptions", "invalid-value", None, json("""{"sort": "sideways"}""")))
          cfgOf("e-table-format") shouldBe json("""{"columnOrder": ["a"]}""")
          a0("e-table-format") shouldBe Set(("e-table-format", "format", "kind-inapplicable", None, JsString("x")))
          cfgOf("e-control") shouldBe json("""{"label": "Keep", "unit": "u", "format": "x", "aggregation": null}""")

          def a0(id: String) = auditRows(sPost, s"output_id = '$id'")
          // Edge Outputs: exact audit rows (key, action, live_key, full original value).
          def a(id: String) = auditRows(sPost, s"output_id = '$id'")
          a("e-null-live") shouldBe Set(("e-null-live", "chartAnnotation", "renamed", Some("annotation"), JsString("Q3 dip")))
          a("e-live-wins") shouldBe Set(("e-live-wins", "collectionOptions", "shadowed-by-live", None, json("""{"layout": "list", "baseType": "metric"}""")))
          a("e-bad-layout") shouldBe Set(("e-bad-layout", "collectionOptions", "invalid-value", None, json("""{"layout": "tile"}""")))
          a("e-bad-label") shouldBe Set(("e-bad-label", "metricLabel", "invalid-value", None, JsNumber(42)))
          a("e-wrong-kind") shouldBe Set(("e-wrong-kind", "metricLabel", "kind-inapplicable", None, JsString("x")))
          a("e-table") shouldBe Set(("e-table", "chartOptions", "kind-inapplicable", None, json("""{"legend": true}""")))
          a("e-markdown") shouldBe Set(("e-markdown", "format", "kind-inapplicable", None, JsString("x")))
          a("e-legend") shouldBe Set(
            ("e-legend", "legend", "no-live-equivalent", None, json("""{"show": true}""")),
            ("e-legend", "tooltip", "no-live-equivalent", None, JsBoolean(false)),
            ("e-legend", "seriesColors", "no-live-equivalent", None, JsArray(JsString("#fff"))),
            ("e-legend", "axisLabels", "no-live-equivalent", None, json("{}")))
          a("e-null-sort") shouldBe Set(("e-null-sort", "timelineOptions", "null-value", None, json("""{"sort": null}""")))
          a("e-null-unit") shouldBe Set(("e-null-unit", "metricUnit", "null-value", None, JsNull))
          a("e-nonhel904") shouldBe Set(
            ("e-nonhel904", "metricLabel", "renamed", Some("label"), JsString("Revenue")),
            ("e-nonhel904", "metricUnit", "renamed", Some("unit"), JsString("USD")))
          a("e-sort") shouldBe Set(("e-sort", "timelineOptions", "renamed", Some("sort"), json("""{"sort": "desc"}""")))
          a("e-readd") shouldBe Set.empty[AuditRow]
          a("e-control") shouldBe Set.empty[AuditRow]

          // AC7: every migrated config is accepted by HEL-1313's validation, empty-stored and round-tripped.
          for ((id, (kind, cfg)) <- post) withClue(s"$id ($kind): ") {
            keysOk(kind, cfg) shouldBe true
            valid(kind, cfg, JsObject.empty) shouldBe Right(())
            valid(kind, cfg, cfg) shouldBe Right(())
          }

          // ── Idempotency 1: re-execute the V117 file as the role -- nothing changes. ──
          val v117 = { val s = Source.fromResource("db/migration/V117__migrate_v94_dead_output_config_keys.sql"); try s.mkString finally s.close() }
          val roleConn = DriverManager.getConnection(url, "helio_migration_test", "test")
          try {
            exec(roleConn, v117)
            configs(sPost) shouldBe post
            auditRows(sPost) shouldBe allAudit
            count(sPost, "SELECT count(*) FROM hel1387_dropped_output_config_keys") shouldBe allAudit.size

            // ── Idempotency 2: put a single top-level dead key back; the re-run repairs it and adds exactly one audit row. ──
            exec(sPost, """UPDATE outputs SET config = config || '{"metricLabel": "Back"}'::jsonb WHERE id = 'e-readd'""")
            exec(roleConn, v117)
            cfgOf2(sPost, "e-readd") shouldBe json("""{"unit": "u", "label": "Back"}""")
            auditRows(sPost, "output_id = 'e-readd'") shouldBe Set(("e-readd", "metricLabel", "renamed", Some("label"), JsString("Back")))
            count(sPost, "SELECT count(*) FROM hel1387_dropped_output_config_keys") shouldBe allAudit.size + 1
            count(sPost, s"SELECT count(*) FROM outputs WHERE $DeadWhere") shouldBe 0

            // ── Audit-table posture: invisible to the ordinary role, visible to the privileged pool and the superuser. ──
            val n = allAudit.size + 1
            exec(roleConn, "SELECT set_config('app.current_user_id', '00000000-0000-0000-0000-000000000001', false)")
            count(roleConn, "SELECT count(*) FROM hel1387_dropped_output_config_keys") shouldBe 0
            exec(roleConn, "SET ROLE helio_privileged")
            count(roleConn, "SELECT count(*) FROM hel1387_dropped_output_config_keys") shouldBe n
            exec(roleConn, "RESET ROLE")
            count(sPost, "SELECT count(*) FROM hel1387_dropped_output_config_keys") shouldBe n
            // FORCE RLS is back on for both tables.
            rows(sPost, "SELECT relname, relforcerowsecurity FROM pg_class WHERE relname IN ('outputs', 'hel1387_dropped_output_config_keys') ORDER BY relname")(r => r.getString(1) -> r.getBoolean(2)) shouldBe
              Vector("hel1387_dropped_output_config_keys" -> true, "outputs" -> true)
          } finally roleConn.close()
        } finally sPost.close()
      } finally pg.close()
    }
  }

  private def cfgOf2(c: Connection, id: String): JsObject = json(rows(c, s"SELECT config::text FROM outputs WHERE id = '$id'")(_.getString(1)).head)
}
