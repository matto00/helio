package com.helio.infrastructure.persistence.pipelines

import com.helio.infrastructure.persistence.DbContext
import com.helio.api.protocols.pipelines.PipelineStepConfigCodec
import com.helio.domain._
import com.helio.domain.model._
import com.helio.domain.engine.InvalidGraph
import slick.jdbc.PostgresProfile.api._
import PipelineRepository.instantColumnType

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Failure, Success}

/** Persistence layer for `pipeline_steps`.
 *
 *  The on-disk shape (`id, pipeline_id, position, op, config, enabled,
 *  created_at, updated_at` — config stored as JSON text) is unchanged except
 *  for `enabled` (HEL-412, V86, `NOT NULL DEFAULT true`). CS2c-3a moves the
 *  typed-ADT dispatch into `rowToDomain` / `domainToRow`: the repo speaks
 *  [[PipelineStep]] sealed-trait values across its public API, and reads /
 *  writes the typed `*Config` via [[PipelineStepConfigCodec]].
 *
 *  HEL-265 CS2: every public method takes the caller identity and JOINs to
 *  `pipelines.owner_id` so the parent pipeline's ACL gates access. Steps
 *  inherit ACL from their parent pipeline; there is no separate `owner_id`
 *  column on `pipeline_steps`. */
class PipelineStepRepository(ctx: DbContext)(implicit ec: ExecutionContext) {

  import PipelineStepRepository._

  private val stepsTable     = TableQuery[PipelineStepTable]
  private val pipelinesTable = TableQuery[PipelineRepository.PipelineTable]

  /** Owner-scoped list. Returns empty vector when the parent pipeline does not
    * exist or is owned by someone else. */
  def listByPipeline(pipelineId: PipelineId, user: AuthenticatedUser): Future[Vector[PipelineStep]] = {
    val ownerUuid = UUID.fromString(user.id.value)
    val query = for {
      step     <- stepsTable if step.pipelineId === pipelineId.value
      pipeline <- pipelinesTable if pipeline.id === step.pipelineId && pipeline.ownerId === ownerUuid
    } yield step
    ctx.withUserContext(user.id.value)(query.result).map(rows => executionOrder(rows.toVector.map(rowToDomain)))
  }

  /** Owner-scoped findById via the parent-pipeline JOIN. */
  def findById(id: PipelineStepId, user: AuthenticatedUser): Future[Option[PipelineStep]] = {
    val ownerUuid = UUID.fromString(user.id.value)
    val query = for {
      step     <- stepsTable if step.id === id.value
      pipeline <- pipelinesTable if pipeline.id === step.pipelineId && pipeline.ownerId === ownerUuid
    } yield step
    ctx.withUserContext(user.id.value)(query.result.headOption).map(_.map(rowToDomain))
  }

  /** Insert a new ROOT step into the pipeline in user context.
    *
    * HEL-949: deliberately root-only -- it has no `parentStepId` parameter and
    * cannot chain. To build a trunk/tail step under an existing step, use
    * `insertInternal(..., parentStepId = Some(...))` instead. This method was
    * previously named `insert`, which read as "add the next step" and caused
    * every test written on that assumption to silently exercise a
    * parallel-root topology instead of the chained one it intended.
    *
    * Gated by the caller having proven pipeline ownership at the service layer;
    * the repo itself only writes — the parent pipeline FK guards against the
    * pipeline disappearing mid-call.
    *
    * The V35 RLS policy on `pipeline_steps` uses an EXISTS subquery to
    * `pipelines.owner_id`. Running inside `withUserContext` means the policy
    * evaluates correctly: the new step is only insertable if the parent pipeline
    * is owned by the caller. */
  def insertRootStep(pipelineId: PipelineId, kind: String, config: Any, user: AuthenticatedUser, enabled: Boolean = true): Future[PipelineStep] = {
    val now = Instant.now()
    val configJson = encodeConfig(kind, config)
    val action = for {
      // HEL-904 cycle-8 (round-5 skeptic non-blocking note): scoped to root
      // siblings (`parentStepId.isEmpty`), not a whole-pipeline max -- this
      // method never sets `parentStepId`, so every row it creates is a root
      // sibling; scoping the max here keeps it from silently colliding with
      // (or being skewed by) a non-root step's position once any caller of
      // insertInternal/spliceInsertAtInternal has created one. Zero live
      // callers today (test-only); scoped anyway, per the "loaded gun"
      // finding, rather than left as a second whole-pipeline writer.
      maxPos   <- stepsTable.filter(s => s.pipelineId === pipelineId.value && s.parentStepId.isEmpty).map(_.position).max.result
      position  = maxPos.map(_ + 1).getOrElse(0)
      id        = UUID.randomUUID().toString
      row       = PipelineStepRow(id, pipelineId.value, position, kind, configJson, enabled, now, now)
      _        <- stepsTable += row
    } yield rowToDomain(row)
    ctx.withUserContext(user.id.value)(action.transactionally)
  }

  /** Owner-scoped partial update. Returns `None` if the step does not exist or
    * the caller does not own the parent pipeline. Cross-type PATCH is rejected
    * at the service boundary; here `kind` stays whatever the persisted row
    * carries. */
  def update(
      id: PipelineStepId,
      config: Option[Any],
      position: Option[Int],
      user: AuthenticatedUser,
      enabled: Option[Boolean] = None
  ): Future[Option[PipelineStep]] = {
    val now       = Instant.now()
    val ownerUuid = UUID.fromString(user.id.value)
    val ownedQuery = for {
      step     <- stepsTable if step.id === id.value
      pipeline <- pipelinesTable if pipeline.id === step.pipelineId && pipeline.ownerId === ownerUuid
    } yield step
    val action = for {
      existing <- ownedQuery.result.headOption
      updated  <- existing match {
        case None      => DBIO.successful(None)
        case Some(row) =>
          val newConfig = config match {
            case Some(cfg) => encodeConfig(row.op, cfg)
            case None      => row.config
          }
          positionScopedUpdateAction(row, newConfig, position, enabled, now).map(r => Some(rowToDomain(r)))
      }
    } yield updated
    ctx.withUserContext(user.id.value)(action.transactionally)
  }

