import { isAxiosError } from "axios";

import {
  createCsvSource,
  createCsvSourceFromUrl,
  fetchCsvLimits,
  inferFromCsv,
  type CsvLimits,
} from "../services/dataSourceService";
import type { DataSource, InferredField } from "../types/dataSource";

/** HEL-893: a CSV column materializes as `string`, always, so every field is sent with that
 *  type regardless of what inference or the editor produced — the one rule the Add Source modal
 *  and the first-run drop zone share, so neither can submit a non-string CSV override. */
export function forceStringFields<T extends { dataType: string }>(fields: T[]): T[] {
  return fields.map((f) => ({ ...f, dataType: "string" }));
}

let csvLimitsPromise: Promise<CsvLimits | null> | null = null;

/** The backend's CSV caps, fetched once and cached. Resolves `null` when the fetch fails (and
 *  forgets the failure so a later call retries): callers then skip the client-side pre-check and
 *  let the server's 413 be the authority, rather than guessing a number that could drift from it. */
export function getCsvLimits(): Promise<CsvLimits | null> {
  if (csvLimitsPromise === null) {
    csvLimitsPromise = (async () => {
      try {
        return await fetchCsvLimits();
      } catch {
        csvLimitsPromise = null;
        return null;
      }
    })();
  }
  return csvLimitsPromise;
}

export function resetCsvLimitsCache(): void {
  csvLimitsPromise = null;
}

/** The user-facing sentence for a CSV upload the server refused as too large (413), which a repeat
 *  cannot fix; `null` for any other failure so callers keep their own copy. Prefers the server's own
 *  message, which names the byte, row and cell caps. */
export function describeCsvTooLarge(err: unknown): string | null {
  if (!isAxiosError(err) || err.response?.status !== 413) return null;
  const data = err.response.data as { message?: unknown } | undefined;
  return typeof data?.message === "string" && data.message
    ? data.message
    : "That CSV is too large to upload. Try a smaller file.";
}

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
