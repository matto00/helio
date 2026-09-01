package com.helio.domain.engine

import com.helio.domain.model.{AssertionSink, CsvSourceConfig, ImageSourceConfig, PdfSourceConfig, RestApiConfig, TextSourceConfig, TruncationSink}
import com.helio.domain.model.{CsvSource, ImageSource, PdfSource, RestSource, SqlSource, TextSource, UserId}
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.domain.engine.InProcessPipelineEngine
import com.helio.domain.steps._
import com.helio.domain.model.{DataSource, DataSourceId, Pipeline, PipelineExecutionContext, PipelineId, PipelineStep, PipelineStepId, SqlSourceConfig, StaticSource}
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import com.helio.api.protocols.pipelines.PipelineStepConfigCodec
import com.helio.infrastructure.persistence.pipelines.PipelineStepRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem
import com.helio.testsupport.PdfFixtures
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.nio.charset.StandardCharsets
import java.nio.file.Paths
import java.time.Instant
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

class InProcessPipelineEngineSpec extends AnyWordSpec with Matchers with ScalatestRouteTest with BeforeAndAfterAll {

  // Not `implicit` (HEL-758): ScalatestRouteTest's own `RouteTest.executor`
  // implicit would otherwise collide with this one, ambiguous-implicit at
  // every call site relying on implicit resolution. Every existing call site
  // in this file already passes `ec` explicitly (e.g. `new
  // DataSourceRepository(null)(ec)`); the engine construction below now
  // relies on RouteTest's own implicit executor instead.
  private val ec: ExecutionContext = ExecutionContext.global
  // ScalatestRouteTest provides the classic `system`; RestApiConnectorDriver needs
  // a typed ActorSystem[_] (HEL-758) to construct, mirroring
  // PipelineApplyProposalSpecBase's own `system.toTyped` pattern.
  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped
  // LocalFileSystem with absolute baseDir; LocalFileSystem.resolve passes absolute
  // paths through unchanged, so tests can write CSVs to tmp and reference by absolute path.
  private val fileSystem = new LocalFileSystem(Paths.get("/"))
  // No connector — used by every existing loadRows case (static/csv/text/pdf/
  // image) plus HEL-758's own "no connector configured" RestSource guard test.
  private val engine = new InProcessPipelineEngine(fileSystem)

  // HEL-758 (design.md D7 pattern, copied from PipelineApplyProposalSpecBase):
  // a stub RestApiConnectorDriver keyed on `config.url` so the same connector
  // instance exercises both a successful and a failing REST fetch.
  private val RestSuccessUrl = "https://rest-engine.test/ok"
  private val RestFailureUrl = "https://rest-engine.test/fail"
  private val stubConnector = new RestApiConnectorDriver(Some { config =>
    if (config.connectorId == RestFailureUrl) Future.successful(Left("connector: endpoint unreachable"))
    else
      Future.successful(Right(JsArray(
        JsObject("name" -> JsString("alice"), "score" -> JsNumber(1)),
        JsObject("name" -> JsString("bob"),   "score" -> JsNumber(2))
      )))
  })
  private val restEngine = new InProcessPipelineEngine(fileSystem, stubConnector)

  // HEL-758: real embedded Postgres for SqlSource loadRows coverage — mirrors
  // SqlConnectorSpec's own `liveConfig` pattern.
  private var embeddedPostgres: EmbeddedPostgres = _
  override def beforeAll(): Unit =
    embeddedPostgres = EmbeddedPostgres.builder().setConnectConfig("stringtype", "unspecified").start()
  override def afterAll(): Unit = {
    embeddedPostgres.close()
    super.afterAll()
  }
  private def liveSqlConfig(query: String = "SELECT 1 AS one"): SqlSourceConfig =
    SqlSourceConfig(
      dialect  = "postgresql",
      host     = "localhost",
      port     = embeddedPostgres.getPort,
      database = "postgres",
      user     = "postgres",
      password = "postgres",
      query    = query
    )

  /** Build a typed PipelineStep from (op, configJson) by round-tripping
   *  through the codec — fixtures stay stringly-typed but the engine
   *  receives the typed ADT. */
  private def makeStep(op: String, config: String): PipelineStep = {
    val now = Instant.now()
    val cfg = PipelineStepConfigCodec.decode(op, config).get
    val id  = PipelineStepId("step-id")
    val pid = PipelineId("pipe-id")
    cfg match {
      case c: RenameConfig    => RenameStep(id, pid, 0, c, now, now)
      case c: FilterConfig    => FilterStep(id, pid, 0, c, now, now)
      case c: JoinConfig      => JoinStep(id, pid, 0, c, now, now)
      case c: ComputeConfig   => ComputeStep(id, pid, 0, c, now, now)
      case c: GroupByConfig   => GroupByStep(id, pid, 0, c, now, now)
      case c: CastConfig      => CastStep(id, pid, 0, c, now, now)
      case c: SelectConfig    => SelectStep(id, pid, 0, c, now, now)
      case c: LimitConfig     => LimitStep(id, pid, 0, c, now, now)
      case c: SortConfig      => SortStep(id, pid, 0, c, now, now)
      case c: AggregateConfig => AggregateStep(id, pid, 0, c, now, now)
      case c: SplitTextConfig => SplitTextStep(id, pid, 0, c, now, now)
      case c: ExtractHeadingsConfig => ExtractHeadingsStep(id, pid, 0, c, now, now)
      case c: ChunkByTokenCountConfig => ChunkByTokenCountStep(id, pid, 0, c, now, now)
      case c: DateBucketConfig => DateBucketStep(id, pid, 0, c, now, now)
      case c: PivotConfig     => PivotStep(id, pid, 0, c, now, now)
      case c: WindowConfig    => WindowStep(id, pid, 0, c, now, now)
      case c: UnpivotConfig   => UnpivotStep(id, pid, 0, c, now, now)
      case c: DedupeConfig    => DedupeStep(id, pid, 0, c, now, now)
      case c: FillNullConfig  => FillNullStep(id, pid, 0, c, now, now)
      case c: StringOpsConfig => StringOpsStep(id, pid, 0, c, now, now)
      case c: UnionConfig    => UnionStep(id, pid, 0, c, now, now)
      case c: LookupConfig   => LookupStep(id, pid, 0, c, now, now)
      case c: AssertConfig   => AssertStep(id, pid, 0, c, now, now)
      case other              => throw new MatchError("Unexpected config type: " + other.getClass.getName)
    }
  }

  private def run(rows: Seq[Map[String, Any]], steps: PipelineStep*): Seq[Map[String, Any]] =
    Await.result(engine.execute(rows, steps.toSeq, null), 5.seconds)

  val sampleRows: Seq[Map[String, Any]] = Seq(
    Map("name" -> "alice", "age" -> 30.0, "dept" -> "eng"),
    Map("name" -> "bob",   "age" -> 25.0, "dept" -> "mkt"),
    Map("name" -> "carol", "age" -> 0.0,  "dept" -> "eng")
  )

  // 6.1 Unit tests for each of the 6 op types