  /** Owner-scoped delete via the parent-pipeline JOIN. Returns `true` only if
    * a step the caller owned was removed.
    *
    * Both the ownership check and the DELETE run inside a single
    * `withUserContext` transaction so the V35 RLS policy on `pipeline_steps`
    * (EXISTS subquery to `pipelines.owner_id`) is active throughout. */
  def delete(id: PipelineStepId, user: AuthenticatedUser): Future[Boolean] = {
    val ownerUuid = UUID.fromString(user.id.value)
    val ownedQuery = for {
      step     <- stepsTable if step.id === id.value
      pipeline <- pipelinesTable if pipeline.id === step.pipelineId && pipeline.ownerId === ownerUuid
    } yield step.id
    val action = ownedQuery.result.headOption.flatMap {
      case None      => DBIO.successful(false)
      case Some(sid) => stepsTable.filter(_.id === sid).delete.map(_ > 0)
    }
    ctx.withUserContext(user.id.value)(action.transactionally)
  }

  // ── Internal (ACL-bypassing) variants for post-access-check callers ───────
  //
  // These methods drop the owner-JOIN predicate and run under withSystemContext
  // (helio_privileged BYPASSRLS). They are called ONLY after PipelineService has
  // confirmed that the caller holds a sharing grant via findByIdShared. An editor
  // grantee is not the pipeline owner, so the owner-JOIN in the non-internal
  // variants would silently return no rows.
  //
  // Every callsite MUST have a comment explaining why ACL bypass is safe.

  /** ACL-bypassing list. Safe to call only after the caller's pipeline access
    * has been confirmed by PipelineService via findByIdShared.
    *
    * HEL-904 follow-on ruling (2026-08-31): ordering is derived from the
    * `parent_step_id` chain via [[executionOrder]] -- the trunk in order,
    * with each node's tail branches emitted immediately after it -- NOT
    * from a global `position` sort. `position` is a sibling-scoped
    * tiebreaker only (see `reorderInternal`); after the trunk/tail
    * position-renumbering fix, every trunk step's `position` is
    * constantly `0`, so a naive `.sortBy(_.position)` here would leave run
    * order undefined for every multi-step pipeline with more than one
    * trunk step. See design.md's trunk/tail decision. */
  def listByPipelineInternal(pipelineId: PipelineId): Future[Vector[PipelineStep]] =
    ctx.withSystemContext(
      stepsTable.filter(_.pipelineId === pipelineId.value).result
    ).map(rows => executionOrder(rows.toVector.map(rowToDomain)))

  /** ACL-bypassing step lookup. Safe to call only after pipeline access
    * has been confirmed by PipelineService via findByIdShared. */
  def findByIdInternal(id: PipelineStepId): Future[Option[PipelineStep]] =
    ctx.withSystemContext(
      stepsTable.filter(_.id === id.value).result.headOption
    ).map(_.map(rowToDomain))

  /** ACL-bypassing insert. Safe to call only after the caller's editor or
    * owner access has been confirmed by PipelineService via findByIdShared.
    *
    * HEL-904 task 1.6 (DB-backed remainder): `position` is scoped to
    * siblings sharing `parentStepId` (`None` = root), not the whole
    * pipeline -- appends after the highest-positioned existing sibling in
    * that same group. No PRODUCTION caller passes a non-`None`
    * `parentStepId` yet (P1.2 wires branch creation); the default
    * preserves today's flat/root-appended behavior exactly. HEL-949's test
    * tree now calls this with an explicit `parentStepId` to build real
    * trunks -- "no live caller" above means no production route, not "this
    * parameter goes untested." */
  def insertInternal(
      pipelineId: PipelineId,
      kind: String,
      config: Any,
      enabled: Boolean = true,
      parentStepId: Option[PipelineStepId] = None
  ): Future[PipelineStep] =
    ctx.withSystemContext(insertInternalAction(pipelineId, kind, config, enabled, parentStepId).transactionally)

  /** DBIO variant of `insertInternal` above -- extracted (HEL-906 task 3.1, coordinator ruling
   *  D3) so `PipelineService`'s single-call transactional pipeline-creation path can compose
   *  this step insert into the SAME database transaction as the pipeline row and every other
   *  step/Output insert, via `PipelineRepository.runTransactionally`, rather than each insert
   *  opening and committing its own transaction. Public (not `private`) for that cross-repository
   *  composition; still only safe to call after the caller's editor-or-owner pipeline access has
   *  been confirmed, exactly like `insertInternal`. */
  def insertInternalAction(
      pipelineId: PipelineId,
      kind: String,
      config: Any,
      enabled: Boolean = true,
      parentStepId: Option[PipelineStepId] = None
  ): DBIO[PipelineStep] = {
    val now        = Instant.now()
    val configJson = encodeConfig(kind, config)
    for {
      maxPos   <- siblingsQuery(pipelineId, parentStepId).map(_.position).max.result
      position  = maxPos.map(_ + 1).getOrElse(0)
      id        = UUID.randomUUID().toString
      row       = PipelineStepRow(id, pipelineId.value, position, kind, configJson, enabled, now, now, parentStepId.map(_.value))
      _        <- stepsTable += row
    } yield rowToDomain(row)
  }

  /** ACL-bypassing update. Safe to call only after the caller's editor or
    * owner access has been confirmed by PipelineService via findByIdShared.
    *
    * HEL-904 cycle-8 fix (round-5 skeptic Finding 2 -- ESCALATION-CLASS,
    * resolved by the coordinator per this ticket's binding position-
    * renumbering ruling): `position` on this API is the SAME sibling-scoped
    * tiebreaker every other writer in this file now uses, not a whole-
    * pipeline index. A raw, unscoped write of the requested `position`
    * value was reproduced silently severing a real 20-step migrated trunk
    * (writing a non-zero `position` on a mid-trunk step broke `trunkOf`'s
    * exact `position == 0` match, reclassifying the rest of the trunk as
    * one giant tail -- and silently changing the node key
    * `PipelineRunService.trunkOf(steps).lastOption` writes run results
    * under). The write is now re-scoped via [[positionScopedUpdateAction]]:
    * a requested `position` moves the step to that (clamped) index WITHIN
    * its own existing sibling group only, by construction never producing
    * two position-0 children at one node, exactly like `reorderInternal`. */
  def updateInternal(
      id: PipelineStepId,
      config: Option[Any],
      position: Option[Int],
      enabled: Option[Boolean] = None
  ): Future[Option[PipelineStep]] = {
    val now = Instant.now()
    val action = for {
      existing <- stepsTable.filter(_.id === id.value).result.headOption
      updated  <- existing match {
        case None      => DBIO.successful(None)
        case Some(row) =>
          val newConfig = config match {
            case Some(cfg) => encodeConfig(row.op, cfg)
            case None      => row.config
          }
          positionScopedUpdateAction(row, newConfig, position, enabled, now).map(r => Some(rowToDomain(r)))
      }
    } yield updated
    ctx.withSystemContext(action.transactionally)
  }

