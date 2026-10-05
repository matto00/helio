package com.helio.services.pipelines

import com.helio.api.protocols.pipelines.{PipelineProposal, PipelineProposalSource}
import com.helio.api.protocols.sources.SqlSourceConfigPayload
import com.helio.domain.connectors.RestApiConnectorDriver
import com.helio.domain.model.{AuthenticatedUser, DataSourceKind, UserId}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.services.ServiceError
import com.helio.testkit.HelioRouteTest
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.mockito.Mockito.mock
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, Future}

/** HEL-998: an inline `sql` pipeline source with an unsupported dialect or a URL-parameter-bearing
 *  database name is refused with a 400 on both inline-source paths (the dry-analyze path in
 *  `PipelineService` and the structural validation in `PipelineProposalService`), before any
 *  connection is attempted. */
class PipelineInlineSqlShapeSpec extends AnyWordSpec with Matchers with HelioRouteTest {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  private val user = AuthenticatedUser(UserId("00000000-0000-0000-0000-000000000001"))

  private def sqlSource(dialect: String, database: String) = PipelineProposalSource(
    sourceId     = None,
    `type`       = Some(DataSourceKind.Sql),
    name         = Some("Inline SQL"),
    csvConfig    = None,
    restConfig   = None,
    sqlConfig    = Some(SqlSourceConfigPayload(dialect, "db.example.com", 5432, database, "u", "p", "SELECT 1")),
    staticConfig = None
  )

  private def proposal(source: PipelineProposalSource) = PipelineProposal("Inline SQL Pipeline", Vector(source), Vector.empty)

  private val badShapes = Seq(
    "an unsupported dialect"                  -> sqlSource("oracle", "app"),
    "a database carrying a URL parameter"     -> sqlSource("postgresql", "app?socketFactory=javax.net.DefaultSocketFactory")
  )

  "PipelineService.analyzeProposal inline sql source" should {
    badShapes.foreach { case (label, source) =>
      s"refuse $label with BadRequest" in {
        val service = new PipelineService(null, null, null, new RestApiConnectorDriver())
        val err     = await(service.analyzeProposal(proposal(source), user)).swap.toOption.get
        err shouldBe a[ServiceError.BadRequest]
      }
    }
  }

  "PipelineProposalService.validate inline sql source" should {
    badShapes.foreach { case (label, source) =>
      s"refuse $label with BadRequest" in {
        val service = new PipelineProposalService(null, null, null, null, mock(classOf[DataSourceRepository]), null)
        val err     = await(service.validate(proposal(source), user)).swap.toOption.get
        err shouldBe a[ServiceError.BadRequest]
      }
    }
  }
}
