package com.helio.domain.steps

import com.helio.domain.model.{AuthenticatedUser, DataSourceId}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import spray.json._

import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Failure, Success, Try}

/** HEL-1099: config model for the future `upsertsource` pipeline step (design spec
 *  `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md`, epic HEL-1098).
 *
 *  A terminal step that writes its input rows to a `dataset` source, either creating a new
 *  one (`NewSource`) or writing into an already-owned one (`ExistingSource`), in `append` or
 *  `replace` mode.
 *
 *  '''Deliberately NOT registered in [[PipelineStep.Registry]] / `PipelineStepKind.All` yet.'''
 *  `PipelineStep.Companion` membership is what makes a step kind creatable via
 *  `PipelineService.addStep`/`create` (`PipelineStepKind.All.contains`,
 *  `PipelineCreateTransactionalSpec`'s pinned "reject until wired" cases,
 *  `PipelineStepsOpCheckSeededRowsSpec`), and every `Companion` entry requires a full
 *  `PipelineStep` subtype implementing `evaluate` — i.e. real engine behavior. That is
 *  HEL-1100's scope, explicitly out of scope here, and cycle detection (HEL-1101, a hard
 *  correctness requirement per the design spec: "a pipeline must not write to a source it
 *  reads") has not landed either. Registering this kind now would let a caller persist a
 *  step that either throws at run time (no engine case) or, once HEL-1100 lands before
 *  HEL-1101, could run before a write→read cycle is rejected. Both are worse than the
 *  current 400. So `PipelineCreateTransactionalSpec`'s `upsertsource` rejection case is left
 *  standing — it is NOT flipped by this ticket.
 *
 *  This ticket instead ships the reusable pieces every one of those follow-ups needs:
 *
 *    - [[UpsertSourceConfig]] / [[UpsertTarget]] — the typed config model and its strict
 *      JSON codec (tolerant `decode` for the read path, mirroring every other step's
 *      `rowToDomain` contract; [[validateRawConfig]] for the write path).
 *    - [[validateRawConfig]] — the strict, synchronous write-path check (HEL-814/HEL-860
 *      class): malformed shape, wrong-typed fields, an unrecognised `target.kind`, or an
 *      unrecognised `mode` are all rejected here, named and typed, never silently defaulted
 *      (HEL-871 class). Read-path decoding (`UpsertSourceConfig.decode`) stays tolerant — a
 *      row with `target`/`mode` simply ABSENT still reads (see `UpsertSourceConfigSpec` — this
 *      is exactly the trap this ticket's own description calls out:
 *      `PipelineStepRepository.rowToDomain` turns any decode failure into an
 *      `IllegalStateException` on every read, so strictness must live here, not there). A
 *      PRESENT-but-wrong-typed value still fails `decode`, exactly like every other step.
 *    - [[validateTargetOwnership]] — the async ownership pre-flight an `ExistingSource`
 *      target needs before HEL-1100 can wire this into `PipelineService.addStep`'s existing
 *      `aclCheckF` (mirrors the `secondaryDataSourceId`/`findByIdOwned` pattern `join`/
 *      `union`/`lookup` already use). Returns a uniform "not found" for both a genuinely
 *      absent id and one owned by another tenant — never a distinguishable cross-tenant
 *      existence oracle.
 *
 *  '''HEL-1100 registers the real `UpsertSourceStep`''' into `PipelineStep.Registry` — it is the
 *  ticket that supplies `evaluate`, so it is the one with a reason to touch the registry; HEL-1101
 *  and HEL-1102 do not. HEL-1100 reuses this file's `UpsertSourceConfig`/`UpsertTarget` types and
 *  wires `validateRawConfig`/`validateTargetOwnership` into the `Companion` exactly as this
 *  scaladoc describes — no config-shape decision is deferred to that ticket. Per design.md
 *  Decision 1 (added after design-gate skeptic round 1 REFUTE): '''HEL-1100 is blocked on
 *  HEL-1101''' — registration, and flipping `PipelineCreateTransactionalSpec`'s pinned rejection,
 *  must not land before HEL-1101's validation-time cycle check exists, or a registered step could
 *  run before a write→read cycle is rejected. This ordering is recorded as a Linear `blockedBy`
 *  relation, not just prose here. */
sealed trait UpsertTarget

/** Shared by [[UpsertTarget]]'s codec and [[UpsertSourceConfig]]'s write-path checks — a single
 *  definition rather than two verbatim copies. */
