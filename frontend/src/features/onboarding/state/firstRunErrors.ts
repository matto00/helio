import { isAxiosError } from "axios";

import { CsvUnreadableError } from "../../sources/utils/csvSourceCreate";

export type FirstRunStage = "reading" | "uploading" | "building";

export const tooLargeMessage =
  "That file is over the 8 MB upload limit. Try a smaller CSV, or paste a link to it instead (links allow up to 50 MB).";

/** A size rejection can never succeed on repeat, so callers show it without a Retry. */
export function isPayloadTooLarge(err: unknown): boolean {
  return isAxiosError(err) && err.response?.status === 413;
}

function serverMessage(err: unknown): string | null {
  if (!isAxiosError(err)) return null;
  const data = err.response?.data as Record<string, unknown> | undefined;
  if (typeof data?.message === "string" && data.message) return data.message;
  return null;
}

/** One human-readable sentence per failure the first-run drop zone can hit (unparseable CSV,
 *  oversized file, unreachable URL, no network), keyed off the HTTP status the routes already use:
 *  413 oversize, 400 not-a-CSV / not-https, 502 upstream fetch failure. */
export function describeFirstRunError(err: unknown, stage: FirstRunStage): string {
  if (err instanceof CsvUnreadableError) return err.message;
  if (isAxiosError(err)) {
    const status = err.response?.status;
    if (status === undefined) return "Couldn't reach Helio. Check your connection and try again.";
    if (status === 413) return tooLargeMessage;
    if (status === 502) {
      return "Helio couldn't fetch that link. Check that it is reachable and try again.";
    }
    if (status === 429) return "Too many requests right now. Wait a moment and try again.";
    if (status === 400 || status === 422) {
      return serverMessage(err) ?? "Helio couldn't read that as a CSV.";
    }
  }
  if (stage === "building") {
    return serverMessage(err) ?? "Helio couldn't build a dashboard from that data. Try again.";
  }
  return "Helio couldn't read that as a CSV. Check the file and try again.";
}
