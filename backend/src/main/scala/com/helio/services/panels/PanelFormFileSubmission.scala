package com.helio.services.panels

import com.helio.services.{FormSubmitError, ServiceError}
import com.helio.services.sources.{DataSourceService, RowWriteResult}
import com.helio.domain.engine.DatasetRowValidator
import com.helio.domain.model._
import com.helio.domain.panels._
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.storage.FileSystem
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** The file-attached `submitForm` path (HEL-1086), split out of `PanelService`. Every dependency is
 *  nullable-optional exactly as on `PanelService` and only dereferenced inside a method body, never at
 *  construction. */
private[panels] final class PanelFormFileSubmission(
    dataSourceRepo:    DataSourceRepository,
    dataSourceService: DataSourceService,
    fileSystem:        FileSystem
)(implicit ec: ExecutionContext) {

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
              dataSourceService.appendFormRow(panel.config.dataSourceId, build, panelId, user)
            }
        }
    }
  }

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
  private def storeFormFiles(files: Map[String, (String, Array[Byte])]): Future[Map[String, JsValue]] =
    Future.traverse(files.toVector) { case (field, (filename, bytes)) =>
      val ext        = FormUploadConfig.extensionOf(filename)
      val storageKey = s"form-uploads/${UUID.randomUUID().toString}.$ext"
      val mimeType   = FormUploadConfig.mimeTypeOf(filename)
      fileSystem.write(storageKey, bytes).map { _ =>
        field -> (JsObject(
          "storageKey" -> JsString(storageKey),
          "mimeType"   -> JsString(mimeType),
          "filename"   -> JsString(filename),
          "sizeBytes"  -> JsNumber(bytes.length.toLong)
        ): JsValue)
      }
    }.map(_.toMap)
}
