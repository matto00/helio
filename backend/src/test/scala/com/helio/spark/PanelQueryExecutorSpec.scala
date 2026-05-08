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

    "filters is non-empty" should {
      "push filter into Spark and return only matching rows" in {
        val ds = staticDs(
          Seq("price" -> "double", "name" -> "string"),
          Seq(
            Seq(JsNumber(10.0), JsString("widget")),
            Seq(JsNumber(25.0), JsString("gadget")),
            Seq(JsNumber(5.0),  JsString("donut"))
          )
        )
        val query = PanelQuery(
          selectedFields = Nil,
          filters        = List(JsString("price > 8")),
          sort           = None,
          limit          = None
        )
        val rows = await(executor.execute(ds, query))

        rows should have size 2
        rows.map(_("name").toString) should contain allOf ("widget", "gadget")
        rows.map(_("name").toString) should not contain "donut"
      }
    }

    "filters contains multiple expressions" should {
      "AND all filter expressions together and return only matching rows" in {
        val ds = staticDs(
          Seq("price" -> "double", "qty" -> "integer", "name" -> "string"),
          Seq(
            Seq(JsNumber(15.0), JsNumber(2), JsString("alpha")),  // price > 10, qty < 5 → PASS
            Seq(JsNumber(5.0),  JsNumber(2), JsString("beta")),   // price <= 10         → FAIL
            Seq(JsNumber(20.0), JsNumber(8), JsString("gamma")),  // qty >= 5            → FAIL
            Seq(JsNumber(25.0), JsNumber(3), JsString("delta"))   // price > 10, qty < 5 → PASS
          )
        )
        val query = PanelQuery(
          selectedFields = Nil,
          filters        = List(JsString("price > 10"), JsString("qty < 5")),
          sort           = None,
          limit          = None
        )
        val rows = await(executor.execute(ds, query))

        rows should have size 2
        rows.map(_("name").toString) should contain allOf ("alpha", "delta")
        rows.map(_("name").toString) should not contain "beta"
        rows.map(_("name").toString) should not contain "gamma"
      }
    }

    "sort is set" should {
      "push orderBy into Spark and return rows in the specified order" in {
        val ds = staticDs(
          Seq("score" -> "integer", "label" -> "string"),
          Seq(
            Seq(JsNumber(30), JsString("c")),
            Seq(JsNumber(10), JsString("a")),
            Seq(JsNumber(20), JsString("b"))
          )
        )
        val query = PanelQuery(
          selectedFields = List("score", "label"),
          filters        = Nil,
          sort           = Some("score ASC"),
          limit          = None
        )
        val rows = await(executor.execute(ds, query))

        rows should have size 3
        val scores = rows.map(r => r("score").asInstanceOf[Int])
        scores shouldBe sorted
      }
    }

    "limit is set" should {
      "push limit into Spark and restrict the number of collected rows" in {
        val ds = staticDs(
          Seq("id" -> "integer"),
          (1 to 10).map(i => Seq(JsNumber(i)))
        )
        val query = PanelQuery(
          selectedFields = List("id"),
          filters        = Nil,
          sort           = None,
          limit          = Some(4)
        )
        val rows = await(executor.execute(ds, query))

        rows should have size 4
      }
    }

    "projection + filter + sort + limit are all set" should {
      "apply all pushdowns in order and return the correct subset" in {
        val ds = staticDs(
          Seq("price" -> "double", "name" -> "string", "qty" -> "integer"),
          Seq(
            Seq(JsNumber(50.0), JsString("alpha"), JsNumber(1)),
            Seq(JsNumber(15.0), JsString("beta"),  JsNumber(2)),
            Seq(JsNumber(30.0), JsString("gamma"), JsNumber(3)),
            Seq(JsNumber(5.0),  JsString("delta"), JsNumber(4)),
            Seq(JsNumber(40.0), JsString("epsilon"), JsNumber(5))
          )
        )
        // Select name + price, keep only price >= 15, sort by price DESC, take top 2
        val query = PanelQuery(
          selectedFields = List("name", "price"),
          filters        = List(JsString("price >= 15")),
          sort           = Some("price DESC"),
          limit          = Some(2)
        )
        val rows = await(executor.execute(ds, query))

        rows should have size 2
        // qty must not appear (projection)
        rows.foreach(row => row.keys should not contain "qty")
        // top 2 by price DESC from {50, 15, 30, 40} => 50 then 40
        val prices = rows.map(r => r("price").asInstanceOf[Double])
        prices shouldBe List(50.0, 40.0)
      }
    }
  }

  override def afterAll(): Unit = {
    submitter.spark.stop()
    super.afterAll()
  }
}
