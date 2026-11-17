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
      r.map(x => Root(x.schema, x.fetchError))
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
