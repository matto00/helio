package com.helio.spark

import com.helio.domain._
import com.helio.infrastructure.PipelineStepRepository.PipelineStepRow
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.time.Instant
import scala.concurrent.ExecutionContext

class SparkJobSubmitterSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  implicit val ec: ExecutionContext = ExecutionContext.global

  // Use local mode to avoid external cluster dependency in tests.
  private val submitter = new SparkJobSubmitter("local[*]", null)

  // Helper: build a minimal static DataSource with given columns and rows.
  private def staticDs(
      cols: Seq[(String, String)],
      rows: Seq[Seq[JsValue]]
  ): DataSource = {
    val colJson = JsArray(cols.map { case (n, t) =>
      JsObject("name" -> JsString(n), "type" -> JsString(t))
    }.toVector)
    val rowJson = JsArray(rows.map(r => JsArray(r.toVector)).toVector)
    val config  = JsObject("columns" -> colJson, "rows" -> rowJson)
    DataSource(
      id         = DataSourceId("ds-1"),
      name       = "test-source",
      sourceType = SourceType.Static,
      config     = config,
      createdAt  = Instant.now(),
      updatedAt  = Instant.now(),
      ownerId    = UserId("user-1")
    )
  }

  // Helper: build a PipelineStepRow for a given op + JSON config string.
  private def step(op: String, configJson: String, pos: Int = 0): PipelineStepRow =
    PipelineStepRow(
      id         = s"step-$pos",
      pipelineId = "pipeline-1",
      position   = pos,
      op         = op,
      config     = configJson,
      createdAt  = Instant.now(),
      updatedAt  = Instant.now()
    )

  // Helper: serialize key-value pairs to a compact JSON string.
  private def cfg(fields: (String, JsValue)*): String =
    JsObject(fields: _*).compactPrint

  "loadDataFrame" should {
    "load a static DataSource into a DataFrame" in {
      val ds = staticDs(
        Seq("name" -> "string", "age" -> "integer"),
        Seq(Seq(JsString("Alice"), JsNumber(30)), Seq(JsString("Bob"), JsNumber(25)))
      )
      val df = submitter.loadDataFrame(ds)
      df.count() shouldBe 2
      df.schema.fieldNames should contain allOf ("name", "age")
    }

    "throw for unsupported rest_api source type" in {
      val ds = DataSource(
        id         = DataSourceId("ds-2"),
        name       = "rest",
        sourceType = SourceType.RestApi,
        config     = JsObject(),
        createdAt  = Instant.now(),
        updatedAt  = Instant.now(),
        ownerId    = UserId("user-1")
      )
      an[IllegalArgumentException] should be thrownBy submitter.loadDataFrame(ds)
    }
  }

  "applyStep" when {

    "op is rename" should {
      "rename a column" in {
        val ds = staticDs(Seq("first_name" -> "string"), Seq(Seq(JsString("Alice"))))
        val df = submitter.loadDataFrame(ds)
        val mappings = JsArray(Vector(JsObject("from" -> JsString("first_name"), "to" -> JsString("name"))))
        val s  = step("rename", cfg("mappings" -> mappings))
        val result = submitter.applyStep(df, s)
        result.schema.fieldNames should contain ("name")
        result.schema.fieldNames should not contain "first_name"
      }
    }

    "op is filter" should {
      "filter rows by SQL expression" in {
        val ds = staticDs(
          Seq("age" -> "integer"),
          Seq(Seq(JsNumber(20)), Seq(JsNumber(35)), Seq(JsNumber(28)))
        )
        val df     = submitter.loadDataFrame(ds)
        val s      = step("filter", cfg("expression" -> JsString("age > 25")))
        val result = submitter.applyStep(df, s)
        result.count() shouldBe 2
      }
    }

    "op is compute" should {
      "add a computed column" in {
        val ds = staticDs(
          Seq("price" -> "double", "qty" -> "integer"),
          Seq(Seq(JsNumber(10.0), JsNumber(3)))
        )
        val df     = submitter.loadDataFrame(ds)
        val s      = step("compute", cfg("column" -> JsString("total"), "expression" -> JsString("price * qty")))
        val result = submitter.applyStep(df, s)
        result.schema.fieldNames should contain ("total")
        result.collect().head.getAs[Double]("total") shouldBe 30.0 +- 0.001
      }
    }

    "op is groupby" should {
      "group and aggregate with sum" in {
        val ds = staticDs(
          Seq("dept" -> "string", "salary" -> "double"),
          Seq(
            Seq(JsString("eng"), JsNumber(100.0)),
            Seq(JsString("eng"), JsNumber(200.0)),
            Seq(JsString("hr"),  JsNumber(150.0))
          )
        )
        val df      = submitter.loadDataFrame(ds)
        val groupBy = JsArray(Vector(JsString("dept")))
        val config  = cfg("groupBy" -> groupBy, "aggColumn" -> JsString("salary"), "aggFunction" -> JsString("sum"))
        val result  = submitter.applyStep(df, step("groupby", config))
        result.count() shouldBe 2
        result.schema.fieldNames should contain ("sum_salary")
      }

      "support avg, min, max functions" in {
        val ds = staticDs(
          Seq("g" -> "string", "v" -> "double"),
          Seq(Seq(JsString("a"), JsNumber(10.0)), Seq(JsString("a"), JsNumber(20.0)))
        )
        val df      = submitter.loadDataFrame(ds)
        val groupBy = JsArray(Vector(JsString("g")))
        Seq("avg", "min", "max").foreach { fn =>
          val config = cfg("groupBy" -> groupBy, "aggColumn" -> JsString("v"), "aggFunction" -> JsString(fn))
          submitter.applyStep(df, step("groupby", config)).count() shouldBe 1L
        }
      }

      "throw for unknown aggFunction" in {
        val ds      = staticDs(Seq("g" -> "string", "v" -> "double"), Seq(Seq(JsString("a"), JsNumber(1.0))))
        val df      = submitter.loadDataFrame(ds)
        val groupBy = JsArray(Vector(JsString("g")))
        val s       = step("groupby", cfg("groupBy" -> groupBy, "aggColumn" -> JsString("v"), "aggFunction" -> JsString("mode")))
        an[IllegalArgumentException] should be thrownBy submitter.applyStep(df, s)
      }
    }

    "op is cast" should {
      "cast a column to a new data type" in {
        val ds     = staticDs(Seq("age" -> "string"), Seq(Seq(JsString("30"))))
        val df     = submitter.loadDataFrame(ds)
        val s      = step("cast", cfg("column" -> JsString("age"), "dataType" -> JsString("integer")))
        val result = submitter.applyStep(df, s)
        result.schema("age").dataType.typeName shouldBe "integer"
        result.collect().head.getAs[Int]("age") shouldBe 30
      }
    }

    "op is unknown" should {
      "throw IllegalArgumentException" in {
        val ds = staticDs(Seq("x" -> "string"), Seq(Seq(JsString("y"))))
        val df = submitter.loadDataFrame(ds)
        val s  = step("explode", "{}")
        an[IllegalArgumentException] should be thrownBy submitter.applyStep(df, s)
      }
    }
  }

  "collectRows" should {
    "return one map per row with all field names" in {
      val ds = staticDs(
        Seq("name" -> "string", "age" -> "integer"),
        Seq(Seq(JsString("Alice"), JsNumber(30)))
      )
      val df   = submitter.loadDataFrame(ds)
      val rows = submitter.collectRows(df)
      rows should have size 1
      rows.head("name") shouldBe "Alice"
      rows.head("age")  shouldBe 30
    }
  }

  override def afterAll(): Unit = {
    submitter.spark.stop()
    super.afterAll()
  }
}