  /** Shared position-scoped update body for [[update]]/[[updateInternal]]
    * (HEL-904 cycle-8, round-5 skeptic Finding 2). When `position` is
    * `None`, this is a plain in-place field update (config/enabled/
    * updatedAt), same as before. When `position` is `Some(requested)`, the
    * requested value is treated as a target index WITHIN `row`'s own
    * existing sibling group (siblings sharing `row.parentStepId`), clamped
    * to `[0, siblingCount]`, and the group is renumbered `0..k-1` around the
    * moved step -- the identical sibling-scoped idiom [[reorderInternal]]
    * and [[insertAtInternal]] already use. This can never produce two
    * position-0 children at one node: the moved step and every other
    * sibling are always assigned distinct indices from one contiguous
    * `zipWithIndex` pass over the same group. */
  private def positionScopedUpdateAction(
      row: PipelineStepRow,
      newConfig: String,
      position: Option[Int],
      enabled: Option[Boolean],
      now: Instant
  ) = {
    position match {
      case None =>
        val newRow = row.copy(config = newConfig, enabled = enabled.getOrElse(row.enabled), updatedAt = now)
        stepsTable.filter(_.id === row.id).update(newRow).map(_ => newRow)
      case Some(requested) =>
        val siblingsQ = siblingsQuery(PipelineId(row.pipelineId), row.parentStepId.map(PipelineStepId(_)))
        for {
          siblings <- siblingsQ.sortBy(_.position).result
          others    = siblings.toVector.filterNot(_.id == row.id)
          clamped   = requested.max(0).min(others.size)
          moved     = row.copy(config = newConfig, enabled = enabled.getOrElse(row.enabled), updatedAt = now)
          withMoved = others.patch(clamped, Vector(moved), 0)
          updates   = withMoved.zipWithIndex.map {
            case (r, i) if r.id == row.id => stepsTable.filter(_.id === r.id).update(r.copy(position = i))
            case (r, i)                   => stepsTable.filter(_.id === r.id).map(s => (s.position, s.updatedAt)).update((i, now))
          }
          _ <- DBIO.sequence(updates)
        } yield moved.copy(position = clamped)
    }
  }

  /** ACL-bypassing insert-at-index (HEL-410). Safe to call only after the
    * caller's editor or owner access has been confirmed by PipelineService via
    * findByIdShared, and after the service has validated `0 <= index <= count`
    * against a freshly-read sibling count. Builds the full target order — the
    * SIBLING group's existing steps sorted by position (HEL-904 task 1.6:
    * scoped to `parentStepId`, not the whole pipeline), with the new row
    * spliced in at `index` — and renumbers every sibling's position 0..n
    * within a single transaction (the `reorderInternal` idiom above). Other
    * sibling groups (other branches) are untouched. This also heals any
    * pre-existing position gaps left by deleteStep (HEL-407 finding) within
    * that same sibling group as a side effect. Returns the created step,
    * whose final position is `index`. */
  def insertAtInternal(
      pipelineId: PipelineId,
      kind: String,
      config: Any,
      index: Int,
      enabled: Boolean = true,
      parentStepId: Option[PipelineStepId] = None
  ): Future[PipelineStep] = {
    val now        = Instant.now()
    val configJson = encodeConfig(kind, config)
    val newId      = UUID.randomUUID().toString
    val newRow     = PipelineStepRow(newId, pipelineId.value, index, kind, configJson, enabled, now, now, parentStepId.map(_.value))
    val action = for {
      existing <- siblingsQuery(pipelineId, parentStepId).sortBy(_.position).result
      ordered   = existing.toVector.patch(index, Vector(newRow), 0)
      updates   = ordered.zipWithIndex.map {
        case (row, i) if row.id == newId => stepsTable += row.copy(position = i)
        case (row, i)                    => stepsTable.filter(_.id === row.id).map(s => (s.position, s.updatedAt)).update((i, now))
      }
      _        <- DBIO.sequence(updates)
    } yield rowToDomain(newRow.copy(position = index))
    ctx.withSystemContext(action.transactionally)
  }

