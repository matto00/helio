package com.helio.services.pipelines

import com.helio.api.protocols.pipelines.{PipelineProposal, PipelineProposalSource, ProposalRestApiConfig}
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.domain.model.{AuthenticatedUser, DataSourceKind, RestApiConfig, UserId}
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, Future}

/** HEL-826 task 2.3c — an inline pipeline-proposal `rest_api` source (the bare-`url`,
 *  ephemeral dry-analyze branch) forwards `body`/`bodyContentType`/`rootSelector` from the
 *  payload the same way `method`/`headers` already do, so a POST+body inline source doesn't
 *  silently drop its body during dry-analyze. Uses a `fetchOverride` stub (never touches the
 *  network) that asserts the body it was handed matches what the payload declared. */
class PipelineServiceInlineRestBodySpec extends AnyWordSpec with Matchers with ScalatestRouteTest {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private val user = AuthenticatedUser(UserId("00000000-0000-0000-0000-000000000001"))

  "PipelineService.analyzeProposal, inline rest_api bare-url source" should {

    "forwards body/bodyContentType/rootSelector from the payload into the ephemeral fetch, inferring correctly" in {
      var observedConfig: Option[RestApiConfig] = None
      val json: JsValue = JsObject("wrapped" -> JsArray(JsObject("id" -> JsNumber(1))))
      val connector = new RestApiConnectorDriver(fetchOverride = Some { cfg =>
        observedConfig = Some(cfg)
        Future.successful(Right(json))
      })
      val service = new PipelineService(
        pipelineRepo     = null,
        pipelineStepRepo = null,
        dataSourceRepo   = null,
        connector        = connector
      )

      val restPayload = ProposalRestApiConfig(
        url             = Some("http://example.invalid/data"),
        method          = Some("POST"),
        body            = Some("""{"q":1}"""),
        bodyContentType = Some("application/json"),
        rootSelector    = Some("wrapped")
      )
      val source = PipelineProposalSource(
        sourceId    = None,
        `type`      = Some(DataSourceKind.RestApi),
        name        = Some("Inline REST"),
        csvConfig   = None,
        restConfig  = Some(restPayload),
        sqlConfig   = None,
        staticConfig = None
      )
      val proposal = PipelineProposal(
        pipelineName       = "Inline REST Pipeline",
        source              = source,
        outputDataTypeName = "InlineOut",
        steps               = Vector.empty
      )

      val result = await(service.analyzeProposal(proposal, user))
      result.isRight shouldBe true
      result.map(_.sourceSchema.map(_.name)) shouldBe Right(Vector("id"))

      // The ephemeral path adapts through `fetchOverride`'s synthetic RestApiConfig (task 2.3c/3.3);
      // confirm body/bodyContentType were carried through, not dropped, into that synthesized config.
      observedConfig.flatMap(_.body) shouldBe Some("""{"q":1}""")
      observedConfig.flatMap(_.bodyContentType) shouldBe Some("application/json")
    }
  }
}
