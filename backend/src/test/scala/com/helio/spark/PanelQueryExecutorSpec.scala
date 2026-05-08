package com.helio.spark

import com.helio.domain._
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.time.Instant
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext}

class PanelQueryExecutorSpec extends AnyWordSpec with Matchers with BeforeAndAfterAll {

  implicit val ec: ExecutionContext = ExecutionContext.global

  private val submitter = new SparkJobSubmitter("local[*]", null, null)
  private val executor  = new PanelQueryExecutor(submitter)

  private def staticDs(cols: Seq[(String, String)], rows: Seq[Seq[JsValue]]): DataSource = {
    val colJson = JsArray(cols.map { case (n, t) => JsObject("name" -> JsString(n), "type" -> JsString(t)) }.toVector)
    val rowJson = JsArray(rows.map(r => JsArray(r.toVector)).toVector)
    DataSource(
      id         = DataSourceId("ds-exec-1"),
      name       = "exec-test-source",
      sourceType = SourceType.Static,
      config     = JsObject("columns" -> colJson, "rows" -> rowJson),
      createdAt  = Instant.now(),
      updatedAt  = Instant.now(),
      ownerId    = UserId("user-1")
    )
  }

  private def await[T](f: scala.concurrent.Future[T]): T = Await.result(f, 30.seconds)

  "PanelQueryExecutor" when {

    "selectedFields is non-empty" should {
      "project only the specified columns" in {
        val ds = staticDs(
          Seq("price" -> "double", "name" -> "string", "qty" -> "integer"),
          Seq(
            Seq(JsNumber(10.0), JsString("widget"), JsNumber(5)),
            Seq(JsNumber(20.0), JsString("gadget"), JsNumber(3))
          )
        )
        val query = PanelQuery(selectedFields = List("price", "name"), filters = Nil, sort = None, limit = None)
        val rows  = await(executor.execute(ds, query))

        rows should have size 2
        rows.foreach { row =>
          row.keys should contain allOf ("price", "name")
          row.keys should not contain "qty"
        }
      }
    }

    "selectedFields is empty" should {
      "return all columns" in {
        val ds = staticDs(
          Seq("price" -> "double", "name" -> "string"),
          Seq(Seq(JsNumber(5.0), JsString("alpha")))
        )
        val query = PanelQuery(selectedFields = Nil, filters = Nil, sort = None, limit = None)
        val rows  = await(executor.execute(ds, query))

        rows should have size 1
        rows.head.keys should contain allOf ("price", "name")
      }
    }

    "data source has multiple rows" should {
      "return all rows without limit" in {
        val ds = staticDs(
          Seq("id" -> "integer"),
          (1 to 5).map(i => Seq(JsNumber(i)))
        )
        val query = PanelQuery(selectedFields = List("id"), filters = Nil, sort = None, limit = None)
        val rows  = await(executor.execute(ds, query))
        rows should have size 5
      }
    }
  }

  override def afterAll(): Unit = {
    submitter.spark.stop()
    super.afterAll()
  }
}
