package com.helio.services.sources

import com.helio.infrastructure.storage.FileSystem
import org.slf4j.LoggerFactory

import scala.concurrent.{ExecutionContext, Future}

/** Removes one stored object by exact path and never throws: a failure is logged (path, context and exception class
 *  only, via [[ImplicitConnectorCleanup.describeFailure]]) and reported as `false`, so a cleanup can never replace the
 *  error that triggered it. Shared by every best-effort object removal (HEL-1494's create compensation, HEL-1434's
 *  post-delete removal and create-side compensation). `FileSystem.delete` is idempotent, so a missing object is `true`. */
private[services] object StoredObjectCleanup {

  private val log = LoggerFactory.getLogger(getClass)

  def delete(fileSystem: FileSystem, path: String, context: String)(implicit ec: ExecutionContext): Future[Boolean] =
    Future.unit.flatMap(_ => fileSystem.delete(path)).map(_ => true).recover { case cleanupEx =>
      log.warn(s"$context failed to delete stored object $path: ${ImplicitConnectorCleanup.describeFailure(cleanupEx)}")
      false
    }
}