  /** ACL-bypassing splice-insert (HEL-904 cycle-7 fix, round-4 skeptic Finding
    * 1; ordering corrected cycle-8, round-5 skeptic Finding 1): inserts a
    * new step as the sole child of `parentStepId` (`None` = pipeline root),
    * RE-PARENTING **every** step that currently is a direct child of
    * `parentStepId` -- both the old position-0 trunk continuation AND any
    * position!=0 tail roots -- onto the new step, preserving each
    * reparented child's own `position` value (so their relative order among
    * themselves, and the position-0-is-trunk invariant, is unchanged; only
    * their common parent moves one hop down). This is the "insert directly
    * after this node" primitive `duplicateStep` and `persistNewStep`'s
    * whole-pipeline `position` index both actually need.
    *
    * `insertAtInternal` (sibling-scoped renumber, no re-parenting) is NOT
    * sufficient for this: calling it with `parentStepId = Some(anchor.id)`,
    * `index = 0` would renumber anchor's existing position-0 child (the old
    * trunk continuation) down to position 1, which `executionOrder` treats
    * as a TAIL emitted BEFORE the new step's own walk -- inverting the
    * entire remaining trunk to appear ahead of the just-inserted step.
    *
    * Round-4's fix reparented only the position-0 occupant (if any), which
    * is correct for a pure trunk anchor but wrong the moment the anchor
    * ALSO has one or more tail children (e.g. a V94-migrated aggregate
    * tail): those tails were left as direct children of the anchor, so
    * `executionOrder`'s `node +: (tails ++ trunkChild.walk)` emitted them
    * BEFORE the newly-inserted trunk continuation -- reproduced on 3 real
    * migrated pipelines (round-5 report). Reparenting ALL of the anchor's
    * existing children (not just the position-0 one) onto the new step
    * fixes this: the anchor now has exactly one child (the new step), and
    * the new step inherits everything the anchor used to own downstream
    * (both its old trunk continuation and its old tails), so those tails
    * are correctly emitted immediately after the new step rather than
    * immediately after the anchor.
    *
    * Returns the freshly `SELECT`-ed, actually-persisted row (not an echo
    * of the request), so callers never report a `position` the row does
    * not have. Safe to call only after the caller's editor or owner access
    * has been confirmed by PipelineService via findByIdShared. */
  def spliceInsertAtInternal(
      pipelineId:   PipelineId,
      kind:         String,
      config:       Any,
      parentStepId: Option[PipelineStepId],
      enabled:      Boolean = true
  ): Future[PipelineStep] = {
    val now        = Instant.now()
    val configJson = encodeConfig(kind, config)
    val newId      = UUID.randomUUID().toString
    val newRow     = PipelineStepRow(newId, pipelineId.value, 0, kind, configJson, enabled, now, now, parentStepId.map(_.value))
    val action = for {
      // Read every existing direct child of the anchor (trunk continuation
      // AND tails) BEFORE inserting, then insert the new row FIRST and
      // re-parent all of them onto it SECOND -- the FK on `parent_step_id`
      // referencing `pipeline_steps.id` would otherwise be violated by
      // pointing a child at a not-yet-existing `newId`.
      existingChildren <- siblingsQuery(pipelineId, parentStepId).result
      _                 <- stepsTable += newRow
      _                 <- if (existingChildren.nonEmpty)
                             DBIO.sequence(existingChildren.map { child =>
                               stepsTable.filter(_.id === child.id)
                                 .map(s => (s.parentStepId, s.updatedAt))
                                 .update((Some(newId), now))
                             })
                           else DBIO.successful(Seq.empty[Int])
      persisted         <- stepsTable.filter(_.id === newId).result.head
    } yield rowToDomain(persisted)
    ctx.withSystemContext(action.transactionally)
  }

  /** ACL-bypassing branch-attach (HEL-908): inserts a new step as a genuine NEW sibling of
    * `parentStepId`'s existing children -- a `position >= 1` tail root -- WITHOUT touching any
    * of them. This is the counterpart to [[spliceInsertAtInternal]] above, which inserts
    * directly after the anchor and REPARENTS every one of the anchor's existing children onto
    * the new step (a trunk-insert-deeper primitive). Neither is a substitute for the other:
    * splicing an anchor that already has a trunk continuation makes the new step the trunk
    * continuation (reparenting the old one one hop down); attaching makes the new step an
    * entirely separate branch, leaving the anchor's existing trunk continuation (and any other
    * tails) exactly where they were.
    *
    * Implementation is the sibling-scoped append idiom every other writer in this file uses
    * ([[siblingsQuery]] + max-position-then-append, same shape as [[insertInternal]]), with ONE
    * deliberate deviation from [[insertInternalAction]]: the computed position is floored at `1`
    * UNCONDITIONALLY, regardless of whether the anchor already has children. When the anchor
    * already has a `position == 0` trunk child, the new row lands at `max(existingMax + 1, 1)`
    * -- by [[tailsOf]]/[[executionOrder]]'s own `position != 0` rule, that is exactly what makes
    * it a tail rather than the trunk. When the anchor has NO children yet (the common case --
    * attaching a tail off the pipeline's current LAST/leaf trunk step), the new row STILL lands
    * at `position == 1`, not `position == 0`: this primitive's entire contract is "attach a tail",
    * and a leaf anchor is not an exception to that contract -- it is the modal case. (Evaluation-1
    * cycle-2 CR1: the earlier `position == 0` leaf fallback silently spliced the new step into the
    * trunk 100% of the time for the common leaf-anchor case, corrupting every downstream trunk
    * step and the pipeline's persisted run output. Fixed here at the primitive so every caller --
    * UI and route alike -- gets a real tail without having to branch on leaf-vs-non-leaf itself.)
    * `position == 0` is deliberately left EMPTY at the anchor in the leaf case; nothing back-fills
    * it, so the anchor's trunk simply ends there until a genuine trunk-continuation insert
    * ([[spliceInsertAtInternal]]) is used.
    *
    * `parentStepId` is a non-`Option` `PipelineStepId` (evaluation-1 cycle-2 non-blocking
    * suggestion): a `None` here would append at the root sibling group, a shape the "tail"
    * concept has no meaning for -- `PipelineService` only ever calls this from its
    * `parentStepId`-present branch, so the type now says so rather than leaving a `None` case
    * every caller has to reason was never actually reachable.
    *
    * Safe to call only after the caller's editor or owner access has been confirmed by
    * PipelineService via findByIdShared, exactly like every other `*Internal` method here. */
  def attachTailInternal(
      pipelineId:   PipelineId,
      kind:         String,
      config:       Any,
      parentStepId: PipelineStepId,
      enabled:      Boolean = true
  ): Future[PipelineStep] =
    ctx.withSystemContext(attachTailInternalAction(pipelineId, kind, config, parentStepId, enabled).transactionally)

  /** DBIO body of [[attachTailInternal]] above -- extracted so route/service-level tests can
    * compose it into a larger transaction if ever needed, matching the `*InternalAction` idiom
    * already used by [[insertInternalAction]]. */
  private def attachTailInternalAction(
      pipelineId:   PipelineId,
      kind:         String,
      config:       Any,
      parentStepId: PipelineStepId,
      enabled:      Boolean
  ): DBIO[PipelineStep] = {
    val now        = Instant.now()
    val configJson = encodeConfig(kind, config)
    for {
      maxPos   <- siblingsQuery(pipelineId, Some(parentStepId)).map(_.position).max.result
      position  = maxPos.map(_ + 1).getOrElse(1).max(1)
      id        = UUID.randomUUID().toString
      row       = PipelineStepRow(id, pipelineId.value, position, kind, configJson, enabled, now, now, Some(parentStepId.value))
      _        <- stepsTable += row
    } yield rowToDomain(row)
  }

