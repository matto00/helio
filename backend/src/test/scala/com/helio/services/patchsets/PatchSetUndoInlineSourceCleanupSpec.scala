package com.helio.services.patchsets

import com.helio.api.protocols.patchsets.InlineSourceUndoOutcome
import com.helio.api.protocols.pipelines.{CreatePipelineRequest, CreatePipelineRootRequest}
import com.helio.api.protocols.sources.{StaticColumnPayload, StaticDataSourceRequest}
import com.helio.domain.model._
import com.helio.infrastructure.persistence.patchsets.PatchSetApplicationRepository.JournaledInlineSource
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.DbContext
import com.helio.services.pipelines.PipelineService
import com.helio.services.sources.{DataSourceDeleteConflict, DataSourceDeleteConflictPanel, DataSourceDeleteConflictPipeline, DataSourceService, InlineSourceCleanup, InlineSourceDeleteResult}
import com.helio.infrastructure.storage.LocalFileSystem
import spray.json._

import java.util.UUID
import scala.concurrent.Future

/** HEL-1493: the journal records the inline sources an apply created, `InlineSourceCleanup.deleteIfUnreferenced`
 *  classifies what happened, and the undo maps each result onto the wire. */
class PatchSetUndoInlineSourceCleanupSpec extends PatchSetInlineSourceFixture {

  private def cleanup: InlineSourceCleanup = pipelineService.inlineSourceCleanup

  private def staticSource(name: String): DataSourceId =
    await(dataSourceService.createStatic(
      StaticDataSourceRequest(name, "static", Vector(StaticColumnPayload("amount", "number")), Vector(Vector(JsNumber(1)))), user
    )).fold(e => fail(s"setup: $e"), _.id)

  private def journaled(applicationId: String) =
    await(applicationRepo.findById(PatchSetApplicationId(applicationId), user)).get.edits.head

  "the apply journal" should {
    "record the created inline source of a pipeline create, and an empty list when every root names an existing source" in {
      val (appId, pipelineId) = applyCreate(CreatePipelineRequest(s"journal-${UUID.randomUUID()}", Vector(datasetRoot())))
      journaled(appId).inlineSources shouldBe Some(Vector(JournaledInlineSource(rootSourceIds(pipelineId).head, implicitConnector = false)))
      val existing = staticSource(s"existing-${UUID.randomUUID()}")
      val (appId2, _) = applyCreate(CreatePipelineRequest(s"journal-none-${UUID.randomUUID()}", Vector(CreatePipelineRootRequest(Some(existing.value)))))
      journaled(appId2).inlineSources shouldBe Some(Vector.empty)
    }

    "flag a bare-url REST inline root as owning an implicit Connector" in {
      val (appId, pipelineId) = applyCreate(CreatePipelineRequest(s"journal-rest-${UUID.randomUUID()}", Vector(bareUrlRestRoot())))
      journaled(appId).inlineSources shouldBe Some(Vector(JournaledInlineSource(rootSourceIds(pipelineId).head, implicitConnector = true)))
    }
  }

  "InlineRootPairing" should {
    val request = CreatePipelineRequest("p", Vector(datasetRoot(), CreatePipelineRootRequest(Some("existing")), datasetRoot()))
    def summary(roots: JsValue*) = Some(JsObject("roots" -> JsArray(roots.toVector)))
    def root(id: String) = JsObject("dataSourceId" -> JsString(id))

    "pair only the inline roots by position" in {
      InlineRootPairing.pair(request, summary(root("a"), root("existing"), root("c"))) shouldBe
        InlineRootPairing.Paired(Vector((DataSourceId("a"), false), (DataSourceId("c"), false)), 0)
    }
    "pair nothing when the counts differ" in {
      InlineRootPairing.pair(request, summary(root("a"))) shouldBe InlineRootPairing.CountMismatch(3, 1)
    }
    "leave out an inline root whose summary entry has no string dataSourceId, and count it" in {
      InlineRootPairing.pair(request, summary(root("a"), root("existing"), JsObject("dataSourceId" -> JsNumber(3)))) shouldBe
        InlineRootPairing.Paired(Vector((DataSourceId("a"), false)), 1)
    }
    "report no inline roots when every root names a source" in {
      InlineRootPairing.pair(CreatePipelineRequest("p", Vector(CreatePipelineRootRequest(Some("x")))), None) shouldBe InlineRootPairing.NoInlineRoots
    }
  }

