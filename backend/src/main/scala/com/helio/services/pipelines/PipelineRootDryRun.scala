package com.helio.services.pipelines

import com.helio.services.ServiceError
import com.helio.services.ratelimit.SourceFetchBudget
import com.helio.services.sources.{DataSourceService, SourceService}
import com.helio.api.protocols.sources.{CreateSourceRequest, RestApiConfigPayload, SqlCreateSourceRequest, SqlSourceConfigPayload, StaticDataPayload, StaticDataSourceRequest}
import com.helio.domain.engine.SchemaField
import com.helio.domain.model.{AuthenticatedUser, DataSourceId, DataSourceKind}
import com.helio.infrastructure.persistence.sources.DataSourceRepository

import scala.concurrent.{ExecutionContext, Future}

/** HEL-1638: one root's schema as apply would persist it, for the propose-time dry run. Shared by the pipeline proposal
 *  path (`PipelineProposalService`) and the patch-set pipeline-create resolver, each of which maps its own root type to a
 *  [[PipelineRootDryRun.Spec]]; the inline create checks and the (budgeted) live schema fetch are the same functions
 *  `createStatic`/`createSql`/`createRest` call, so the dry run cannot drift from apply. `sourceService` may be null
 *  (no SourceService wired): an inline rest/sql root then fails like apply's own "unavailable" guard. */
private[services] final class PipelineRootDryRun(
    dataSourceRepo: DataSourceRepository,
    sourceService: SourceService,
    sourceFetchBudget: SourceFetchBudget
)(implicit ec: ExecutionContext) {
  import PipelineRootDryRun._

  /** `address` prefixes this root's own messages (`roots[0]`); `notFound` and `inlineCsv` are the caller's messages for those
   *  two cases (the proposal and the transactional create word them differently). `chargeFetches` false skips the C12
   *  budget (apply-time re-runs: the propose that preceded them was charged). */
  def rootSchema(spec: Spec, address: String, user: AuthenticatedUser, chargeFetches: Boolean, notFound: String, inlineCsv: ServiceError): Future[Either[ServiceError, Root]] = {
    val beforeFetch: () => Either[ServiceError, Unit] = () => if (chargeFetches) sourceFetchBudget.charge(user) else Right(())
    def inline(r: Either[ServiceError, SourceService.InlineDryRunSchema]): Either[ServiceError, Root] =
      r.map(x => Root(x.schema, x.fetchError.map(capFetchError)))
    spec match {
      case Spec.Existing(id) =>
        dataSourceRepo.findByIdOwned(DataSourceId(id), user).map {
          case None     => Left(ServiceError.NotFound(notFound))
          case Some(ds) => Right(Root(ds.inferredSchema))
        }
      case Spec.Csv => Future.successful(Left(inlineCsv))
      case Spec.Static(name, cfg) =>
        Future.successful(
          DataSourceService.validateStatic(StaticDataSourceRequest(name, DataSourceKind.Dataset, cfg.columns, cfg.rows), DataSourceService.DatasetMaxRows)
            .map(checked => Root(checked.fields))
        )
      case Spec.Sql(name, cfg) =>
        if (sourceService == null) Future.successful(Left(unavailable))
        else sourceService.dryRunSqlSchema(SqlCreateSourceRequest(name, DataSourceKind.Sql, cfg), user, beforeFetch).map(inline)
      case Spec.Rest(name, cfg) =>
        if (sourceService == null) Future.successful(Left(unavailable))
        else sourceService.dryRunRestSchema(CreateSourceRequest(name, DataSourceKind.RestApi, cfg, fieldOverrides = None), user, beforeFetch).map(inline)
      case Spec.Invalid(err) => Future.successful(Left(err))
    }
  }
}

private[services] object PipelineRootDryRun {

  /** One root's schema as apply would persist it; `fetchError` is set when an inline rest/sql fetch failed (apply keeps the
   *  source with an empty schema). */
  final case class Root(schema: Vector[SchemaField], fetchError: Option[String] = None)

  /** HEL-1727: the most code points of a failed fetch's remote error text a rejection (and so the assistant's `is_error` tool
   *  result) carries. 500 matches `HomeSummaryLimits.ErrorLogMax`: it keeps an HTTP status plus the useful head of a JSON
   *  error body, while a large or hostile response cannot grow the tool result or the model's context. */
  val FetchErrorMaxCodePoints: Int = 500

  private val FetchErrorTruncationMarker = " … [truncated]"

  /** Cuts `error` to [[FetchErrorMaxCodePoints]] code points plus a visible marker. Counted by code point (never splitting a
   *  surrogate pair); the `codePointCount` guard comes first because `offsetByCodePoints` throws when fewer code points
   *  exist than asked for, even when `length` exceeds the limit. */
  def capFetchError(error: String): String =
    if (error.codePointCount(0, error.length) <= FetchErrorMaxCodePoints) error
    else error.substring(0, error.offsetByCodePoints(0, FetchErrorMaxCodePoints)) + FetchErrorTruncationMarker

  sealed trait Spec
  object Spec {
    final case class Existing(id: String) extends Spec
    case object Csv extends Spec
    final case class Static(name: String, config: StaticDataPayload) extends Spec
    final case class Sql(name: String, config: SqlSourceConfigPayload) extends Spec
    final case class Rest(name: String, config: RestApiConfigPayload) extends Spec
    final case class Invalid(error: ServiceError) extends Spec
  }

  private val unavailable: ServiceError = ServiceError.InternalError("Inline root sources are unavailable (no SourceService/DataSourceService configured)")
}