private[steps] object UpsertJson {
  def kindName(v: JsValue): String = v match {
    case JsString(_)      => "a string"
    case JsNumber(_)      => "a number"
    case JsTrue | JsFalse => "a boolean"
    case JsArray(_)       => "an array"
    case JsNull           => "null"
    case _: JsObject      => "an object"
  }
}

object UpsertTarget {

  /** Write into a brand-new `dataset` source named `name`, created by the engine at run
   *  time. `name` uniqueness/collision handling is an engine concern (HEL-1100). */
  final case class NewSource(name: String) extends UpsertTarget

  /** Write into an already-existing, caller-owned source. */
  final case class ExistingSource(dataSourceId: String) extends UpsertTarget

  /** Wire shape mirrors [[SecondaryInput]]'s `kind`-discriminated object, the established
   *  convention for a two-case target in this codebase:
   *  `{"kind": "newSource", "name": <string>}` or
   *  `{"kind": "existingSource", "dataSourceId": <string>}`. */
  implicit val format: RootJsonFormat[UpsertTarget] = new RootJsonFormat[UpsertTarget] {
    def write(t: UpsertTarget): JsValue = t match {
      case NewSource(name)         => JsObject("kind" -> JsString("newSource"), "name" -> JsString(name))
      case ExistingSource(id)      => JsObject("kind" -> JsString("existingSource"), "dataSourceId" -> JsString(id))
    }

    def read(json: JsValue): UpsertTarget = json match {
      case obj: JsObject =>
        obj.fields.get("kind") match {
          case Some(JsString("newSource")) =>
            obj.fields.get("name") match {
              case Some(JsString(name)) => NewSource(name)
              case _ =>
                throw new StepConfigTypeMismatch(
                  "'target' with kind 'newSource' requires a string 'name'."
                )
            }
          case Some(JsString("existingSource")) =>
            obj.fields.get("dataSourceId") match {
              case Some(JsString(id)) => ExistingSource(id)
              case _ =>
                throw new StepConfigTypeMismatch(
                  "'target' with kind 'existingSource' requires a string 'dataSourceId'."
                )
            }
          case Some(JsString(other)) =>
            throw new StepConfigTypeMismatch(
              s"'target.kind' must be 'newSource' or 'existingSource', got '$other'."
            )
          case _ =>
            throw new StepConfigTypeMismatch(
              "'target' requires a string 'kind' of 'newSource' or 'existingSource'."
            )
        }
      case other =>
        throw new StepConfigTypeMismatch(
          s"'target' must be an object, got ${UpsertJson.kindName(other)}."
        )
    }
  }

  /** Tolerant read-path default for an ABSENT `target` — mirrors
   *  [[SecondaryInput.Default]]'s "unconfigured, incomplete draft" contract rather than
   *  raising: a step a user added but has not configured yet must still round-trip through
   *  `PipelineStepRepository.rowToDomain`. */
  val Default: UpsertTarget = ExistingSource("")
}

/** `mode` supported values. Both are "append"/"replace" per the design spec — no third
 *  value exists yet, so this is a closed, non-registry-derived set (unlike
 *  `PipelineStepKind.All`). */
object UpsertMode {
  val Append: String  = "append"
  val Replace: String = "replace"
  val All: Vector[String] = Vector(Append, Replace)

  /** Tolerant read-path default, matching every other step's enum-default convention
   *  (e.g. `UnionConfig`'s `mode` defaulting to `"byPosition"`). */
  val Default: String = Append
}

final case class UpsertSourceConfig(target: UpsertTarget, mode: String)

object UpsertSourceConfig {

  /** Tolerant READ-path decode (HEL-860/HEL-814 contract): a missing `target` decodes to
   *  [[UpsertTarget.Default]], a missing `mode` decodes to [[UpsertMode.Default]] — a
   *  partially-configured or legacy row must still open in the pipeline editor rather than
   *  500ing `PipelineStepRepository.rowToDomain`. A PRESENT-but-wrong-typed `target`/`mode`
   *  still raises [[StepConfigTypeMismatch]] (HEL-814 D1's line between "unset" and
   *  "affirmatively wrong"), exactly like every other step's decoder — that failure is what
   *  the write path below intercepts before it ever reaches storage. */
  def decode(raw: String): UpsertSourceConfig = {
    val obj    = StepCodecUtil.asObject(raw)
    val target = obj.fields.get("target") match {
      case None | Some(JsNull) => UpsertTarget.Default
      case Some(v)             => UpsertTarget.format.read(v)
    }
    val mode = StepCodecUtil.str(obj, "mode", UpsertMode.Default)
    UpsertSourceConfig(target, mode)
  }