  "InProcessPipelineEngine" should {

    "rename: renames a single column via renames map" in {
      val cfg = """{ "renames": { "name": "full_name" } }"""
      val step = makeStep("rename", cfg)
      val result = run(sampleRows, step)
      result.head.keys should contain ("full_name")
      result.head.keys should not contain "name"
      result.head("full_name") shouldBe "alice"
    }

    "rename: renames multiple columns in a single step" in {
      val cfg = """{ "renames": { "name": "full_name", "dept": "department" } }"""
      val step = makeStep("rename", cfg)
      val result = run(sampleRows, step)
      result.head.keys should contain ("full_name")
      result.head.keys should contain ("department")
      result.head.keys should not contain "name"
      result.head.keys should not contain "dept"
      result.head("full_name") shouldBe "alice"
      result.head("department") shouldBe "eng"
    }

    "rename: silently ignores a missing source field" in {
      val cfg = """{ "renames": { "nonexistent": "new_name" } }"""
      val step = makeStep("rename", cfg)
      val result = run(sampleRows, step)
      // Row is unchanged — source field was not present
      result.head.keys should contain ("name")
      result.head.keys should not contain "new_name"
    }

    "rename: empty renames map is a no-op" in {
      val cfg = """{ "renames": {} }"""
      val step = makeStep("rename", cfg)
      val result = run(sampleRows, step)
      result should have size sampleRows.size
      result.head.keys should contain theSameElementsAs sampleRows.head.keys
      result.head("name") shouldBe "alice"
    }

    // ── filter: structured-condition evaluation ──────────────────────────────

    "filter: = operator keeps matching rows" in {
      val cfg  = """{ "combinator": "AND", "conditions": [{ "field": "dept", "operator": "=", "value": "eng" }] }"""
      val step = makeStep("filter", cfg)
      val result = run(sampleRows, step)
      result should have size 2
      result.map(_("name")) should contain allOf ("alice", "carol")
      result.map(_("name")) should not contain "bob"
    }

    "filter: != operator excludes matching rows" in {
      val cfg  = """{ "combinator": "AND", "conditions": [{ "field": "dept", "operator": "!=", "value": "eng" }] }"""
      val step = makeStep("filter", cfg)
      val result = run(sampleRows, step)
      result should have size 1
      result.head("name") shouldBe "bob"
    }

    "filter: > operator keeps rows where field is greater than value" in {
      val cfg  = """{ "combinator": "AND", "conditions": [{ "field": "age", "operator": ">", "value": "25" }] }"""
      val step = makeStep("filter", cfg)
      val result = run(sampleRows, step)
      result should have size 1
      result.head("name") shouldBe "alice"
    }

    "filter: >= operator keeps rows where field is greater than or equal to value" in {
      val cfg  = """{ "combinator": "AND", "conditions": [{ "field": "age", "operator": ">=", "value": "25" }] }"""
      val step = makeStep("filter", cfg)
      val result = run(sampleRows, step)
      result should have size 2
      result.map(_("name")) should contain allOf ("alice", "bob")
    }

    "filter: < operator keeps rows where field is less than value" in {
      val cfg  = """{ "combinator": "AND", "conditions": [{ "field": "age", "operator": "<", "value": "25" }] }"""
      val step = makeStep("filter", cfg)
      val result = run(sampleRows, step)
      result should have size 1
      result.head("name") shouldBe "carol"
    }

    "filter: <= operator keeps rows where field is less than or equal to value" in {
      val cfg  = """{ "combinator": "AND", "conditions": [{ "field": "age", "operator": "<=", "value": "25" }] }"""
      val step = makeStep("filter", cfg)
      val result = run(sampleRows, step)
      result should have size 2
      result.map(_("name")) should contain allOf ("bob", "carol")
    }

    "filter: contains operator checks substring on field value" in {
      val cfg  = """{ "combinator": "AND", "conditions": [{ "field": "name", "operator": "contains", "value": "ol" }] }"""
      val step = makeStep("filter", cfg)
      val result = run(sampleRows, step)
      result should have size 1
      result.head("name") shouldBe "carol"
    }

    "filter: is null operator keeps rows where field is null" in {
      val rows = Seq(
        Map[String, Any]("name" -> "alice", "score" -> null),
        Map[String, Any]("name" -> "bob",   "score" -> 10.0)
      )
      val cfg  = """{ "combinator": "AND", "conditions": [{ "field": "score", "operator": "is null" }] }"""
      val step = makeStep("filter", cfg)
      val result = run(rows, step)
      result should have size 1
      result.head("name") shouldBe "alice"
    }

    "filter: is not null operator keeps rows where field is not null" in {
      val rows = Seq(
        Map[String, Any]("name" -> "alice", "score" -> null),
        Map[String, Any]("name" -> "bob",   "score" -> 10.0)
      )
      val cfg  = """{ "combinator": "AND", "conditions": [{ "field": "score", "operator": "is not null" }] }"""
      val step = makeStep("filter", cfg)
      val result = run(rows, step)
      result should have size 1
      result.head("name") shouldBe "bob"
    }

    "filter: AND combinator requires all conditions to pass" in {
      val cfg  = """{ "combinator": "AND", "conditions": [
        { "field": "dept", "operator": "=", "value": "eng" },
        { "field": "age",  "operator": ">", "value": "10" }
      ] }"""
      val step = makeStep("filter", cfg)
      val result = run(sampleRows, step)
      // alice: eng + age 30 > 10 → pass; carol: eng + age 0 > 10 → fail
      result should have size 1
      result.head("name") shouldBe "alice"
    }

    "filter: OR combinator passes rows matching any condition" in {
      val cfg  = """{ "combinator": "OR", "conditions": [
        { "field": "dept", "operator": "=",  "value": "mkt" },
        { "field": "age",  "operator": ">=", "value": "30"  }
      ] }"""
      val step = makeStep("filter", cfg)
      val result = run(sampleRows, step)
      // alice: age 30 >= 30 → pass; bob: dept mkt → pass; carol: neither → fail
      result should have size 2
      result.map(_("name")) should contain allOf ("alice", "bob")
      result.map(_("name")) should not contain "carol"
    }

    "filter: missing field is treated as null (passes is null, fails comparisons)" in {
      val rows = Seq(
        Map[String, Any]("name" -> "alice"),  // no "score" field
        Map[String, Any]("name" -> "bob", "score" -> 10.0)
      )
      val cfgNull    = """{ "combinator": "AND", "conditions": [{ "field": "score", "operator": "is null" }] }"""
      val cfgGt      = """{ "combinator": "AND", "conditions": [{ "field": "score", "operator": ">", "value": "5" }] }"""
      val resultNull = run(rows, makeStep("filter", cfgNull))
      val resultGt   = run(rows, makeStep("filter", cfgGt))
      resultNull should have size 1
      resultNull.head("name") shouldBe "alice"
      resultGt should have size 1
      resultGt.head("name") shouldBe "bob"
    }

    "filter: empty conditions array passes all rows" in {
      val cfg  = """{ "combinator": "AND", "conditions": [] }"""
      val step = makeStep("filter", cfg)
      val result = run(sampleRows, step)
      result should have size sampleRows.size
    }

    "compute: adds a new column from expression" in {
      val cfg = """{ "column": "age_plus_ten", "expression": "age + 10" }"""
      val step = makeStep("compute", cfg)
      val result = run(sampleRows, step)
      result.head("age_plus_ten") shouldBe 40.0
      result(1)("age_plus_ten") shouldBe 35.0
    }

    "compute: tolerates extra 'type' key in unified config shape" in {
      val cfg  = """{ "column": "age_doubled", "expression": "age + age", "type": "number" }"""
      val step = makeStep("compute", cfg)
      val result = run(sampleRows, step)
      result.head("age_doubled") shouldBe 60.0
    }

    "compute: division by zero produces null for that row" in {
      val rows = Seq(
        Map[String, Any]("x" -> 10.0, "y" -> 2.0),
        Map[String, Any]("x" -> 5.0,  "y" -> 0.0)
      )
      val cfg  = """{ "column": "result", "expression": "x / y", "type": "number" }"""
      val step = makeStep("compute", cfg)
      val result = run(rows, step)
      result.head("result") shouldBe 5.0
      result(1)("result").asInstanceOf[AnyRef] shouldBe null
    }

    "compute: unknown field reference produces null for that row" in {
      val rows = Seq(Map[String, Any]("x" -> 10.0))
      val cfg  = """{ "column": "result", "expression": "x + nonexistent", "type": "number" }"""
      val step = makeStep("compute", cfg)
      val result = run(rows, step)
      result.head("result").asInstanceOf[AnyRef] shouldBe null
    }

    "compute: arithmetic with multiply and parentheses" in {
      val rows = Seq(Map[String, Any]("price" -> 3.0, "quantity" -> 5.0))
      val cfg  = """{ "column": "total", "expression": "price * quantity", "type": "number" }"""
      val step = makeStep("compute", cfg)
      val result = run(rows, step)
      result.head("total") shouldBe 15.0
    }

    "groupby: groups and sums a column" in {
      val cfg = """{ "groupBy": ["dept"], "aggColumn": "age", "aggFunction": "sum" }"""
      val step = makeStep("groupby", cfg)
      val result = run(sampleRows, step)
      result should have size 2
      val engRow = result.find(_("dept") == "eng").get
      engRow("sum_age") shouldBe 30.0
    }

    "groupby: counts rows per group" in {
      val cfg = """{ "groupBy": ["dept"], "aggColumn": "name", "aggFunction": "count" }"""
      val step = makeStep("groupby", cfg)
      val result = run(sampleRows, step)
      val engRow = result.find(_("dept") == "eng").get
      engRow("count_name") shouldBe 2L
    }

    "cast: empty casts map is a no-op" in {
      val cfg  = """{ "casts": {} }"""
      val step = makeStep("cast", cfg)
      val result = run(sampleRows, step)
      result should have size sampleRows.size
      result.head.keys should contain theSameElementsAs sampleRows.head.keys
      result.head("name") shouldBe "alice"
    }

    "cast: converts column to integer via casts map" in {
      val rows = Seq(Map("x" -> "42".asInstanceOf[Any]))
      val cfg  = """{ "casts": { "x": "integer" } }"""
      val step = makeStep("cast", cfg)
      val result = run(rows, step)
      result.head("x") shouldBe 42
    }

    "cast: converts column to double via casts map" in {
      val rows = Seq(Map("v" -> "3.14".asInstanceOf[Any]))
      val cfg  = """{ "casts": { "v": "double" } }"""
      val step = makeStep("cast", cfg)
      val result = run(rows, step)
      result.head("v") shouldBe 3.14
    }

    "cast: invalid value yields null" in {
      val rows = Seq(Map("x" -> "not-a-number".asInstanceOf[Any]))
      val cfg  = """{ "casts": { "x": "integer" } }"""
      val step = makeStep("cast", cfg)
      val result = run(rows, step)
      result.head("x").asInstanceOf[AnyRef] shouldBe null
    }

    "cast: field absent from casts map passes through unchanged" in {
      val rows = Seq(Map("a" -> "hello".asInstanceOf[Any], "b" -> "42".asInstanceOf[Any]))
      val cfg  = """{ "casts": { "b": "integer" } }"""
      val step = makeStep("cast", cfg)
      val result = run(rows, step)
      result.head("a") shouldBe "hello"
      result.head("b") shouldBe 42
    }

    "cast: converts column to long via casts map" in {
      val rows = Seq(Map("n" -> "999999999999".asInstanceOf[Any]))
      val cfg  = """{ "casts": { "n": "long" } }"""
      val step = makeStep("cast", cfg)
      val result = run(rows, step)
      result.head("n") shouldBe 999999999999L
    }

    "cast: converts column to boolean via casts map" in {
      val rows = Seq(Map("flag" -> "true".asInstanceOf[Any]))
      val cfg  = """{ "casts": { "flag": "boolean" } }"""
      val step = makeStep("cast", cfg)
      val result = run(rows, step)
      result.head("flag") shouldBe true
    }

    // HEL-378: datebucket — floors a timestamp field to the start of a
    // granularity bucket. See spec.md for the exact scenarios these mirror.

    "datebucket: floors to day" in {
      val rows = Seq(Map("ts" -> "2026-03-17T14:32:00Z".asInstanceOf[Any]))
      val cfg  = """{ "field": "ts", "granularity": "day" }"""
      val step = makeStep("datebucket", cfg)
      val result = run(rows, step)
      result.head("ts") shouldBe "2026-03-17"
    }

    "datebucket: floors to the Monday of the ISO week (week boundary policy: Monday, not Sunday)" in {
      val rows = Seq(Map("ts" -> "2026-03-19".asInstanceOf[Any])) // a Thursday
      val cfg  = """{ "field": "ts", "granularity": "week" }"""
      val step = makeStep("datebucket", cfg)
      val result = run(rows, step)
      result.head("ts") shouldBe "2026-03-16"
    }

    "datebucket: floors to the first of the month" in {
      val rows = Seq(Map("ts" -> "2026-03-17".asInstanceOf[Any]))
      val cfg  = """{ "field": "ts", "granularity": "month" }"""
      val step = makeStep("datebucket", cfg)
      val result = run(rows, step)
      result.head("ts") shouldBe "2026-03-01"
    }

    "datebucket: floors to the start of the quarter" in {
      val rows = Seq(Map("ts" -> "2026-08-05".asInstanceOf[Any]))
      val cfg  = """{ "field": "ts", "granularity": "quarter" }"""
      val step = makeStep("datebucket", cfg)
      val result = run(rows, step)
      result.head("ts") shouldBe "2026-07-01"
    }

    "datebucket: floors to the start of the year" in {
      val rows = Seq(Map("ts" -> "2026-08-05".asInstanceOf[Any]))
      val cfg  = """{ "field": "ts", "granularity": "year" }"""
      val step = makeStep("datebucket", cfg)
      val result = run(rows, step)
      result.head("ts") shouldBe "2026-01-01"
    }

    "datebucket: parses epoch-seconds input" in {
      val rows = Seq(Map("ts" -> "1771286400".asInstanceOf[Any]))
      val cfg  = """{ "field": "ts", "granularity": "day" }"""
      val step = makeStep("datebucket", cfg)
      val result = run(rows, step)
      result.head("ts") shouldBe a [String]
      result.head("ts").asInstanceOf[String] should fullyMatch regex """\d{4}-\d{2}-\d{2}"""
    }

    "datebucket: parses epoch-milliseconds input (magnitude > 10 digits)" in {
      val rows = Seq(Map("ts" -> "1771286400000".asInstanceOf[Any]))
      val cfg  = """{ "field": "ts", "granularity": "day" }"""
      val step = makeStep("datebucket", cfg)
      val result = run(rows, step)
      result.head("ts") shouldBe "2026-02-17"
    }

    "datebucket: outputColumn writes to a new field, preserving the source field" in {
      val rows = Seq(Map("ts" -> "2026-03-17T00:00:00Z".asInstanceOf[Any], "name" -> "foo"))
      val cfg  = """{ "field": "ts", "granularity": "month", "outputColumn": "ts_month" }"""
      val step = makeStep("datebucket", cfg)
      val result = run(rows, step)
      result.head("ts")       shouldBe "2026-03-17T00:00:00Z"
      result.head("ts_month") shouldBe "2026-03-01"
      result.head("name")     shouldBe "foo"
    }

    // HEL-639: a single-row, all-unparseable input now trips the zero-parse-rate
    // guard and fails execution (design.md decision 2) rather than silently
    // succeeding with an all-null bucketing — this is the intentional guard
    // behavior change, not a regression. See DateBucketStepSpec for the
    // partially-parseable case, which still nulls only the unparseable row.
    "datebucket: an all-unparseable input fails execution instead of silently yielding null" in {
      val rows = Seq(Map("ts" -> "not-a-date".asInstanceOf[Any]))
      val cfg  = """{ "field": "ts", "granularity": "day" }"""
      val step = makeStep("datebucket", cfg)
      val ex = intercept[StepExecutionException](run(rows, step))
      ex.getMessage should include ("ts")
    }

    "datebucket: unsupported granularity fails at execute time with a descriptive error" in {
      val rows = Seq(Map("ts" -> "2026-03-17".asInstanceOf[Any]))
      val cfg  = """{ "field": "ts", "granularity": "fortnight" }"""
      val step = makeStep("datebucket", cfg)
      val ex = intercept[StepExecutionException](run(rows, step))
      ex.getMessage should include ("fortnight")
      ex.getMessage should include ("day")
      ex.getMessage should include ("week")
      ex.getMessage should include ("month")
      ex.getMessage should include ("quarter")
      ex.getMessage should include ("year")
    }

    // HEL-375: pivot — reshapes long rows into wide rows grouped by index.
    // See spec.md for the exact scenarios these mirror.

    "pivot: basic pivot with sum" in {
      val rows = Seq(
        Map[String, Any]("region" -> "west", "product" -> "widgets", "revenue" -> 10.0),
        Map[String, Any]("region" -> "west", "product" -> "widgets", "revenue" -> 5.0),
        Map[String, Any]("region" -> "west", "product" -> "gadgets", "revenue" -> 7.0),
        Map[String, Any]("region" -> "east", "product" -> "widgets", "revenue" -> 3.0)
      )
      val cfg  = """{"index":["region"],"column":"product","values":"revenue","agg":"sum"}"""
      val step = makeStep("pivot", cfg)
      val result = run(rows, step)

      result should have size 2
      val west = result.find(_("region") == "west").get
      west("revenue_widgets") shouldBe 15.0
      west("revenue_gadgets") shouldBe 7.0
      val east = result.find(_("region") == "east").get
      east("revenue_widgets") shouldBe 3.0
      east.keys should not contain "revenue_gadgets"
    }

    "pivot: count agg counts non-null values cells" in {
      val rows = Seq(
        Map[String, Any]("region" -> "west", "product" -> "widgets", "revenue" -> 10.0),
        Map[String, Any]("region" -> "west", "product" -> "widgets", "revenue" -> null)
      )
      val cfg  = """{"index":["region"],"column":"product","values":"revenue","agg":"count"}"""
      val step = makeStep("pivot", cfg)
      val result = run(rows, step)

      result.head("revenue_widgets") shouldBe 1L
    }

    "pivot: avg agg averages numeric values" in {
      val rows = Seq(
        Map[String, Any]("region" -> "west", "product" -> "widgets", "revenue" -> 10.0),
        Map[String, Any]("region" -> "west", "product" -> "widgets", "revenue" -> 20.0)
      )
      val cfg  = """{"index":["region"],"column":"product","values":"revenue","agg":"avg"}"""
      val step = makeStep("pivot", cfg)
      val result = run(rows, step)

      result.head("revenue_widgets") shouldBe 15.0
    }

    "pivot: min agg returns the minimum numeric value" in {
      val rows = Seq(
        Map[String, Any]("region" -> "west", "product" -> "widgets", "revenue" -> 10.0),
        Map[String, Any]("region" -> "west", "product" -> "widgets", "revenue" -> 3.0)
      )
      val cfg  = """{"index":["region"],"column":"product","values":"revenue","agg":"min"}"""
      val step = makeStep("pivot", cfg)
      val result = run(rows, step)

      result.head("revenue_widgets") shouldBe 3.0
    }

    "pivot: max agg returns the maximum numeric value" in {
      val rows = Seq(
        Map[String, Any]("region" -> "west", "product" -> "widgets", "revenue" -> 10.0),
        Map[String, Any]("region" -> "west", "product" -> "widgets", "revenue" -> 3.0)
      )
      val cfg  = """{"index":["region"],"column":"product","values":"revenue","agg":"max"}"""
      val step = makeStep("pivot", cfg)
      val result = run(rows, step)

      result.head("revenue_widgets") shouldBe 10.0
    }

    "pivot: first agg returns the raw (un-coerced) values cell of the first matching row" in {
      val rows = Seq(
        Map[String, Any]("region" -> "west", "status" -> "open", "label" -> "Needs Review"),
        Map[String, Any]("region" -> "west", "status" -> "open", "label" -> "Second Label")
      )
      val cfg  = """{"index":["region"],"column":"status","values":"label","agg":"first"}"""
      val step = makeStep("pivot", cfg)
      val result = run(rows, step)

      result.head("label_open") shouldBe "Needs Review"
    }

    "pivot: rows with a null column value don't block their index group's output row" in {
      val rows = Seq(Map[String, Any]("region" -> "west", "product" -> null, "revenue" -> 10.0))
      val cfg  = """{"index":["region"],"column":"product","values":"revenue","agg":"sum"}"""
      val step = makeStep("pivot", cfg)
      val result = run(rows, step)

      result should have size 1
      result.head("region") shouldBe "west"
      result.head.keys.count(_.startsWith("revenue_")) shouldBe 0
    }

    "pivot: unsupported agg fails at execute time with a descriptive error" in {
      val rows = Seq(Map[String, Any]("region" -> "west", "product" -> "widgets", "revenue" -> 10.0))
      val cfg  = """{"index":["region"],"column":"product","values":"revenue","agg":"median"}"""
      val step = makeStep("pivot", cfg)
      val ex = intercept[StepExecutionException](run(rows, step))
      ex.getMessage should include ("median")
      ex.getMessage should include ("sum")
      ex.getMessage should include ("count")
      ex.getMessage should include ("avg")
      ex.getMessage should include ("min")
      ex.getMessage should include ("max")
      ex.getMessage should include ("first")
    }

    "pivot: value column wins on collision with an index field name" in {
      // Index field is literally named "revenue_west"; pivoting product="west"
      // on values="revenue" also produces a "revenue_west" value column —
      // design.md decision 2: the later-computed value column wins.
      val rows = Seq(
        Map[String, Any]("revenue_west" -> "placeholder", "product" -> "west", "revenue" -> 10.0)
      )
      val cfg  = """{"index":["revenue_west"],"column":"product","values":"revenue","agg":"sum"}"""
      val step = makeStep("pivot", cfg)
      val result = run(rows, step)

      result.head("revenue_west") shouldBe 10.0
    }

    // HEL-376: window — partitions + orders rows, appending one derived
    // column per row while preserving row count and original row order.
    // See spec.md for the exact scenarios these mirror.

    "window: row_number assigns 1-based sequential positions per partition, preserving original row order" in {
      val rows = Seq(
        Map[String, Any]("category" -> "a", "amount" -> 10.0),
        Map[String, Any]("category" -> "b", "amount" -> 5.0),
        Map[String, Any]("category" -> "a", "amount" -> 30.0),
        Map[String, Any]("category" -> "a", "amount" -> 20.0),
        Map[String, Any]("category" -> "b", "amount" -> 15.0)
      )
      val cfg  = """{"partitionBy":["category"],"orderBy":[{"field":"amount","direction":"desc"}],"function":"row_number","outputColumn":"rn"}"""
      val step = makeStep("window", cfg)
      val result = run(rows, step)

      // Output row order matches the original input row order (design.md decision 3).
      result.map(_("category")) shouldBe Seq("a", "b", "a", "a", "b")

      // Partition "a": amounts 10, 30, 20 → desc order 30 (rn 1), 20 (rn 2), 10 (rn 3).
      result(0)("rn") shouldBe 3 // amount 10
      result(2)("rn") shouldBe 1 // amount 30
      result(3)("rn") shouldBe 2 // amount 20

      // Partition "b": amounts 5, 15 → desc order 15 (rn 1), 5 (rn 2).
      result(1)("rn") shouldBe 2 // amount 5
      result(4)("rn") shouldBe 1 // amount 15
    }

    "window: rank and dense_rank handle ties per standard SQL semantics" in {
      val rows = Seq(
        Map[String, Any]("category" -> "a", "amount" -> 30.0),
        Map[String, Any]("category" -> "a", "amount" -> 30.0),
        Map[String, Any]("category" -> "a", "amount" -> 20.0),
        Map[String, Any]("category" -> "a", "amount" -> 10.0)
      )

      val rankCfg = """{"partitionBy":["category"],"orderBy":[{"field":"amount","direction":"desc"}],"function":"rank","outputColumn":"r"}"""
      val rankResult = run(rows, makeStep("window", rankCfg))
      // Two tied rows share rank 1; the next distinct value's rank skips to 3.
      rankResult.map(_("r")) shouldBe Seq(1, 1, 3, 4)

      val denseCfg = """{"partitionBy":["category"],"orderBy":[{"field":"amount","direction":"desc"}],"function":"dense_rank","outputColumn":"dr"}"""
      val denseResult = run(rows, makeStep("window", denseCfg))
      // Two tied rows share rank 1; the next distinct value's rank increments by exactly 1.
      denseResult.map(_("dr")) shouldBe Seq(1, 1, 2, 3)
    }

    "window: running_sum accumulates numeric values in partition order" in {
      val rows = Seq(
        Map[String, Any]("category" -> "a", "day" -> 1, "amount" -> 10.0),
        Map[String, Any]("category" -> "a", "day" -> 2, "amount" -> 5.0),
        Map[String, Any]("category" -> "a", "day" -> 3, "amount" -> 20.0),
        Map[String, Any]("category" -> "b", "day" -> 1, "amount" -> 100.0)
      )
      val cfg  = """{"partitionBy":["category"],"orderBy":[{"field":"day","direction":"asc"}],"function":"running_sum","field":"amount","outputColumn":"cum"}"""
      val result = run(rows, makeStep("window", cfg))

      result(0)("cum") shouldBe 10.0
      result(1)("cum") shouldBe 15.0
      result(2)("cum") shouldBe 35.0
      result(3)("cum") shouldBe 100.0
    }

    "window: running_sum's non-numeric or absent field values contribute 0 (parity with aggregate's sum)" in {
      val rows = Seq(
        Map[String, Any]("category" -> "a", "day" -> 1, "amount" -> "not-a-number"),
        Map[String, Any]("category" -> "a", "day" -> 2, "amount" -> 5.0)
      )
      val cfg  = """{"partitionBy":["category"],"orderBy":[{"field":"day","direction":"asc"}],"function":"running_sum","field":"amount","outputColumn":"cum"}"""
      val result = run(rows, makeStep("window", cfg))

      result(0)("cum") shouldBe 0.0
      result(1)("cum") shouldBe 5.0
    }

    "window: running_sum without a field fails with a descriptive error" in {
      val rows = Seq(Map[String, Any]("category" -> "a", "amount" -> 10.0))
      val cfg  = """{"partitionBy":["category"],"orderBy":[],"function":"running_sum","outputColumn":"cum"}"""
      val ex = intercept[StepExecutionException](run(rows, makeStep("window", cfg)))
      ex.getMessage should include ("running_sum")
      ex.getMessage should include ("field")
    }

    "window: lag and lead read a neighboring row's field value within the partition" in {
      val rows = Seq(
        Map[String, Any]("category" -> "a", "day" -> 1, "amount" -> 10.0),
        Map[String, Any]("category" -> "a", "day" -> 2, "amount" -> 20.0),
        Map[String, Any]("category" -> "a", "day" -> 3, "amount" -> 30.0)
      )
      val lagCfg = """{"partitionBy":["category"],"orderBy":[{"field":"day","direction":"asc"}],"function":"lag","field":"amount","offset":1,"outputColumn":"prev"}"""
      run(rows, makeStep("window", lagCfg)).map(_("prev")) shouldBe Seq(null, 10.0, 20.0)

      val leadCfg = """{"partitionBy":["category"],"orderBy":[{"field":"day","direction":"asc"}],"function":"lead","field":"amount","offset":1,"outputColumn":"next"}"""
      run(rows, makeStep("window", leadCfg)).map(_("next")) shouldBe Seq(20.0, 30.0, null)
    }

    "window: lag and lead at partition edges emit null" in {
      val rows = Seq(
        Map[String, Any]("category" -> "a", "day" -> 1, "amount" -> 10.0),
        Map[String, Any]("category" -> "a", "day" -> 2, "amount" -> 20.0)
      )
      // offset 5 exceeds the partition size in both directions.
      val lagCfg = """{"partitionBy":["category"],"orderBy":[{"field":"day","direction":"asc"}],"function":"lag","field":"amount","offset":5,"outputColumn":"prev"}"""
      run(rows, makeStep("window", lagCfg)).map(_("prev")) shouldBe Seq(null, null)

      val leadCfg = """{"partitionBy":["category"],"orderBy":[{"field":"day","direction":"asc"}],"function":"lead","field":"amount","offset":5,"outputColumn":"next"}"""
      run(rows, makeStep("window", leadCfg)).map(_("next")) shouldBe Seq(null, null)
    }

    "window: lag/lead offset defaults to 1 when absent" in {
      val rows = Seq(
        Map[String, Any]("category" -> "a", "day" -> 1, "amount" -> 10.0),
        Map[String, Any]("category" -> "a", "day" -> 2, "amount" -> 20.0)
      )
      val cfg  = """{"partitionBy":["category"],"orderBy":[{"field":"day","direction":"asc"}],"function":"lag","field":"amount","outputColumn":"prev"}"""
      run(rows, makeStep("window", cfg)).map(_("prev")) shouldBe Seq(null, 10.0)
    }

    "window: non-positive offset fails with a descriptive error" in {
      val rows = Seq(Map[String, Any]("category" -> "a", "amount" -> 10.0))
      val cfg  = """{"partitionBy":["category"],"orderBy":[],"function":"lag","field":"amount","offset":0,"outputColumn":"prev"}"""
      val ex = intercept[StepExecutionException](run(rows, makeStep("window", cfg)))
      ex.getMessage should include ("offset")
    }

    "window: unsupported function fails at execute time with a descriptive error" in {
      val rows = Seq(Map[String, Any]("category" -> "a", "amount" -> 10.0))
      val cfg  = """{"partitionBy":["category"],"orderBy":[],"function":"median","outputColumn":"m"}"""
      val ex = intercept[StepExecutionException](run(rows, makeStep("window", cfg)))
      ex.getMessage should include ("median")
      ex.getMessage should include ("row_number")
      ex.getMessage should include ("rank")
      ex.getMessage should include ("dense_rank")
      ex.getMessage should include ("running_sum")
      ex.getMessage should include ("lag")
      ex.getMessage should include ("lead")
    }

    "window: outputColumn overwrites an existing field of the same name" in {
      val rows = Seq(Map[String, Any]("category" -> "a", "amount" -> 10.0, "rn" -> "placeholder"))
      val cfg  = """{"partitionBy":["category"],"orderBy":[{"field":"amount","direction":"asc"}],"function":"row_number","outputColumn":"rn"}"""
      run(rows, makeStep("window", cfg)).head("rn") shouldBe 1
    }

    "window: empty partitionBy collapses all rows into a single partition" in {
      val rows = Seq(
        Map[String, Any]("amount" -> 10.0),
        Map[String, Any]("amount" -> 30.0),
        Map[String, Any]("amount" -> 20.0)
      )
      val cfg  = """{"partitionBy":[],"orderBy":[{"field":"amount","direction":"desc"}],"function":"row_number","outputColumn":"rn"}"""
      run(rows, makeStep("window", cfg)).map(_("rn")) shouldBe Seq(3, 1, 2)
    }

    "window: a null partitionBy field value is a valid partition key" in {
      val rows = Seq(
        Map[String, Any]("category" -> null, "amount" -> 10.0),
        Map[String, Any]("category" -> null, "amount" -> 20.0)
      )
      val cfg  = """{"partitionBy":["category"],"orderBy":[{"field":"amount","direction":"asc"}],"function":"row_number","outputColumn":"rn"}"""
      run(rows, makeStep("window", cfg)).map(_("rn")) shouldBe Seq(1, 2)
    }

    // HEL-380: unpivot — reshapes wide rows into long rows, one output row
    // per (input row, valueVar). See spec.md for the exact scenarios these
    // mirror.

    "unpivot: basic unpivot with two value columns" in {
      val rows = Seq(Map[String, Any]("region" -> "west", "jan" -> 10, "feb" -> 20))
      val cfg  = """{"idVars":["region"],"valueVars":["jan","feb"],"varName":"month","valueName":"amount"}"""
      val step = makeStep("unpivot", cfg)
      val result = run(rows, step)

      result should have size 2
      result(0) shouldBe Map("region" -> "west", "month" -> "jan", "amount" -> 10)
      result(1) shouldBe Map("region" -> "west", "month" -> "feb", "amount" -> 20)
    }

    "unpivot: row count multiplies by the number of valueVars" in {
      val rows = Seq(
        Map[String, Any]("id" -> 1, "a" -> 1, "b" -> 2, "c" -> 3),
        Map[String, Any]("id" -> 2, "a" -> 4, "b" -> 5, "c" -> 6)
      )
      val cfg  = """{"idVars":["id"],"valueVars":["a","b","c"],"varName":"variable","valueName":"value"}"""
      val step = makeStep("unpivot", cfg)
      val result = run(rows, step)

      result should have size 6
    }

    "unpivot: default varName/valueName apply when omitted from config" in {
      val rows = Seq(Map[String, Any]("id" -> 1, "a" -> 5))
      val cfg  = """{"idVars":["id"],"valueVars":["a"]}"""
      val step = makeStep("unpivot", cfg)
      val result = run(rows, step)

      result should have size 1
      result.head shouldBe Map("id" -> 1, "variable" -> "a", "value" -> 5)
    }

    "unpivot: missing idVars or valueVars field yields null, not a dropped row" in {
      val rows = Seq(Map[String, Any]("id" -> 1))
      val cfg  = """{"idVars":["id","missingId"],"valueVars":["missingValue"],"varName":"variable","valueName":"value"}"""
      val step = makeStep("unpivot", cfg)
      val result = run(rows, step)

      result should have size 1
      result.head shouldBe Map("id" -> 1, "missingId" -> null, "variable" -> "missingValue", "value" -> null)
    }

    "unpivot: valueName collides with an idVars field name — valueName wins" in {
      val rows = Seq(Map[String, Any]("value" -> "keep-me", "a" -> 5))
      val cfg  = """{"idVars":["value"],"valueVars":["a"],"varName":"variable","valueName":"value"}"""
      val step = makeStep("unpivot", cfg)
      val result = run(rows, step)

      result.head("value") shouldBe 5
    }

    "unpivot: empty valueVars produces zero output rows per input row" in {
      // Design.md's row-multiplication formula (N input rows * len(valueVars))
      // degrades to zero when valueVars is empty — no special-casing in the
      // engine, just an inner loop with nothing to iterate.
      val rows = Seq(
        Map[String, Any]("id" -> 1, "a" -> 5),
        Map[String, Any]("id" -> 2, "a" -> 6)
      )
      val cfg  = """{"idVars":["id"],"valueVars":[],"varName":"variable","valueName":"value"}"""
      val step = makeStep("unpivot", cfg)
      val result = run(rows, step)

      result shouldBe empty
    }

    "join op: performs inner join on joinKey" in {
      val leftRows = Seq(
        Map[String, Any]("id" -> "1", "left_val" -> "a"),
        Map[String, Any]("id" -> "2", "left_val" -> "b"),
        Map[String, Any]("id" -> "3", "left_val" -> "c")  // no match → excluded in inner join
      )
      val rightConfig = buildStaticConfig(
        Seq("id", "dept"),
        Seq(
          Map[String, Any]("id" -> "1", "dept" -> "eng"),
          Map[String, Any]("id" -> "2", "dept" -> "mkt")
        )
      )
      val rightDs = StaticSource(
        id        = DataSourceId("ds-right"),
        name      = "right",
        ownerId   = UserId("00000000-0000-0000-0000-000000000001"),
        createdAt = Instant.now(),
        updatedAt = Instant.now()
      )
      val rightConfigJson = rightConfig.compactPrint
      val mockRepo = new DataSourceRepository(null)(ec) {
        override def findByIdInternal(dsId: DataSourceId): Future[Option[DataSource]] =
          Future.successful(if (dsId.value == "ds-right") Some(rightDs) else None)
        override def readRawConfig(dsId: DataSourceId): Future[Option[String]] =
          Future.successful(if (dsId.value == "ds-right") Some(rightConfigJson) else None)
      }
      val step = makeStep("join",
        """{ "rightDataSourceId": "ds-right", "joinKey": "id", "joinType": "inner" }""")
      val result = Await.result(engine.execute(leftRows, Seq(step), mockRepo), 5.seconds)

      result should have size 2
      result.map(_("left_val")) should contain allOf ("a", "b")
      result.map(_("dept"))     should contain allOf ("eng", "mkt")
    }

    "join op: left join retains unmatched left rows" in {
      val leftRows = Seq(
        Map[String, Any]("id" -> "1", "left_val" -> "a"),
        Map[String, Any]("id" -> "99", "left_val" -> "orphan")
      )
      val rightConfig = buildStaticConfig(
        Seq("id", "dept"),
        Seq(Map[String, Any]("id" -> "1", "dept" -> "eng"))
      )
      val rightDs = StaticSource(
        id        = DataSourceId("ds-right-left"),
        name      = "right",
        ownerId   = UserId("00000000-0000-0000-0000-000000000001"),
        createdAt = Instant.now(),
        updatedAt = Instant.now()
      )
      val rightConfigJson = rightConfig.compactPrint
      val mockRepo = new DataSourceRepository(null)(ec) {
        override def findByIdInternal(dsId: DataSourceId): Future[Option[DataSource]] =
          Future.successful(if (dsId.value == "ds-right-left") Some(rightDs) else None)
        override def readRawConfig(dsId: DataSourceId): Future[Option[String]] =
          Future.successful(if (dsId.value == "ds-right-left") Some(rightConfigJson) else None)
      }
      val step = makeStep("join",
        """{ "rightDataSourceId": "ds-right-left", "joinKey": "id", "joinType": "left" }""")
      val result = Await.result(engine.execute(leftRows, Seq(step), mockRepo), 5.seconds)

      result should have size 2  // orphan row retained
      result.map(_("left_val")) should contain ("orphan")
    }

    // HEL-384 — union op: byPosition/byName execution, error paths.

    "union op: byPosition appends rows with no column reconciliation" in {
      val currentRows = Seq(Map[String, Any]("a" -> 1, "b" -> 2))
      val otherConfig = buildStaticConfig(
        Seq("a", "b"),
        Seq(Map[String, Any]("a" -> 3, "b" -> 4))
      )
      val otherDs = StaticSource(
        id        = DataSourceId("ds-union-position"),
        name      = "other",
        ownerId   = UserId("00000000-0000-0000-0000-000000000001"),
        createdAt = Instant.now(),
        updatedAt = Instant.now()
      )
      val otherConfigJson = otherConfig.compactPrint
      val mockRepo = new DataSourceRepository(null)(ec) {
        override def findByIdInternal(dsId: DataSourceId): Future[Option[DataSource]] =
          Future.successful(if (dsId.value == "ds-union-position") Some(otherDs) else None)
        override def readRawConfig(dsId: DataSourceId): Future[Option[String]] =
          Future.successful(if (dsId.value == "ds-union-position") Some(otherConfigJson) else None)
      }
      val step = makeStep("union",
        """{ "otherDataSourceId": "ds-union-position", "mode": "byPosition" }""")
      val result = Await.result(engine.execute(currentRows, Seq(step), mockRepo), 5.seconds)

      result shouldBe Seq(
        Map[String, Any]("a" -> 1, "b" -> 2),
        Map[String, Any]("a" -> 3, "b" -> 4)
      )
    }

    "union op: byName aligns on column names and backfills missing columns with null" in {
      val currentRows = Seq(Map[String, Any]("a" -> 1, "b" -> 2))
      val otherConfig = buildStaticConfig(
        Seq("a", "c"),
        Seq(Map[String, Any]("a" -> 3, "c" -> 5))
      )
      val otherDs = StaticSource(
        id        = DataSourceId("ds-union-name"),
        name      = "other",
        ownerId   = UserId("00000000-0000-0000-0000-000000000001"),
        createdAt = Instant.now(),
        updatedAt = Instant.now()
      )
      val otherConfigJson = otherConfig.compactPrint
      val mockRepo = new DataSourceRepository(null)(ec) {
        override def findByIdInternal(dsId: DataSourceId): Future[Option[DataSource]] =
          Future.successful(if (dsId.value == "ds-union-name") Some(otherDs) else None)
        override def readRawConfig(dsId: DataSourceId): Future[Option[String]] =
          Future.successful(if (dsId.value == "ds-union-name") Some(otherConfigJson) else None)
      }
      val step = makeStep("union",
        """{ "otherDataSourceId": "ds-union-name", "mode": "byName" }""")
      val result = Await.result(engine.execute(currentRows, Seq(step), mockRepo), 5.seconds)

      result shouldBe Seq(
        Map[String, Any]("a" -> 1, "b" -> 2, "c" -> null),
        Map[String, Any]("a" -> 3, "b" -> null, "c" -> 5)
      )
    }

    "union op: byName with identical column sets behaves like byPosition (no null backfill)" in {
      val currentRows = Seq(Map[String, Any]("a" -> 1, "b" -> 2))
      val otherConfig = buildStaticConfig(
        Seq("a", "b"),
        Seq(Map[String, Any]("a" -> 3, "b" -> 4))
      )
      val otherDs = StaticSource(
        id        = DataSourceId("ds-union-name-same"),
        name      = "other",
        ownerId   = UserId("00000000-0000-0000-0000-000000000001"),
        createdAt = Instant.now(),
        updatedAt = Instant.now()
      )
      val otherConfigJson = otherConfig.compactPrint
      val mockRepo = new DataSourceRepository(null)(ec) {
        override def findByIdInternal(dsId: DataSourceId): Future[Option[DataSource]] =
          Future.successful(if (dsId.value == "ds-union-name-same") Some(otherDs) else None)
        override def readRawConfig(dsId: DataSourceId): Future[Option[String]] =
          Future.successful(if (dsId.value == "ds-union-name-same") Some(otherConfigJson) else None)
      }
      val step = makeStep("union",
        """{ "otherDataSourceId": "ds-union-name-same", "mode": "byName" }""")
      val result = Await.result(engine.execute(currentRows, Seq(step), mockRepo), 5.seconds)

      result shouldBe Seq(
        Map[String, Any]("a" -> 1, "b" -> 2),
        Map[String, Any]("a" -> 3, "b" -> 4)
      )
    }

    "union op: missing otherDataSourceId fails at execute time" in {
      val mockRepo = new DataSourceRepository(null)(ec) {
        override def findByIdInternal(dsId: DataSourceId): Future[Option[DataSource]] =
          Future.successful(None)
      }
      val step = makeStep("union", """{ "mode": "byPosition" }""")
      val ex = intercept[StepExecutionException] {
        Await.result(engine.execute(sampleRows, Seq(step), mockRepo), 5.seconds)
      }
      ex.getMessage should include ("DataSource not found for union")
    }

    "union op: unresolvable otherDataSourceId fails at execute time, naming the id" in {
      val mockRepo = new DataSourceRepository(null)(ec) {
        override def findByIdInternal(dsId: DataSourceId): Future[Option[DataSource]] =
          Future.successful(None)
      }
      val step = makeStep("union",
        """{ "otherDataSourceId": "does-not-exist", "mode": "byPosition" }""")
      val ex = intercept[StepExecutionException] {
        Await.result(engine.execute(sampleRows, Seq(step), mockRepo), 5.seconds)
      }
      ex.getMessage should include ("does-not-exist")
    }

    "union op: unsupported mode fails at execute time, naming the value and supported modes" in {
      val otherDs = StaticSource(
        id        = DataSourceId("ds-union-badmode"),
        name      = "other",
        ownerId   = UserId("00000000-0000-0000-0000-000000000001"),
        createdAt = Instant.now(),
        updatedAt = Instant.now()
      )
      val otherConfigJson = buildStaticConfig(Seq("a"), Seq(Map[String, Any]("a" -> 1))).compactPrint
      val mockRepo = new DataSourceRepository(null)(ec) {
        override def findByIdInternal(dsId: DataSourceId): Future[Option[DataSource]] =
          Future.successful(if (dsId.value == "ds-union-badmode") Some(otherDs) else None)
        override def readRawConfig(dsId: DataSourceId): Future[Option[String]] =
          Future.successful(if (dsId.value == "ds-union-badmode") Some(otherConfigJson) else None)
      }
      val step = makeStep("union",
        """{ "otherDataSourceId": "ds-union-badmode", "mode": "byColumn" }""")
      val ex = intercept[StepExecutionException] {
        Await.result(engine.execute(sampleRows, Seq(step), mockRepo), 5.seconds)
      }
      ex.getMessage should include ("byColumn")
      ex.getMessage should include ("byPosition")
      ex.getMessage should include ("byName")
    }

    // HEL-386 — lookup op: single-key left-join match/no-match/multi-match/
    // collision behavior, plus error paths.

    "lookup op: matching row is enriched with only the named columns" in {
      val currentRows = Seq(Map[String, Any]("code" -> "A", "qty" -> 5))
      val refConfig = buildStaticConfig(
        Seq("code", "label", "price"),
        Seq(Map[String, Any]("code" -> "A", "label" -> "Apple", "price" -> 1.5))
      )
      val refDs = StaticSource(
        id        = DataSourceId("ds-lookup-match"),
        name      = "reference",
        ownerId   = UserId("00000000-0000-0000-0000-000000000001"),
        createdAt = Instant.now(),
        updatedAt = Instant.now()
      )
      val refConfigJson = refConfig.compactPrint
      val mockRepo = new DataSourceRepository(null)(ec) {
        override def findByIdInternal(dsId: DataSourceId): Future[Option[DataSource]] =
          Future.successful(if (dsId.value == "ds-lookup-match") Some(refDs) else None)
        override def readRawConfig(dsId: DataSourceId): Future[Option[String]] =
          Future.successful(if (dsId.value == "ds-lookup-match") Some(refConfigJson) else None)
      }
      val step = makeStep("lookup",
        """{ "referenceDataSourceId": "ds-lookup-match", "sourceKey": "code", "lookupKey": "code", "columns": ["label"] }""")
      val result = Await.result(engine.execute(currentRows, Seq(step), mockRepo), 5.seconds)

      result shouldBe Seq(Map[String, Any]("code" -> "A", "qty" -> 5, "label" -> "Apple"))
    }

    "lookup op: unmatched row is null-filled, not dropped (left join)" in {
      val currentRows = Seq(Map[String, Any]("code" -> "B", "qty" -> 2))
      val refConfig = buildStaticConfig(
        Seq("code", "label"),
        Seq(Map[String, Any]("code" -> "A", "label" -> "Apple"))
      )
      val refDs = StaticSource(
        id        = DataSourceId("ds-lookup-nomatch"),
        name      = "reference",
        ownerId   = UserId("00000000-0000-0000-0000-000000000001"),
        createdAt = Instant.now(),
        updatedAt = Instant.now()
      )
      val refConfigJson = refConfig.compactPrint
      val mockRepo = new DataSourceRepository(null)(ec) {
        override def findByIdInternal(dsId: DataSourceId): Future[Option[DataSource]] =
          Future.successful(if (dsId.value == "ds-lookup-nomatch") Some(refDs) else None)
        override def readRawConfig(dsId: DataSourceId): Future[Option[String]] =
          Future.successful(if (dsId.value == "ds-lookup-nomatch") Some(refConfigJson) else None)
      }
      val step = makeStep("lookup",
        """{ "referenceDataSourceId": "ds-lookup-nomatch", "sourceKey": "code", "lookupKey": "code", "columns": ["label"] }""")
      val result = Await.result(engine.execute(currentRows, Seq(step), mockRepo), 5.seconds)

      result shouldBe Seq(Map[String, Any]("code" -> "B", "qty" -> 2, "label" -> null))
    }

    "lookup op: duplicate reference keys use the first match, row count unchanged" in {
      val currentRows = Seq(Map[String, Any]("code" -> "A"))
      val refConfig = buildStaticConfig(
        Seq("code", "label"),
        Seq(
          Map[String, Any]("code" -> "A", "label" -> "First"),
          Map[String, Any]("code" -> "A", "label" -> "Second")
        )
      )
      val refDs = StaticSource(
        id        = DataSourceId("ds-lookup-multi"),
        name      = "reference",
        ownerId   = UserId("00000000-0000-0000-0000-000000000001"),
        createdAt = Instant.now(),
        updatedAt = Instant.now()
      )
      val refConfigJson = refConfig.compactPrint
      val mockRepo = new DataSourceRepository(null)(ec) {
        override def findByIdInternal(dsId: DataSourceId): Future[Option[DataSource]] =
          Future.successful(if (dsId.value == "ds-lookup-multi") Some(refDs) else None)
        override def readRawConfig(dsId: DataSourceId): Future[Option[String]] =
          Future.successful(if (dsId.value == "ds-lookup-multi") Some(refConfigJson) else None)
      }
      val step = makeStep("lookup",
        """{ "referenceDataSourceId": "ds-lookup-multi", "sourceKey": "code", "lookupKey": "code", "columns": ["label"] }""")
      val result = Await.result(engine.execute(currentRows, Seq(step), mockRepo), 5.seconds)

      result should have size 1
      result shouldBe Seq(Map[String, Any]("code" -> "A", "label" -> "First"))
    }

    "lookup op: column collision — reference value overwrites the left row's value" in {
      val currentRows = Seq(Map[String, Any]("code" -> "A", "qty" -> 5))
      val refConfig = buildStaticConfig(
        Seq("code", "qty"),
        Seq(Map[String, Any]("code" -> "A", "qty" -> 99))
      )
      val refDs = StaticSource(
        id        = DataSourceId("ds-lookup-collision"),
        name      = "reference",
        ownerId   = UserId("00000000-0000-0000-0000-000000000001"),
        createdAt = Instant.now(),
        updatedAt = Instant.now()
      )
      val refConfigJson = refConfig.compactPrint
      val mockRepo = new DataSourceRepository(null)(ec) {
        override def findByIdInternal(dsId: DataSourceId): Future[Option[DataSource]] =
          Future.successful(if (dsId.value == "ds-lookup-collision") Some(refDs) else None)
        override def readRawConfig(dsId: DataSourceId): Future[Option[String]] =
          Future.successful(if (dsId.value == "ds-lookup-collision") Some(refConfigJson) else None)
      }
      val step = makeStep("lookup",
        """{ "referenceDataSourceId": "ds-lookup-collision", "sourceKey": "code", "lookupKey": "code", "columns": ["qty"] }""")
      val result = Await.result(engine.execute(currentRows, Seq(step), mockRepo), 5.seconds)

      result shouldBe Seq(Map[String, Any]("code" -> "A", "qty" -> 99))
    }

    "lookup op: only named columns are brought in, other reference fields dropped" in {
      val currentRows = Seq(Map[String, Any]("code" -> "A", "qty" -> 5))
      val refConfig = buildStaticConfig(
        Seq("code", "label", "price"),
        Seq(Map[String, Any]("code" -> "A", "label" -> "Apple", "price" -> 1.5))
      )
      val refDs = StaticSource(
        id        = DataSourceId("ds-lookup-onlynamed"),
        name      = "reference",
        ownerId   = UserId("00000000-0000-0000-0000-000000000001"),
        createdAt = Instant.now(),
        updatedAt = Instant.now()
      )
      val refConfigJson = refConfig.compactPrint
      val mockRepo = new DataSourceRepository(null)(ec) {
        override def findByIdInternal(dsId: DataSourceId): Future[Option[DataSource]] =
          Future.successful(if (dsId.value == "ds-lookup-onlynamed") Some(refDs) else None)
        override def readRawConfig(dsId: DataSourceId): Future[Option[String]] =
          Future.successful(if (dsId.value == "ds-lookup-onlynamed") Some(refConfigJson) else None)
      }
      val step = makeStep("lookup",
        """{ "referenceDataSourceId": "ds-lookup-onlynamed", "sourceKey": "code", "lookupKey": "code", "columns": ["label"] }""")
      val result = Await.result(engine.execute(currentRows, Seq(step), mockRepo), 5.seconds)

      result.head.keys should not contain "price"
    }

    "lookup op: missing referenceDataSourceId fails at execute time" in {
      val mockRepo = new DataSourceRepository(null)(ec) {
        override def findByIdInternal(dsId: DataSourceId): Future[Option[DataSource]] =
          Future.successful(None)
      }
      val step = makeStep("lookup", """{ "sourceKey": "code", "lookupKey": "code", "columns": ["label"] }""")
      val ex = intercept[StepExecutionException] {
        Await.result(engine.execute(sampleRows, Seq(step), mockRepo), 5.seconds)
      }
      ex.getMessage should include ("DataSource not found for lookup")
    }

    "lookup op: unresolvable referenceDataSourceId fails at execute time, naming the id" in {
      val mockRepo = new DataSourceRepository(null)(ec) {
        override def findByIdInternal(dsId: DataSourceId): Future[Option[DataSource]] =
          Future.successful(None)
      }
      val step = makeStep("lookup",
        """{ "referenceDataSourceId": "does-not-exist", "sourceKey": "code", "lookupKey": "code", "columns": ["label"] }""")
      val ex = intercept[StepExecutionException] {
        Await.result(engine.execute(sampleRows, Seq(step), mockRepo), 5.seconds)
      }
      ex.getMessage should include ("does-not-exist")
    }

    "multi-step: applies steps in order" in {
      val renameStep  = makeStep("rename",  """{ "renames": { "name": "person" } }""")
      val computeStep = makeStep("compute", """{ "column": "age_doubled", "expression": "age + age" }""")
      val castStep    = makeStep("cast",    """{ "casts": { "age": "integer" } }""")

      val result = run(sampleRows, renameStep, computeStep, castStep)

      result.head.keys should contain ("person")
      result.head.keys should not contain "name"
      result.head("age_doubled") shouldBe 60.0
      result.head("age") shouldBe 30
    }

    "select: retains only specified fields" in {
      val cfg  = """{ "fields": ["name", "dept"] }"""
      val step = makeStep("select", cfg)
      val result = run(sampleRows, step)
      result should have size 3
      result.head.keys should contain theSameElementsAs Seq("name", "dept")
      result.head("name") shouldBe "alice"
      result.head.keys should not contain "age"
    }

    // HEL-599 acceptance criteria / task 5.8: a dotted column produced by nested-JSON row
    // materialisation is an exact key, so `select`'s key-set intersection (SelectStep.scala:50)
    // retains it exactly like any other field — this was the field report's failing case
    // ("select with dotted fields silently drops them"), now unblocked once the column exists.
    "select: retains a dotted column produced by nested-JSON flattening" in {
      val nestedRows = Seq(Map("player_id" -> "8800", "stats.pts_ppr" -> 33.7, "team" -> "DAL"))
      val cfg        = """{ "fields": ["player_id", "stats.pts_ppr"] }"""
      val step       = makeStep("select", cfg)
      val result     = run(nestedRows, step)
      result.head.keys should contain theSameElementsAs Seq("player_id", "stats.pts_ppr")
      result.head("stats.pts_ppr") shouldBe 33.7
    }

    "select: silently omits missing fields" in {
      val cfg  = """{ "fields": ["name", "nonexistent"] }"""
      val step = makeStep("select", cfg)
      val result = run(sampleRows, step)
      result.head.keys should contain ("name")
      result.head.keys should not contain "nonexistent"
    }

    "select: returns empty maps when fields list is empty" in {
      val cfg  = """{ "fields": [] }"""
      val step = makeStep("select", cfg)
      val result = run(sampleRows, step)
      result should have size 3
      result.head.keys shouldBe empty
    }

    // ── aggregate op ────────────────────────────────────────────────────────

    "aggregate: groups and sums a numeric column" in {
      val cfg = """{ "groupBy": [{"name":"dept","type":"string"}],
                    "aggregations": [{"alias":"total_age","fn":"sum","field":"age"}] }"""
      val step   = makeStep("aggregate", cfg)
      val result = run(sampleRows, step)
      result should have size 2
      val engRow = result.find(_("dept") == "eng").get
      engRow("total_age") shouldBe (30.0 + 0.0)
      val mktRow = result.find(_("dept") == "mkt").get
      mktRow("total_age") shouldBe 25.0
    }

    "aggregate: computes avg of a numeric column per group" in {
      val cfg = """{ "groupBy": [{"name":"dept","type":"string"}],
                    "aggregations": [{"alias":"avg_age","fn":"avg","field":"age"}] }"""
      val step   = makeStep("aggregate", cfg)
      val result = run(sampleRows, step)
      result should have size 2
      val engRow = result.find(_("dept") == "eng").get
      engRow("avg_age") shouldBe (30.0 / 2)
    }

    "aggregate: computes min and max of a numeric column" in {
      val cfg = """{ "groupBy": [{"name":"dept","type":"string"}],
                    "aggregations": [
                      {"alias":"min_age","fn":"min","field":"age"},
                      {"alias":"max_age","fn":"max","field":"age"}
                    ] }"""
      val step   = makeStep("aggregate", cfg)
      val result = run(sampleRows, step)
      val engRow = result.find(_("dept") == "eng").get
      engRow("min_age") shouldBe 0.0
      engRow("max_age") shouldBe 30.0
    }

    "aggregate: counts non-null values per group" in {
      val rows = Seq(
        Map[String, Any]("dept" -> "eng", "score" -> 10.0),
        Map[String, Any]("dept" -> "eng", "score" -> null),
        Map[String, Any]("dept" -> "mkt", "score" -> 5.0)
      )
      val cfg = """{ "groupBy": [{"name":"dept","type":"string"}],
                    "aggregations": [{"alias":"n","fn":"count","field":"score"}] }"""
      val step   = makeStep("aggregate", cfg)
      val result = run(rows, step)
      val engRow = result.find(_("dept") == "eng").get
      engRow("n") shouldBe 1L  // only non-null counted
      val mktRow = result.find(_("dept") == "mkt").get
      mktRow("n") shouldBe 1L
    }

    "aggregate: empty groupBy collapses all rows into one group" in {
      val cfg = """{ "groupBy": [],
                    "aggregations": [{"alias":"total","fn":"sum","field":"age"}] }"""
      val step   = makeStep("aggregate", cfg)
      val result = run(sampleRows, step)
      result should have size 1
      result.head("total") shouldBe (30.0 + 25.0 + 0.0)
    }

    "aggregate: null-safe — skips null values for sum/avg/min/max" in {
      val rows = Seq(
        Map[String, Any]("dept" -> "eng", "score" -> null),
        Map[String, Any]("dept" -> "eng", "score" -> null)
      )
      val cfg = """{ "groupBy": [{"name":"dept","type":"string"}],
                    "aggregations": [
                      {"alias":"total","fn":"sum","field":"score"},
                      {"alias":"avg","fn":"avg","field":"score"},
                      {"alias":"mn","fn":"min","field":"score"},
                      {"alias":"mx","fn":"max","field":"score"}
                    ] }"""
      val step   = makeStep("aggregate", cfg)
      val result = run(rows, step)
      result should have size 1
      result.head("total") shouldBe 0.0         // sum of empty seq
      result.head("avg").asInstanceOf[AnyRef]   shouldBe null
      result.head("mn").asInstanceOf[AnyRef]    shouldBe null
      result.head("mx").asInstanceOf[AnyRef]    shouldBe null
    }

    "aggregate: malformed config — missing aggregations key yields empty agg map" in {
      val cfg = """{ "groupBy": [{"name":"dept","type":"string"}] }"""
      val step   = makeStep("aggregate", cfg)
      val result = run(sampleRows, step)
      // No aggregation columns — each group row only has the groupBy key
      result should have size 2
      result.head.keys should contain ("dept")
    }

    "aggregate: malformed config — missing groupBy key treats all rows as one group" in {
      val cfg = """{ "aggregations": [{"alias":"total","fn":"sum","field":"age"}] }"""
      val step   = makeStep("aggregate", cfg)
      val result = run(sampleRows, step)
      result should have size 1
      result.head("total") shouldBe (30.0 + 25.0 + 0.0)
    }

    // ── limit op ─────────────────────────────────────────────────────────────

    "limit: truncates output to N rows" in {
      val cfg  = """{ "count": 2 }"""
      val step = makeStep("limit", cfg)
      val result = run(sampleRows, step)
      result should have size 2
      result.head("name") shouldBe "alice"
      result(1)("name") shouldBe "bob"
    }

    "limit: count greater than total rows returns all rows" in {
      val cfg  = """{ "count": 100 }"""
      val step = makeStep("limit", cfg)
      val result = run(sampleRows, step)
      result should have size sampleRows.size
    }

    "limit: count = 0 is a no-op and returns all rows" in {
      val cfg  = """{ "count": 0 }"""
      val step = makeStep("limit", cfg)
      val result = run(sampleRows, step)
      result should have size sampleRows.size
    }

    // ── sort op ──────────────────────────────────────────────────────────────

    "sort: sorts rows ascending by a string column" in {
      val cfg  = """{ "sortBy": [{ "field": "name", "direction": "asc" }] }"""
      val step = makeStep("sort", cfg)
      val result = run(sampleRows, step)
      result.map(_("name")) shouldBe Seq("alice", "bob", "carol")
    }

    "sort: sorts rows descending by a string column" in {
      val cfg  = """{ "sortBy": [{ "field": "name", "direction": "desc" }] }"""
      val step = makeStep("sort", cfg)
      val result = run(sampleRows, step)
      result.map(_("name")) shouldBe Seq("carol", "bob", "alice")
    }

    "sort: multi-column sort — primary key takes precedence" in {
      val rows = Seq(
        Map[String, Any]("dept" -> "eng", "name" -> "carol"),
        Map[String, Any]("dept" -> "mkt", "name" -> "alice"),
        Map[String, Any]("dept" -> "eng", "name" -> "alice")
      )
      val cfg  = """{ "sortBy": [
        { "field": "dept", "direction": "asc" },
        { "field": "name", "direction": "asc" }
      ] }"""
      val step   = makeStep("sort", cfg)
      val result = run(rows, step)
      // Primary: dept asc (eng before mkt); Secondary: name asc within dept
      result.map(r => (r("dept"), r("name"))) shouldBe Seq(
        ("eng", "alice"),
        ("eng", "carol"),
        ("mkt", "alice")
      )
    }

    "sort: nulls sort last for ascending direction" in {
      val rows = Seq(
        Map[String, Any]("name" -> "bob",  "score" -> 10.0),
        Map[String, Any]("name" -> "alice","score" -> null),
        Map[String, Any]("name" -> "carol","score" -> 5.0)
      )
      val cfg  = """{ "sortBy": [{ "field": "score", "direction": "asc" }] }"""
      val step = makeStep("sort", cfg)
      val result = run(rows, step)
      result.map(_("name")) shouldBe Seq("carol", "bob", "alice")
    }

    "sort: nulls sort last for descending direction" in {
      val rows = Seq(
        Map[String, Any]("name" -> "bob",  "score" -> 10.0),
        Map[String, Any]("name" -> "alice","score" -> null),
        Map[String, Any]("name" -> "carol","score" -> 5.0)
      )
      val cfg  = """{ "sortBy": [{ "field": "score", "direction": "desc" }] }"""
      val step = makeStep("sort", cfg)
      val result = run(rows, step)
      result.map(_("name")) shouldBe Seq("bob", "carol", "alice")
    }

    "sort: empty sortBy array is a no-op" in {
      val cfg  = """{ "sortBy": [] }"""
      val step = makeStep("sort", cfg)
      val result = run(sampleRows, step)
      result should have size sampleRows.size
      result.map(_("name")) shouldBe sampleRows.map(_("name"))
    }

    // ── dedupe op (HEL-382) ────────────────────────────────────────────────────

    "dedupe: whole-row distinct removes exact-duplicate rows, preserving first-seen order" in {
      val rows = Seq(
        Map[String, Any]("a" -> 1.0, "b" -> 2.0),
        Map[String, Any]("a" -> 1.0, "b" -> 2.0),
        Map[String, Any]("a" -> 1.0, "b" -> 3.0)
      )
      val cfg  = """{ "keys": [], "keep": "first" }"""
      val step = makeStep("dedupe", cfg)
      val result = run(rows, step)
      result shouldBe Seq(
        Map[String, Any]("a" -> 1.0, "b" -> 2.0),
        Map[String, Any]("a" -> 1.0, "b" -> 3.0)
      )
    }

    "dedupe: key-set dedupe with keep=first keeps the first occurrence per key" in {
      val rows = Seq(
        Map[String, Any]("id" -> 1.0, "v" -> "a"),
        Map[String, Any]("id" -> 2.0, "v" -> "b"),
        Map[String, Any]("id" -> 1.0, "v" -> "c")
      )
      val cfg  = """{ "keys": ["id"], "keep": "first" }"""
      val step = makeStep("dedupe", cfg)
      val result = run(rows, step)
      result shouldBe Seq(
        Map[String, Any]("id" -> 1.0, "v" -> "a"),
        Map[String, Any]("id" -> 2.0, "v" -> "b")
      )
    }

    "dedupe: key-set dedupe with keep=last keeps the last occurrence per key, at its original position" in {
      val rows = Seq(
        Map[String, Any]("id" -> 1.0, "v" -> "a"),
        Map[String, Any]("id" -> 2.0, "v" -> "b"),
        Map[String, Any]("id" -> 1.0, "v" -> "c")
      )
      val cfg  = """{ "keys": ["id"], "keep": "last" }"""
      val step = makeStep("dedupe", cfg)
      val result = run(rows, step)
      result shouldBe Seq(
        Map[String, Any]("id" -> 2.0, "v" -> "b"),
        Map[String, Any]("id" -> 1.0, "v" -> "c")
      )
    }

    "dedupe: null values for a key field collapse together" in {
      val rows = Seq(
        Map[String, Any]("region" -> null, "v" -> 1.0),
        Map[String, Any]("region" -> null, "v" -> 2.0)
      )
      val cfg  = """{ "keys": ["region"], "keep": "first" }"""
      val step = makeStep("dedupe", cfg)
      val result = run(rows, step)
      result shouldBe Seq(Map[String, Any]("region" -> null, "v" -> 1.0))
    }

    "dedupe: missing keep field defaults to first" in {
      val rows = Seq(
        Map[String, Any]("id" -> 1.0, "v" -> "a"),
        Map[String, Any]("id" -> 1.0, "v" -> "b")
      )
      val cfg  = """{ "keys": ["id"] }"""
      val step = makeStep("dedupe", cfg)
      val result = run(rows, step)
      result shouldBe Seq(Map[String, Any]("id" -> 1.0, "v" -> "a"))
    }

    "dedupe: preserves the relative order of surviving rows (stable filter)" in {
      val rows = Seq(
        Map[String, Any]("id" -> 3.0, "v" -> "x"),
        Map[String, Any]("id" -> 1.0, "v" -> "y"),
        Map[String, Any]("id" -> 2.0, "v" -> "z"),
        Map[String, Any]("id" -> 1.0, "v" -> "w")
      )
      val cfg  = """{ "keys": ["id"], "keep": "first" }"""
      val step = makeStep("dedupe", cfg)
      val result = run(rows, step)
      result.map(_("id")) shouldBe Seq(3.0, 1.0, 2.0)
    }

    // ── fillnull op (HEL-388) ──────────────────────────────────────────────────

    "fillnull: constant strategy fills only null cells" in {
      val rows = Seq(
        Map[String, Any]("region" -> null, "v" -> 1.0),
        Map[String, Any]("region" -> "east", "v" -> 2.0)
      )
      val cfg  = """{ "columns": ["region"], "strategy": "constant", "value": "unknown" }"""
      val step = makeStep("fillnull", cfg)
      val result = run(rows, step)
      result shouldBe Seq(
        Map[String, Any]("region" -> "unknown", "v" -> 1.0),
        Map[String, Any]("region" -> "east", "v" -> 2.0)
      )
    }

    "fillnull: constant strategy treats a missing key as null" in {
      val rows = Seq(Map[String, Any]("v" -> 1.0))
      val cfg  = """{ "columns": ["region"], "strategy": "constant", "value": "unknown" }"""
      val step = makeStep("fillnull", cfg)
      val result = run(rows, step)
      result shouldBe Seq(Map[String, Any]("region" -> "unknown", "v" -> 1.0))
    }

    "fillnull: constant strategy without a value fails with a descriptive error" in {
      val rows = Seq(Map[String, Any]("region" -> null))
      val cfg  = """{ "columns": ["region"], "strategy": "constant" }"""
      val step = makeStep("fillnull", cfg)
      val ex = intercept[StepExecutionException](run(rows, step))
      ex.getMessage should include("value")
    }

    "fillnull: columns not listed are untouched" in {
      val rows = Seq(Map[String, Any]("region" -> null, "other" -> null))
      val cfg  = """{ "columns": ["region"], "strategy": "constant", "value": "x" }"""
      val step = makeStep("fillnull", cfg)
      val result = run(rows, step)
      result shouldBe Seq(Map[String, Any]("region" -> "x", "other" -> null))
    }

    "fillnull: forwardFill carries the last non-null value in original row order" in {
      val rows = Seq(
        Map[String, Any]("price" -> 10.0),
        Map[String, Any]("price" -> null),
        Map[String, Any]("price" -> null),
        Map[String, Any]("price" -> 20.0)
      )
      val cfg  = """{ "columns": ["price"], "strategy": "forwardFill" }"""
      val step = makeStep("fillnull", cfg)
      val result = run(rows, step)
      result.map(_("price")) shouldBe Seq(10.0, 10.0, 10.0, 20.0)
    }

    "fillnull: forwardFill leaves a leading null region null" in {
      val rows = Seq(
        Map[String, Any]("price" -> null),
        Map[String, Any]("price" -> null),
        Map[String, Any]("price" -> 5.0)
      )
      val cfg  = """{ "columns": ["price"], "strategy": "forwardFill" }"""
      val step = makeStep("fillnull", cfg)
      val result = run(rows, step)
      result.map(_("price")) shouldBe Seq(null, null, 5.0)
    }

    "fillnull: mean strategy imputes the column mean of non-null values" in {
      val rows = Seq(
        Map[String, Any]("price" -> 10.0),
        Map[String, Any]("price" -> null),
        Map[String, Any]("price" -> 20.0)
      )
      val cfg  = """{ "columns": ["price"], "strategy": "mean" }"""
      val step = makeStep("fillnull", cfg)
      val result = run(rows, step)
      result.map(_("price")) shouldBe Seq(10.0, 15.0, 20.0)
    }

    "fillnull: median strategy imputes the column median of non-null values" in {
      val rows = Seq(
        Map[String, Any]("price" -> 1.0),
        Map[String, Any]("price" -> 3.0),
        Map[String, Any]("price" -> null),
        Map[String, Any]("price" -> 100.0)
      )
      val cfg  = """{ "columns": ["price"], "strategy": "median" }"""
      val step = makeStep("fillnull", cfg)
      val result = run(rows, step)
      result.map(_("price")) shouldBe Seq(1.0, 3.0, 3.0, 100.0)
    }

    "fillnull: mode strategy imputes the most frequent value, ties broken by first-encountered" in {
      val rows = Seq(
        Map[String, Any]("region" -> "east"),
        Map[String, Any]("region" -> "west"),
        Map[String, Any]("region" -> null)
      )
      val cfg  = """{ "columns": ["region"], "strategy": "mode" }"""
      val step = makeStep("fillnull", cfg)
      val result = run(rows, step)
      result.map(_("region")) shouldBe Seq("east", "west", "east")
    }

    "fillnull: all-null column stays null under a statistic strategy" in {
      val rows = Seq(
        Map[String, Any]("price" -> null),
        Map[String, Any]("price" -> null)
      )
      val cfg  = """{ "columns": ["price"], "strategy": "mean" }"""
      val step = makeStep("fillnull", cfg)
      val result = run(rows, step)
      result.map(_("price")) shouldBe Seq(null, null)
    }

    "fillnull: unsupported strategy fails with a descriptive error naming the invalid value" in {
      val rows = Seq(Map[String, Any]("a" -> null))
      val cfg  = """{ "columns": ["a"], "strategy": "bogus" }"""
      val step = makeStep("fillnull", cfg)
      val ex = intercept[StepExecutionException](run(rows, step))
      ex.getMessage should include("bogus")
    }

    // ── stringops op (HEL-389) ──────────────────────────────────────────────────

    "stringops: trim removes leading/trailing whitespace" in {
      val rows = Seq(Map[String, Any]("name" -> "  Ada  "))
      val cfg  = """{ "operation": "trim", "field": "name", "outputColumn": "name" }"""
      val step = makeStep("stringops", cfg)
      val result = run(rows, step)
      result shouldBe Seq(Map[String, Any]("name" -> "Ada"))
    }

    "stringops: upper converts to uppercase" in {
      val rows = Seq(Map[String, Any]("code" -> "ab-12"))
      val cfg  = """{ "operation": "upper", "field": "code", "outputColumn": "code" }"""
      val step = makeStep("stringops", cfg)
      val result = run(rows, step)
      result shouldBe Seq(Map[String, Any]("code" -> "AB-12"))
    }

    "stringops: lower converts to lowercase" in {
      val rows = Seq(Map[String, Any]("code" -> "AB-12"))
      val cfg  = """{ "operation": "lower", "field": "code", "outputColumn": "code" }"""
      val step = makeStep("stringops", cfg)
      val result = run(rows, step)
      result shouldBe Seq(Map[String, Any]("code" -> "ab-12"))
    }

    "stringops: split takes an indexed segment" in {
      val rows = Seq(Map[String, Any]("path" -> "a/b/c"))
      val cfg  = """{ "operation": "split", "field": "path", "separator": "/", "index": 1, "outputColumn": "segment" }"""
      val step = makeStep("stringops", cfg)
      val result = run(rows, step)
      result shouldBe Seq(Map[String, Any]("path" -> "a/b/c", "segment" -> "b"))
    }

    "stringops: split with an out-of-bounds index yields null" in {
      val rows = Seq(Map[String, Any]("path" -> "a/b/c"))
      val cfg  = """{ "operation": "split", "field": "path", "separator": "/", "index": 5, "outputColumn": "segment" }"""
      val step = makeStep("stringops", cfg)
      val result = run(rows, step)
      result.head("segment").asInstanceOf[AnyRef] shouldBe null
    }

    "stringops: split with a negative index yields null" in {
      val rows = Seq(Map[String, Any]("path" -> "a/b/c"))
      val cfg  = """{ "operation": "split", "field": "path", "separator": "/", "index": -1, "outputColumn": "segment" }"""
      val step = makeStep("stringops", cfg)
      val result = run(rows, step)
      result.head("segment").asInstanceOf[AnyRef] shouldBe null
    }

    "stringops: split missing separator fails at execute time before any row is processed" in {
      val rows = Seq(Map[String, Any]("path" -> "a/b/c"))
      val cfg  = """{ "operation": "split", "field": "path", "index": 1, "outputColumn": "segment" }"""
      val step = makeStep("stringops", cfg)
      val ex = intercept[StepExecutionException](run(rows, step))
      ex.getMessage should include("separator")
    }

    "stringops: split missing index fails at execute time before any row is processed" in {
      val rows = Seq(Map[String, Any]("path" -> "a/b/c"))
      val cfg  = """{ "operation": "split", "field": "path", "separator": "/", "outputColumn": "segment" }"""
      val step = makeStep("stringops", cfg)
      val ex = intercept[StepExecutionException](run(rows, step))
      ex.getMessage should include("index")
    }

    "stringops: extractRegex extracts the first capturing group" in {
      val rows = Seq(Map[String, Any]("email" -> "ada@example.com"))
      val cfg  = """{ "operation": "extractRegex", "field": "email", "pattern": "^([^@]+)@", "outputColumn": "localPart" }"""
      val step = makeStep("stringops", cfg)
      val result = run(rows, step)
      result shouldBe Seq(Map[String, Any]("email" -> "ada@example.com", "localPart" -> "ada"))
    }

    "stringops: extractRegex with no match yields null" in {
      val rows = Seq(Map[String, Any]("email" -> "not-an-email"))
      val cfg  = """{ "operation": "extractRegex", "field": "email", "pattern": "^([^@]+)@", "outputColumn": "localPart" }"""
      val step = makeStep("stringops", cfg)
      val result = run(rows, step)
      result.head("localPart").asInstanceOf[AnyRef] shouldBe null
    }

    "stringops: extractRegex pattern without a capturing group fails at execute time" in {
      val rows = Seq(Map[String, Any]("email" -> "ada@example.com"))
      val cfg  = """{ "operation": "extractRegex", "field": "email", "pattern": "[^@]+", "outputColumn": "localPart" }"""
      val step = makeStep("stringops", cfg)
      val ex = intercept[StepExecutionException](run(rows, step))
      ex.getMessage should include("[^@]+")
      ex.getMessage should include("capturing group")
    }

    "stringops: concat joins named fields with a separator" in {
      val rows = Seq(Map[String, Any]("first" -> "Ada", "last" -> "Lovelace"))
      val cfg  = """{ "operation": "concat", "fields": ["first", "last"], "separator": " ", "outputColumn": "fullName" }"""
      val step = makeStep("stringops", cfg)
      val result = run(rows, step)
      result shouldBe Seq(Map[String, Any]("first" -> "Ada", "last" -> "Lovelace", "fullName" -> "Ada Lovelace"))
    }

    "stringops: concat treats a missing/null field as an empty string, not whole-output null" in {
      val rows = Seq(Map[String, Any]("first" -> "Ada", "last" -> "Lovelace"))
      val cfg  = """{ "operation": "concat", "fields": ["first", "middle", "last"], "separator": " ", "outputColumn": "fullName" }"""
      val step = makeStep("stringops", cfg)
      val result = run(rows, step)
      result.head("fullName") shouldBe "Ada  Lovelace"
    }

    "stringops: a null/missing source field yields null for single-field operations" in {
      val rows = Seq(Map[String, Any]("name" -> null))
      val cfg  = """{ "operation": "trim", "field": "name", "outputColumn": "name" }"""
      val step = makeStep("stringops", cfg)
      val result = run(rows, step)
      result.head("name").asInstanceOf[AnyRef] shouldBe null
    }

    "stringops: outputColumn distinct from field appends a new column, preserving the source field" in {
      val rows = Seq(Map[String, Any]("code" -> "ab-12", "name" -> "foo"))
      val cfg  = """{ "operation": "upper", "field": "code", "outputColumn": "codeUpper" }"""
      val step = makeStep("stringops", cfg)
      val result = run(rows, step)
      result shouldBe Seq(Map[String, Any]("code" -> "ab-12", "codeUpper" -> "AB-12", "name" -> "foo"))
    }

    "stringops: row count is unchanged by the op" in {
      val rows = Seq(
        Map[String, Any]("name" -> "a"),
        Map[String, Any]("name" -> "b"),
        Map[String, Any]("name" -> "c")
      )
      val cfg  = """{ "operation": "upper", "field": "name", "outputColumn": "name" }"""
      val step = makeStep("stringops", cfg)
      val result = run(rows, step)
      result should have size 3
    }

    "stringops: unsupported operation fails at execute time" in {
      val rows = Seq(Map[String, Any]("code" -> "ab-12"))
      val cfg  = """{ "operation": "reverse", "field": "code", "outputColumn": "code" }"""
      val step = makeStep("stringops", cfg)
      val ex = intercept[StepExecutionException](run(rows, step))
      ex.getMessage should include("reverse")
      ex.getMessage should include("trim")
    }

    // ── splittext op (HEL-219) ─────────────────────────────────────────────────

    "splittext: paragraph mode emits one row per segment via the full engine round trip" in {
      val rows = Seq(Map[String, Any]("content" -> "Para one.\n\nPara two."))
      val cfg  = """{ "field": "content", "mode": "paragraph" }"""
      val step = makeStep("splittext", cfg)
      val result = run(rows, step)
      result should have size 2
      result.map(_("content")) shouldBe Seq("Para one.", "Para two.")
      result.map(_("segmentIndex")) shouldBe Seq(0, 1)
    }

    "splittext: heading mode round trip via config decode/engine execution" in {
      val rows = Seq(Map[String, Any]("content" -> "## A\nx\n## B\ny", "filename" -> "doc.md"))
      val cfg  = """{ "field": "content", "mode": "heading", "headingLevel": 2 }"""
      val step = makeStep("splittext", cfg)
      val result = run(rows, step)
      result should have size 2
      result.foreach(_("filename") shouldBe "doc.md")
      result.map(_("content")) shouldBe Seq("## A\nx", "## B\ny")
    }

    "splittext: null field value drops the row (engine round trip)" in {
      val rows = Seq(Map[String, Any]("content" -> null))
      val cfg  = """{ "field": "content", "mode": "paragraph" }"""
      val step = makeStep("splittext", cfg)
      run(rows, step) shouldBe empty
    }

    // ── extractheadings op (HEL-220) ────────────────────────────────────────────

    "extractheadings: mixed-level headings emit one row per heading via the full engine round trip" in {
      val rows = Seq(Map[String, Any]("content" -> "# Title\ntext\n## Section\nmore text"))
      val cfg  = """{ "field": "content" }"""
      val step = makeStep("extractheadings", cfg)
      val result = run(rows, step)
      result should have size 2
      result.map(_("content")) shouldBe Seq("Title", "Section")
      result.map(_("headingIndex")) shouldBe Seq(0, 1)
      result.map(_("headingLevel")) shouldBe Seq(1, 2)
    }

    "extractheadings: passes through other row fields unchanged" in {
      val rows = Seq(Map[String, Any]("content" -> "# Title", "filename" -> "doc.md"))
      val cfg  = """{ "field": "content" }"""
      val step = makeStep("extractheadings", cfg)
      val result = run(rows, step)
      result should have size 1
      result.foreach(_("filename") shouldBe "doc.md")
    }

    "extractheadings: null field value drops the row (engine round trip)" in {
      val rows = Seq(Map[String, Any]("content" -> null))
      val cfg  = """{ "field": "content" }"""
      val step = makeStep("extractheadings", cfg)
      run(rows, step) shouldBe empty
    }

    "extractheadings: no heading lines drops the row (engine round trip)" in {
      val rows = Seq(Map[String, Any]("content" -> "no headings here"))
      val cfg  = """{ "field": "content" }"""
      val step = makeStep("extractheadings", cfg)
      run(rows, step) shouldBe empty
    }

    // ── chunkbytokencount op (HEL-221) ──────────────────────────────────────────

    "chunkbytokencount: long content emits multiple chunk rows via the full engine round trip" in {
      val content = "one two three four five six seven eight nine ten"
      val rows    = Seq(Map[String, Any]("content" -> content))
      val cfg     = """{ "field": "content", "targetTokenCount": 3 }"""
      val step    = makeStep("chunkbytokencount", cfg)
      val result  = run(rows, step)

      result.size should be > 1
      result.map(_("chunkIndex")) shouldBe result.indices.toSeq
      result.foreach(_("tokenCount") shouldBe a[java.lang.Integer])
    }

    "chunkbytokencount: passes through other row fields unchanged" in {
      val rows = Seq(Map[String, Any]("content" -> "one two three", "filename" -> "doc.txt"))
      val cfg  = """{ "field": "content", "targetTokenCount": 500 }"""
      val step = makeStep("chunkbytokencount", cfg)
      val result = run(rows, step)
      result should have size 1
      result.foreach(_("filename") shouldBe "doc.txt")
    }

    "chunkbytokencount: null field value drops the row (engine round trip)" in {
      val rows = Seq(Map[String, Any]("content" -> null))
      val cfg  = """{ "field": "content" }"""
      val step = makeStep("chunkbytokencount", cfg)
      run(rows, step) shouldBe empty
    }

    "chunkbytokencount: empty-string field value drops the row (engine round trip)" in {
      val rows = Seq(Map[String, Any]("content" -> ""))
      val cfg  = """{ "field": "content" }"""
      val step = makeStep("chunkbytokencount", cfg)
      run(rows, step) shouldBe empty
    }

    "chunkbytokencount: cl100k_base encoding round trips via the full engine" in {
      val rows = Seq(Map[String, Any]("content" -> "one two three four five six"))
      val cfg  = """{ "field": "content", "targetTokenCount": 2, "encoding": "cl100k_base" }"""
      val step = makeStep("chunkbytokencount", cfg)
      val result = run(rows, step)
      result.size should be > 1
    }

    "unknown op fails at the codec boundary (compile-time exhaustive in the engine)" in {
      // Pre-CS2c-3a the engine rejected unknown ops at runtime via a string
      // `match`. After CS2c-3a the sealed-trait dispatch is exhaustive, so
      // unknown ops can't reach the engine — they're rejected at decode time.
      val ex = intercept[Exception](PipelineStepConfigCodec.decode("bogus", "{}").get)
      ex.getMessage should include ("Unknown step op: 'bogus'")
    }

    // Regression: HEL-237 — CSV configs are persisted under the "path" key by
    // DataSourceRoutes; the engine previously read "filePath", causing every
    // CSV pipeline run to fail with `key not found: filePath` (HTTP 422).
    "loadRows: CSV source reads filePath from the canonical 'path' config key" in {
      val tmp = java.io.File.createTempFile("helio-csv-regression-", ".csv")
      tmp.deleteOnExit()
      val writer = new java.io.PrintWriter(tmp)
      try {
        writer.println("name,age")
        writer.println("alice,30")
        writer.println("bob,25")
      } finally writer.close()

      val ds = CsvSource(
        id        = DataSourceId("ds-csv-1"),
        name      = "csv-src",
        ownerId   = UserId("00000000-0000-0000-0000-000000000001"),
        createdAt = Instant.now(),
        updatedAt = Instant.now(),
        config    = CsvSourceConfig(tmp.getAbsolutePath)
      )
      val rows = Await.result(engine.loadRows(ds, null), 5.seconds)
      rows should have size 2
      rows.head("name") shouldBe "alice"
      rows.head("age")  shouldBe "30"
    }

    // Legacy 'filePath' tolerance lives at the row→domain boundary in
    // `DataSourceRepository` / `DataSourceConfigCodec`; once the typed
    // `CsvSourceConfig` is in the domain layer, the engine itself never sees
    // a JSON blob and the only path field that exists is `CsvSourceConfig.path`.
    // This is asserted by `DataSourceConfigCodec.decodeCsv` round-trip tests.

    "loadRows: CSV source with no path config raises a diagnostic error (no 'key not found')" in {
      val ds = CsvSource(
        id        = DataSourceId("ds-csv-bad"),
        name      = "broken-csv",
        ownerId   = UserId("00000000-0000-0000-0000-000000000001"),
        createdAt = Instant.now(),
        updatedAt = Instant.now(),
        config    = CsvSourceConfig("")
      )
      val ex = intercept[IllegalArgumentException](
        Await.result(engine.loadRows(ds, null), 5.seconds)
      )
      ex.getMessage                 should include ("broken-csv")
      ex.getMessage                 should include ("path")
      // Critically, it must NOT bubble up the raw Map lookup message.
      ex.getMessage                 should not include "key not found"
    }

    // HEL-862 (design.md Decision 3/4, task 6): the engine-level csvUrlFetch
    // seam — the load-bearing branch for AC3, since a scheduled run never
    // calls DataSourceService.refreshCsv.
    "loadRows: a URL-backed CSV source re-fetches via the seam and reflects CHANGED upstream content across two runs" in {
      var callCount = 0
      val responses = Vector("name,age\nalice,30", "name,age\nalice,31\nbob,40")
      val seamEngine = new InProcessPipelineEngine(
        fileSystem,
        csvUrlFetch = (_: String) => {
          val body = responses(math.min(callCount, responses.size - 1))
          callCount += 1
          Future.successful(Right(body.getBytes(StandardCharsets.UTF_8)))
        }
      )
      val ds = CsvSource(
        id        = DataSourceId("ds-csv-url"),
        name      = "url-csv-src",
        ownerId   = UserId("00000000-0000-0000-0000-000000000001"),
        createdAt = Instant.now(),
        updatedAt = Instant.now(),
        config    = CsvSourceConfig("csv/ds-csv-url.csv", sourceUrl = Some("https://example.com/data.csv"))
      )
      val firstRun  = Await.result(seamEngine.loadRows(ds, null), 5.seconds)
      val secondRun = Await.result(seamEngine.loadRows(ds, null), 5.seconds)

      firstRun should have size 1
      firstRun.head("age") shouldBe "30"

      secondRun should have size 2
      secondRun.head("age") shouldBe "31"
      secondRun(1)("name")  shouldBe "bob"
      callCount shouldBe 2
    }

    "loadRows: a snapshot-backed (no sourceUrl) CSV source reads the file and never calls the seam" in {
      val tmp = java.io.File.createTempFile("helio-csv-snapshot-", ".csv")
      tmp.deleteOnExit()
      val writer = new java.io.PrintWriter(tmp)
      try { writer.println("name,age"); writer.println("carol,50") } finally writer.close()

      var seamCalled = false
      val seamEngine = new InProcessPipelineEngine(
        fileSystem,
        csvUrlFetch = (_: String) => { seamCalled = true; Future.successful(Right(Array.emptyByteArray)) }
      )
      val ds = CsvSource(
        id        = DataSourceId("ds-csv-snapshot"),
        name      = "snapshot-csv-src",
        ownerId   = UserId("00000000-0000-0000-0000-000000000001"),
        createdAt = Instant.now(),
        updatedAt = Instant.now(),
        config    = CsvSourceConfig(tmp.getAbsolutePath, sourceUrl = None)
      )
      val rows = Await.result(seamEngine.loadRows(ds, null), 5.seconds)
      rows should have size 1
      rows.head("name") shouldBe "carol"
      seamCalled shouldBe false
    }

    "loadRows: a URL-backed CSV source fails the run with a message naming the source and the reason, on a failing fetch" in {
      val seamEngine = new InProcessPipelineEngine(
        fileSystem,
        csvUrlFetch = (_: String) => Future.successful(Left("URL host 'sneaky.example' resolves to a disallowed address"))
      )
      val ds = CsvSource(
        id        = DataSourceId("ds-csv-fail"),
        name      = "failing-url-csv",
        ownerId   = UserId("00000000-0000-0000-0000-000000000001"),
        createdAt = Instant.now(),
        updatedAt = Instant.now(),
        config    = CsvSourceConfig("csv/ds-csv-fail.csv", sourceUrl = Some("https://sneaky.example/data.csv"))
      )
      val ex = intercept[IllegalArgumentException](
        Await.result(seamEngine.loadRows(ds, null), 5.seconds)
      )
      ex.getMessage should include ("failing-url-csv")
      ex.getMessage should include ("disallowed address")
    }

    "loadRows: constructing the engine with the DEFAULT (unconfigured) seam does not throw, and a URL-backed CSV run fails 'not configured'" in {
      noException should be thrownBy new InProcessPipelineEngine(fileSystem)
      val defaultEngine = new InProcessPipelineEngine(fileSystem)
      val ds = CsvSource(
        id        = DataSourceId("ds-csv-unconfigured"),
        name      = "unconfigured-url-csv",
        ownerId   = UserId("00000000-0000-0000-0000-000000000001"),
        createdAt = Instant.now(),
        updatedAt = Instant.now(),
        config    = CsvSourceConfig("csv/ds-csv-unconfigured.csv", sourceUrl = Some("https://example.com/data.csv"))
      )
      val ex = intercept[IllegalArgumentException](
        Await.result(defaultEngine.loadRows(ds, null), 5.seconds)
      )
      ex.getMessage should include ("not configured")
    }

    // HEL-215: text/Markdown connector — single-row loader.

    "loadRows: TextSource yields exactly one row with content/filename/sizeBytes keys" in {
      val tmp = java.io.File.createTempFile("helio-text-regression-", ".txt")
      tmp.deleteOnExit()
      val writer = new java.io.PrintWriter(tmp)
      try writer.print("hello world") finally writer.close()

      val ds = TextSource(
        id        = DataSourceId("ds-text-1"),
        name      = "text-src",
        ownerId   = UserId("00000000-0000-0000-0000-000000000001"),
        createdAt = Instant.now(),
        updatedAt = Instant.now(),
        config    = TextSourceConfig(tmp.getAbsolutePath, sourceUrl = None)
      )
      val rows = Await.result(engine.loadRows(ds, null), 5.seconds)
      rows should have size 1
      rows.head("content")   shouldBe "hello world"
      rows.head("filename")  shouldBe tmp.getName
      rows.head("sizeBytes") shouldBe "hello world".getBytes(StandardCharsets.UTF_8).length.toLong
    }

    "loadRows: TextSource with no path config raises a diagnostic error" in {
      val ds = TextSource(
        id        = DataSourceId("ds-text-bad"),
        name      = "broken-text",
        ownerId   = UserId("00000000-0000-0000-0000-000000000001"),
        createdAt = Instant.now(),
        updatedAt = Instant.now(),
        config    = TextSourceConfig("", sourceUrl = None)
      )
      val ex = intercept[IllegalArgumentException](
        Await.result(engine.loadRows(ds, null), 5.seconds)
      )
      ex.getMessage should include ("broken-text")
      ex.getMessage should include ("path")
    }

    // HEL-214: PDF connector — multi-row loader (one row per page), the
    // first content connector whose loadRows case produces more than one row.
    // ─────────────────────────────────────────────────────────────────────────

    "loadRows: PdfSource yields one row per page with correct pageNumber/pageCount/content/characterCount" in {
      val bytes = PdfFixtures.multiPagePdf(Seq("Alpha content", "Beta content", "Gamma content"))
      val tmp   = java.io.File.createTempFile("helio-pdf-regression-", ".pdf")
      tmp.deleteOnExit()
      java.nio.file.Files.write(tmp.toPath, bytes)

      val ds = PdfSource(
        id        = DataSourceId("ds-pdf-1"),
        name      = "pdf-src",
        ownerId   = UserId("00000000-0000-0000-0000-000000000001"),
        createdAt = Instant.now(),
        updatedAt = Instant.now(),
        config    = PdfSourceConfig(tmp.getAbsolutePath, sourceUrl = None)
      )
      val rows = Await.result(engine.loadRows(ds, null), 5.seconds)

      rows should have size 3
      rows.map(_("pageNumber")) shouldBe Seq(1, 2, 3)
      rows.foreach(_("pageCount") shouldBe 3)
      rows.foreach(r => r("filename") shouldBe tmp.getName)
      rows.foreach(r => r("sizeBytes") shouldBe bytes.length.toLong)

      val contents = rows.map(_("content").asInstanceOf[String])
      contents(0) should include ("Alpha content")
      contents(1) should include ("Beta content")
      contents(2) should include ("Gamma content")

      rows.foreach { r =>
        r("characterCount") shouldBe r("content").asInstanceOf[String].length
      }
    }

    "loadRows: PdfSource with no path config raises a diagnostic error" in {
      val ds = PdfSource(
        id        = DataSourceId("ds-pdf-bad"),
        name      = "broken-pdf",
        ownerId   = UserId("00000000-0000-0000-0000-000000000001"),
        createdAt = Instant.now(),
        updatedAt = Instant.now(),
        config    = PdfSourceConfig("", sourceUrl = None)
      )
      val ex = intercept[IllegalArgumentException](
        Await.result(engine.loadRows(ds, null), 5.seconds)
      )
      ex.getMessage should include ("broken-pdf")
      ex.getMessage should include ("path")
    }

    // HEL-216: image connector — single-row loader with a nested `content`
    // binary-ref map.

    "loadRows: ImageSource yields exactly one row with content/filename/sizeBytes/mimeType/width/height keys" in {
      val tmp = java.io.File.createTempFile("helio-image-regression-", ".png")
      tmp.deleteOnExit()
      val image = new java.awt.image.BufferedImage(5, 4, java.awt.image.BufferedImage.TYPE_INT_RGB)
      javax.imageio.ImageIO.write(image, "png", tmp)
      val bytes = java.nio.file.Files.readAllBytes(tmp.toPath)

      val ds = ImageSource(
        id        = DataSourceId("ds-image-1"),
        name      = "image-src",
        ownerId   = UserId("00000000-0000-0000-0000-000000000001"),
        createdAt = Instant.now(),
        updatedAt = Instant.now(),
        config    = ImageSourceConfig(tmp.getAbsolutePath, sourceUrl = None)
      )
      val rows = Await.result(engine.loadRows(ds, null), 5.seconds)
      rows should have size 1
      val row = rows.head
      row("filename")  shouldBe tmp.getName
      row("sizeBytes") shouldBe bytes.length.toLong
      row("mimeType")  shouldBe "image/png"
      row("width")     shouldBe 5
      row("height")    shouldBe 4

      val content = row("content").asInstanceOf[Map[String, Any]]
      content("storageKey") shouldBe tmp.getAbsolutePath
      content("mimeType")   shouldBe "image/png"
      content("filename")   shouldBe tmp.getName
      content("sizeBytes")  shouldBe bytes.length.toLong
    }

    "loadRows: ImageSource with no path config raises a diagnostic error" in {
      val ds = ImageSource(
        id        = DataSourceId("ds-image-bad"),
        name      = "broken-image",
        ownerId   = UserId("00000000-0000-0000-0000-000000000001"),
        createdAt = Instant.now(),
        updatedAt = Instant.now(),
        config    = ImageSourceConfig("", sourceUrl = None)
      )
      val ex = intercept[IllegalArgumentException](
        Await.result(engine.loadRows(ds, null), 5.seconds)
      )
      ex.getMessage should include ("broken-image")
      ex.getMessage should include ("path")
    }

    "loadRows: ImageSource with corrupt bytes raises a diagnostic error (not a raw exception)" in {
      val tmp = java.io.File.createTempFile("helio-image-corrupt-", ".png")
      tmp.deleteOnExit()
      val writer = new java.io.FileOutputStream(tmp)
      try writer.write(Array[Byte](0x00, 0x01, 0x02)) finally writer.close()

      val ds = ImageSource(
        id        = DataSourceId("ds-image-corrupt"),
        name      = "corrupt-image",
        ownerId   = UserId("00000000-0000-0000-0000-000000000001"),
        createdAt = Instant.now(),
        updatedAt = Instant.now(),
        config    = ImageSourceConfig(tmp.getAbsolutePath, sourceUrl = None)
      )
      val ex = intercept[IllegalArgumentException](
        Await.result(engine.loadRows(ds, null), 5.seconds)
      )
      ex.getMessage should include ("Unable to read image dimensions")
    }

    // HEL-758: rest_api/sql loadRows — the engine now dispatches both kinds
    // through their existing connector's fetch(config, maxRows) SPI method
    // (design.md D1), converting each connector-fetched JsValue row into an
    // engine Row via PipelineRowJson.jsRowToRow.

    "loadRows: RestSource fetches via the connector and converts rows with jsRowToRow" in {
      val ds = RestSource(
        id        = DataSourceId("ds-rest-1"),
        name      = "rest-src",
        ownerId   = UserId("00000000-0000-0000-0000-000000000001"),
        createdAt = Instant.now(),
        updatedAt = Instant.now(),
        config    = RestApiConfig(connectorId = RestSuccessUrl)
      )
      val rows = Await.result(restEngine.loadRows(ds, null), 5.seconds)
      rows should have size 2
      rows.head("name")  shouldBe "alice"
      rows.head("score") shouldBe 1.0
      rows(1)("name")    shouldBe "bob"
    }

    "loadRows: RestSource with a connector fetch failure fails with the connector's own message" in {
      val ds = RestSource(
        id        = DataSourceId("ds-rest-fail"),
        name      = "rest-src-fail",
        ownerId   = UserId("00000000-0000-0000-0000-000000000001"),
        createdAt = Instant.now(),
        updatedAt = Instant.now(),
        config    = RestApiConfig(connectorId = RestFailureUrl)
      )
      val ex = intercept[IllegalArgumentException](
        Await.result(restEngine.loadRows(ds, null), 5.seconds)
      )
      ex.getMessage should include ("connector: endpoint unreachable")
    }

    // HEL-599 design.md D1/D5: nested REST rows carry dotted columns (not raw JSON text), and a
    // broken rootSelector fails the run loudly instead of yielding an empty row set.

    "loadRows: RestSource with a nested JSON response materialises dotted columns via jsRowToRow" in {
      val nestedConnector = new RestApiConnectorDriver(Some { _ =>
        Future.successful(Right(JsArray(
          JsObject(
            "player_id" -> JsString("8800"),
            "stats"     -> JsObject("pts_ppr" -> JsNumber(33.7))
          )
        )))
      })
      val nestedEngine = new InProcessPipelineEngine(fileSystem, nestedConnector)
      val ds = RestSource(
        id        = DataSourceId("ds-rest-nested"),
        name      = "rest-src-nested",
        ownerId   = UserId("00000000-0000-0000-0000-000000000001"),
        createdAt = Instant.now(),
        updatedAt = Instant.now(),
        config    = RestApiConfig(connectorId = "https://rest-engine.test/nested")
      )
      val rows = Await.result(nestedEngine.loadRows(ds, null), 5.seconds)
      rows should have size 1
      rows.head("stats.pts_ppr") shouldBe 33.7
      rows.head.keySet should not contain "stats"
    }

    "loadRows: RestSource with a broken rootSelector fails the run rather than yielding zero rows" in {
      val brokenSelectorConnector = new RestApiConnectorDriver(Some { _ =>
        Future.successful(Right(JsObject("data" -> JsArray(JsObject("id" -> JsNumber(1))))))
      })
      val brokenEngine = new InProcessPipelineEngine(fileSystem, brokenSelectorConnector)
      val ds = RestSource(
        id        = DataSourceId("ds-rest-badselector"),
        name      = "rest-src-badselector",
        ownerId   = UserId("00000000-0000-0000-0000-000000000001"),
        createdAt = Instant.now(),
        updatedAt = Instant.now(),
        config    = RestApiConfig(connectorId = "https://rest-engine.test/badselector", rootSelector = Some("nope"))
      )
      val ex = intercept[IllegalArgumentException](
        Await.result(brokenEngine.loadRows(ds, null), 5.seconds)
      )
      ex.getMessage should include("nope")
    }

    "loadRows: RestSource with no connector configured (null) fails fast with a diagnostic error, not an NPE" in {
      val ds = RestSource(
        id        = DataSourceId("ds-rest-noconn"),
        name      = "rest-src-noconn",
        ownerId   = UserId("00000000-0000-0000-0000-000000000001"),
        createdAt = Instant.now(),
        updatedAt = Instant.now(),
        config    = RestApiConfig(connectorId = RestSuccessUrl)
      )
      // `engine` (module-level val, above) was constructed with no connector
      // (defaults to null) — this must NOT throw a raw NullPointerException.
      val ex = intercept[IllegalArgumentException](
        Await.result(engine.loadRows(ds, null), 5.seconds)
      )
      ex.getMessage should include ("rest-src-noconn")
      ex.getMessage should include ("no RestApiConnectorDriver")
    }

    "loadRows: SqlSource fetches via SqlConnectorDriver and converts rows with jsRowToRow" in {
      val ds = SqlSource(
        id        = DataSourceId("ds-sql-1"),
        name      = "sql-src",
        ownerId   = UserId("00000000-0000-0000-0000-000000000001"),
        createdAt = Instant.now(),
        updatedAt = Instant.now(),
        config    = liveSqlConfig(query = "SELECT 1 AS one")
      )
      val rows = Await.result(engine.loadRows(ds, null), 5.seconds)
      rows should have size 1
      rows.head("one") shouldBe 1.0
    }

    "loadRows: SqlSource with an unreachable database fails with the connector's own message" in {
      val ds = SqlSource(
        id        = DataSourceId("ds-sql-fail"),
        name      = "sql-src-fail",
        ownerId   = UserId("00000000-0000-0000-0000-000000000001"),
        createdAt = Instant.now(),
        updatedAt = Instant.now(),
        config    = liveSqlConfig().copy(port = 1)
      )
      val ex = intercept[IllegalArgumentException](
        Await.result(engine.loadRows(ds, null), 5.seconds)
      )
      ex.getMessage should include ("SQL execution failed")
    }

    // ── HEL-509 (419-B): executeWithStepCounts' assertionSink threading ───────

    "assert: an assert step records its AssertionResults into a caller-supplied AssertionSink" in {
      val sink = new AssertionSink
      val cfg  = """{"rules":[{"kind":"notNull","field":"name","params":{},"severity":"error"}]}"""
      val step = makeStep("assert", cfg)
      Await.result(engine.executeWithStepCounts(sampleRows, Seq(step), null, sink), 5.seconds)
      sink.results should have size 1
      sink.results.head.passed shouldBe true
    }

    "assert: existing callers with no assertionSink argument are unaffected (fresh, discarded sink)" in {
      val cfg  = """{"rules":[{"kind":"rowCountMin","params":{"count":100},"severity":"error"}]}"""
      val step = makeStep("assert", cfg)
      // No assertionSink argument — default applies. The assert step still
      // evaluates (and would fail, 3 < 100) but there's no way to observe
      // the result; the important assertion is that execution completes
      // normally and row output is unaffected.
      val result = run(sampleRows, step)
      result shouldBe sampleRows
    }

    "assert: execute()'s delegation (.map(_._1)) is unaffected by the new optional parameter" in {
      val cfg  = """{"rules":[{"kind":"notNull","field":"name","params":{},"severity":"error"}]}"""
      val step = makeStep("assert", cfg)
      val result = Await.result(engine.execute(sampleRows, Seq(step), null), 5.seconds)
      result shouldBe sampleRows
    }

    // ── HEL-859: step-failure attribution (design.md Decisions 1-3) ─────────

    "executeWithStepCounts: an IllegalArgumentException failure is wrapped in a StepExecutionException naming the step id, kind, and the original message" in {
      val cfg  = """{"operation":"regexExtract","field":"name","outputColumn":"extracted"}"""
      val step = makeStep("stringops", cfg)
      val thrown = intercept[StepExecutionException] {
        Await.result(engine.executeWithStepCounts(sampleRows, Seq(step), null), 5.seconds)
      }
      thrown.stepId shouldBe "step-id"
      thrown.stepKind shouldBe "stringops"
      thrown.reason should include("regexExtract")
      thrown.reason should include("extractRegex")
      thrown.getMessage shouldBe s"Pipeline execution failed at step step-id (stringops): ${thrown.reason}"
    }

    // HEL-859 (design.md Decision 3, tasks.md 5.2): the allowlist forwards
    // ONLY an `IllegalArgumentException`'s own message; a fake step
    // deliberately failing with a `RuntimeException` (not on the allowlist)
    // is still attributed to its step id/kind, but its `reason` is the fixed,
    // non-descriptive string — never the throwable's own message.
    "executeWithStepCounts: a non-IllegalArgumentException failure names the step but not the throwable's own message" in {
      val now = Instant.now()
      val leakyMessage = "leaky internal detail: connection refused at 10.0.0.1:5432"
      val failingStep = new PipelineStep {
        val id: PipelineStepId = PipelineStepId("leaky-step")
        val pipelineId: PipelineId = PipelineId("pipe-id")
        val position: Int = 0
        val kind: String = "leaky"
        val createdAt: Instant = now
        val updatedAt: Instant = now
        val enabled: Boolean = true
        val parentStepId: Option[PipelineStepId] = None
        // HEL-814: this fake step's kind is not in `PipelineStep.Registry`, so
        // the engine's required-config check finds no companion and skips it,
        // leaving this test exercising exactly what it did before.
        def configValue: Any = ()
        def evaluate(rows: Seq[Map[String, Any]], ctx: PipelineExecutionContext)(implicit
            ec: ExecutionContext
        ): Future[Seq[Map[String, Any]]] =
          Future.failed(new RuntimeException(leakyMessage))
      }
      val thrown = intercept[StepExecutionException] {
        Await.result(engine.executeWithStepCounts(sampleRows, Seq(failingStep), null), 5.seconds)
      }
      thrown.stepId shouldBe "leaky-step"
      thrown.stepKind shouldBe "leaky"
      thrown.reason should not include leakyMessage
      thrown.reason should not include "RuntimeException"
      thrown.getMessage should not include leakyMessage
      thrown.getMessage should not include "RuntimeException"
    }

    "executeWithStepCounts: an already-wrapped StepExecutionException is not double-wrapped" in {
      val original = StepExecutionException.from("inner-step", "stringops", new IllegalArgumentException("bad op"))
      val wrapped  = StepExecutionException.from("outer-step", "outer-kind", original)
      wrapped shouldBe theSameInstanceAs(original)
    }

    // ── HEL-861: truncation reporting (design D1-D9, tasks 7.1-7.6b) ─────────

    "MaxRunRows: the row cap is exactly 1000 (task 7.5 — catches a future change to the bound)" in {
      InProcessPipelineEngine.MaxRunRows shouldBe 1000
    }

    "loadRowsWithStats: a REST source with more rows than the cap reports truncated with the true total (task 7.1)" in {
      val totalRows = 3303
      val bigRestConnector = new RestApiConnectorDriver(Some { _ =>
        Future.successful(Right(JsArray(
          (1 to totalRows).map(i => JsObject("id" -> JsNumber(i))).toVector
        )))
      })
      val bigRestEngine = new InProcessPipelineEngine(fileSystem, bigRestConnector)
      val ds = RestSource(
        id        = DataSourceId("ds-rest-big"),
        name      = "rest-src-big",
        ownerId   = UserId("00000000-0000-0000-0000-000000000001"),
        createdAt = Instant.now(),
        updatedAt = Instant.now(),
        config    = RestApiConfig(connectorId = "https://rest-engine.test/big")
      )
      val (rows, stats) = Await.result(bigRestEngine.loadRowsWithStats(ds, null), 5.seconds)
      rows should have size 1000
      stats.truncated shouldBe true
      stats.availableRowCount shouldBe Some(totalRows.toLong)
    }

    "loadRowsWithStats: a REST source with exactly 1000 rows is NOT truncated — no false positives (task 7.2)" in {
      val exactRestConnector = new RestApiConnectorDriver(Some { _ =>
        Future.successful(Right(JsArray(
          (1 to 1000).map(i => JsObject("id" -> JsNumber(i))).toVector
        )))
      })
      val exactRestEngine = new InProcessPipelineEngine(fileSystem, exactRestConnector)
      val ds = RestSource(
        id        = DataSourceId("ds-rest-exact"),
        name      = "rest-src-exact",
        ownerId   = UserId("00000000-0000-0000-0000-000000000001"),
        createdAt = Instant.now(),
        updatedAt = Instant.now(),
        config    = RestApiConfig(connectorId = "https://rest-engine.test/exact")
      )
      val (rows, stats) = Await.result(exactRestEngine.loadRowsWithStats(ds, null), 5.seconds)
      rows should have size 1000
      stats.truncated shouldBe false
      stats.availableRowCount shouldBe Some(1000L)
    }

    "loadRowsWithStats: a SQL source with more rows than the cap proves truncation but reports no total (task 7.3)" in {
      val ds = SqlSource(
        id        = DataSourceId("ds-sql-big"),
        name      = "sql-src-big",
        ownerId   = UserId("00000000-0000-0000-0000-000000000001"),
        createdAt = Instant.now(),
        updatedAt = Instant.now(),
        config    = liveSqlConfig(query = "SELECT * FROM generate_series(1, 1001) AS n")
      )
      val (rows, stats) = Await.result(engine.loadRowsWithStats(ds, null), 5.seconds)
      rows should have size 1000
      stats.truncated shouldBe true
      stats.availableRowCount shouldBe None
    }

    "loadRowsWithStats: an uncapped source kind (static) always reports not truncated (task 7.4)" in {
      val ds = StaticSource(
        id        = DataSourceId("ds-static-uncapped"),
        name      = "static-src",
        ownerId   = UserId("00000000-0000-0000-0000-000000000001"),
        createdAt = Instant.now(),
        updatedAt = Instant.now()
      )
      val staticConfigJson = buildStaticConfig(Seq("a"), Seq(Map[String, Any]("a" -> 1))).compactPrint
      val mockRepo = new DataSourceRepository(null)(ec) {
        override def readRawConfig(dsId: DataSourceId): Future[Option[String]] =
          Future.successful(Some(staticConfigJson))
      }
      val (_, stats) = Await.result(engine.loadRowsWithStats(ds, mockRepo), 5.seconds)
      stats shouldBe SourceReadStats(truncated = false, availableRowCount = None)
    }

    "executeWithStepCounts: a union step reading a truncated secondary source records it into the caller's truncationSink, even when the primary is under the cap (task 7.6b)" in {
      val primaryRows = Seq(Map[String, Any]("a" -> 1, "b" -> 2))
      val bigUnionConnector = new RestApiConnectorDriver(Some { _ =>
        Future.successful(Right(JsArray(
          (1 to 1500).map(i => JsObject("a" -> JsNumber(i), "b" -> JsNumber(i * 2))).toVector
        )))
      })
      val bigUnionEngine = new InProcessPipelineEngine(fileSystem, bigUnionConnector)
      val secondaryDs = RestSource(
        id        = DataSourceId("ds-union-truncated"),
        name      = "union-secondary-truncated",
        ownerId   = UserId("00000000-0000-0000-0000-000000000001"),
        createdAt = Instant.now(),
        updatedAt = Instant.now(),
        config    = RestApiConfig(connectorId = "https://rest-engine.test/union-big")
      )
      val mockRepo = new DataSourceRepository(null)(ec) {
        override def findByIdInternal(dsId: DataSourceId): Future[Option[DataSource]] =
          Future.successful(if (dsId.value == "ds-union-truncated") Some(secondaryDs) else None)
      }
      val step = makeStep("union", """{ "otherDataSourceId": "ds-union-truncated", "mode": "byPosition" }""")
      val truncationSink = new TruncationSink
      val (result, _) = Await.result(
        bigUnionEngine.executeWithStepCounts(primaryRows, Seq(step), mockRepo, truncationSink = truncationSink),
        5.seconds
      )
      result.size shouldBe (1 + 1000)
      truncationSink.reads should have size 1
      truncationSink.reads.head.dataSourceName shouldBe "union-secondary-truncated"
      truncationSink.reads.head.rowsRead shouldBe 1000L
      truncationSink.reads.head.availableRowCount shouldBe Some(1500L)
    }
  }

