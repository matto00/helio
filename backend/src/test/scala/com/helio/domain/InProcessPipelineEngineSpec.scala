package com.helio.domain

import com.helio.api.protocols.PipelineStepConfigCodec
import com.helio.infrastructure.{DataSourceRepository, LocalFileSystem}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.nio.file.Paths
import java.time.Instant
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

class InProcessPipelineEngineSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global
  // LocalFileSystem with absolute baseDir; LocalFileSystem.resolve passes absolute
  // paths through unchanged, so tests can write CSVs to tmp and reference by absolute path.
  private val fileSystem = new LocalFileSystem(Paths.get("/"))
  private val engine = new InProcessPipelineEngine(fileSystem)

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

        // 6.2 Multi-step pipeline test
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

    // 3.1 — select op
    "select: retains only specified fields" in {
      val cfg  = """{ "fields": ["name", "dept"] }"""
      val step = makeStep("select", cfg)
      val result = run(sampleRows, step)
      result should have size 3
      result.head.keys should contain theSameElementsAs Seq("name", "dept")
      result.head("name") shouldBe "alice"
      result.head.keys should not contain "age"
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