  implicit val format: RootJsonFormat[UpsertSourceConfig] = new RootJsonFormat[UpsertSourceConfig] {
    def write(c: UpsertSourceConfig): JsValue =
      JsObject("target" -> UpsertTarget.format.write(c.target), "mode" -> JsString(c.mode))
    def read(json: JsValue): UpsertSourceConfig = decode(json.compactPrint)
  }

  /** WRITE-path strict check (HEL-814/HEL-860/HEL-871 class): a caller-supplied raw config
   *  that decodes to a shape the read path would silently default (mistyped `target`/`mode`,
   *  an unrecognised `target.kind`, or a `mode` outside [[UpsertMode.All]]) is rejected here,
   *  named and typed, rather than persisted as a no-op or a silently-defaulted value.
   *
   *  `None` means accept. This mirrors `PipelineStep.Companion.validateRawConfig`'s exact
   *  contract (see this file's own top-of-file scaladoc for why this type is not itself a
   *  registered `Companion` yet) so wiring this into one, later, is a direct copy-paste of
   *  this method's body. */
  def validateRawConfig(raw: String): Option[String] = {
    val shapeError: Option[String] =
      Try(StepCodecUtil.asObject(raw)) match {
        case Failure(e: StepConfigTypeMismatch) =>
          Some(s"Invalid 'upsertsource' config: ${e.getMessage}")
        case Failure(_) =>
          // Malformed JSON — the pre-existing "invalid config" category the calling
          // surface already reports from its own decode `Try`; not duplicated here.
          None
        case Success(obj) =>
          decodeErrorFor(obj)
      }
    shapeError.orElse(modeError(raw))
  }

  private def decodeErrorFor(obj: JsObject): Option[String] =
    Try {
      obj.fields.get("target") match {
        case None | Some(JsNull) => ()
        case Some(v)             => UpsertTarget.format.read(v)
      }
      obj.fields.get("mode") match {
        case None | Some(JsNull)  => ()
        case Some(JsString(_))    => ()
        case Some(other) =>
          throw new StepConfigTypeMismatch(s"'mode' must be a string, got ${UpsertJson.kindName(other)}.")
      }
    } match {
      case Failure(e: StepConfigTypeMismatch) => Some(s"Invalid 'upsertsource' config: ${e.getMessage}")
      case _                                             => None
    }

  /** A present-but-unsupported `mode` (e.g. `"upsert"`, a plausible typo for this exact
   *  step) is a named, write-time-rejected value, not a silent fallback to
   *  [[UpsertMode.Default]] — the HEL-871 class this ticket's description points at. An
   *  absent `mode` is not an error here: that is the tolerant-default case already covered
   *  by `decode`. */
  private def modeError(raw: String): Option[String] =
    Try(StepCodecUtil.asObject(raw)).toOption.flatMap { obj =>
      obj.fields.get("mode") match {
        case Some(JsString(m)) if !UpsertMode.All.contains(m) =>
          Some(s"Invalid 'upsertsource' config: 'mode' must be one of ${UpsertMode.All.mkString(", ")}, got '$m'.")
        case _ => None
      }
    }

  /** Async ownership pre-flight for an [[UpsertTarget.ExistingSource]] target — the
   *  standalone building block for the `aclCheckF` HEL-1100 will add to
   *  `PipelineService.addStep`'s existing pre-flight (mirrors the `secondaryDataSourceId`/
   *  `findByIdOwned` pattern `join`/`union`/`lookup` already use there).
   *
   *  `findByIdOwned` returns `None` uniformly for "does not exist" and "exists but is owned
   *  by someone else" (see its own scaladoc / HEL-278) — so this never gives a caller a way
   *  to distinguish "not found" from "found, not yours" for another tenant's source. An
   *  empty `dataSourceId` (the picker's own unset-draft value, matching HEL-950) is treated
   *  as an incomplete config, not a lookup — skipped, `None`.
   *
   *  A [[UpsertTarget.NewSource]] target has nothing to own yet — always `None`. */
  def validateTargetOwnership(
      target: UpsertTarget,
      user: AuthenticatedUser,
      dataSourceRepo: DataSourceRepository
  )(implicit ec: ExecutionContext): Future[Option[String]] = target match {
    case UpsertTarget.NewSource(_) => Future.successful(None)
    case UpsertTarget.ExistingSource(id) if id.trim.isEmpty =>
      Future.successful(None)
    case UpsertTarget.ExistingSource(id) =>
      dataSourceRepo.findByIdOwned(DataSourceId(id), user).map {
        case Some(_) => None
        case None    => Some(s"Data source not found: $id")
      }
  }
}
