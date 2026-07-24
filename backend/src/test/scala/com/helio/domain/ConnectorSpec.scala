package com.helio.domain

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json.{JsNumber, JsObject, JsValue}

import scala.concurrent.{Await, ExecutionContext, Future}
import scala.concurrent.duration.DurationInt

/** Minimal config for [[FixtureConnector]] — deliberately unrelated in shape to
 *  `SqlSourceConfig`/`RestApiConfig`, to prove `Connector[Config]` doesn't require a common config
 *  supertype (design.md Decision 1). */
final case class FixtureConfig(reachable: Boolean, rowCount: Int)

/** A trivial in-memory `Connector[FixtureConfig]` implementation used only to prove the SPI
 *  contract (lifecycle dispatch, metadata surface) independent of the real SQL/REST connectors. */
object FixtureConnector extends Connector[FixtureConfig] {

  val metadata: ConnectorMetadata = ConnectorMetadata(
    kind = "fixture",
    displayName = "Fixture Connector",
    supportsIncremental = false,
    authKind = "none"
  )

  def testConnection(config: FixtureConfig)(implicit ec: ExecutionContext): Future[Either[String, Unit]] =
    Future.successful(if (config.reachable) Right(()) else Left("fixture unreachable"))

  def inferSchema(config: FixtureConfig)(implicit ec: ExecutionContext): Future[Either[String, InferredSchema]] =
    Future.successful(
      Right(InferredSchema(Seq(InferredField("id", "Id", DataFieldType.IntegerType, nullable = false))))
    )

  def fetch(config: FixtureConfig, maxRows: Int)(implicit ec: ExecutionContext)
      : Future[Either[String, Vector[JsValue]]] =
    Future.successful(
      Right((1 to config.rowCount).map(i => JsObject("id" -> JsNumber(i))).toVector.take(maxRows))
    )
}

/** Proves the `Connector[Config]` trait contract (lifecycle dispatch through the trait interface,
 *  not just the concrete object) using a fixture implementation — independent of SqlConnector/
 *  RestApiConnector, which get their own dispatch tests. */
class ConnectorSpec extends AnyWordSpec with Matchers {

  private implicit val ec: ExecutionContext = ExecutionContext.global

  private def await[T](f: Future[T]): T = Await.result(f, 5.seconds)

  /** Reference the fixture through the trait type, not the concrete object — this is what proves
   *  dispatch works through `Connector[Config]` rather than merely compiling as a subtype. */
  private val asConnector: Connector[FixtureConfig] = FixtureConnector

  "Connector[FixtureConfig] (dispatch through the trait interface)" should {

    "expose metadata with the expected capability fields" in {
      asConnector.metadata shouldBe ConnectorMetadata(
        kind = "fixture",
        displayName = "Fixture Connector",
        supportsIncremental = false,
        authKind = "none"
      )
    }

    "return Right(()) from testConnection when the fixture reports reachable" in {
      await(asConnector.testConnection(FixtureConfig(reachable = true, rowCount = 0))) shouldBe Right(())
    }

    "return Left with an error message from testConnection when the fixture reports unreachable" in {
      await(asConnector.testConnection(FixtureConfig(reachable = false, rowCount = 0))) shouldBe Left("fixture unreachable")
    }

    "return an InferredSchema from inferSchema" in {
      val result = await(asConnector.inferSchema(FixtureConfig(reachable = true, rowCount = 3)))
      result.map(_.fields.map(_.name)) shouldBe Right(Seq("id"))
    }

    "return normalized JsObject rows from fetch, bounded by maxRows" in {
      val result = await(asConnector.fetch(FixtureConfig(reachable = true, rowCount = 5), maxRows = 2))
      result shouldBe Right(Vector(JsObject("id" -> JsNumber(1)), JsObject("id" -> JsNumber(2))))
    }

    "not declare a refresh method (refresh = re-fetch by default, per trait doc comment)" in {
      // Compile-time proof, not a runtime assertion: `Connector[Config]` only
      // declares `metadata`, `testConnection`, `inferSchema`, and `fetch`.
      // If a `refresh` member existed on the trait, `asConnector.refresh` would
      // compile below — it doesn't, so this is enforced by the type checker.
      "asConnector.refresh" shouldNot compile
    }
  }
}