  /** ACL-bypassing atomic reorder (HEL-407). Safe to call only after the
    * caller's editor or owner access has been confirmed by PipelineService
    * via findByIdShared, and after the service has confirmed `orderedIds` is
    * exactly a permutation of the pipeline's current step ids.
    *
    * HEL-904 follow-on ruling (2026-08-31): renumbers `position` WITHIN
    * each existing SIBLING group only, never across the whole pipeline --
    * `orderedIds` is grouped by each id's EXISTING `parentStepId` (read
    * fresh from the DB, never trusted from the caller), and within each
    * group the ids are renumbered `0..k-1` in the relative order they
    * appear in `orderedIds`. This never touches `parentStepId` itself, so
    * the position-0 = trunk-continuation invariant is preserved BY
    * CONSTRUCTION: a step can only ever be renumbered relative to its own
    * siblings, never promoted/demoted across a different parent's group.
    * (Before this fix, `orderedIds.zipWithIndex` set a single global
    * `0..N-1` index across the WHOLE pipeline regardless of sibling
    * grouping, which would silently re-break the trunk/tail invariant the
    * first time any user reordered steps.) Returns the pipeline's full step
    * set in [[executionOrder]] (trunk/tail structural order), not a
    * position sort. */
  def reorderInternal(pipelineId: PipelineId, orderedIds: Seq[PipelineStepId]): Future[Vector[PipelineStep]] = {
    val now = Instant.now()
    val idValues = orderedIds.map(_.value)
    val action = for {
      existingRows <- stepsTable.filter(_.id.inSet(idValues)).map(s => (s.id, s.parentStepId)).result
      parentById    = existingRows.toMap
      groups        = orderedIds.groupBy(id => parentById.getOrElse(id.value, None: Option[String]))
      updates       = groups.values.flatMap { group =>
                         group.zipWithIndex.map { case (id, index) =>
                           stepsTable.filter(_.id === id.value).map(s => (s.position, s.updatedAt)).update((index, now))
                         }
                       }
      _    <- DBIO.sequence(updates.toSeq)
      rows <- stepsTable.filter(_.pipelineId === pipelineId.value).result
    } yield executionOrder(rows.toVector.map(rowToDomain))
    ctx.withSystemContext(action.transactionally)
  }

  /** ACL-bypassing trunk-to-trunk reorder (HEL-908, design.md decision 15 / non-goal waiver #2).
    * Safe to call only after the caller's editor or owner access has been confirmed by
    * PipelineService via findByIdShared, and after the service has validated `orderedTrunkIds`
    * against [[PipelineService]]'s own trunk-only permutation contract (see Decision 15) --
    * this method itself re-derives and re-validates the trunk from a FRESH read rather than
    * trusting the caller's earlier snapshot, so a race between the service's check and this
    * call cannot silently corrupt structure.
    *
    * Unlike [[reorderInternal]] (sibling-scoped `position` renumber, a no-op for a pure trunk
    * since every trunk step has a distinct parent), this RELINKS the `parentStepId` chain
    * itself: `orderedTrunkIds(0).parentStepId` becomes `None` (the new trunk root),
    * `orderedTrunkIds(i).parentStepId` becomes `orderedTrunkIds(i - 1)` for `i > 0`, and every
    * trunk node's `position` is written as `0` (a trunk node is always the position-0 / trunk-
    * continuation child of its new parent, by `trunkOf`/`executionOrder`'s own definition).
    *
    * Per the human's ruling ("the tail FOLLOWS ITS TRUNK STEP"): a tail's own `parentStepId`
    * already references its trunk node's id, not a position/slot, and ids never change here --
    * so no tail row is read or written by this method. A moved trunk node's tail travels with
    * it automatically (the tail still points at the same node id, wherever that node's own
    * `parentStepId`/`position` now point); the node that ends up occupying the moved node's old
    * position in the trunk array does NOT inherit that tail, because the tail was never
    * attached to a "slot" -- only ever to the node's id.
    *
    * Returns `Left(error message)` (never partially applies a rejected request) when
    * `orderedTrunkIds` is not exactly a permutation of the pipeline's CURRENT trunk ids -- any
    * tail id present, any trunk id missing, or any duplicate. */
  def reorderTrunkInternal(pipelineId: PipelineId, orderedTrunkIds: Seq[PipelineStepId]): Future[Either[String, Vector[PipelineStep]]] = {
    val now = Instant.now()
    val action = for {
      rows          <- stepsTable.filter(_.pipelineId === pipelineId.value).result
      steps          = rows.toVector.map(rowToDomain)
      currentTrunk   = trunkOf(steps).map(_.id)
      validation     = validateTrunkReorderRequest(currentTrunk, orderedTrunkIds)
      result        <- validation match {
        case Left(err) => DBIO.successful(Left(err): Either[String, Vector[PipelineStep]])
        case Right(())  =>
          val updates = orderedTrunkIds.zipWithIndex.map { case (id, idx) =>
            val newParent: Option[String] = if (idx == 0) None else Some(orderedTrunkIds(idx - 1).value)
            stepsTable.filter(_.id === id.value).map(s => (s.parentStepId, s.position, s.updatedAt)).update((newParent, 0, now))
          }
          for {
            _         <- DBIO.sequence(updates)
            finalRows <- stepsTable.filter(_.pipelineId === pipelineId.value).result
          } yield Right(executionOrder(finalRows.toVector.map(rowToDomain))): Either[String, Vector[PipelineStep]]
      }
    } yield result
    ctx.withSystemContext(action.transactionally)
  }

  /** Pure validation for [[reorderTrunkInternal]]'s request-shape contract (design.md decision
    * 15): `requested` must be exactly a permutation of `currentTrunk` -- same length, same set,
    * no duplicates. Named per-violation messages so a rejected request is diagnosable by the
    * caller, not a generic "invalid" 422. */
  private def validateTrunkReorderRequest(
      currentTrunk: Vector[PipelineStepId],
      requested: Seq[PipelineStepId]
  ): Either[String, Unit] = {
    val currentSet   = currentTrunk.toSet
    val requestedSet = requested.toSet
    if (requested.size != requestedSet.size)
      Left("orderedTrunkIds must not contain duplicate step ids")
    else if (requestedSet != currentSet) {
      val missing = currentSet -- requestedSet
      val extra   = requestedSet -- currentSet
      val parts = Vector(
        if (missing.nonEmpty) Some(s"missing trunk step ids: ${missing.map(_.value).mkString(", ")}") else None,
        if (extra.nonEmpty) Some(s"unexpected step ids (tail ids are not accepted here, only current trunk ids): ${extra.map(_.value).mkString(", ")}") else None
      ).flatten
      Left(s"orderedTrunkIds must be exactly the pipeline's current trunk step ids: ${parts.mkString("; ")}")
    } else Right(())
  }