  // HEL-330 (design.md task 4.3): parity check — InProcessExecutionBackend.execute must
  // produce the exact same outcome as calling loadRowsWithStats + executeWithStepCounts
  // directly on the same inputs, since it's a verbatim wrapper (no logic change).
  "InProcessExecutionBackend" should {
    "produce the same rows/stepCounts/sourceRowCount/primaryStats as the direct engine calls (task 4.3)" in {
      val ds = StaticSource(
        id        = DataSourceId("ds-backend-parity"),
        name      = "static-src",
        ownerId   = UserId("00000000-0000-0000-0000-000000000001"),
        createdAt = Instant.now(),
        updatedAt = Instant.now()
      )
      val staticConfigJson =
        buildStaticConfig(Seq("name"), Seq(Map[String, Any]("name" -> "alice"), Map[String, Any]("name" -> "bob"))).compactPrint
      val mockRepo = new DataSourceRepository(null)(ec) {
        override def readRawConfig(dsId: DataSourceId): Future[Option[String]] =
          Future.successful(Some(staticConfigJson))
      }
      val step = makeStep("rename", """{ "renames": { "name": "renamed" } }""")

      val pipeline = Pipeline(
        id                 = PipelineId("pipeline-parity"),
        name               = "pipe",
        sourceDataSourceId = ds.id,
        lastRunStatus      = None,
        lastRunAt          = None,
        createdAt          = Instant.now(),
        updatedAt          = Instant.now(),
        ownerId            = UserId("00000000-0000-0000-0000-000000000001")
      )
      val stepRepo = new PipelineStepRepository(null)(ec)
      val backend = new InProcessExecutionBackend(engine, stepRepo)
      val backendOutcome = Await.result(
        backend.execute(pipeline, ds, Vector(step), mockRepo, new AssertionSink, new TruncationSink),
        5.seconds
      )

      val (directRows, directCounts) = Await.result(
        engine.loadRowsWithStats(ds, mockRepo).flatMap { case (sourceRows, primaryStats) =>
          engine.executeWithStepCounts(sourceRows, Seq(step), mockRepo).map { case (out, counts) =>
            (out, counts, sourceRows.size.toLong, primaryStats)
          }
        }.map { case (out, counts, _, _) => (out, counts) },
        5.seconds
      )
      val (_, directPrimaryStats) = Await.result(engine.loadRowsWithStats(ds, mockRepo), 5.seconds)

      backendOutcome.rows shouldBe directRows
      backendOutcome.stepCounts shouldBe directCounts
      backendOutcome.sourceRowCount shouldBe 2L
      backendOutcome.primaryStats shouldBe directPrimaryStats
    }
  }
  // ── Helpers ─────────────────────────────────────────────────────────────────

  private def buildStaticConfig(colNames: Seq[String], rows: Seq[Map[String, Any]]): JsValue = {
    val columns = colNames.map(n => JsObject("name" -> JsString(n), "type" -> JsString("string")))
    val jsRows  = rows.map { row =>
      JsArray(colNames.map(c => row.get(c).map(v => anyToJs(v)).getOrElse(JsNull)).toVector)
    }
    JsObject("columns" -> JsArray(columns.toVector), "rows" -> JsArray(jsRows.toVector))
  }

  private def anyToJs(v: Any): JsValue = v match {
    case null       => JsNull
    case b: Boolean => JsBoolean(b)
    case i: Int     => JsNumber(i)
    case l: Long    => JsNumber(l)
    case d: Double  => JsNumber(d)
    case s: String  => JsString(s)
    case _          => JsString(v.toString)
  }

}