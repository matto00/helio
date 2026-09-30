package com.helio.testsupport

import com.helio.domain.model._
import com.helio.domain.steps._
import com.helio.infrastructure.persistence.pipelines._
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.services.pipelines.PipelineRunService
import spray.json.{JsNumber, JsObject}

import java.time.Instant
import java.util.UUID
import scala.concurrent.duration.DurationInt
import scala.concurrent.{Await, ExecutionContext, Future}

/** HEL-1206 fixture builders shared by the provenance specs: real sources -> pipeline (one root per
 *  source) -> steps -> runs/assertions/snapshots, all through the real repositories. */
final class ProvenanceFixtures(
    owner: AuthenticatedUser,
    dataSourceRepo: DataSourceRepository,
    pipelineRepo: PipelineRepository,
    stepRepo: PipelineStepRepository,
    rootRepo: PipelineRootRepository,
    runRepo: PipelineRunRepository,
    snapshotRepo: NodeSnapshotRepository
)(implicit ec: ExecutionContext) {

  private def await[T](f: Future[T]): T = Await.result(f, 10.seconds)

  final case class Built(pipelineId: PipelineId, sources: Vector[DataSource], roots: Vector[PipelineRoot])

  def newSource(name: String): DataSource = {
    val now = Instant.now()
    await(dataSourceRepo.insert(DatasetSource(DataSourceId(UUID.randomUUID().toString), name, owner.id, now, now), owner))
  }

  /** One pipeline with one root per source name, in order (positions 0..n-1). */
  def newPipeline(pipelineName: String, sourceNames: Vector[String]): Built = {
    val sources  = sourceNames.map(newSource)
    val pipeline = await(pipelineRepo.create(pipelineName, sources.map(_.id), owner)).getOrElse(throw new IllegalStateException("pipeline create failed"))
    val pid      = PipelineId(pipeline.id)
    Built(pid, sources, await(rootRepo.listInternal(pid)))
  }

  def filterStep(p: PipelineId, parent: Option[PipelineStepId], root: Option[PipelineRoot] = None): PipelineStep =
    await(stepRepo.insertInternal(p, "filter", FilterConfig("and", Vector.empty), parentStepId = parent, explicitRootId = root.map(_.id)))

  def joinStep(p: PipelineId, parent: PipelineStepId, secondary: SecondaryInput): PipelineStep =
    await(stepRepo.insertInternal(p, "join", JoinConfig(secondary, "k", "inner"), parentStepId = Some(parent), explicitRootId = None))

  def unionStep(p: PipelineId, parent: PipelineStepId, secondary: SecondaryInput): PipelineStep =
    await(stepRepo.insertInternal(p, "union", UnionConfig(secondary, "all"), parentStepId = Some(parent), explicitRootId = None))

  def lookupStep(p: PipelineId, parent: PipelineStepId, secondary: SecondaryInput): PipelineStep =
    await(stepRepo.insertInternal(p, "lookup", LookupConfig(secondary, "k", "k", Vector("v")), parentStepId = Some(parent), explicitRootId = None))

  def assertStep(p: PipelineId, parent: Option[PipelineStepId], root: Option[PipelineRoot] = None): PipelineStep =
    await(stepRepo.insertInternal(p, "assert", AssertConfig(Vector.empty), parentStepId = parent, explicitRootId = root.map(_.id)))

  /** A persisted run (`status`, optional `errorLog`) plus its assertion rows; returns the run id. */
  def run(p: PipelineId, status: String, errorLog: Option[String] = None, assertions: Seq[AssertionResult] = Seq.empty): PipelineRunId = {
    val runId = PipelineRunId(UUID.randomUUID().toString)
    await(runRepo.insertRunInternal(runId, p, Instant.now()))
    await(runRepo.updateRunTerminalInternal(runId, status, Instant.now(), Some(1), errorLog, Some(PipelineRunService.EmptyTruncationJson)))
    if (assertions.nonEmpty) await(runRepo.insertAssertions(runId, assertions))
    runId
  }

  def dryRun(p: PipelineId, assertions: Seq[AssertionResult]): Unit = {
    val runId = PipelineRunId(UUID.randomUUID().toString)
    await(runRepo.insertDryRunInternal(runId, p, Instant.now(), rowCount = 1, truncatedReadsJson = PipelineRunService.EmptyTruncationJson))
    await(runRepo.insertAssertions(runId, assertions))
  }

  def snapshot(p: PipelineId, step: Option[PipelineStepId], root: Option[PipelineRoot], rows: Int): Unit =
    await(snapshotRepo.overwriteRows(p.value, step.map(_.value), (1 to rows).map(i => JsObject("n" -> JsNumber(i))), if (step.isEmpty) root.map(_.id.value) else None))
}
