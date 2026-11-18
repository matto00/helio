import type { AskError } from "./types/ask";

/** The one message per failure kind (design D5). Fixed copy only: never server message or `reasons` text, and never the
 *  429's `limit` (it counts weighted units, which is the open billing-weight question). */
export function askErrorMessage(error: AskError): string {
  switch (error.kind) {
    case "limitReached":
      return "Daily chat limit reached. It resets at the start of the next UTC day.";
    case "truncated":
      return "That answer ran out of room. Try a narrower question.";
    case "ungrounded":
      return "Couldn't ground an answer in this data.";
    case "unavailable":
    case "network":
      return "Ask is unavailable right now.";
    case "invalid":
      return "That question can't be asked. Check its length and try again.";
    case "tierForbidden":
    case "unknown":
      return "Something went wrong asking. Try again.";
  }
}

/** Only a transient failure offers Retry (which re-sends the same question); a narrower question or a limit does not. */
export function askErrorRetryable(error: AskError): boolean {
  return error.kind === "unavailable" || error.kind === "network" || error.kind === "unknown";
}
