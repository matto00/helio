package com.helio.services.panels

import com.helio.services.{FormSubmitError, ServiceError}
import com.helio.services.sources.{DataSourceService, ImplicitConnectorCleanup, RowWriteResult, StoredObjectCleanup}
import com.helio.domain.engine.DatasetRowValidator
import com.helio.domain.model._
import com.helio.domain.panels._
import com.helio.infrastructure.persistence.sources.{DataSourceRepository, StoredObjectDeletionRepository}
import com.helio.infrastructure.storage.FileSystem
import org.slf4j.LoggerFactory
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Failure, Success, Try}
import scala.util.control.NonFatal

/** The file-attached `submitForm` path (HEL-1086), split out of `PanelService`. Every dependency is
 *  nullable-optional exactly as on `PanelService` and only dereferenced inside a method body, never at
 *  construction. */
private[panels] final class PanelFormFileSubmission(
    dataSourceRepo:    DataSourceRepository,
    dataSourceService: DataSourceService,
    fileSystem:        FileSystem,
    // HEL-1530: nullable-optional like the others; `null` skips the failed-append compensation (a leak, never a delete).
    storedObjectDeletionRepo: StoredObjectDeletionRepository = null,
    graceSeconds:      Long = PanelFormFileSubmission.DefaultGraceSeconds
)(implicit ec: ExecutionContext) {

  private val log = LoggerFactory.getLogger(getClass)

  /** HEL-1086 design.md D2: the two-phase file-attached submit path. Phase 1 (pre-lock, read-only):
   *  fold `files` into `values` as presence-marker placeholders (`{"__file", "filename",
   *  "sizeBytes"}`) and run `FormSubmission.buildRow` once against the schema read via
   *  `getDeclaredSchema` — this single pass already validates EVERY field, file included (C2/C3:
   *  a sibling field's failure is caught here, before any byte is written). Only on `Right` does
   *  phase 2 write each file's real bytes via `FileSystem.write` (design.md D3 storage-key shape)
   *  and substitute the placeholder with the real `binary-ref` JSON object, then delegate to
   *  `DataSourceService.appendFormRow` exactly like the no-file path — which re-runs `buildRow`
   *  a second time, atomically, under the source's own lock, against the declaration read fresh
   *  there (closing the same concurrent-schema-change race the no-file path already closes). */
  def submitFormWithFiles(
      panelId: PanelId,
      panel:   FormPanel,
      values:  Map[String, JsValue],
      files:   Map[String, (String, Array[Byte])],
      user:    AuthenticatedUser
  ): Future[Either[FormSubmitError, RowWriteResult]] = {
    val placeholderValues = foldFilePlaceholders(values, files)
    dataSourceRepo.getDeclaredSchema(panel.config.dataSourceId, user).flatMap {
      case None => Future.successful(Left(FormSubmitError(ServiceError.NotFound("Data source not found"))))
      case Some(declaration) =>
        FormSubmission.buildRow(panel.config, declaration, placeholderValues) match {
          case Left(errors) => Future.successful(Left(FormSubmitError.fromFieldErrors(errors)))
          case Right(_) =>
            storeFormFiles(files).flatMap { refsByField =>
              val realValues = values ++ refsByField
              val build: (Vector[DatasetFieldDeclaration], Instant) => Either[Vector[DatasetRowValidator.FieldError], Vector[JsValue]] =
                (decl, now) => FormSubmission.buildRow(panel.config, decl, realValues, now)
              Future.unit.flatMap(_ => dataSourceService.appendFormRow(panel.config.dataSourceId, build, panelId, user)).transformWith {
                case Success(right @ Right(_)) => Future.successful(right)
                // HEL-1434: a refused in-lock append (source gone, schema changed, row limit) wrote no row, so the
                // objects stored for it are unreferenced -- remove them immediately.
                case Success(left @ Left(_)) => removeStored(refsByField.values).map(_ => left)
                // HEL-1530: a FAILED future is ambiguous (the append may have committed, e.g. a throw after the
                // commit), so the objects are queued behind a grace window and the drain's guard deletes one only if
                // no committed row holds its key. The original failure is returned unchanged.
                case Failure(failure) => queueFailedAppend(refsByField.values).transform(_ => Failure(failure))
              }
            }
        }
    }
  }

  /** Queues the storage keys of `refs` for guarded deletion no earlier than [[graceSeconds]] from now. Never fails: a
   *  queue failure is logged (key count and exception class only) and the objects are left, which is a leak, never a
   *  wrong delete. */
  private def queueFailedAppend(refs: Iterable[JsValue]): Future[Unit] = {
    val keys = storageKeys(refs)
    if (storedObjectDeletionRepo == null || keys.isEmpty) Future.unit
    else
      Future.unit
        .flatMap(_ => storedObjectDeletionRepo.enqueue(keys, "form_submit_failed", Instant.now().plusSeconds(graceSeconds)))
        .recover { case NonFatal(e) =>
          log.warn(s"PanelFormFileSubmission could not queue ${keys.size} stored object(s) of a failed form append: ${ImplicitConnectorCleanup.describeFailure(e)}")
        }
  }

  private def storageKeys(refs: Iterable[JsValue]): Vector[String] =
    refs.toVector.collect { case JsObject(fields) => fields.get("storageKey") }.collect { case Some(JsString(key)) => key }

  /** Best-effort removal of the objects behind `binary-ref` objects (never fails; see [[StoredObjectCleanup]]). */
  private def removeStored(refs: Iterable[JsValue]): Future[Unit] =
    removeKeys(storageKeys(refs))

  private def removeKeys(keys: Iterable[String]): Future[Unit] =
    Future.traverse(keys.toVector)(key => StoredObjectCleanup.delete(fileSystem, key, "PanelFormFileSubmission")).map(_ => ())

  /** `{sourceField -> (filename, bytes)}` folded into `values` as the presence-marker placeholder
   *  `FormSubmission.buildRow`'s file-control branch validates (design.md D2). Overwrites any
   *  entry already present at that key — a `file` field's value only ever comes from a multipart
   *  part, never the JSON `values` body. */
  private def foldFilePlaceholders(
      values: Map[String, JsValue],
      files:  Map[String, (String, Array[Byte])]
  ): Map[String, JsValue] =
    values ++ files.map { case (field, (filename, bytes)) =>
      field -> JsObject(
        "__file"    -> JsBoolean(true),
        "filename"  -> JsString(filename),
        "sizeBytes" -> JsNumber(bytes.length.toLong)
      )
    }

  /** Writes every attached file's real bytes via `FileSystem.write` at `form-uploads/<uuid>.<ext>`
   *  (design.md D3 — a UUID-named storage key, never the caller-supplied filename, closes the
   *  path-traversal scenario by construction) and returns the real `binary-ref` JSON object
   *  (`storageKey`, `mimeType`, `filename`, `sizeBytes`) per field, ready to substitute into
   *  `values` for the final in-lock `buildRow`/`appendFormRow` call. Only ever invoked AFTER the
   *  pre-lock `buildRow` pass above returned `Right` — never on a submit that phase already
   *  rejected (C3: a rejected submit stores no file). */
  private def storeFormFiles(files: Map[String, (String, Array[Byte])]): Future[Map[String, JsValue]] = {
    // Keys are generated up front and EVERY write is awaited (no fail-fast), so that when one write fails the cleanup
    // below runs only after every sibling write has settled and cannot be overtaken by a slow one (HEL-1530 D7).
    val planned = files.toVector.map { case (field, (filename, bytes)) =>
      val ext        = FormUploadConfig.extensionOf(filename)
      val storageKey = s"form-uploads/${UUID.randomUUID().toString}.$ext"
      (field, filename, bytes, storageKey)
    }
    val attempts: Future[Vector[(String, String, Array[Byte], String, Try[Unit])]] =
      Future.traverse(planned) { case (field, filename, bytes, storageKey) =>
        Future.unit.flatMap(_ => fileSystem.write(storageKey, bytes)).transform(t => Success((field, filename, bytes, storageKey, t)))
      }
    attempts.flatMap { settled =>
      settled.collectFirst { case (_, _, _, _, Failure(e)) => e } match {
        case Some(failure) =>
          // Files already written (and the failed one, which may have landed partially) have no row: remove them.
          removeKeys(settled.map(_._4)).flatMap(_ => Future.failed(failure))
        case None =>
          Future.successful(settled.map { case (field, filename, bytes, storageKey, _) =>
            field -> (JsObject(
              "storageKey" -> JsString(storageKey),
              "mimeType"   -> JsString(FormUploadConfig.mimeTypeOf(filename)),
              "filename"   -> JsString(filename),
              "sizeBytes"  -> JsNumber(bytes.length.toLong)
            ): JsValue)
          }.toMap)
      }
    }
  }
}

private[panels] object PanelFormFileSubmission {
  /** Grace window before the drain may delete the objects of a form submit whose append future failed. */
  val DefaultGraceSeconds: Long = 900L
}
