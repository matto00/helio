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

/** HEL-1410: V118 maps the legacy object-valued `format` V94 (HEL-904) copied onto metric/collection Outputs to a
 *  string format the readers accept, moves the legacy text into the live `unit` (never overwriting a non-null one)
 *  and records every original in `hel1410_migrated_output_formats`.
 *
 *  Same harness and reasoning as V117DeadOutputConfigKeysMigrationSpec: the chain runs as a genuine
 *  NOSUPERUSER/NOBYPASSRLS schema owner (a missing `outputs` NO FORCE bracket makes the UPDATE match zero rows
 *  SILENTLY, and the migration's own guard shares that blindness), and every residual count is read over the
 *  superuser connection. V94 ITSELF produces the three dump-derived object formats.
 */
class V118LegacyMetricFormatMigrationSpec extends AnyWordSpec with Matchers {

  private val ObjectWhere = "kind IN ('metric', 'collection') AND jsonb_typeof(config) = 'object' AND jsonb_typeof(config -> 'format') = 'object'"
  private val FormatSet = Set("number", "integer", "currency", "percent")

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

  /** (output_id, kind, original_format, new_format, prior_unit, unit_action, unit_written, approximations) */
  private type AuditRow = (String, String, JsValue, String, Option[JsValue], String, Option[String], Vector[String])
  private def auditRows(c: Connection, where: String = "true"): Set[AuditRow] =
    rows(c, s"""SELECT output_id, output_kind, original_format::text, new_format, prior_unit::text, unit_action, unit_written,
               |array_to_string(approximations, ',') FROM hel1410_migrated_output_formats WHERE $where""".stripMargin) { rs =>
      (rs.getString(1), rs.getString(2), rs.getString(3).parseJson, rs.getString(4), Option(rs.getString(5)).map(_.parseJson),
        rs.getString(6), Option(rs.getString(7)), Option(rs.getString(8)).filter(_.nonEmpty).map(_.split(",").toVector).getOrElse(Vector.empty))
    }.toSet
  private def configs(c: Connection): Map[String, (String, JsObject)] =
    rows(c, "SELECT id, kind, config::text FROM outputs WHERE jsonb_typeof(config) = 'object'")(rs => rs.getString(1) -> (rs.getString(2), json(rs.getString(3)))).toMap

  /** One post-V117 edge Output: its input config, the exact expected config and the exact expected audit contract. */
  private case class Edge(id: String, kind: String, input: String, expected: String, newFormat: String,
                          priorUnit: Option[String], action: String, written: Option[String], approx: Vector[String])

