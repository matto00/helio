package com.helio.services.patchsets

import com.helio.services.ServiceError
import com.helio.api.protocols.patchsets.Edit
import com.helio.domain.model.OutputKind
import spray.json.{JsObject, JsString}

/** HEL-1639 D2: the intra-set references of a patch set. A create edit may carry `target.ref`; a LATER panel create may
 *  bind `config.outputId` to `"$ref:<ref>"`, naming an EARLIER `output` create of the same set. The real Output id does
 *  not exist until apply creates it, so apply substitutes it (see [[PatchSetApplyService]]) and preview carries the
 *  referenced create's kind instead.
 *
 *  `refs` maps a defined ref to the edit index that defined it and, for an `output` create, the Output's kind. */
private[services] final case class PatchSetRefs(refs: Map[String, PatchSetRefs.Defined]) {
  def names: Vector[String] = refs.toVector.sortBy(_._2.index).map(_._1)
}

private[services] object PatchSetRefs {

  final case class Defined(index: Int, outputKind: Option[OutputKind])

  val empty: PatchSetRefs = PatchSetRefs(Map.empty)

  /** The prefix a panel create's `config.outputId` uses to name an earlier `output` create. */
  val Prefix: String = "$ref:"

  private val Pattern = "^[a-z][a-z0-9_-]{0,31}$".r

  /** A ref is only allowed on a create, must match `^[a-z][a-z0-9_-]{0,31}$`, and must be unique within the set. */
  def checkDefinition(edit: Edit, index: Int, refs: PatchSetRefs): Either[ServiceError, Unit] =
    edit.target.ref match {
      case None => Right(())
      case Some(ref) if edit.op != "create" =>
        Left(ServiceError.BadRequest(s"edit $index: target.ref '$ref' is only valid on a create edit"))
      case Some(ref) if Pattern.findFirstIn(ref).isEmpty =>
        Left(ServiceError.BadRequest(s"edit $index: target.ref '$ref' must match ^[a-z][a-z0-9_-]{0,31}$$"))
      case Some(ref) if refs.refs.contains(ref) =>
        Left(ServiceError.BadRequest(s"edit $index: target.ref '$ref' is already used by edit ${refs.refs(ref).index}"))
      case Some(_) => Right(())
    }

  /** Records the ref a just-resolved create defines (an `output` create also records its kind). */
  def register(refs: PatchSetRefs, resolved: ResolvedEdit): PatchSetRefs =
    resolved.ref match {
      case None => refs
      case Some(ref) =>
        val kind = resolved.action match {
          case ResolvedAction.OutputCreate(_, request) => OutputKind.fromString(request.kind).toOption
          case _                                       => None
        }
        PatchSetRefs(refs.refs + (ref -> Defined(resolved.index, kind)))
    }

  /** `Some(ref)` when `outputId` is a `"$ref:<ref>"` reference. */
  def refOf(outputId: String): Option[String] =
    if (outputId.startsWith(Prefix)) Some(outputId.stripPrefix(Prefix)) else None

  /** The binding of a panel create to `ref`, or the error naming the refs that do exist. */
  def resolveUse(ref: String, index: Int, refs: PatchSetRefs): Either[ServiceError, OutputRefUse] =
    refs.refs.get(ref).flatMap(d => d.outputKind.map(k => OutputRefUse(ref, k))) match {
      case Some(use) => Right(use)
      case None =>
        val outputRefs = refs.refs.collect { case (name, d) if d.outputKind.isDefined => name }.toVector.sorted
        Left(ServiceError.BadRequest(
          s"edit $index: $Prefix$ref does not name an earlier output create (refs: ${if (outputRefs.isEmpty) "none" else outputRefs.mkString(", ")})"
        ))
    }

  /** Apply-time substitution: `edit` with its `"$ref:<ref>"` replaced by the real Output id apply just created. */
  def substitute(edit: ResolvedEdit, createdIds: Map[String, String]): Either[ServiceError, ResolvedEdit] =
    (edit.action, edit.outputRefUse) match {
      case (ResolvedAction.PanelCreate(request), Some(use)) =>
        createdIds.get(use.ref) match {
          case None => Left(ServiceError.InternalError(s"edit ${edit.index}: $Prefix${use.ref} was not created before this panel"))
          case Some(id) =>
            val config = request.config.collect { case o: JsObject => o }.getOrElse(JsObject.empty)
            Right(edit.copy(action = ResolvedAction.PanelCreate(request.copy(config = Some(JsObject(config.fields + ("outputId" -> JsString(id))))))))
        }
      case _ => Right(edit)
    }
}
