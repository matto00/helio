package com.helio.domain.panels

/** HEL-1086 design.md D1/D4: form-file-field validation constants, deliberately separate from
 *  `ImageUploadService`'s `allowedExtensions`/`maxBytes` — a form file field isn't only images, so
 *  its allowlist is a superset covering common document types too (design.md D4: "exact list is an
 *  implementation detail, not spec-level"). Read once, at object-init, from the same `sys.env`
 *  convention `ImageUploadService`/`ContentSourceSupport`'s siblings already use.
 *
 *  Lives in `domain.panels` (not `services`) so [[FormSubmission]] — deliberately pure,
 *  side-effect-free — can validate a file placeholder's extension/size without depending on the
 *  services layer; reading `sys.env` here is a one-time object-init read, not a per-call I/O
 *  operation, so `FormSubmission.buildRow` itself stays pure. */
object FormUploadConfig {

  /** Default matches `ImageUploadService.maxBytes`'s own default (`10485760L`, HEL-246). */
  val maxFileSizeBytes: Long =
    sys.env.get("FORM_UPLOAD_MAX_FILE_SIZE_BYTES").flatMap(_.toLongOption).getOrElse(10485760L)

  val allowedExtensions: Set[String] =
    Set("png", "jpg", "jpeg", "gif", "webp", "pdf", "txt", "csv", "doc", "docx", "xls", "xlsx")

  val mimeTypeByExtension: Map[String, String] = Map(
    "png"  -> "image/png",
    "jpg"  -> "image/jpeg",
    "jpeg" -> "image/jpeg",
    "gif"  -> "image/gif",
    "webp" -> "image/webp",
    "pdf"  -> "application/pdf",
    "txt"  -> "text/plain",
    "csv"  -> "text/csv",
    "doc"  -> "application/msword",
    "docx" -> "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xls"  -> "application/vnd.ms-excel",
    "xlsx" -> "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  )

  def extensionOf(filename: String): String = filename.lastIndexOf('.') match {
    case -1 => ""
    case i  => filename.substring(i + 1).toLowerCase
  }

  def mimeTypeOf(filename: String): String =
    mimeTypeByExtension.getOrElse(extensionOf(filename), "application/octet-stream")

  /** `Right(())` when `filename`'s extension is allowed and `sizeBytes` is within bound;
   *  `Left(reason)` otherwise — `reason` is discarded by [[FormSubmission]] in favor of the
   *  uniform `"invalid"` field-error reason (spec: same wording for either cause), but is kept
   *  descriptive here for anything that logs it. */
  def validate(filename: String, sizeBytes: Long): Either[String, Unit] = {
    val ext = extensionOf(filename)
    if (!allowedExtensions.contains(ext))
      Left(s"Unsupported file extension: '.$ext'. Supported extensions: " + allowedExtensions.toSeq.sorted.map("." + _).mkString(", "))
    else if (sizeBytes > maxFileSizeBytes)
      Left(s"File exceeds the maximum allowed size of $maxFileSizeBytes bytes")
    else
      Right(())
  }
}
