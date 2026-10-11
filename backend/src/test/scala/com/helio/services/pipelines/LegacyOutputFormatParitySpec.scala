package com.helio.services.pipelines

import com.helio.domain.model.OutputKind
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import com.helio.testkit.VerifiedEmbeddedPostgres
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.sql.{Connection, ResultSet}
import scala.io.Source
import scala.util.{Random, Using}

/** HEL-1441 drift pin: runs V118's REAL repair (section 3's DO block, extracted verbatim from the migration
 *  file on the classpath) over a corpus of Output configs and asserts [[LegacyOutputFormat.normalise]]
 *  produces the identical config for every row. Mechanics as in `LegacyOutputConfigKeysParitySpec`: session
 *  TEMP tables of the names the block references shadow on a database with no V118 schema, on ONE connection. */
class LegacyOutputFormatParitySpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  private var pg: EmbeddedPostgres = _
  override def beforeAll(): Unit = pg = VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder())
  override def afterAll(): Unit  = pg.close()

  private val Kinds = Vector(OutputKind.Table, OutputKind.Metric, OutputKind.Chart, OutputKind.Collection, OutputKind.Timeline, OutputKind.Markdown)
  private val kindName: Map[OutputKind, String] = Map(
    OutputKind.Table -> "table", OutputKind.Metric -> "metric", OutputKind.Chart -> "chart",
    OutputKind.Collection -> "collection", OutputKind.Timeline -> "timeline", OutputKind.Markdown -> "markdown")
  private val InScope = Vector(OutputKind.Metric, OutputKind.Collection)

  private def num(s: String): JsValue = JsNumber(BigDecimal(s))
  private def str(s: String): JsValue = JsString(s)

  // Axis values; None = key absent. Whitespace code points are spelled as escapes so the intent is visible.
  private val Decimals: Vector[Option[JsValue]] = Vector(None, Some(JsNull), Some(num("0")), Some(num("0.0")), Some(num("1")),
    Some(num("2")), Some(num("2.0")), Some(num("3")), Some(num("7")), Some(num("-1")), Some(num("1.5")), Some(str("2")), Some(JsTrue))
  private val Prefixes: Vector[Option[JsValue]] = Vector(None, Some(JsNull), Some(str("$")), Some(str(" $\t")), Some(str("\u00a0$")),
    Some(str("\u000b$")), Some(str("$\u000c")), Some(str("\u2003$")), Some(str(" $")), Some(str("")), Some(str("  ")),
    Some(str("USD")), Some(str("%")), Some(num("5")))
  private val Units: Vector[Option[JsValue]]    = Vector(None, Some(JsNull), Some(str("kg")), Some(str(" kg\n")), Some(str(" kg\u000b")), Some(num("3")))
  private val Suffixes: Vector[Option[JsValue]] = Vector(None, Some(JsNull), Some(str("pts")), Some(str("")))
  private val Extras: Vector[Option[JsValue]]   = Vector(None, Some(JsNumber(1)))
  private val LiveUnits: Vector[Option[JsValue]] = Vector(None, Some(JsNull), Some(str("live")), Some(num("5")), Some(JsTrue), Some(JsObject()))

  private def fmtObj(d: Option[JsValue], p: Option[JsValue], u: Option[JsValue], s: Option[JsValue], x: Option[JsValue]): JsObject =
    JsObject(Vector("decimals" -> d, "prefix" -> p, "unit" -> u, "suffix" -> s, "extra" -> x).collect { case (k, Some(v)) => k -> v }.toMap)

  private def cfg(kind: OutputKind, fmt: JsValue, live: Option[JsValue]): JsObject =
    JsObject((Map("format" -> fmt, "keep" -> JsNumber(1)) ++ live.map("unit" -> _)))

  private def label(kind: OutputKind, fmt: JsValue, live: Option[JsValue]): String =
    s"${kindName(kind)}-${fmt.compactPrint}-${live.map(_.compactPrint)}"

  private type Row = (String, OutputKind, JsObject)
  private def row(kind: OutputKind, fmt: JsValue, live: Option[JsValue] = None): Row = (label(kind, fmt, live), kind, cfg(kind, fmt, live))

  private def topLevelShapes: Vector[Row] = for {
    kind <- Kinds
    fmt  <- Vector[Option[JsValue]](None, Some(JsNull), Some(str("number")), Some(num("3")), Some(JsArray(JsString("a"))), Some(JsObject()))
  } yield (s"top-${kindName(kind)}-${fmt.map(_.compactPrint)}", kind, JsObject(fmt.map("format" -> _).toMap + ("keep" -> JsNumber(1))))

  private def decimalsByPrefix: Vector[Row] = for {
    kind <- InScope
    d    <- Decimals
    p    <- Prefixes
  } yield row(kind, fmtObj(d, p, None, None, None))

  private def singleAxis: Vector[Row] = for {
    kind <- InScope
    fmt  <- (Units.map(u => fmtObj(None, None, u, None, None)) ++ Suffixes.map(s => fmtObj(None, None, None, s, None)) ++
              Extras.map(x => fmtObj(None, None, None, None, x)))
  } yield row(kind, fmt)

  private def liveUnitRows: Vector[Row] = for {
    kind <- InScope
    live <- LiveUnits
    fmt  <- Vector(fmtObj(None, None, Some(str("kg")), None, None), fmtObj(Some(num("2")), Some(str("$")), None, None, None),
                   fmtObj(None, Some(str("USD")), Some(str("kg")), Some(str("pts")), None), JsObject())
  } yield row(kind, fmt, live)

  private def sampled: Vector[Row] = {
    val rnd = new Random(1441)
    def pick[A](v: Vector[A]): A = v(rnd.nextInt(v.size))
    Vector.fill(2400)(row(pick(InScope), fmtObj(pick(Decimals), pick(Prefixes), pick(Units), pick(Suffixes), pick(Extras)), pick(LiveUnits)))
  }

  private def corpus: Vector[Row] = {
    val all = topLevelShapes ++ decimalsByPrefix ++ singleAxis ++ liveUnitRows ++ sampled
    all.distinctBy(_._1)
  }

  /** Section 3's DO block, verbatim, from the migration on the classpath. */
  private def doBlock: String = {
    val sql = Using.resource(Source.fromInputStream(getClass.getResourceAsStream("/db/migration/V118__map_legacy_metric_format_objects.sql"), "UTF-8"))(_.mkString)
    val marker = "-- ── 3. The mapping"
    sql.indexOf(marker) should be >= 0
    sql.indexOf(marker, sql.indexOf(marker) + 1) shouldBe -1
    val from = sql.substring(sql.indexOf(marker) + marker.length)
    val end  = from.indexOf("\n$$;")
    end should be > 0
    val block = from.substring(from.indexOf("DO $$"), end + "\n$$;".length)
    "DO \\$\\$".r.findAllIn(block).size shouldBe 1
    block should include ("jsonb_typeof(config -> 'format') = 'object'")
    block
  }

  private def exec(c: Connection, sql: String): Unit = Using.resource(c.createStatement())(_.execute(sql))

  private def query[A](c: Connection, sql: String)(read: ResultSet => A): Vector[A] =
    Using.resource(c.createStatement()) { st =>
      Using.resource(st.executeQuery(sql)) { rs => Iterator.continually(rs).takeWhile(_.next()).map(read).toVector }
    }

  "LegacyOutputFormat.normalise" should {
    "equal V118's real DO block on every corpus row" in {
      val rows = corpus
      rows.size should be > 2500
      val c = pg.getPostgresDatabase.getConnection
      try {
        exec(c, "CREATE TEMP TABLE outputs (id text, kind text, config jsonb)")
        exec(c, """CREATE TEMP TABLE hel1410_migrated_output_formats (
                  |  output_id text NOT NULL, output_kind text NOT NULL, original_format jsonb NOT NULL,
                  |  new_format text NOT NULL CHECK (new_format IN ('number', 'integer', 'currency')),
                  |  prior_unit jsonb NULL,
                  |  unit_action text NOT NULL CHECK (unit_action IN ('written', 'shadowed-by-live', 'no-text', 'kind-has-no-unit')),
                  |  unit_written text NULL,
                  |  approximations text[] NOT NULL CHECK (approximations <@ ARRAY[
                  |    'decimals-capped', 'decimals-not-fixed', 'decimals-ignored', 'prefix-after-value', 'text-joined', 'text-shadowed',
                  |    'text-dropped-collection', 'text-ignored-non-string', 'unknown-keys-ignored']::TEXT[]),
                  |  logged_at timestamptz NOT NULL DEFAULT now())""".stripMargin)
        for (rel <- Seq("outputs", "hel1410_migrated_output_formats")) {
          val ns = query(c, s"SELECT n.nspname FROM pg_class cl JOIN pg_namespace n ON n.oid = cl.relnamespace WHERE cl.oid = '$rel'::regclass")(_.getString(1))
          ns.head should startWith ("pg_temp")
        }
        Using.resource(c.prepareStatement("INSERT INTO outputs (id, kind, config) VALUES (?, ?, ?::jsonb)")) { ins =>
          rows.foreach { case (id, kind, config) => ins.setString(1, id); ins.setString(2, kindName(kind)); ins.setString(3, config.compactPrint); ins.addBatch() }
          ins.executeBatch()
        }
        // The Scala side sees exactly the JSON text the SQL side stored.
        val before = query(c, "SELECT id, config::text FROM outputs")(r => r.getString(1) -> r.getString(2).parseJson.asJsObject).toMap

        exec(c, doBlock)

        val after = query(c, "SELECT id, config::text FROM outputs")(r => r.getString(1) -> r.getString(2).parseJson.asJsObject).toMap
        after.size shouldBe rows.size

        val mismatches = rows.collect { case (id, kind, _) if LegacyOutputFormat.normalise(kind, before(id)) != after(id) =>
          s"$id: sql=${after(id).compactPrint} scala=${LegacyOutputFormat.normalise(kind, before(id)).compactPrint}" }
        withClue(mismatches.take(10).mkString("\n")) { mismatches shouldBe empty }

        val changed = rows.count { case (id, _, _) => after(id) != before(id) }
        changed should be > 2000
        rows.count { case (id, _, _) => after(id) == before(id) } should be > 20
        rows.count { case (_, k, _) if !InScope.contains(k) => true; case _ => false } should be > 20

        val actions = query(c, "SELECT DISTINCT unit_action FROM hel1410_migrated_output_formats")(_.getString(1)).toSet
        actions shouldBe Set("written", "shadowed-by-live", "no-text", "kind-has-no-unit")
        val codes = query(c, "SELECT DISTINCT unnest(approximations) FROM hel1410_migrated_output_formats")(_.getString(1)).toSet
        codes shouldBe Set("decimals-capped", "decimals-not-fixed", "decimals-ignored", "prefix-after-value", "text-joined",
          "text-shadowed", "text-dropped-collection", "text-ignored-non-string", "unknown-keys-ignored")
        val formats = query(c, "SELECT DISTINCT new_format FROM hel1410_migrated_output_formats")(_.getString(1)).toSet
        formats shouldBe Set("number", "integer", "currency")
      } finally c.close()
    }
  }
}