  private val Edges = Vector(
    Edge("m-currency", "metric", """{"format": {"prefix": " $ ", "decimals": 2}}""", """{"format": "currency"}""", "currency", None, "no-text", None, Vector.empty),
    Edge("m-currency-nodec", "metric", """{"format": {"prefix": "$"}}""", """{"format": "currency"}""", "currency", None, "no-text", None, Vector.empty),
    Edge("m-currency-dec-string", "metric", """{"format": {"prefix": "$", "decimals": "2"}}""", """{"format": "currency"}""", "currency", None, "no-text", None, Vector("decimals-ignored")),
    Edge("m-currency-2point0", "metric", """{"format": {"prefix": "$", "decimals": 2.0}}""", """{"format": "currency"}""", "currency", None, "no-text", None, Vector.empty),
    Edge("m-dollar-int", "metric", """{"format": {"prefix": "$", "decimals": 0}}""", """{"format": "integer", "unit": "$"}""", "integer", None, "written", Some("$"), Vector("prefix-after-value")),
    Edge("m-dollar-1", "metric", """{"format": {"prefix": "$", "decimals": 1}}""", """{"format": "number", "unit": "$"}""", "number", None, "written", Some("$"), Vector("decimals-not-fixed", "prefix-after-value")),
    Edge("m-euro", "metric", """{"label": "Keep", "format": {"prefix": "€"}}""", """{"label": "Keep", "format": "number", "unit": "€"}""", "number", None, "written", Some("€"), Vector("prefix-after-value")),
    Edge("m-dec3", "metric", """{"format": {"unit": "kg", "decimals": 3}}""", """{"format": "number", "unit": "kg"}""", "number", None, "written", Some("kg"), Vector("decimals-capped")),
    Edge("m-dec-string", "metric", """{"format": {"decimals": "2", "suffix": "x"}}""", """{"format": "number", "unit": "x"}""", "number", None, "written", Some("x"), Vector("decimals-ignored")),
    Edge("m-dec-neg", "metric", """{"format": {"decimals": -1, "unit": "u"}}""", """{"format": "number", "unit": "u"}""", "number", None, "written", Some("u"), Vector("decimals-ignored")),
    Edge("m-nulls", "metric", """{"format": {"decimals": null, "prefix": null, "unit": null, "suffix": null}}""", """{"format": "number"}""", "number", None, "no-text", None, Vector.empty),
    Edge("m-pct-null-unit", "metric", """{"unit": null, "format": {"decimals": 0, "suffix": "%"}}""", """{"unit": "%", "format": "integer"}""", "integer", Some("null"), "written", Some("%"), Vector.empty),
    Edge("m-live-unit", "metric", """{"unit": "kg", "format": {"unit": "lb"}}""", """{"unit": "kg", "format": "number"}""", "number", Some("\"kg\""), "shadowed-by-live", None, Vector("text-shadowed")),
    Edge("m-live-unit-numeric", "metric", """{"unit": 5, "format": {"unit": "lb"}}""", """{"unit": 5, "format": "number"}""", "number", Some("5"), "shadowed-by-live", None, Vector("text-shadowed")),
    Edge("m-nonstring-text", "metric", """{"format": {"unit": 5, "suffix": "s"}}""", """{"format": "number", "unit": "s"}""", "number", None, "written", Some("s"), Vector("text-ignored-non-string")),
    Edge("m-unknown-key", "metric", """{"format": {"foo": 1, "unit": "u"}}""", """{"format": "number", "unit": "u"}""", "number", None, "written", Some("u"), Vector("unknown-keys-ignored")),
    Edge("m-whitespace", "metric", """{"format": {"prefix": "  ", "unit": "\t", "suffix": " \n"}}""", """{"format": "number"}""", "number", None, "no-text", None, Vector.empty),
    Edge("m-joined", "metric", """{"format": {"unit": "a", "suffix": "b", "bogus": true, "decimals": 5}}""", """{"format": "number", "unit": "a b"}""", "number", None, "written", Some("a b"),
      Vector("decimals-capped", "text-joined", "unknown-keys-ignored")),
    Edge("c-text", "collection", """{"format": {"unit": "pts", "decimals": 0}}""", """{"format": "integer"}""", "integer", None, "kind-has-no-unit", None, Vector("text-dropped-collection")),
    Edge("c-currency", "collection", """{"format": {"prefix": "$"}}""", """{"format": "currency"}""", "currency", None, "kind-has-no-unit", None, Vector.empty)
  )

  // Controls: must stay byte-identical, with no audit row.
  private val Controls = Vector(
    ("m-string-control", "metric", """{"format": "percent", "unit": "u"}"""),
    ("t-object-format", "table", """{"format": {"unit": "x"}}"""),
    ("m-no-format", "metric", """{"label": "a"}"""),
    ("m-format-null", "metric", """{"format": null}"""),
    ("m-array-config", "metric", """["format"]""")
  )

