package com.helio.services.pipelines

import com.helio.domain.model.OutputKind
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.sql.Connection
import scala.io.Source
import scala.util.Random

/** HEL-1409 drift pin: runs V117's REAL repair (section 3's DO block, extracted verbatim from the
 *  migration file on the classpath) over a corpus of Output configs and asserts
 *  [[LegacyOutputConfigKeys.normalise]] produces the identical config for every row. Flyway SQL cannot
 *  be imported, so the SQL is executed rather than re-stated.
 *
 *  The DO block references unqualified `outputs` and `hel1387_dropped_output_config_keys`; session TEMP
 *  tables of those names shadow (`pg_temp` is searched first) on a database that has no V117 schema at
 *  all. Everything runs on ONE JDBC connection because temp tables are session-scoped. */
class LegacyOutputConfigKeysParitySpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private var pg: EmbeddedPostgres = _
  override def beforeAll(): Unit = pg = EmbeddedPostgres.builder().start()
  override def afterAll(): Unit  = pg.close()

  private val Kinds = Vector(OutputKind.Table, OutputKind.Metric, OutputKind.Chart, OutputKind.Collection, OutputKind.Timeline, OutputKind.Markdown)
  private val kindName: Map[OutputKind, String] = Map(
    OutputKind.Table -> "table", OutputKind.Metric -> "metric", OutputKind.Chart -> "chart",
    OutputKind.Collection -> "collection", OutputKind.Timeline -> "timeline", OutputKind.Markdown -> "markdown")

  private val DeadKeys = Vector(
    "metricLabel", "metricUnit", "chartAnnotation", "collectionOptions", "timelineOptions",
    "columnWidths", "tableDensity", "legend", "tooltip", "seriesColors", "axisLabels",
    "format", "columnOrder", "chartOptions")
  private val LiveOf = Map("metricLabel" -> "label", "metricUnit" -> "unit", "chartAnnotation" -> "annotation",
    "collectionOptions" -> "layout", "timelineOptions" -> "sort")

  private def o(fields: (String, JsValue)*): JsObject = JsObject(fields: _*)
  /** valid, JSON null, wrong JSON type, invalid enum, nested key missing / null / wrong type. */
  private val ValuePool: Vector[JsValue] = Vector(
    JsString("x"), JsString("grid"), JsNumber(5), JsNull, JsTrue, JsArray(), JsArray(JsString("a")),
    o("layout" -> JsString("grid")), o("layout" -> JsString("list")), o("layout" -> JsString("up")),
    o("layout" -> JsNull), o("layout" -> JsNumber(1)), o("sort" -> JsString("asc")), o("sort" -> JsString("desc")),
    o("sort" -> JsString("up")), o("sort" -> JsNull), o(), o("x" -> JsNumber(1), "layout" -> JsString("grid")),
    o("x" -> JsNumber(1), "sort" -> JsString("asc")))
  private val LiveStates: Vector[Option[JsValue]] = Vector(None, Some(JsNull), Some(JsString("keepme")))

  private def single: Vector[(String, OutputKind, JsObject)] = for {
    kind  <- Kinds
    key   <- DeadKeys
    value <- ValuePool
    live  <- if (LiveOf.contains(key)) LiveStates else Vector(None)
  } yield {
    val liveField = for (l <- live; k <- LiveOf.get(key)) yield k -> l
    (s"single-$key-${kindName(kind)}-${value.compactPrint}-${live.map(_.compactPrint)}", kind,
      JsObject((Map(key -> value, "keep" -> JsNumber(1)) ++ liveField)))
  }

  private def multi: Vector[(String, OutputKind, JsObject)] = {
    val rnd = new Random(1409)
    Vector.tabulate(600) { i =>
      val kind = Kinds(rnd.nextInt(Kinds.size))
      val dead = DeadKeys.filter(_ => rnd.nextBoolean()).map(k => k -> ValuePool(rnd.nextInt(ValuePool.size)))
      val live = LiveOf.values.toVector.flatMap(l => LiveStates(rnd.nextInt(LiveStates.size)).map(l -> _))
      (s"multi-$i", kind, JsObject((dead ++ live :+ ("keep" -> JsString("k"))).toMap))
    }
  }

  private def liveOnly: Vector[(String, OutputKind, JsObject)] = Kinds.map(k =>
    (s"live-only-${kindName(k)}", k, o("label" -> JsString("l"), "unit" -> JsString("u"), "layout" -> JsString("grid"), "sort" -> JsString("asc"))))
  private def emptyCfg: Vector[(String, OutputKind, JsObject)] = Kinds.map(k => (s"empty-${kindName(k)}", k, o()))

  /** Section 3's DO block, verbatim, from the migration on the classpath. */
  private def doBlock: String = {
    val src = Source.fromInputStream(getClass.getResourceAsStream("/db/migration/V117__migrate_v94_dead_output_config_keys.sql"), "UTF-8")
    val sql = try src.mkString finally src.close()
    val marker = "-- ── 3. The repair"
    sql.indexOf(marker) should be >= 0
    sql.indexOf(marker, sql.indexOf(marker) + 1) shouldBe -1
    val from = sql.substring(sql.indexOf(marker) + marker.length)
    val end  = from.indexOf("\n$$;")
    end should be > 0
    val block = from.substring(from.indexOf("DO $$"), end + "\n$$;".length)
    "DO \\$\\$".r.findAllIn(block).size shouldBe 1
    block should include ("jsonb_exists_any(config, all_keys)")
    block
  }

  private def exec(c: Connection, sql: String): Unit = { val st = c.createStatement(); try st.execute(sql) finally st.close() }

  "LegacyOutputConfigKeys.normalise" should {
    "equal V117's real DO block on every corpus row" in {
      val corpus = single ++ multi ++ liveOnly ++ emptyCfg
      corpus.map(_._1).distinct.size shouldBe corpus.size
      val c = pg.getPostgresDatabase.getConnection
      try {
        exec(c, "CREATE TEMP TABLE outputs (id text, kind text, config jsonb)")
        exec(c, """CREATE TEMP TABLE hel1387_dropped_output_config_keys (output_id text NOT NULL, output_kind text NOT NULL,
                  | config_key text NOT NULL, config_value jsonb NOT NULL, action text NOT NULL, live_key text NULL,
                  | logged_at timestamptz NOT NULL DEFAULT now())""".stripMargin)
        // The DO block's unqualified relations must resolve to the TEMP tables, not anything else.
        for (rel <- Seq("outputs", "hel1387_dropped_output_config_keys")) {
          val rs = c.createStatement().executeQuery(s"SELECT n.nspname FROM pg_class cl JOIN pg_namespace n ON n.oid = cl.relnamespace WHERE cl.oid = '$rel'::regclass")
          rs.next() shouldBe true
          rs.getString(1) should startWith ("pg_temp")
        }
        val ins = c.prepareStatement("INSERT INTO outputs (id, kind, config) VALUES (?, ?, ?::jsonb)")
        corpus.foreach { case (id, kind, cfg) => ins.setString(1, id); ins.setString(2, kindName(kind)); ins.setString(3, cfg.compactPrint); ins.addBatch() }
        ins.executeBatch(); ins.close()

        exec(c, doBlock)

        val rs = c.createStatement().executeQuery("SELECT id, config::text FROM outputs")
        val after = Iterator.continually(rs).takeWhile(_.next()).map(r => r.getString(1) -> r.getString(2).parseJson.asJsObject).toMap
        after.size shouldBe corpus.size

        val mismatches = corpus.collect { case (id, kind, cfg) if LegacyOutputConfigKeys.normalise(kind, cfg) != after(id) =>
          s"$id: sql=${after(id).compactPrint} scala=${LegacyOutputConfigKeys.normalise(kind, cfg).compactPrint}" }
        withClue(mismatches.take(10).mkString("\n")) { mismatches shouldBe empty }

        // Non-vacuity: the corpus must actually exercise the repair, in every audit action class.
        val changed = corpus.count { case (id, _, cfg) => after(id) != cfg }
        changed should be > 1500
        corpus.count { case (id, _, cfg) => after(id) == cfg } should be > 50
        val ars = c.createStatement().executeQuery("SELECT DISTINCT action FROM hel1387_dropped_output_config_keys")
        val actions = Iterator.continually(ars).takeWhile(_.next()).map(_.getString(1)).toSet
        actions shouldBe Set("kind-inapplicable", "no-live-equivalent", "null-value", "invalid-value", "shadowed-by-live", "renamed")
        // and the Scala side also changed exactly the rows SQL changed
        corpus.count { case (_, k, cfg) => LegacyOutputConfigKeys.normalise(k, cfg) != cfg } shouldBe changed
      } finally c.close()
    }
  }
}
