package com.helio.services.panels

import com.helio.domain.model._
import com.helio.domain.panels.OutputControlSpec
import com.helio.infrastructure.persistence.pipelines.{NodeSnapshotRepository, OutputRepository}
import com.helio.services.ServiceError
import com.helio.services.pipelines.{OutputControlEligibility, OutputFilterCapability}

import scala.concurrent.{ExecutionContext, Future}

/** HEL-1189 design.md D4/D5 — `PanelService.rejectInvalidControls`'s write-time implementation
 *  AND the read-time orphan classification both live here, split into its own file (mirrors
 *  `PanelPatchApplier`'s extraction) to keep `PanelService.scala` inside CONTRIBUTING.md's
 *  file-size budget. Takes only the two dependencies it needs, exactly like
 *  `PanelPatchApplier(panelRepo)`. Not `private[services]` — `PublicDashboardRoutes` (the panel
 *  read path, `com.helio.api.routes.dashboards`) constructs its own instance from the same
 *  nullable-optional `outputRepo`/`nodeSnapshotRepo` convention to compute read-time orphan
 *  status, reusing `isOrphaned` below rather than a second hand-rolled copy of eligibility. */
final class OutputControlsValidator(
    outputRepo: OutputRepository,
    nodeSnapshotRepo: NodeSnapshotRepository
)(implicit ec: ExecutionContext) {

  /** Validates ONLY `controls` entries that are NEW (no matching persisted `id` in
   *  `existingControls`) or whose `column`/`kind` differ from the matching persisted entry —
   *  diffed by `id`. An entry whose `id`/`column`/`kind` are unchanged (only `label`/
   *  `defaultValue` edited, or genuinely untouched, including a currently-orphaned one) is NEVER
   *  re-validated here, regardless of its current eligibility (D5's read-time classification
   *  handles that) — this is what lets an author save an unrelated edit (a different control, the
   *  title, appearance) without an already-orphaned control locking the panel. A `None`
   *  `outputIdOpt` (no output-kind config in play), empty `toValidate`, or a `null` `outputRepo`
   *  (unwired fixture, mirrors this file's other nullable-optional dependencies) all skip the
   *  eligibility check entirely — `PanelService.rejectMissingOutput` already 404s a nonexistent/
   *  cross-user `outputId` before this runs. */
  def reject(
      outputIdOpt: Option[OutputId],
      controls: Vector[OutputControlSpec],
      existingControls: Vector[OutputControlSpec],
      user: AuthenticatedUser
  ): Future[Either[ServiceError, Unit]] = {
    val existingById = existingControls.map(c => c.id -> c).toMap
    val toValidate = controls.filter { c =>
      existingById.get(c.id) match {
        case None            => true
        case Some(persisted) => persisted.kind != c.kind || persisted.column != c.column
      }
    }
    if (toValidate.isEmpty) Future.successful(Right(()))
    else
      outputIdOpt match {
        case None                          => Future.successful(Right(()))
        // A null nodeSnapshotRepo alone does NOT skip this whole check (unlike outputRepo, which
        // is needed to fetch the Output at all) — text/numeric-range/date-range eligibility is
        // pure schema/type-driven and must still run; only controlEligible's `dropdown` branch
        // actually needs nodeSnapshotRepo, and degrades locally there.
        case Some(_) if outputRepo == null => Future.successful(Right(()))
        case Some(outputId) =>
          outputRepo.findByIdOwned(outputId, user).flatMap {
            // rejectMissingOutput (already run first, same panelId/user) 404s this case.
            case None         => Future.successful(Right(()))
            case Some(output) => validateAgainstOutput(output, toValidate)
          }
      }
  }

  /** HEL-1189 design.md D5 — read-time orphan classification: `true` when `control`'s bound
   *  `column` is absent from `output`'s CURRENT declared schema, or present but no longer eligible
   *  for its `kind` per the CURRENT capability contract. Reuses `controlEligible` (the exact same
   *  decision `reject`'s write-time check makes) rather than a second, independently-maintained
   *  copy — "orphaned" is just "not (write-time) eligible right now," evaluated read-only. */
  def isOrphaned(output: Output, control: OutputControlSpec): Future[Boolean] =
    controlEligible(output, control).map(_.isLeft)

  private def validateAgainstOutput(
      output: Output,
      controls: Vector[OutputControlSpec]
  ): Future[Either[ServiceError, Unit]] = {
    def loop(remaining: Vector[OutputControlSpec]): Future[Either[ServiceError, Unit]] =
      remaining.headOption match {
        case None => Future.successful(Right(()))
        case Some(c) =>
          controlEligible(output, c).flatMap {
            case Left(err) => Future.successful(Left(err))
            case Right(_)  => loop(remaining.tail)
          }
      }
    loop(controls)
  }

  /** design.md D3/D4 — the SINGLE decision point for "is `c` currently eligible on `output`,"
   *  delegating the actual rule to `OutputControlEligibility.kindsFor` (never re-derived inline —
   *  evaluation-1.md CR2: this used to hand-roll an equivalent per-kind match, which left `kindsFor`
   *  dead in production and opened a silent-drift gap the C4 guard couldn't see). `resolveOperators`
   *  below still special-cases WHICH operators are worth resolving per kind, purely as a cost
   *  optimization (`Eq`/`In}` are the only cardinality-gated, DB-touching ones, and only `dropdown`
   *  needs them) — the ELIGIBILITY DECISION itself is `kindsFor`'s alone. */
  private def controlEligible(output: Output, c: OutputControlSpec): Future[Either[ServiceError, Unit]] = {
    def reject: Left[ServiceError, Unit] =
      Left(ServiceError.BadRequest(s"control not eligible: column '${c.column}', kind '${c.kind}'"))

    output.schema.find(_.name == c.column).flatMap(f => DataFieldType.fromString(f.`type`)) match {
      case None => Future.successful(reject)
      // A null nodeSnapshotRepo (unwired fixture) skips only the `dropdown` kind's cardinality-
      // gated check, mirroring PanelCapabilityService.rowCountOf's degrade-rather-than-NPE
      // convention — text/numeric-range/date-range below never reach this branch (resolveOperators
      // never calls eqInEligibleColumn for them), so they are unaffected by nodeSnapshotRepo being
      // null.
      case Some(_) if c.kind == "dropdown" && nodeSnapshotRepo == null =>
        Future.successful(Right(()))
      case Some(fieldType) =>
        resolveOperators(output, fieldType, c.column, c.kind).map { operators =>
          if (OutputControlEligibility.kindsFor(c.column, operators, fieldType).contains(c.kind)) Right(())
          else reject
        }
    }
  }

  /** Resolves the operator set `kindsFor` needs for `column`, kept minimal per `kind` for cost
   *  (design.md D3's own cost discipline): `Contains`/`Gte`/`Lte` are purely static
   *  (`OutputFilterCapability.staticOperatorsFor`, zero DB cost) and cover text/numeric-range/
   *  date-range's requirements outright, so `Eq`/`In` are only worth resolving — via the
   *  cardinality-gated `OutputFilterCapability.eqInEligibleColumn`, the same cheap single-column
   *  scan `/rows`'s hot path and `/distinct-values` already use, never the full
   *  O(columns x row-count) `buildContract` scan `/filter-capabilities` pays — when `kind` is
   *  itself `dropdown` (the only kind `KindRequirements` gates on `Eq`+`In`). */
  private def resolveOperators(
      output: Output,
      fieldType: DataFieldType,
      column: String,
      kind: String
  ): Future[Set[OutputFilterCapability.Operator]] = {
    val staticOps = OutputFilterCapability.staticOperatorsFor(fieldType)
    if (kind != "dropdown") Future.successful(staticOps)
    else
      OutputFilterCapability.eqInEligibleColumn(output, nodeSnapshotRepo, column).map {
        case Right(_) => staticOps ++ Set(OutputFilterCapability.Operator.Eq, OutputFilterCapability.Operator.In)
        case Left(_)  => staticOps
      }
  }
}
