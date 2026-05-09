package com.helio.domain

import com.helio.infrastructure.{DataSourceRepository, PipelineStepRepository}
import com.helio.infrastructure.PipelineStepRepository.PipelineStepRow
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.time.Instant
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

class InProcessPipelineEngineSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global
  private val engine = new InProcessPipelineEngine()

  private def makeStep(op: String, config: String): PipelineStepRow =
    PipelineStepRow("step-id", "pipe-id", 0, op, config, Instant.now(), Instant.now())

  private def run(rows: Seq[Map[String, Any]], steps: PipelineStepRow*): Seq[Map[String, Any]] =
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

    "filter: keeps rows where expression evaluates to non-zero number" in {
      val cfg = """{ "expression": "age" }"""
      val step = makeStep("filter", cfg)
      val result = run(sampleRows, step)
      result should have size 2
      result.map(_("name")) should contain allOf ("alice", "bob")
      result.map(_("name")) should not contain "carol"
    }

    "compute: adds a new column from expression" in {
      val cfg = """{ "column": "age_plus_ten", "expression": "age + 10" }"""
      val step = makeStep("compute", cfg)
      val result = run(sampleRows, step)
      result.head("age_plus_ten") shouldBe 40.0
      result(1)("age_plus_ten") shouldBe 35.0
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

    "cast: converts column to integer" in {
      val rows = Seq(Map("x" -> "42".asInstanceOf[Any]))
      val cfg  = """{ "column": "x", "dataType": "integer" }"""
      val step = makeStep("cast", cfg)
      val result = run(rows, step)
      result.head("x") shouldBe 42
    }

    "cast: sets null on unparseable value" in {
      val rows = Seq(Map("x" -> "not-a-number".asInstanceOf[Any]))
      val cfg  = """{ "column": "x", "dataType": "integer" }"""
      val step = makeStep("cast", cfg)
      val result = run(rows, step)
      result.head("x").asInstanceOf[AnyRef] shouldBe null
    }

    "cast: converts column to long" in {
      val rows = Seq(Map("n" -> "999999999999".asInstanceOf[Any]))
      val cfg  = """{ "column": "n", "dataType": "long" }"""
      val step = makeStep("cast", cfg)
      val result = run(rows, step)
      result.head("n") shouldBe 999999999999L
    }

    "cast: converts column to double" in {
      val rows = Seq(Map("v" -> "3.14".asInstanceOf[Any]))
      val cfg  = """{ "column": "v", "dataType": "double" }"""
      val step = makeStep("cast", cfg)
      val result = run(rows, step)
      result.head("v") shouldBe 3.14
    }

    "cast: converts column to boolean" in {
      val rows = Seq(Map("flag" -> "true".asInstanceOf[Any]))
      val cfg  = """{ "column": "flag", "dataType": "boolean" }"""
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
      val rightDs = DataSource(
        id         = DataSourceId("ds-right"),
        name       = "right",
        sourceType = SourceType.Static,
        config     = rightConfig,
        createdAt  = Instant.now(),
        updatedAt  = Instant.now(),
        ownerId    = UserId("00000000-0000-0000-0000-000000000001")
      )
      val mockRepo = new DataSourceRepository(null)(ec) {
        override def findById(dsId: DataSourceId): Future[Option[DataSource]] =
          Future.successful(if (dsId.value == "ds-right") Some(rightDs) else None)
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
      val rightDs = DataSource(
        id         = DataSourceId("ds-right-left"),
        name       = "right",
        sourceType = SourceType.Static,
        config     = rightConfig,
        createdAt  = Instant.now(),
        updatedAt  = Instant.now(),
        ownerId    = UserId("00000000-0000-0000-0000-000000000001")
      )
      val mockRepo = new DataSourceRepository(null)(ec) {
        override def findById(dsId: DataSourceId): Future[Option[DataSource]] =
          Future.successful(if (dsId.value == "ds-right-left") Some(rightDs) else None)
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
      val castStep    = makeStep("cast",    """{ "column": "age", "dataType": "integer" }""")

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

    "unknown op fails with descriptive error" in {
      val step = makeStep("bogus", "{}")
      val fut  = engine.execute(sampleRows, Seq(step), null)
      val ex   = intercept[Exception](Await.result(fut, 5.seconds))
      ex.getMessage should include ("Unknown step op: bogus")
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