package com.helio.infrastructure.persistence.pipelines

import com.helio.infrastructure.persistence.DbContext
import com.helio.api.protocols.pipelines.PipelineStepConfigCodec
import com.helio.domain._
import com.helio.domain.model._
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

  /** Insert a new step into the pipeline in user context.
    *
    * Gated by the caller having proven pipeline ownership at the service layer;
    * the repo itself only writes — the parent pipeline FK guards against the
    * pipeline disappearing mid-call.
    *
    * The V35 RLS policy on `pipeline_steps` uses an EXISTS subquery to
    * `pipelines.owner_id`. Running inside `withUserContext` means the policy
    * evaluates correctly: the new step is only insertable if the parent pipeline
    * is owned by the caller. */
  def insert(pipelineId: PipelineId, kind: String, config: Any, user: AuthenticatedUser, enabled: Boolean = true): Future[PipelineStep] = {
    val now = Instant.now()
    val configJson = encodeConfig(kind, config)
    val action = for {
      maxPos   <- stepsTable.filter(_.pipelineId === pipelineId.value).map(_.position).max.result
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
          val newRow = row.copy(
            config    = newConfig,
            position  = position.getOrElse(row.position),
            enabled   = enabled.getOrElse(row.enabled),
            updatedAt = now
          )
          stepsTable.filter(_.id === id.value).update(newRow).map(_ => Some(rowToDomain(newRow)))
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
    * that same group. No live caller passes a non-`None` `parentStepId`
    * yet (P1.2 wires branch creation); the default preserves today's
    * flat/root-appended behavior exactly. */
  def insertInternal(
      pipelineId: PipelineId,
      kind: String,
      config: Any,
      enabled: Boolean = true,
      parentStepId: Option[PipelineStepId] = None
  ): Future[PipelineStep] = {
    val now        = Instant.now()
    val configJson = encodeConfig(kind, config)
    val action = for {
      maxPos   <- siblingsQuery(pipelineId, parentStepId).map(_.position).max.result
      position  = maxPos.map(_ + 1).getOrElse(0)
      id        = UUID.randomUUID().toString
      row       = PipelineStepRow(id, pipelineId.value, position, kind, configJson, enabled, now, now, parentStepId.map(_.value))
      _        <- stepsTable += row
    } yield rowToDomain(row)
    ctx.withSystemContext(action.transactionally)
  }

  /** ACL-bypassing update. Safe to call only after the caller's editor or
    * owner access has been confirmed by PipelineService via findByIdShared. */
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
          val newRow = row.copy(
            config    = newConfig,
            position  = position.getOrElse(row.position),
            enabled   = enabled.getOrElse(row.enabled),
            updatedAt = now
          )
          stepsTable.filter(_.id === id.value).update(newRow).map(_ => Some(rowToDomain(newRow)))
      }
    } yield updated
    ctx.withSystemContext(action.transactionally)
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
    * but the case is handled defensively rather than silently dropped. */
  def executionOrder(steps: Vector[PipelineStep]): Vector[PipelineStep] = {
    def expandBranch(root: PipelineStep): Vector[PipelineStep] =
      root +: childrenOf(steps, Some(root.id)).flatMap(expandBranch)

    def walk(node: PipelineStep): Vector[PipelineStep] = {
      val children    = childrenOf(steps, Some(node.id))
      val tails       = children.filter(_.position != 0).flatMap(expandBranch)
      val trunkChild  = children.find(_.position == 0)
      node +: (tails ++ trunkChild.toVector.flatMap(walk))
    }

    val rootChildren = childrenOf(steps, None)
    val rootTrunk     = rootChildren.find(_.position == 0)
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
