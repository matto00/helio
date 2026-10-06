package com.helio.services.patchsets

import com.helio.infrastructure.persistence.DbContext
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.sources.DataSourceRepository

/** Service-level coverage for `PatchSetUndoService`'s repository wiring (HEL-1256): undo-context
 *  parity with the apply context. Fixture shared via `PatchSetUndoServiceFixture`. */
class PatchSetUndoRepoWiringSpec extends PatchSetUndoServiceFixture {

  "PatchSetUndoContext parity (HEL-1256)" should {

    "carry every undo-context field, non-null and identical to the supplied collaborator, and be a subset of the apply context" in {
      val ctx2 = new DbContext(db, db)
      val supplied = Map[String, AnyRef](
        "panelRepo"        -> new PanelRepository(ctx2),
        "dashboardRepo"    -> new DashboardRepository(ctx2),
        "dataSourceRepo"   -> new DataSourceRepository(ctx2),
        "pipelineRepo"     -> new PipelineRepository(ctx2, dataSourceRepo),
        "pipelineStepRepo" -> new PipelineStepRepository(ctx2),
        "outputRepo"       -> new OutputRepository(ctx2)
      )
      val undo = new PatchSetUndoService(
        panelService, dashboardService, dataSourceService, pipelineService,
        supplied("panelRepo").asInstanceOf[PanelRepository], supplied("dashboardRepo").asInstanceOf[DashboardRepository],
        supplied("dataSourceRepo").asInstanceOf[DataSourceRepository], supplied("pipelineRepo").asInstanceOf[PipelineRepository],
        supplied("pipelineStepRepo").asInstanceOf[PipelineStepRepository], applicationRepo,
        supplied("outputRepo").asInstanceOf[OutputRepository]
      )
      val fields = undo.context.productElementNames.zip(undo.context.productIterator).toVector
      fields.map(_._1).toSet shouldBe supplied.keySet // a NEW context field must be wired + added here deliberately
      fields.foreach { case (name, value) =>
        withClue(s"undo context field '$name' ") {
          (value == null) shouldBe false
          value.asInstanceOf[AnyRef] should be theSameInstanceAs supplied(name)
        }
      }
      // Undo's context is a subset of apply's: a repo added to one and not the other shows up here.
      val applyFields = applyService.context.productElementNames.toSet
      fields.map(_._1).toSet.subsetOf(applyFields) shouldBe true
    }
  }
}