  /** ACL-bypassing delete, with splice-on-delete (HEL-904 task 1.6/1.7): safe
    * to call only after the caller's editor or owner access has been
    * confirmed by PipelineService via findByIdShared.
    *
    * Per ticket.md's repository semantics (`parent_step_id` has NO `ON
    * DELETE CASCADE` -- deletion splices instead): deleting a step
    * re-parents its position-0 child (if any) into the deleted step's own
    * `parentStepId`/`position` slot, so the trunk stays connected. Every
    * OTHER child is the root of a "tail" -- both it and its full descendant
    * subtree are deleted outright (a tail has no splice target of its own).
    * Any Outputs attached to a removed tail node are cascade-deleted by
    * `outputs.node_step_id ON DELETE CASCADE` once the step row itself is
    * gone.
    *
    * Returns `None` if the step does not exist, otherwise
    * `Some(removedPlacementCount)` -- the count of steps deleted from tail
    * subtrees (NOT counting the target step itself), so a future caller
    * (P1.3) can warn the user how much was removed. The sole current live
    * caller (`PipelineService.deleteStep`) only needs the `Option`'s
    * presence to know whether the step existed; it does not consume the
    * count yet. */
  def deleteInternal(id: PipelineStepId): Future[Option[Int]] = {
    val action = for {
      existing <- stepsTable.filter(_.id === id.value).result.headOption
      result   <- existing match {
        case None => DBIO.successful(None)
        case Some(deletedRow) =>
          for {
            allRows        <- stepsTable.filter(_.pipelineId === deletedRow.pipelineId).map(s => (s.id, s.parentStepId)).result
            childrenSorted <- stepsTable.filter(_.parentStepId === deletedRow.id).sortBy(_.position).map(_.id).result
            headChildOpt    = childrenSorted.headOption
            tailRootIds     = childrenSorted.drop(1)
            parentByChild   = allRows.toMap
            tailDescendantIds = tailRootIds.flatMap(rootId => descendantIdsOf(rootId, parentByChild)).toSet
            _ <- headChildOpt match {
              case Some(headChildId) =>
                stepsTable
                  .filter(_.id === headChildId)
                  .map(s => (s.parentStepId, s.position))
                  .update((deletedRow.parentStepId, deletedRow.position))
              case None => DBIO.successful(0)
            }
            _ <- if (tailDescendantIds.nonEmpty) stepsTable.filter(_.id.inSet(tailDescendantIds)).delete
                 else DBIO.successful(0)
            _ <- stepsTable.filter(_.id === deletedRow.id).delete
          } yield Some(tailDescendantIds.size)
      }
    } yield result
    ctx.withSystemContext(action.transactionally)
  }

  /** Every id in the subtree rooted at `rootId` (inclusive), walked via the
    * `(id -> parentStepId)` map of a pipeline's full step set. Pure — no DB
    * access. Used by `deleteInternal`'s splice-on-delete to find every step
    * a removed tail must take with it. */
  private def descendantIdsOf(rootId: String, parentById: Map[String, Option[String]]): Vector[String] = {
    val childrenOf = parentById.toVector.collect { case (childId, Some(p)) if p == rootId => childId }
    rootId +: childrenOf.flatMap(c => descendantIdsOf(c, parentById))
  }

  /** Query for the sibling group sharing `parentStepId` (`None` = root)
    * within `pipelineId`. HEL-904 task 1.6: `position` is scoped to this
    * group, not the whole pipeline. */
  private def siblingsQuery(pipelineId: PipelineId, parentStepId: Option[PipelineStepId]) =
    parentStepId match {
      case Some(pid) => stepsTable.filter(s => s.pipelineId === pipelineId.value && s.parentStepId === pid.value)
      case None      => stepsTable.filter(s => s.pipelineId === pipelineId.value && s.parentStepId.isEmpty)
    }


  // ── Tree-ordered reads (HEL-904 task 1.6) ─────────────────────────────────
  //
  // Pure functions over an already-fetched Vector[PipelineStep], walking
  // `parentStepId` links (added additively in task 1.2). Every real row
  // today decodes with `parentStepId = None` (the DB column lands in the
  // V94 migration, task 2.2's backfill) — until that backfill runs, every
  // step is a root-level sibling and `trunkOf` degrades to today's flat
  // position-sorted list, which is intentional: these reads must be safe to
  // call before the migration exists. Once V94 backfills `parent_step_id`
  // from `position`, every pre-existing pipeline becomes a pure trunk (one
  // root child chained by `parentStepId`) and `trunkOf` walks it exactly as
  // `list` does today. Only *new* branches created after P1.2's engine
  // tree-walk ships produce a step with siblings or a non-trunk tail.

  /** The pipeline's trunk: starting from the position-0 root child (`parentStepId
    * = None`), follow the position-0 child at each level. Returns steps in
    * root-to-leaf order. A pipeline with no steps returns an empty Vector.
    *
    * HEL-904 binding ruling (2026-08-31): this walk requires an EXACT
    * `position == 0` match at each level, not merely "the lowest-position
    * child" (`headOption` on `childrenOf`'s ascending sort, which this used
    * to be). The two differ exactly when a node's ONLY child is a
    * migration-created tail (position >= 1, forced by V94's migration DML)
    * and it has no genuine trunk continuation -- `headOption` would
    * wrongly treat that sole, non-zero-position child as "the lowest" and
    * incorrectly extend the trunk into what is actually a tail. Requiring
    * `position == 0` exactly is what "a node with no position-0 child ends
    * the trunk" (the spec's stated rule) actually means. */
  def trunkOf(steps: Vector[PipelineStep]): Vector[PipelineStep] = {
    def loop(parent: Option[PipelineStepId], acc: Vector[PipelineStep]): Vector[PipelineStep] =
      childrenOf(steps, parent).find(_.position == 0) match {
        case Some(next) => loop(Some(next.id), acc :+ next)
        case None       => acc
      }
    loop(None, Vector.empty)
  }

