package com.helio.domain.steps

import com.helio.domain.model.{AuthenticatedUser, DataSource, DataSourceId, DataSourceKind}
import com.helio.infrastructure.persistence.sources.DataSourceRepository

import scala.concurrent.{ExecutionContext, Future}

/** HEL-1265: outcome of checking an `upsertsource` existing-source target. A target is writable
 *  only when the pipeline owner owns it AND it is a dataset ([[DataSourceKind.isWritableDataset]]).
 *
 *  [[NotFound]] and [[NotWritable]] are deliberately distinct: [[NotFound]] covers an unknown id and
 *  a source owned by someone else indistinguishably (`findByIdOwned` returns `None` for both) and
 *  carries no name or kind, so a caller cannot probe another tenant's sources. [[NotWritable]] is
 *  only ever produced after the owner-scoped lookup succeeded, which is what makes naming the
 *  source's name and kind in its message safe. */
sealed trait UpsertTargetCheck

object UpsertTargetCheck {
  case object Writable                           extends UpsertTargetCheck
  final case class NotFound(message: String)     extends UpsertTargetCheck
  final case class NotWritable(message: String)  extends UpsertTargetCheck

  def notFoundMessage(id: String): String = s"Data source not found: $id"

  def notWritableMessage(source: DataSource): String =
    s"Upsert target '${source.name}' (${source.id.value}) is a ${source.kind} source; an existing-source target must be a dataset."

  def classify(id: String, found: Option[DataSource]): UpsertTargetCheck = found match {
    case None                                                  => NotFound(notFoundMessage(id))
    case Some(source) if DataSourceKind.isWritableDataset(source.kind) => Writable
    case Some(source)                                          => NotWritable(notWritableMessage(source))
  }

  /** Resolves `id` as `owner` (the pipeline owner, never the calling grantee -- targets stay
   *  owner-owned) through `findByIdOwned`, which is RLS-scoped. */
  def checkExisting(id: String, owner: AuthenticatedUser, repo: DataSourceRepository)(implicit
      ec: ExecutionContext
  ): Future[UpsertTargetCheck] =
    repo.findByIdOwned(DataSourceId(id), owner).map(classify(id, _))

  /** An empty `dataSourceId` is an incomplete draft (savable, not runnable) and a [[UpsertTarget.NewSource]]
   *  has nothing to check yet: both are [[Writable]] here. */
  def check(target: UpsertTarget, owner: AuthenticatedUser, repo: DataSourceRepository)(implicit
      ec: ExecutionContext
  ): Future[UpsertTargetCheck] = target match {
    case UpsertTarget.ExistingSource(id) if id.trim.nonEmpty => checkExisting(id, owner, repo)
    case _                                                   => Future.successful(Writable)
  }
}
