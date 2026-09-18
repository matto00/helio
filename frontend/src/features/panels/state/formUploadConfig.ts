// HEL-1086 design.md D4/tasks.md 2.5 — client-side mirror of the backend's `FormUploadConfig`
// defaults (`backend/src/main/scala/com/helio/domain/panels/FormUploadConfig.scala`). UX only:
// this is a convenience check that blocks an obviously-doomed submit before a round-trip; the
// server enforces its own (possibly env-overridden, via `FORM_UPLOAD_MAX_FILE_SIZE_BYTES`) limits
// independently and is the actual source of truth (`formSubmission.ts`'s header comment).

/** Matches `FormUploadConfig.maxFileSizeBytes`'s default (`10485760L`). */
export const MAX_FILE_SIZE_BYTES = 10485760;

/** Matches `FormUploadConfig.allowedExtensions`. */
export const ALLOWED_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "pdf",
  "txt",
  "csv",
  "doc",
  "docx",
  "xls",
  "xlsx",
]);

function extensionOf(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i === -1 ? "" : filename.slice(i + 1).toLowerCase();
}

/** `null` when `file` passes both checks; otherwise the reason to show. */
export function validateFileUpload(file: File): string | null {
  const ext = extensionOf(file.name);
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return `Unsupported file extension: '.${ext}'`;
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return "File exceeds the maximum allowed size";
  }
  return null;
}
