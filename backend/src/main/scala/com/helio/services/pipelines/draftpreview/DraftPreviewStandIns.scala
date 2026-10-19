package com.helio.services.pipelines.draftpreview

import com.helio.domain.ai.{AiStepClient, AiStepRequest}
import com.helio.domain.model.{DataSource, PipelineExecutionContext}
import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import slick.dbio.DBIO

import scala.concurrent.{ExecutionContext, Future}

/** HEL-1630 design.md D2/D3 (rulings C2 and F): what the draft preview's execution context offers a step that tries to reach a
 *  data source or a model. Nothing legitimate calls any of them (the planner removes every AI step and answers every secondary
 *  from supplied frames); they exist so that a step reaching for one fails loudly instead of reading or spending. */
object DraftPreviewStandIns {

  private def refusal(what: String) = new IllegalStateException(s"Draft preview never reads $what")

  /** A repository whose every read throws, built over a [[DbContext]] that refuses all access. */
  def refusingRepository(implicit ec: ExecutionContext): DataSourceRepository = {
    val refusing = new DbContext(null, null) {
      override def withUserContext[R](userId: String)(action: DBIO[R]): Future[R] = throw refusal("a data source")
      override def withSystemContext[R](action: DBIO[R]): Future[R]               = throw refusal("a data source")
    }
    new DataSourceRepository(refusing)
  }

  val refusingAiClient: AiStepClient = new AiStepClient {
    def complete(request: AiStepRequest) = Future.failed(refusal("a model"))
  }

  /** `ctx` with every source and model path closed, secondaries answered from `secondaries`, and the draft's row ceiling and
   *  cell guard attached. `resolveLane` and the sinks are the engine's own and are kept. */
  def draftContext(secondaries: String => Future[Seq[Map[String, Any]]])(ctx: PipelineExecutionContext)(implicit
      ec: ExecutionContext
  ): PipelineExecutionContext =
    ctx.copy(
      dataSourceRepo = refusingRepository,
      loadSource = (_: DataSource) => Future.failed(refusal("a data source")),
      aiClient = refusingAiClient,
      resolveSecondarySource = Some(secondaries),
      maxNodeRows = Some(DraftPreviewLimits.MaxNodeRows),
      frameGuard = Some(rows => DraftPreviewCells.unencodable(rows)),
      maxLiveCells = Some(DraftPreviewLimits.MaxLiveCells),
      maxStringChars = Some(DraftPreviewLimits.MaxStringChars)
    )
}
