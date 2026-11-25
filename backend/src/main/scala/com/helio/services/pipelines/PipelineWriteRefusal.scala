package com.helio.services.pipelines

import com.helio.infrastructure.persistence.pipelines.{PipelineWriteAccessRevoked, WriteAccess}
import com.helio.services.ServiceError

/** HEL-1707: maps an in-transaction grant re-check refusal to the answer the route's own service-layer check gives when the
 *  revoke lands first: a remaining viewer grant is `403 Forbidden`, no grant (or a pipeline gone) the route's not-found. */
private[services] object PipelineWriteRefusal {

  def toError(access: WriteAccess, notFound: => ServiceError): ServiceError = access match {
    case WriteAccess.Viewer => ServiceError.Forbidden("Forbidden")
    case _                  => notFound
  }

  /** A `.recover` case mapping ONLY the typed refusal; compose it BEFORE any generic handler (`classifyDbError` and the like). */
  def refused[A](notFound: => ServiceError): PartialFunction[Throwable, Either[ServiceError, A]] = {
    case PipelineWriteAccessRevoked(access) => Left(toError(access, notFound))
  }
}
