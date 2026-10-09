package com.helio.services.workspace

import com.helio.api.JsonProtocols
import com.helio.domain.engine.PipelineRowJson
import com.helio.domain.model.DataField
import com.helio.infrastructure.persistence.pipelines.OutputRepository
import com.helio.testsupport.CsvLoadSupport
import org.mockito.Mockito.mock
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import scala.concurrent.ExecutionContext

/** HEL-1408 design D7b: the assistant's workspace grounding reads a CSV-loaded frame whose blanks are
 *  now null, so `nullRate` rises and distinct/example values no longer include the blank. */
class CsvBlankCellsNullWorkspaceSpec extends AnyWordSpec with Matchers with JsonProtocols with CsvLoadSupport {

  private implicit val ec: ExecutionContext = ExecutionContext.global
  private val service = new WorkspaceContextService(null, null, mock(classOf[OutputRepository]), null)

  "computeColumnStats over a CSV-loaded frame with blanks" should {
    "count the blanks in nullRate and leave them out of distinct count and examples" in {
      val rows   = loadCsv("team,n\na,1\n,2\nb,3\n,4\n").map(r => JsObject(PipelineRowJson.rowToJsMap(r))).toVector
      val fields = Vector(DataField(name = "team", displayName = "team", dataType = "string", nullable = true))
      val stats  = service.computeColumnStats(fields, rows)("team")
      stats.nullRate shouldBe 0.5
      stats.distinctCount shouldBe 2
      stats.exampleValues shouldBe Vector(JsString("a"), JsString("b"))
    }
  }
}
