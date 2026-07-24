package com.helio.domain

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** Config for [[RowSupplyingConnector]] — a fixture distinct from `ConnectorSpec`'s
 *  `FixtureConnector`, built specifically to prove HEL-473's documented contract
 *  (`Connector.scala`'s `'''Schema inference'''` doc block, spec.md Scenario "A test connector
 *  supplying arbitrary rows infers correctly"): a new connector only needs to supply
 *  `Vector[JsValue]` rows; correct schema inference comes for free from
 *  `SchemaInferenceEngine.inferSchemaFromRows`, with no connector-specific inference logic. */
final case class RowSupplyingConfig(rows: Vector[JsValue])

/** A `Connector[Config]` implementation whose `inferSchema` does nothing but fetch its configured
 *  rows and hand them to `SchemaInferenceEngine.inferSchemaFromRows` — exactly the pattern
 *  `Connector.scala`'s trait doc comment describes for any new connector. */
object RowSupplyingConnector extends Connector[RowSupplyingConfig] {

  val metadata: ConnectorMetadata = ConnectorMetadata(
    kind = "row-supplying-fixture",
    displayName = "Row-Supplying Fixture Connector",
    supportsIncremental = false,
    authKind = "none"
  )

  def testConnection(config: RowSupplyingConfig)(implicit ec: ExecutionContext): Future[Either[String, Unit]] =
    Future.successful(Right(()))

  def fetch(config: RowSupplyingConfig, maxRows: Int)(implicit ec: ExecutionContext)
      : Future[Either[String, Vector[JsValue]]] =
    Future.successful(Right(config.rows.take(maxRows)))

  def inferSchema(config: RowSupplyingConfig)(implicit ec: ExecutionContext): Future[Either[String, InferredSchema]] =
    fetch(config, maxRows = 100).map(_.map(SchemaInferenceEngine.inferSchemaFromRows))
}

class NewConnectorInferenceSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global
  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  "A new Connector[Config] implementation supplying arbitrary rows" should {

    "produce an InferredSchema with correct field names, types, and nullability via inferSchemaFromRows" in {
      val rows: Vector[JsValue] = Vector(
        JsObject("sku" -> JsString("A1"), "qty" -> JsNumber(5), "note" -> JsNull),
        JsObject("sku" -> JsString("A2"), "qty" -> JsNumber(7), "note" -> JsString("low stock"))
      )
      val config = RowSupplyingConfig(rows)

      val schema = await(RowSupplyingConnector.inferSchema(config)).getOrElse(fail("expected Right"))
      val byName = schema.fields.map(f => f.name -> f).toMap

      byName.keySet shouldBe Set("sku", "qty", "note")
      byName("sku").dataType  shouldBe DataFieldType.StringType
      byName("sku").nullable  shouldBe false
      byName("qty").dataType  shouldBe DataFieldType.IntegerType
      byName("qty").nullable  shouldBe false
      byName("note").dataType shouldBe DataFieldType.StringType
      byName("note").nullable shouldBe true
    }

    "reflect exactly the fields present in the supplied rows — no fabricated extras" in {
      val rows: Vector[JsValue] = Vector(JsObject("only_field" -> JsBoolean(true)))
      val result = await(RowSupplyingConnector.inferSchema(RowSupplyingConfig(rows)))
      result.map(_.fields.map(_.name)) shouldBe Right(Seq("only_field"))
    }
  }
}
