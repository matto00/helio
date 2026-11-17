package com.helio.services.panels

import com.helio.services.ServiceError
import com.helio.api.http.RequestValidation
import com.helio.api.protocols.panels.CreatePanelRequest
import com.helio.domain.model._
import com.helio.domain.panels._
import com.helio.services.panels.PanelServiceHelpers._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** Construct + validate a new `Panel` from a `CreatePanelRequest`, split out of `PanelService`. */
private[panels] final class PanelCreateBuilder(
    bindingChecks:           PanelBindingChecks,
    outputControlsValidator: OutputControlsValidator
)(implicit ec: ExecutionContext) {

  import bindingChecks._
  import PanelBindingChecks._

  /** Construct + validate a new `Panel` domain object for `dashboardId` from a
   *  `CreatePanelRequest` — every check `create` performs EXCEPT the
   *  dashboard ACL check (the caller is expected to have already authorized
   *  the target dashboard) and the final `panelRepo.insert` write.
   *
   *  Extracted (HEL-363 D1, behavior-preserving — same validation order, same
   *  error messages as before) so `DashboardContentsService`'s atomic
   *  replace-contents path can validate + build every panel in a batch, with
   *  zero DB writes, before its single transactional write — reusing this
   *  exact config-decode/appearance-resolve/`rejectCompanionBinding` logic
   *  per panel instead of duplicating it. */
  private[services] def buildForCreate(
      dashboardId: DashboardId,
      request: CreatePanelRequest,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, Panel]] =
    run(dashboardId, request, user, PanelCreateBuilder.Binding.Real)

  /** HEL-1638 D3: [[buildForCreate]]'s checks as a dry run for a request whose Output may not exist yet. `Real` is exactly
   *  `buildForCreate`; `Sentinel` (a combined proposal's panel bound to the Output its own pipeline will create) skips the
   *  Output existence check and, per the 0.2 decision, the controls check (`OutputControlsValidator` reads a persisted
   *  Output), which stay apply-only. Writes nothing. */
  private[services] def dryRunForCreate(
      dashboardId: DashboardId,
      request: CreatePanelRequest,
      user: AuthenticatedUser,
      binding: PanelCreateBuilder.Binding
  ): Future[Either[ServiceError, Panel]] = run(dashboardId, request, user, binding)

  /** The pure half: config + appearance resolution (no I/O). */
  private def resolveCreate(request: CreatePanelRequest): Either[ServiceError, (PanelConfigCodec.CreateConfig, PanelAppearance)] =
    (for {
      createConfig <- resolveCreateConfig(request)
      appearance   <- resolveCreateAppearance(request.appearance)
    } yield (createConfig, appearance)).left.map(err => ServiceError.BadRequest(err))

  /** The pure half: construct the panel and run `panel.validateConfig` (no I/O). */
  private def constructPanel(
      dashboardId: DashboardId,
      request: CreatePanelRequest,
      user: AuthenticatedUser,
      createConfig: PanelConfigCodec.CreateConfig,
      appearance: PanelAppearance
  ): Either[ServiceError, Panel] = {
    val now = Instant.now()
    val panel = buildNewPanel(
      id           = PanelId(UUID.randomUUID().toString),
      dashboardId  = dashboardId,
      title        = RequestValidation.normalizePanelTitle(request.title),
      meta         = ResourceMeta(createdBy = user.id.value, createdAt = now, lastUpdated = now),
      appearance   = appearance,
      ownerId      = user.id,
      createConfig = createConfig
    )
    panel.validateConfig.left.map(msg => ServiceError.BadRequest(msg)).map(_ => panel)
  }

  /** The binding half (reads only), in `buildForCreate`'s order. */
  private def run(
      dashboardId: DashboardId,
      request: CreatePanelRequest,
      user: AuthenticatedUser,
      binding: PanelCreateBuilder.Binding
  ): Future[Either[ServiceError, Panel]] =
    resolveCreate(request) match {
      case Left(err) => Future.successful(Left(err))
      case Right((createConfig, appearance)) =>
        val outputCheck =
          if (binding == PanelCreateBuilder.Binding.Real) rejectMissingOutput(outputIdFromCreateConfig(createConfig), user)
          else Future.successful(Right(()))
        outputCheck.flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right(_)  => rejectMissingDataSource(dataSourceIdFromCreateConfig(createConfig), user)
        }.flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right(_) =>
            constructPanel(dashboardId, request, user, createConfig, appearance) match {
              case Left(err) => Future.successful(Left(err))
              case Right(panel) =>
                // HEL-1189 design.md D4: create has no pre-existing persisted controls, so every
                // entry in a new panel's `controls` is "new" and gets validated.
                val controls: Future[Either[ServiceError, Unit]] =
                  if (binding == PanelCreateBuilder.Binding.Sentinel || outputControlsValidator == null) Future.successful(Right(()))
                  else outputControlsValidator.reject(outputIdOf(panel), controlsOf(panel), Vector.empty, user)
                controls.flatMap {
                  case Left(err) => Future.successful(Left(err))
                  case Right(_) =>
                    rejectInconsistentForm(formConfigOf(panel), user).map {
                      case Left(err) => Left(err)
                      case Right(_)  => Right(panel)
                    }
                }
            }
        }
    }

  /** Sequentially `buildForCreate` every request for `dashboardId`, short-
   *  circuiting on the first failure — zero DB writes for ANY item until every
   *  item in `requests` has been validated + constructed (design.md D1/D2).
   *
   *  Extracted so `DashboardContentsService.buildPanels` and `batchCreate`
   *  share one "validate every item before any write" recursion instead of
   *  each hand-rolling its own. `itemLabel` (default: no label) lets a caller
   *  opt into a per-index prefix on a `BadRequest` failure (e.g. `"panel 2
   *  ('Revenue'): ..."`) without changing the unlabeled caller's messages —
   *  `DashboardContentsService` passes the default so its own tested error
   *  messages stay byte-for-byte unchanged; `batchCreate` opts in (design.md
   *  D5) to satisfy this ticket's "400 identifies the offending item" AC.
   *  Only `BadRequest` errors are labeled — every other `ServiceError`
   *  `buildForCreate` can produce passes through unlabeled. */
  private[services] def buildAllForCreate(
      dashboardId: DashboardId,
      requests: Vector[CreatePanelRequest],
      user: AuthenticatedUser,
      itemLabel: Int => Option[String] = _ => None
  ): Future[Either[ServiceError, Vector[Panel]]] = {
    def loop(remaining: Vector[(CreatePanelRequest, Int)], acc: Vector[Panel]): Future[Either[ServiceError, Vector[Panel]]] =
      remaining.headOption match {
        case None => Future.successful(Right(acc))
        case Some((request, idx)) =>
          buildForCreate(dashboardId, request, user).flatMap {
            case Left(ServiceError.BadRequest(msg)) =>
              val labeled = itemLabel(idx).fold(msg)(label => s"$label: $msg")
              Future.successful(Left(ServiceError.BadRequest(labeled)))
            case Left(err)    => Future.successful(Left(err))
            case Right(built) => loop(remaining.tail, acc :+ built)
          }
      }
    loop(requests.zipWithIndex, Vector.empty)
  }
}

private[services] object PanelCreateBuilder {
  /** How a dry run treats the panel's Output binding. */
  sealed trait Binding
  object Binding {
    /** The Output exists (or is not bound): the checks `buildForCreate` makes. */
    case object Real extends Binding
    /** The Output is the one a combined proposal's own pipeline will create: its existence and controls are apply-only. */
    case object Sentinel extends Binding
  }
}