  /** Direct children of `parent` (`None` = root), sorted by `position`
    * ascending (sibling order). */
  def childrenOf(steps: Vector[PipelineStep], parent: Option[PipelineStepId]): Vector[PipelineStep] =
    steps.filter(_.parentStepId == parent).sortBy(_.position)

  /** Every branch other than the trunk: for each node, every child whose
    * `position != 0` roots its own tail, expanded depth-first. Returns one
    * Vector per tail root, each in root-to-leaf order (mirrors `trunkOf`'s
    * shape for a branch).
    *
    * HEL-904 binding ruling (2026-08-31): filters on `position != 0`
    * explicitly, rather than `drop(1)` on the ascending-sorted sibling list
    * (this used to be `childrenOf(...).drop(1)`, dropping only the lowest-
    * position child). The two differ exactly when a node's ONLY child is a
    * migration-created tail root (position >= 1, no genuine position-0
    * sibling) -- `drop(1)` on a single-element list drops it entirely,
    * silently losing that tail; `filter(_.position != 0)` correctly keeps
    * it, matching `trunkOf`'s companion fix (exact `position == 0`, not
    * "lowest position", decides trunk-vs-tail). */
  def tailsOf(steps: Vector[PipelineStep]): Vector[Vector[PipelineStep]] = {
    def expand(root: PipelineStep): Vector[PipelineStep] = {
      def loop(current: PipelineStep, acc: Vector[PipelineStep]): Vector[PipelineStep] =
        childrenOf(steps, Some(current.id)).headOption match {
          case Some(next) => loop(next, acc :+ next)
          case None       => acc
        }
      loop(root, Vector(root))
    }

    val allParents = steps.map(_.parentStepId).distinct
    allParents.flatMap { parent =>
      childrenOf(steps, parent).filter(_.position != 0).map(expand)
    }
  }

  /** Whole-pipeline execution order (HEL-904 follow-on binding ruling,
    * 2026-08-31): derived from the `parent_step_id` chain, NOT from a
    * global `position` sort. The trunk's steps appear in order; each
    * node's own tail branches (its `position != 0` children, each fully
    * expanded depth-first) are emitted immediately after that node and
    * before the trunk continues past it. `position` is a sibling-scoped
    * tiebreaker only -- meaningful among children of the same parent, never
    * as a whole-pipeline ordering key (see `reorderInternal`).
    *
    * `PipelineStepRepository.listByPipelineInternal` (consumed by
    * `PipelineRunService` and `PipelineService` for both run execution and
    * step listing/reordering) and the owner-scoped `listByPipeline` both
    * return this order. Any root-level tail branches (children of the
    * virtual root, i.e. `parentStepId = None`, other than the single
    * trunk-starting step) are appended at the very end -- real migrated
    * data never produces these (every pipeline has exactly one root child),
    * but the case is handled defensively rather than silently dropped.
    *
    * HEL-930 fix: a node (including the virtual root) with TWO OR MORE
    * `position == 0` children is the same `InvalidGraph` arm-1 violation
    * [[com.helio.domain.engine.InProcessPipelineEngine.validateGraph]] already
    * rejects before a run -- this method used to resolve it via `.find`,
    * silently keeping the first match and dropping every other position-0
    * sibling (and its whole subtree) from the returned Vector with no error
    * at all. That silent-drop shape is exactly what this scaladoc's previous
    * wording incorrectly claimed didn't exist ("handled defensively rather
    * than silently dropped") -- it did exist, right here, for this one shape.
    * Fixed by raising [[InvalidGraph]] the moment more than one position-0
    * child is found at any node, so a malformed graph now fails loudly
    * instead of quietly executing with a step missing. */
  def executionOrder(steps: Vector[PipelineStep]): Vector[PipelineStep] = {
    def expandBranch(root: PipelineStep): Vector[PipelineStep] =
      root +: childrenOf(steps, Some(root.id)).flatMap(expandBranch)

    // HEL-930: raises InvalidGraph instead of `.find`'s silent first-match
    // whenever a node has more than one position-0 child -- `nodeLabel` is
    // only used to build that error's message.
    def trunkChildOf(nodeLabel: => String, children: Vector[PipelineStep]): Option[PipelineStep] = {
      val trunkChildren = children.filter(_.position == 0)
      if (trunkChildren.size > 1)
        throw InvalidGraph(s"InvalidGraph: node $nodeLabel has ${trunkChildren.size} children at position 0")
      trunkChildren.headOption
    }

    def walk(node: PipelineStep): Vector[PipelineStep] = {
      val children    = childrenOf(steps, Some(node.id))
      val tails       = children.filter(_.position != 0).flatMap(expandBranch)
      val trunkChild  = trunkChildOf(node.id.value, children)
      node +: (tails ++ trunkChild.toVector.flatMap(walk))
    }

    val rootChildren = childrenOf(steps, None)
    val rootTrunk     = trunkChildOf("root", rootChildren)
    val rootTails      = rootChildren.filter(_.position != 0).flatMap(expandBranch)
    rootTrunk.toVector.flatMap(walk) ++ rootTails
  }