  "InlineSourceCleanup.inUseReason (C6)" should {
    def conflict(pipelines: Vector[String], panels: Vector[String], hiddenPipelines: Int = 0, hiddenPanels: Int = 0) =
      DataSourceDeleteConflict(
        "dataSource", "s-id", "S", "agent text with 430cda43-47ce-43f2-b334-7790d65a55cb. Remove each reference first.",
        pipelines.map(DataSourceDeleteConflictPipeline("430cda43-47ce-43f2-b334-7790d65a55cb", _, Vector("root"))),
        panels.map(DataSourceDeleteConflictPanel("p-id", _, "d-id", "D")), hiddenPipelines, hiddenPanels)

    "name a visible pipeline and form panel, without ids or remediation" in {
      InlineSourceCleanup.inUseReason(conflict(Vector("Holder"), Vector("Form"))) shouldBe """still used by pipeline "Holder", form panel "Form"."""
    }
    "report referencers the caller cannot see as a count only" in {
      InlineSourceCleanup.inUseReason(conflict(Vector("Holder"), Vector.empty, hiddenPipelines = 2, hiddenPanels = 1)) shouldBe
        """still used by pipeline "Holder", 3 you cannot access."""
      InlineSourceCleanup.inUseReason(conflict(Vector.empty, Vector.empty, hiddenPipelines = 1)) shouldBe "still used by 1 you cannot access."
    }
    "bound the number of named referencers" in {
      InlineSourceCleanup.inUseReason(conflict(Vector("A", "B", "C", "D", "E"), Vector.empty)) shouldBe
        """still used by pipeline "A", pipeline "B", pipeline "C", 2 more."""
    }
    "fall back to a generic sentence when nothing is listed" in {
      InlineSourceCleanup.inUseReason(conflict(Vector.empty, Vector.empty)) shouldBe "still in use."
    }
  }

  "InlineSourceCleanup.deleteIfUnreferenced" should {
    "remove an unreferenced source and report its name" in {
      val name = s"unref-${UUID.randomUUID()}"; val id = staticSource(name)
      await(cleanup.deleteIfUnreferenced(id, implicitConnector = false, user, "test")) shouldBe InlineSourceDeleteResult.Removed(Some(name))
      sourceCount(id.value) shouldBe 0
    }
    "keep a referenced source, with UI-safe in-use text naming the visible pipeline" in {
      val name = s"ref-${UUID.randomUUID()}"; val id = staticSource(name)
      await(pipelineService.create(CreatePipelineRequest("Holder", Vector(CreatePipelineRootRequest(Some(id.value)))), user)).isRight shouldBe true
      await(cleanup.deleteIfUnreferenced(id, implicitConnector = false, user, "test")) match {
        case InlineSourceDeleteResult.KeptReferenced(Some(n), reason) => n shouldBe name; reason shouldBe """still used by pipeline "Holder"."""
        case other                                                    => fail(s"expected KeptReferenced, got $other")
      }
      sourceCount(id.value) shouldBe 1
    }
    "report AlreadyGone for a source that does not exist" in {
      await(cleanup.deleteIfUnreferenced(DataSourceId(UUID.randomUUID().toString), implicitConnector = false, user, "test")) shouldBe InlineSourceDeleteResult.AlreadyGone
    }
    "report Failed, never throwing, when the delete itself errors" in {
      val failingRepo = new DataSourceRepository(new DbContext(db, db)) {
        override def delete(id: DataSourceId, u: AuthenticatedUser): Future[Boolean] = Future.failed(new RuntimeException("boom"))
      }
      val failing = new InlineSourceCleanup(
        failingRepo, new DataSourceService(failingRepo, new LocalFileSystem(newTempDir("hel1493-failing"))), connectorRepo)
      val name = s"fail-${UUID.randomUUID()}"; val id = staticSource(name)
      await(failing.deleteIfUnreferenced(id, implicitConnector = false, user, "test")) shouldBe InlineSourceDeleteResult.Failed(Some(name))
      sourceCount(id.value) shouldBe 1
    }
  }

  "the undo mapping" should {
    import PatchSetUndoInlineSources._
    "map Failed to kept with the fixed failure reason, carrying no exception text" in {
      toOutcome("s1", InlineSourceDeleteResult.Failed(Some("n"))) shouldBe
        InlineSourceUndoOutcome("s1", Some("n"), "kept", Some(ReasonFailed))
      ReasonFailed shouldBe "The data source could not be removed."
    }
    "report every journaled source kept with the unavailable reason when no cleanup helper is wired" in {
      val sources = Vector(JournaledInlineSource("a", implicitConnector = false), JournaledInlineSource("b", implicitConnector = true))
      val out = await(PatchSetUndoInlineSources.cleanup(sources, null, user, "test"))
      out.map(o => (o.id, o.result, o.reason)) shouldBe Vector(("a", "kept", Some(ReasonUnavailable)), ("b", "kept", Some(ReasonUnavailable)))
      ReasonUnavailable shouldBe "The data source was not removed: source cleanup is unavailable."
    }
    "undo a real pipeline create through a service with no cleanup wired: pipeline deleted, source kept, status restored" in {
      val (appId, pipelineId) = applyCreate(CreatePipelineRequest(s"nohelper-${UUID.randomUUID()}", Vector(datasetRoot())))
      val sourceId = rootSourceIds(pipelineId).head
      val bare = new PipelineService(pipelineRepo, pipelineStepRepo, dataSourceRepo, outputRepo = outputRepo)
      val noHelperUndo = new PatchSetUndoService(
        panelService, dashboardService, dataSourceService, bare,
        panelRepo, dashboardRepo, dataSourceRepo, pipelineRepo, pipelineStepRepo, applicationRepo, outputRepo)
      val response = await(noHelperUndo.undo(PatchSetApplicationId(appId), user)).fold(e => fail(s"refused: $e"), identity)
      response.edits.head.status shouldBe "restored"
      response.edits.head.inlineSources.map(_.map(o => (o.id, o.result, o.reason))) shouldBe Some(Vector((sourceId, "kept", Some(ReasonUnavailable))))
      sourceCount(sourceId) shouldBe 1
    }
  }
}