  "V118, run as a NOBYPASSRLS table-owning role over a real pre-V94 dump" should {
    "map object formats to strings, move text into unit, audit, stay idempotent and keep the audit table admin-only" in {
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
        val sc0 = superDs.getConnection
        try {
          rows(sc0, "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'helio_migration_test'")(r => (r.getBoolean(1), r.getBoolean(2))) shouldBe Vector((false, false))
          rows(sc0, "SELECT rolbypassrls FROM pg_roles WHERE rolname = 'helio_privileged'")(_.getBoolean(1)) shouldBe Vector(true)
        } finally sc0.close()

        flyway(Some("93")).migrate()

        // ── Real dump; bind panels to real metrics rows so V94 itself writes the object formats ──
        val sc = superDs.getConnection
        var metricDumpPanel, metricEmptyPanel, collectionPanel = ""
        try {
          exec(sc, """TRUNCATE TABLE users, data_sources, data_types, pipelines, pipeline_steps, panels,
                     |dashboards, metrics, binary_refs, data_type_rows, patch_set_applications RESTART IDENTITY CASCADE""".stripMargin)
          val dump = { val s = Source.fromResource("db/fixtures/hel904-real-dump.sql"); try s.mkString finally s.close() }
          exec(sc, dump)
          exec(sc, "SET search_path TO public")
          def outputPanel(kind: String, offset: Int) = rows(sc,
            s"""SELECT p.id FROM panels p JOIN pipelines pl ON pl.output_data_type_id = p.type_id
               |WHERE p.type = '$kind' AND p.metric_id IS NULL ORDER BY p.id LIMIT 1 OFFSET $offset""".stripMargin)(_.getString(1)).head
          metricDumpPanel = outputPanel("metric", 0); metricEmptyPanel = outputPanel("metric", 1); collectionPanel = outputPanel("collection", 0)
          val emptyMetricId = rows(sc, "SELECT id FROM metrics WHERE format = '{}'::jsonb ORDER BY id LIMIT 1")(_.getString(1)).head
          exec(sc, s"UPDATE panels SET metric_id = '6df6f851-b58a-4448-b249-e44369f9bc82' WHERE id IN ('$metricDumpPanel', '$collectionPanel')")
          exec(sc, s"UPDATE panels SET metric_id = '$emptyMetricId' WHERE id = '$metricEmptyPanel'")
        } finally sc.close()

        flyway(Some("117")).migrate()

        // ── Post-V117 edge + control Outputs (superuser insert) ──
        val ec = superDs.getConnection
        try {
          val (pipelineId, ownerId, nodeStep, rootId) = rows(ec, "SELECT pipeline_id, owner_id::text, node_step_id, root_id FROM outputs LIMIT 1")(
            r => (r.getString(1), r.getString(2), r.getString(3), r.getString(4))).head
          def lit(o: String) = if (o == null) "NULL" else s"'$o'"
          def ins(id: String, kind: String, cfg: String): Unit =
            exec(ec, s"""INSERT INTO outputs (id, pipeline_id, node_step_id, root_id, owner_id, name, kind, config, position, created_at, updated_at)
                        |VALUES ('$id', '$pipelineId', ${lit(nodeStep)}, ${lit(rootId)}, '$ownerId'::uuid, '$id', '$kind', '$cfg'::jsonb, 900, now(), '2026-01-02T03:04:05Z')""".stripMargin)
          Edges.foreach(e => ins(e.id, e.kind, e.input))
          Controls.foreach { case (id, kind, cfg) => ins(id, kind, cfg) }
        } finally ec.close()

        val dumpIds = Map("real-metric-dump" -> s"hel904-output-$metricDumpPanel", "real-metric-empty" -> s"hel904-output-$metricEmptyPanel",
          "real-collection-dump" -> s"hel904-output-$collectionPanel")

        // ── Snapshot over the superuser connection before V118 ──
        val sPre = superDs.getConnection
        val (preConfigs, preUpdated, preObjects) =
          try {
            (configs(sPre), rows(sPre, "SELECT id, updated_at::text FROM outputs")(r => r.getString(1) -> r.getString(2)).toMap,
              count(sPre, s"SELECT count(*) FROM outputs WHERE $ObjectWhere"))
          } finally sPre.close()
        withClue("fixture must put object formats on real and edge Outputs: ") { preObjects should be >= (Edges.size + 3) }
        dumpIds.values.foreach(id => withClue(s"$id (V94-produced): ") { preConfigs(id)._2.fields("format") shouldBe a[JsObject] })
        preConfigs(dumpIds("real-metric-dump"))._2.fields("format") shouldBe json("""{"unit": "pts", "prefix": "~", "suffix": "/10", "decimals": 2}""")
        preConfigs(dumpIds("real-metric-dump"))._2.fields.get("unit") shouldBe None
        preConfigs(dumpIds("real-metric-dump"))._1 shouldBe "metric"
        preConfigs(dumpIds("real-collection-dump"))._1 shouldBe "collection"
        info(s"pre-V118: ${preConfigs.size} outputs, $preObjects metric/collection with an object format")

        def kindOf(k: String) = OutputKind.fromString(k).toOption.get
        def keysOk(kind: String, cfg: JsObject) = cfg.fields.keySet.subsetOf(OutputConfigValidation.KnownKeys(kindOf(kind)))
        def valid(kind: String, cfg: JsObject, stored: JsObject) = OutputConfigValidation.validate(kindOf(kind), cfg, stored)
        def formatInSet(c: JsObject) = c.fields.get("format").exists { case JsString(s) => FormatSet(s); case _ => false }
        val scope = Edges.map(_.id) ++ dumpIds.values :+ "m-string-control"
        // Non-vacuity: pre-V118 the red/green proof is RED for every rewritten row (the string control is already green).
        for (id <- Edges.map(_.id) ++ dumpIds.values) withClue(s"$id pre-V118: ") { formatInSet(preConfigs(id)._2) shouldBe false }
        formatInSet(preConfigs("m-string-control")._2) shouldBe true

        // ── V118 via Flyway, as the NOBYPASSRLS owner ──
        noException should be thrownBy flyway(None).migrate()

        val sPost = superDs.getConnection
        try {
          count(sPost, s"SELECT count(*) FROM outputs WHERE $ObjectWhere") shouldBe 0
          val post = configs(sPost)
          post.keySet shouldBe preConfigs.keySet
          rows(sPost, "SELECT id, updated_at::text FROM outputs")(r => r.getString(1) -> r.getString(2)).toMap shouldBe preUpdated
          def cfgOf(id: String) = post(id)._2

          // Edge Outputs: exact configs and exact audit rows.
          for (e <- Edges) withClue(s"${e.id}: ") {
            cfgOf(e.id) shouldBe json(e.expected)
            auditRows(sPost, s"output_id = '${e.id}'") shouldBe Set(
              (e.id, e.kind, json(e.input).fields("format"), e.newFormat, e.priorUnit.map(_.parseJson), e.action, e.written, e.approx))
          }

          // Dump-derived Outputs: only `format`/`unit` change; everything else is untouched.
          def sameApartFromFormatUnit(id: String) = withClue(s"$id other keys: ") {
            cfgOf(id).fields.removed("format").removed("unit") shouldBe preConfigs(id)._2.fields.removed("format").removed("unit")
          }
          val dumpMetric = dumpIds("real-metric-dump"); val emptyMetric = dumpIds("real-metric-empty"); val dumpColl = dumpIds("real-collection-dump")
          Seq(dumpMetric, emptyMetric, dumpColl).foreach(sameApartFromFormatUnit)
          cfgOf(dumpMetric).fields("format") shouldBe JsString("number")
          cfgOf(dumpMetric).fields("unit") shouldBe JsString("~ pts /10")
          auditRows(sPost, s"output_id = '$dumpMetric'") shouldBe Set((dumpMetric, "metric", preConfigs(dumpMetric)._2.fields("format"), "number", None,
            "written", Some("~ pts /10"), Vector("decimals-not-fixed", "prefix-after-value", "text-joined")))
          cfgOf(emptyMetric).fields("format") shouldBe JsString("number")
          cfgOf(emptyMetric).fields.get("unit") shouldBe None
          auditRows(sPost, s"output_id = '$emptyMetric'") shouldBe Set((emptyMetric, "metric", json("{}"), "number", None, "no-text", None, Vector.empty))
          cfgOf(dumpColl).fields("format") shouldBe JsString("number")
          cfgOf(dumpColl).fields.get("unit") shouldBe None
          auditRows(sPost, s"output_id = '$dumpColl'") shouldBe Set((dumpColl, "collection", preConfigs(dumpColl)._2.fields("format"), "number", None,
            "kind-has-no-unit", None, Vector("decimals-not-fixed", "text-dropped-collection")))

          // Controls and every Output with no object format: byte-identical, no audit row.
          for ((id, _, cfg) <- Controls if id != "m-array-config") withClue(s"$id: ") { cfgOf(id) shouldBe json(cfg) }
          rows(sPost, "SELECT config::text FROM outputs WHERE id = 'm-array-config'")(_.getString(1)) shouldBe Vector("""["format"]""")
          val touched = Edges.map(_.id).toSet ++ dumpIds.values
          for ((id, v) <- preConfigs if !touched(id)) withClue(s"$id untouched: ") { post(id) shouldBe v }
          auditRows(sPost).map(_._1) shouldBe touched
          auditRows(sPost, "output_id IN ('m-string-control','t-object-format','m-no-format','m-format-null','m-array-config')") shouldBe Set.empty[AuditRow]

          // Validity (non-vacuous, scoped to the rewritten rows + the string control): format is a string in the set.
          for (id <- scope) withClue(s"$id: ") {
            val (kind, cfg) = post(id)
            formatInSet(cfg) shouldBe true
            keysOk(kind, cfg) shouldBe true
            valid(kind, cfg, JsObject.empty) shouldBe Right(())
            valid(kind, cfg, cfg) shouldBe Right(())
          }

          // Seam: the same fixture the frontend reader test consumes.
          val fixture = { val s = Source.fromResource("db/fixtures/hel1410-v118-expected-configs.json"); try s.mkString.parseJson.asJsObject finally s.close() }
          val entries = fixture.fields("entries").asInstanceOf[JsArray].elements.map(_.asJsObject)
          entries.map(_.fields("id").asInstanceOf[JsString].value).toSet shouldBe (Edges.map(_.id).toSet ++ dumpIds.keySet + "m-string-control")
          for (en <- entries) {
            val fid = en.fields("id").asInstanceOf[JsString].value
            val id = dumpIds.getOrElse(fid, fid)
            withClue(s"fixture $fid: ") {
              cfgOf(id).fields.get("format") shouldBe en.fields.get("format")
              cfgOf(id).fields.get("unit") shouldBe en.fields.get("unit")
              en.fields("kind") shouldBe JsString(post(id)._1)
              if (en.fields("originalFormat") != JsNull) preConfigs(id)._2.fields("format") shouldBe en.fields("originalFormat")
            }
          }

          // ── Idempotency 1: re-execute the V118 file as the role -- nothing changes. ──
          val allAudit = auditRows(sPost)
          val v118 = { val s = Source.fromResource("db/migration/V118__map_legacy_metric_format_objects.sql"); try s.mkString finally s.close() }
          val roleConn = DriverManager.getConnection(url, "helio_migration_test", "test")
          try {
            exec(roleConn, v118)
            configs(sPost) shouldBe post
            auditRows(sPost) shouldBe allAudit

            // ── Idempotency 2: put one object back (live unit "€" is non-null); the re-run maps it and adds exactly one audit row. ──
            exec(sPost, """UPDATE outputs SET config = config || '{"format": {"unit": "re"}}'::jsonb WHERE id = 'm-euro'""")
            exec(roleConn, v118)
            cfgOf2(sPost, "m-euro") shouldBe json("""{"label": "Keep", "format": "number", "unit": "€"}""")
            auditRows(sPost, "output_id = 'm-euro'").size shouldBe 2
            auditRows(sPost, "output_id = 'm-euro' AND unit_action = 'shadowed-by-live'") shouldBe Set(
              ("m-euro", "metric", json("""{"unit": "re"}"""), "number", Some(JsString("€")), "shadowed-by-live", None, Vector("text-shadowed")))
            count(sPost, "SELECT count(*) FROM hel1410_migrated_output_formats") shouldBe allAudit.size + 1
            count(sPost, s"SELECT count(*) FROM outputs WHERE $ObjectWhere") shouldBe 0

            // ── Audit-table posture ──
            val n = allAudit.size + 1
            exec(roleConn, "SELECT set_config('app.current_user_id', '00000000-0000-0000-0000-000000000001', false)")
            count(roleConn, "SELECT count(*) FROM hel1410_migrated_output_formats") shouldBe 0
            exec(roleConn, "SET ROLE helio_privileged")
            count(roleConn, "SELECT count(*) FROM hel1410_migrated_output_formats") shouldBe n
            exec(roleConn, "RESET ROLE")
            count(sPost, "SELECT count(*) FROM hel1410_migrated_output_formats") shouldBe n
            rows(sPost, "SELECT relname, relforcerowsecurity FROM pg_class WHERE relname IN ('outputs', 'hel1410_migrated_output_formats') ORDER BY relname")(r => r.getString(1) -> r.getBoolean(2)) shouldBe
              Vector("hel1410_migrated_output_formats" -> true, "outputs" -> true)
          } finally roleConn.close()
        } finally sPost.close()
      } finally pg.close()
    }
  }

  private def cfgOf2(c: Connection, id: String): JsObject = json(rows(c, s"SELECT config::text FROM outputs WHERE id = '$id'")(_.getString(1)).head)
}
