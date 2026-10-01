import {
  createCsvSource,
  createCsvSourceFromUrl,
  inferFromCsv,
} from "../services/dataSourceService";
import type { DataSource, InferredField } from "../types/dataSource";

/** HEL-893: a CSV column materializes as `string`, always, so every field is sent with that
 *  type regardless of what inference or the editor produced — the one rule the Add Source modal
 *  and the first-run drop zone share, so neither can submit a non-string CSV override. */
export function forceStringFields<T extends { dataType: string }>(fields: T[]): T[] {
  return fields.map((f) => ({ ...f, dataType: "string" }));
}

/** The largest CSV a browser upload can carry. Pekko HTTP's default `max-content-length` (8m; the
 *  backend sets no override in `application.conf`) bounds the whole multipart entity on both
 *  `/api/data-sources/infer` and `/api/data-sources`, so it sits below the 50 MiB
 *  `CsvUrlFetch.maxFileSizeBytes` that link ingestion allows. */
export const CSV_UPLOAD_MAX_BYTES = 8 * 1024 * 1024;

export class CsvUnreadableError extends Error {
  constructor() {
    super("That CSV has no readable columns. Check that its first row holds the column names.");
    this.name = "CsvUnreadableError";
  }
}

/** Creates a CSV source from an already-inferred (and possibly user-edited) field list. Callers
 *  own the follow-up (refetching the sources list, selection, toasts). */
export function createCsvFromFields(
  name: string,
  file: File,
  fields: InferredField[],
): Promise<DataSource> {
  return createCsvSource(name, file, forceStringFields(fields));
}

/** The shared infer -> force-string -> create path (HEL-1209), for flows with no field-editing
 *  step; `AddSourceModal` runs the same two halves with its editing step between them. Throws
 *  [[CsvUnreadableError]] when inference finds no columns, before anything is uploaded. */
export async function inferAndCreateCsv(
  name: string,
  file: File,
  onStage?: (stage: "reading" | "uploading") => void,
): Promise<DataSource> {
  onStage?.("reading");
  const inferred = await inferFromCsv(file);
  if (inferred.length === 0) throw new CsvUnreadableError();
  onStage?.("uploading");
  return createCsvFromFields(name, file, inferred);
}

export function createCsvFromUrl(name: string, url: string): Promise<DataSource> {
  return createCsvSourceFromUrl(name, url);
}
