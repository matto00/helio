package com.helio.api.routes.pipelines

import com.helio.api.protocols.pipelines.PipelineProposalApplyResponse
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.infrastructure.persistence.auth.ConnectorCredentialRepository
import com.helio.infrastructure.persistence.sources.ConnectorRepository
import com.helio.services.sources.ContentSourceSupport
import com.helio.testkit.RemoteErrorBodyStub
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.Http
import org.apache.pekko.http.scaladsl.model.StatusCodes

import java.net.InetAddress
import scala.concurrent.Await
import scala.concurrent.duration.DurationInt

/** HEL-1841: apply-proposal against the REAL driver and a local server answering 500 with an oversized body. The
 *  blocked run's reason and the stored run `error_log` carry the capped text, never the whole body. The proposal has
 *  no Output with a fieldMapping on the failing root (else apply's own dry run rejects first and the blocked-run path
 *  is never reached), and the stub answers 500 on every call (the dry run and the create). */
class PipelineApplyProposalRemoteErrorCapSpec extends PipelineApplyProposalSpecBase {

  private implicit val stubSystem: ActorSystem[Nothing] = system.toTyped
  private var binding: Http.ServerBinding               = _
  private var port: Int                                 = _

  private val admitLocalhost: (String, InetAddress) => Boolean =
    (host, addr) => if (host == "localhost") false else ContentSourceSupport.isBlockedAddress(addr)

  override protected def restDriver(connectorRepo: ConnectorRepository, credentialRepo: ConnectorCredentialRepository): RestApiConnectorDriver =
    new RestApiConnectorDriver(connectorRepoOpt = Some(connectorRepo), credentialRepoOpt = Some(credentialRepo), isBlocked = admitLocalhost)

  override def beforeAll(): Unit = {
    binding = Await.result(Http(stubSystem.classicSystem).newServerAt("localhost", 0).bind(RemoteErrorBodyStub.route), 10.seconds)
    port = binding.localAddress.getPort
    super.beforeAll()
  }

  override def afterAll(): Unit = {
    Await.ready(binding.unbind(), 10.seconds)
    super.afterAll()
  }

  private def applyAgainst(path: String, expected: String): Unit = {
    val body =
      s"""{"pipelineName":"Remote Error Cap $path","roots":[{"type":"rest_api","name":"Failing Rest $path",
         |"config":{"url":"http://localhost:$port/$path"}}],"steps":[]}""".stripMargin
    var pipelineId = ""
    apply(body) ~> routes ~> check {
      status shouldBe StatusCodes.Created
      val resp = responseAs[PipelineProposalApplyResponse]
      resp.run.blocked shouldBe true
      val reason = resp.run.blockedReason.get
      // The cut sits inside the quoted error: the capped text is followed directly by the fixed " — fix the source" tail.
      reason should include(expected + " — fix the source")
      reason.length should be < 700
      pipelineId = resp.pipeline.id
    }
    val (runStatus, errorLog) = latestPipelineRun(pipelineId).get
    runStatus shouldBe "failed"
    errorLog.get should include(expected + " — fix the source")
    errorLog.get.length should be < 700
  }

  "POST /api/pipelines/apply-proposal with a failing remote" should {
    "cap an oversized error body in the blocked reason and the stored error_log" in {
      applyAgainst("big", RemoteErrorBodyStub.ExpectedBig)
    }
    "not split a surrogate pair at the cut" in {
      applyAgainst("surrogate", RemoteErrorBodyStub.ExpectedSurrogate)
    }
  }
}
