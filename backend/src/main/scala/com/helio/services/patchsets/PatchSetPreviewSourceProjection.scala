package com.helio.services.patchsets

import com.helio.api.protocols.sources.{DataSourceResponse, StaticDataSourceRequest, UpdateDataSourceRequest}
import com.helio.domain.model._
import PatchSetApplyServiceJson._
import spray.json._

import java.time.Instant

/** Pure after-state projections for data-source edits, split out of `PatchSetPreviewProjection`
 *  (HEL-1498; behaviour-preserving). See that object for the shared contract. */
private[patchsets] object PatchSetPreviewSourceProjection {

  /** Trivial rename-only `.copy`, mirroring `PatchSetApplyRollback`'s own
   *  `DataSourceUpdate` inverse-request composition style -- `updatedAt` is
   *  deliberately left at `prior`'s value (design.md D3's timestamp
   *  exclusion). */
  private[patchsets] def dataSourceUpdateAfter(request: UpdateDataSourceRequest, prior: DataSource): (JsValue, DataSource) = {
    val newName = request.name.map(_.trim).getOrElse(prior.name)
    val updated = prior match {
      case c: CsvSource    => c.copy(name = newName)
      case r: RestSource   => r.copy(name = newName)
      case s: SqlSource    => s.copy(name = newName)
      case s: DatasetSource => s.copy(name = newName)
      case t: TextSource   => t.copy(name = newName)
      case p: PdfSource    => p.copy(name = newName)
      case i: ImageSource  => i.copy(name = newName)
    }
    (dataSourceResponseFormat.write(DataSourceResponse.fromDomain(updated)), updated)
  }

  private[patchsets] def dataSourceCreateAfter(request: StaticDataSourceRequest, user: AuthenticatedUser): JsValue = {
    val now = Instant.now()
    val source = DatasetSource(
      id        = DataSourceId(PatchSetPreviewProjection.PendingId),
      name      = request.name.trim,
      ownerId   = user.id,
      createdAt = now,
      updatedAt = now,
      tag       = request.tag
    )
    dataSourceResponseFormat.write(DataSourceResponse.fromDomain(source))
  }
}