  private def rowToDomain(row: PipelineStepRow): PipelineStep = {
    val stepId = PipelineStepId(row.id)
    val pid    = PipelineId(row.pipelineId)
    PipelineStepConfigCodec.decode(row.op, row.config) match {
      case Success(cfg: RenameConfig)    => RenameStep(stepId, pid, row.position, cfg, row.createdAt, row.updatedAt, parentStepId = row.parentStepId.map(PipelineStepId(_)), enabled = row.enabled)
      case Success(cfg: FilterConfig)    => FilterStep(stepId, pid, row.position, cfg, row.createdAt, row.updatedAt, parentStepId = row.parentStepId.map(PipelineStepId(_)), enabled = row.enabled)
      case Success(cfg: JoinConfig)      => JoinStep(stepId, pid, row.position, cfg, row.createdAt, row.updatedAt, parentStepId = row.parentStepId.map(PipelineStepId(_)), enabled = row.enabled)
      case Success(cfg: ComputeConfig)   => ComputeStep(stepId, pid, row.position, cfg, row.createdAt, row.updatedAt, parentStepId = row.parentStepId.map(PipelineStepId(_)), enabled = row.enabled)
      case Success(cfg: GroupByConfig)   => GroupByStep(stepId, pid, row.position, cfg, row.createdAt, row.updatedAt, parentStepId = row.parentStepId.map(PipelineStepId(_)), enabled = row.enabled)
      case Success(cfg: CastConfig)      => CastStep(stepId, pid, row.position, cfg, row.createdAt, row.updatedAt, parentStepId = row.parentStepId.map(PipelineStepId(_)), enabled = row.enabled)
      case Success(cfg: SelectConfig)    => SelectStep(stepId, pid, row.position, cfg, row.createdAt, row.updatedAt, parentStepId = row.parentStepId.map(PipelineStepId(_)), enabled = row.enabled)
      case Success(cfg: LimitConfig)     => LimitStep(stepId, pid, row.position, cfg, row.createdAt, row.updatedAt, parentStepId = row.parentStepId.map(PipelineStepId(_)), enabled = row.enabled)
      case Success(cfg: SortConfig)      => SortStep(stepId, pid, row.position, cfg, row.createdAt, row.updatedAt, parentStepId = row.parentStepId.map(PipelineStepId(_)), enabled = row.enabled)
      case Success(cfg: AggregateConfig) => AggregateStep(stepId, pid, row.position, cfg, row.createdAt, row.updatedAt, parentStepId = row.parentStepId.map(PipelineStepId(_)), enabled = row.enabled)
      case Success(cfg: SplitTextConfig) => SplitTextStep(stepId, pid, row.position, cfg, row.createdAt, row.updatedAt, parentStepId = row.parentStepId.map(PipelineStepId(_)), enabled = row.enabled)
      case Success(cfg: ExtractHeadingsConfig) => ExtractHeadingsStep(stepId, pid, row.position, cfg, row.createdAt, row.updatedAt, parentStepId = row.parentStepId.map(PipelineStepId(_)), enabled = row.enabled)
      case Success(cfg: ChunkByTokenCountConfig) => ChunkByTokenCountStep(stepId, pid, row.position, cfg, row.createdAt, row.updatedAt, parentStepId = row.parentStepId.map(PipelineStepId(_)), enabled = row.enabled)
      case Success(cfg: DateBucketConfig) => DateBucketStep(stepId, pid, row.position, cfg, row.createdAt, row.updatedAt, parentStepId = row.parentStepId.map(PipelineStepId(_)), enabled = row.enabled)
      case Success(cfg: PivotConfig) => PivotStep(stepId, pid, row.position, cfg, row.createdAt, row.updatedAt, parentStepId = row.parentStepId.map(PipelineStepId(_)), enabled = row.enabled)
      case Success(cfg: WindowConfig) => WindowStep(stepId, pid, row.position, cfg, row.createdAt, row.updatedAt, parentStepId = row.parentStepId.map(PipelineStepId(_)), enabled = row.enabled)
      case Success(cfg: UnpivotConfig) => UnpivotStep(stepId, pid, row.position, cfg, row.createdAt, row.updatedAt, parentStepId = row.parentStepId.map(PipelineStepId(_)), enabled = row.enabled)
      case Success(cfg: DedupeConfig) => DedupeStep(stepId, pid, row.position, cfg, row.createdAt, row.updatedAt, parentStepId = row.parentStepId.map(PipelineStepId(_)), enabled = row.enabled)
      case Success(cfg: FillNullConfig) => FillNullStep(stepId, pid, row.position, cfg, row.createdAt, row.updatedAt, parentStepId = row.parentStepId.map(PipelineStepId(_)), enabled = row.enabled)
      case Success(cfg: StringOpsConfig) => StringOpsStep(stepId, pid, row.position, cfg, row.createdAt, row.updatedAt, parentStepId = row.parentStepId.map(PipelineStepId(_)), enabled = row.enabled)
      case Success(cfg: UnionConfig) => UnionStep(stepId, pid, row.position, cfg, row.createdAt, row.updatedAt, parentStepId = row.parentStepId.map(PipelineStepId(_)), enabled = row.enabled)
      case Success(cfg: LookupConfig) => LookupStep(stepId, pid, row.position, cfg, row.createdAt, row.updatedAt, parentStepId = row.parentStepId.map(PipelineStepId(_)), enabled = row.enabled)
      case Success(cfg: AssertConfig) => AssertStep(stepId, pid, row.position, cfg, row.createdAt, row.updatedAt, parentStepId = row.parentStepId.map(PipelineStepId(_)), enabled = row.enabled)
      case Success(other) =>
        throw new IllegalStateException(
          s"PipelineStepRepository: codec returned unexpected config type ${other.getClass.getName} for op '${row.op}'"
        )
      case Failure(ex) =>
        throw new IllegalStateException(
          s"PipelineStepRepository: failed to decode config for step ${row.id} (op='${row.op}'): ${ex.getMessage}",
          ex
        )
    }
  }

  /** Encode a typed config (handed in from the service layer) to JSON text. */
  private def encodeConfig(kind: String, config: Any): String =
    PipelineStepConfigCodec.encodeConfig(config)
}

object PipelineStepRepository {

  /** Internal row representation — never crosses the public boundary. Use
   *  [[PipelineStep]] outside the repository. */
  case class PipelineStepRow(
      id: String,
      pipelineId: String,
      position: Int,
      op: String,
      config: String,
      enabled: Boolean,
      createdAt: Instant,
      updatedAt: Instant,
      parentStepId: Option[String] = None
  )

  class PipelineStepTable(tag: Tag) extends Table[PipelineStepRow](tag, "pipeline_steps") {
    def id           = column[String]("id", O.PrimaryKey)
    def pipelineId   = column[String]("pipeline_id")
    def position     = column[Int]("position")
    def op           = column[String]("op")
    def config       = column[String]("config")
    def enabled      = column[Boolean]("enabled")
    def createdAt    = column[Instant]("created_at")
    def updatedAt    = column[Instant]("updated_at")
    def parentStepId = column[Option[String]]("parent_step_id")

    def * = (id, pipelineId, position, op, config, enabled, createdAt, updatedAt, parentStepId).mapTo[PipelineStepRow]
  }
}
