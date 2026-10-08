package com.helio.services.pipelines

import com.helio.services.ServiceError
import com.helio.api.protocols.pipelines.OutputRowsResponse
import com.helio.domain.model.{AuthenticatedUser, Output, OutputId, Page, PagedResult}
import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputRepository, PipelineRunRepository}
import spray.json.{JsObject, JsValue}

import scala.concurrent.{ExecutionContext, Future}

/** The materialized-row read surface of `OutputService` (`rows`, `filterCapabilities`, `distinctValues`):
 *  reads an Output's own node snapshot behind the same sharing-aware `outputRepo.findById` ACL gate.
 *  Collaborators keep `OutputService`'s nullable-optional wiring (null degrades, never an NPE). */
private[pipelines] final class OutputRowReads(
    outputRepo:       OutputRepository,
    nodeSnapshotRepo: NodeSnapshotRepository,
    pipelineRunRepo:  PipelineRunRepository
)(implicit ec: ExecutionContext) {

  /** `GET /api/outputs/:id/rows` (HEL-906 cycle 7, P1.4's `get_output_rows` dependency):
   *  the Output's own materialized node snapshot (`node_snapshots`, keyed by
   *  `(pipelineId, nodeStepId)` off `output.node`), offset/limit paginated. Gated by
   *  `outputRepo.findById`'s own sharing-aware RLS select (same ACL surface as `GET
   *  /api/outputs/:id`) -- an Output's rows are exactly as visible as the Output itself,
   *  no separate check needed. A missing `nodeSnapshotRepo` (nullable-optional wiring) degrades
   *  to an empty page rather than an NPE, mirroring every other nullable dependency in
   *  `OutputService`.
   *
   *  HEL-1027 design.md D1-D6 — `sort`/`filter` are resolved against THIS Output's OWN `schema`
   *  (`OutputRowsQuery`, task 3.1) BEFORE `listRowsPaged` is ever called, so a non-eligible column
   *  is rejected as `400` (D3) without touching the ACL-bypassing repository call at all -- the
   *  `outputRepo.findById` ACL gate above remains the only access check either way (task 3.3). */
  def rows(
      id: OutputId,
      page: Page,
      user: AuthenticatedUser,
      sort: Option[OutputRowsQuery.SortParam] = None,
      filter: Option[OutputRowsQuery.FilterParam] = None
  ): Future[Either[ServiceError, OutputRowsResponse]] =
    outputRepo.findById(id, user).flatMap {
      case None => Future.successful(Left(ServiceError.NotFound("Output not found")))
      case Some(_) if nodeSnapshotRepo == null =>
        Future.successful(Right(OutputRowsResponse(Vector.empty, 0, page.offset, page.limit, materialized = false)))
      case Some(output) =>
        OutputRowsQuery.resolveSort(output.schema, sort) match {
          case Left(err) => Future.successful(Left(err))
          case Right(resolvedSort) =>
            // HEL-1188 design.md D3: `resolveFilter` is now `Future`-returning (the `eq`/`in`
            // on-demand cardinality check needs `nodeSnapshotRepo`) -- `resolveSort` above stays
            // synchronous, unaffected.
            OutputRowsQuery.resolveFilter(output, filter, nodeSnapshotRepo).flatMap {
              case Left(err) => Future.successful(Left(err))
              case Right(resolvedFilter) =>
                nodeSnapshotRepo
                  .listRowsPaged(
                    output.node.pipelineId.value,
                    output.node.stepId.map(_.value),
                    page,
                    explicitRootId = output.node.rootId.map(_.value),
                    sort = resolvedSort,
                    filter = resolvedFilter
                  )
                  .flatMap { paged =>
                    for {
                      materialized <- materializedFor(output, paged, filterActive = resolvedFilter.isDefined)
                      metric       <- OutputFilteredMetric.compute(output, resolvedFilter, page.offset, outputRepo, nodeSnapshotRepo)
                    } yield Right(OutputRowsResponse(paged.items.map(identity[JsValue]), paged.total, paged.offset, paged.limit, materialized = materialized, metric = metric))
                  }
            }
        }
    }

  /** `GET /api/outputs/:id/filter-capabilities` (HEL-1188 design.md D1/D5) — same ACL surface as
   *  `rows` above (`outputRepo.findById`'s sharing-aware select); the per-column operator contract
   *  itself is `OutputFilterCapability.buildContract`'s job, not this method's. A missing
   *  `nodeSnapshotRepo` (nullable-optional wiring, mirroring every other such fixture in `OutputService.scala`)
   *  degrades to an empty contract rather than an NPE. */
  def filterCapabilities(id: OutputId, user: AuthenticatedUser): Future[Either[ServiceError, OutputFilterCapability.FilterCapabilityContract]] =
    outputRepo.findById(id, user).flatMap {
      case None => Future.successful(Left(ServiceError.NotFound("Output not found")))
      case Some(_) if nodeSnapshotRepo == null =>
        Future.successful(Right(OutputFilterCapability.FilterCapabilityContract(Vector.empty)))
      case Some(output) =>
        OutputFilterCapability.buildContract(output, nodeSnapshotRepo).map(Right(_))
    }

  /** `GET /api/outputs/:id/distinct-values?column=` (HEL-1188 design.md D4) — same ACL surface as
   *  `rows`/`filterCapabilities` above. Gated on the SAME `eqInEligibleColumn` check
   *  `resolveFilter`'s `eq`/`in` branch uses (design.md D2's "the contract and the rows endpoint
   *  can't drift" guarantee, extended to this third surface) -- never a fourth, hand-copied
   *  eligibility check. */
  def distinctValues(id: OutputId, user: AuthenticatedUser, column: String): Future[Either[ServiceError, Vector[(String, Int)]]] =
    outputRepo.findById(id, user).flatMap {
      case None => Future.successful(Left(ServiceError.NotFound("Output not found")))
      case Some(_) if nodeSnapshotRepo == null =>
        Future.successful(Left(ServiceError.BadRequest(s"column not eq/in-eligible: '$column'")))
      case Some(output) =>
        OutputFilterCapability.eqInEligibleColumn(output, nodeSnapshotRepo, column).flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right(()) =>
            nodeSnapshotRepo
              .topDistinctValues(
                output.node.pipelineId.value,
                output.node.stepId.map(_.value),
                output.node.rootId.map(_.value),
                column,
                OutputFilterCapability.MaxDropdownCardinality
              )
              .map(Right(_))
        }
    }

  /** HEL-1027 design.md D5 amendment (task 3.4) — decouples the "does this node have ANY raw
   *  data at all" signal from `paged.total`, which now can mean "count under the current filter"
   *  (D5). Unfiltered requests keep TODAY'S exact `paged.total > 0` check (zero added cost, the
   *  overwhelmingly common case); a filtered request that legitimately matches zero rows of an
   *  Output that has real data must NOT fall into the "never materialized" branch just because
   *  the filter happened to exclude every row (D5's own worked example: two Outputs sharing the
   *  same `node_snapshots` data could otherwise report DIFFERENT `materialized` values purely as
   *  an artifact of one having a filter and the other not). */
  private def materializedFor(output: Output, paged: PagedResult[JsObject], filterActive: Boolean): Future[Boolean] = {
    val rawExistsFuture: Future[Boolean] =
      if (!filterActive) Future.successful(paged.total > 0)
      else nodeSnapshotRepo.hasAnyRow(output.node.pipelineId.value, output.node.stepId.map(_.value), output.node.rootId.map(_.value))

    rawExistsFuture.flatMap { rawExists =>
      if (rawExists) Future.successful(true)
      else if (pipelineRunRepo == null) Future.successful(true)
      else pipelineRunRepo.latestSuccessfulCompletedAtInternal(output.node.pipelineId).map { lastSuccess =>
        lastSuccess.exists(t => !t.isBefore(output.createdAt))
      }
    }
  }
}
