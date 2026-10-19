package com.helio.testsupport

import com.helio.domain.engine.PipelineRowJson.Row
import com.helio.domain.engine.{InProcessExecutionBackend, InProcessPipelineEngine, NodeKey, PipelineExecutionOutcome, SourceReadStats}
import com.helio.domain.model._
import com.helio.domain.steps._
import com.helio.infrastructure.persistence.pipelines.PipelineStepRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.LocalFileSystem

import java.lang.management.ManagementFactory
import java.nio.file.Paths
import java.time.Instant
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.util.Try

/** HEL-1660: drives the one production entry every run, the saved preview and a backfill share, `InProcessExecutionBackend.execute`,
 *  over in-memory frames. A source is a `DatasetSource` whose name is a key into `frames`; the engine's loader is replaced, so every
 *  other engine path (the tree walk, the context, every step) is the production one. */
trait RunBackendFixture {

  protected implicit val fixtureEc: ExecutionContext = ExecutionContext.global

  protected val fixtureNow: Instant    = Instant.now()
  protected val fixturePid: PipelineId = PipelineId("p")
  protected val fixtureOwner: UserId   = UserId("00000000-0000-0000-0000-000000000001")
  protected val RootName               = "root"

  protected val fixturePipeline: Pipeline = Pipeline(fixturePid, "pipe", None, None, fixtureNow, fixtureNow, fixtureOwner)

  protected def source(name: String): DatasetSource = DatasetSource(DataSourceId(name), name, fixtureOwner, fixtureNow, fixtureNow)

  protected def repoOver(frames: Map[String, Seq[Row]]): DataSourceRepository = new DataSourceRepository(null) {
    override def findByIdInternal(id: DataSourceId): Future[Option[DataSource]] =
      Future.successful(frames.get(id.value).map(_ => source(id.value)))
  }

  protected def engineOver(frames: Map[String, Seq[Row]]): InProcessPipelineEngine =
    new InProcessPipelineEngine(new LocalFileSystem(Paths.get("/"))) {
      override def loadRowsWithStats(ds: DataSource, dataSourceRepo: DataSourceRepository): Future[(Seq[Row], SourceReadStats)] =
        Future.successful((frames(ds.name), SourceReadStats(truncated = false, availableRowCount = None)))
    }

  /** One run of `steps` over the single root `root` (and any other named frame a join/union/lookup source reads). */
  protected def runOver(frames: Map[String, Seq[Row]], steps: Vector[PipelineStep], retain: Set[NodeKey] = Set.empty): Future[PipelineExecutionOutcome] =
    new InProcessExecutionBackend(engineOver(frames), new PipelineStepRepository(null))
      .execute(fixturePipeline, Vector((RootName, source(RootName))), steps, repoOver(frames), new AssertionSink, new TruncationSink, retain)

  protected def awaitRun[A](f: Future[A]): Try[A] = Try(Await.result(f, 180.seconds))

  protected def usedHeapAfterGcMb(): Long = {
    System.gc(); Thread.sleep(50); System.gc()
    ManagementFactory.getMemoryMXBean.getHeapMemoryUsage.getUsed / 1048576
  }

  protected def sid(id: String): PipelineStepId = PipelineStepId(id)
  private def parentOf(parent: Option[String]): Option[PipelineStepId] = parent.map(PipelineStepId(_))

  protected def computeStep(id: String, column: String, expression: String, parent: Option[String] = None, position: Int = 0): PipelineStep =
    ComputeStep(sid(id), fixturePid, position, ComputeConfig(column, expression, None), fixtureNow, fixtureNow, parentOf(parent))

  protected def joinStep(id: String, secondary: SecondaryInput, parent: Option[String] = None, joinType: String = "inner"): PipelineStep =
    JoinStep(sid(id), fixturePid, 0, JoinConfig(secondary, "k", joinType), fixtureNow, fixtureNow, parentOf(parent))

  protected def unpivotStep(id: String, valueVars: Int, parent: Option[String] = None, position: Int = 0): PipelineStep =
    UnpivotStep(sid(id), fixturePid, position, UnpivotConfig(Vector("id"), Vector.tabulate(valueVars)(i => s"v$i"), "var", "val"), fixtureNow, fixtureNow, parentOf(parent))

  protected def splitStep(id: String, parent: Option[String] = None): PipelineStep =
    SplitTextStep(sid(id), fixturePid, 0, SplitTextConfig("body", "paragraph"), fixtureNow, fixtureNow, parentOf(parent))

  protected def chunkStep(id: String, parent: Option[String] = None): PipelineStep =
    ChunkByTokenCountStep(sid(id), fixturePid, 0, ChunkByTokenCountConfig("body", targetTokenCount = 1), fixtureNow, fixtureNow, parentOf(parent))

  protected def headingsStep(id: String, parent: Option[String] = None): PipelineStep =
    ExtractHeadingsStep(sid(id), fixturePid, 0, ExtractHeadingsConfig("body"), fixtureNow, fixtureNow, parentOf(parent))

  protected def unionStep(id: String, laneStepId: String, parent: Option[String] = None, position: Int = 0): PipelineStep =
    UnionStep(sid(id), fixturePid, position, UnionConfig(SecondaryInput.Lane(laneStepId), "byPosition"), fixtureNow, fixtureNow, parentOf(parent))

  protected def pivotStep(id: String, parent: Option[String] = None): PipelineStep =
    PivotStep(sid(id), fixturePid, 0, PivotConfig(Vector("side"), "pad", "i", "first"), fixtureNow, fixtureNow, parentOf(parent))
}
