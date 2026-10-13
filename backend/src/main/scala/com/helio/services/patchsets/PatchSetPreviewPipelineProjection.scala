package com.helio.services.patchsets

import com.helio.services.ServiceError
import com.helio.services.pipelines.OutputService
import com.helio.api.protocols.pipelines.{CreatePipelineRequest, CreatePipelineRootRequest, PipelineRootSummaryResponse, PipelineSummaryResponse, UpdateOutputRequest, UpdatePipelineRequest}
import com.helio.domain.model._
import com.helio.infrastructure.persistence.pipelines.PipelineRepository.PipelineSummary
import PatchSetApplyServiceJson._
import spray.json._

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** Pure after-state projections for pipeline and output edits, split out of `PatchSetPreviewProjection`
 *  (HEL-1498; behaviour-preserving). See that object for the shared contract. */
private[patchsets] object PatchSetPreviewPipelineProjection {

  /** HEL-1239: after-state of an Output update -- `name` replaced, `config` shallow-merged and its `fieldMapping` validated EXACTLY as `OutputService.update`
   *  does (shared `OutputService.mergeConfig`/`validateConfig`), so a preview of an invalid
   *  patch 400s like the apply would. `updatedAt` stays at `prior`'s value (design.md D3's
   *  timestamp exclusion, same as every other update projection). */
  private[patchsets] def outputUpdateAfter(
      request: UpdateOutputRequest,
      prior: Output,
      priorConfig: JsObject
  ): Either[ServiceError, (JsValue, Output, JsObject)] = {
    val merged = request.config.map(patch => OutputService.mergeConfig(priorConfig, patch))
    request.config.map(patch => OutputService.validateConfig(prior.kind, patch, priorConfig)).getOrElse(Right(())).map { _ =>
      val updated = prior.copy(name = request.name.getOrElse(prior.name))
      val config  = merged.getOrElse(priorConfig)
      (outputResponseFormat.write(outputResponseFrom(updated, config)), updated, config)
    }
  }

  /** Mirrors `PipelineService.updateName`'s blank-name check
   *  (`PipelineService.updateName`, design.md D1/D1a) before the trivial
   *  rename `.copy`. */
  private[patchsets] def pipelineRenameAfter(request: UpdatePipelineRequest, prior: PipelineSummary): Either[ServiceError, (JsValue, PipelineSummary)] =
    if (request.name.trim.isEmpty) Left(ServiceError.BadRequest("name must not be empty"))
    else {
      val updated = prior.copy(name = request.name.trim)
      Right((pipelineSummaryResponseFormat.write(toPipelineSummaryResponse(updated)), updated))
    }

  /** Trivial field-echo of the decoded `CreatePipelineRequest` (design.md
   *  D3) -- `sourceDataSourceName` needs one genuine extra READ (a read, not
   *  a write) since the request only carries the source's id, not its name;
   *  `outputDataTypeId`/`id` are the `"(pending)"` sentinel, nothing exists
   *  yet. */
  private[patchsets] def pipelineCreateAfter(
      request: CreatePipelineRequest,
      user: AuthenticatedUser,
      ctx: PatchSetApplyContext,
      overlay: PatchSetPreviewOverlay
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, Option[JsValue]]] = {
    // HEL-913 task 7.6: `roots` replaces the scalar `sourceDataSourceId` -- resolves EVERY
    // root's DataSource (never just the first) so the preview's `roots[]` echoes what the real
    // create would actually produce, not a single-root approximation.
    // (id, name) pairs -- an inline root (task 7.1a: `sourceId` absent, `type` present) has no
    // real DataSource to look up yet, so it echoes the PENDING sentinel id and the request's own
    // `name`, exactly like the pipeline id itself below (nothing exists until the real apply
    // runs `pipelineService.create`, which re-validates every root, inline branch included).
    def loop(remaining: List[CreatePipelineRootRequest], acc: Vector[(String, String)]): Future[Either[ServiceError, Vector[(String, String)]]] =
      remaining match {
        case Nil => Future.successful(Right(acc))
        case root :: rest =>
          root.sourceId.map(_.trim) match {
            case Some(sid) if sid.isEmpty =>
              Future.successful(Left(ServiceError.BadRequest("roots: sourceId is required and must not be blank")))
            case Some(sid) if overlay.isRemoved("dataSource", sid) =>
              Future.successful(Left(ServiceError.NotFound(s"data source not found: $sid")))
            case Some(sid) =>
              ctx.dataSourceRepo.findByIdOwned(DataSourceId(sid), user).flatMap {
                case None     => Future.successful(Left(ServiceError.NotFound(s"data source not found: $sid")))
                case Some(ds) => loop(rest, acc :+ ((ds.id.value, ds.name)))
              }
            case None =>
              loop(rest, acc :+ ((PatchSetPreviewProjection.PendingId, root.name.getOrElse("(pending)"))))
          }
      }
    if (request.roots.isEmpty)
      Future.successful(Left(ServiceError.BadRequest("roots must be a non-empty array")))
    else
      loop(request.roots.toList, Vector.empty).map {
        case Left(err) => Left(err)
        case Right(sources) =>
          // HEL-1022 (adversarial review finding 3): `createdAt`/`updatedAt` must not silently
          // default to `""` -- nothing is persisted yet (this is a preview), so "now" is the
          // honest value for what applying this create edit would produce this instant, exactly
          // like `PipelineRepository.create`/`createAction`'s own `now.toString` for a real
          // create. An empty string reached `PipelineListTable`'s `formatRelativeTime("")` as
          // "NaN years ago" -- latent (this construction site's caller is a preview projection,
          // not the list endpoint itself), but this response shape is otherwise contractually
          // "always non-empty" (`pipeline-list-api` spec), so this site must honor that too.
          val now = Instant.now().toString
          Right(Some(pipelineSummaryResponseFormat.write(PipelineSummaryResponse(
            id                   = PatchSetPreviewProjection.PendingId,
            name                 = request.name.trim,
            roots                = sources.map { case (id, name) => PipelineRootSummaryResponse(PatchSetPreviewProjection.PendingId, id, name) },
            lastRunStatus        = None,
            lastRunAt            = None,
            lastRunRowCount      = None,
            ownerId              = Some(user.id.value),
            tag                  = request.tag,
            createdAt            = now,
            updatedAt            = now
          ))))
      }
  }

  /** Trivial field-echo -- `PatchSetPipelineResolvers.pipelineSummaryResponse`
   *  is `private` to that object, not `private[services]`, so this mirrors
   *  its 1:1 field mapping rather than reaching across the object boundary. */
  private[patchsets] def toPipelineSummaryResponse(s: PipelineSummary): PipelineSummaryResponse =
    PipelineSummaryResponse(
      id                   = s.id,
      name                 = s.name,
      roots                = s.roots.map(r => PipelineRootSummaryResponse(r.id, r.dataSourceId, r.dataSourceName)),
      lastRunStatus        = s.lastRunStatus,
      lastRunAt            = s.lastRunAt,
      lastRunRowCount      = s.lastRunRowCount,
      ownerId              = if (s.ownerId.nonEmpty) Some(s.ownerId) else None,
      tag                  = s.tag,
      createdAt            = s.createdAt,
      updatedAt            = s.updatedAt
    )
}
