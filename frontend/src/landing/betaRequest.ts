import { API_BASE_URL } from "../config/env";
import { CSRF_HEADER, CSRF_HEADER_VALUE } from "../services/csrfHeader";

export type BetaOutcome =
  | "success"
  | "signedOut"
  | "alreadyBeta"
  | "cooldown"
  | "unavailable"
  | "error";

/**
 * `POST /api/beta-access/request`: authenticated, no body. Deliberately avoids `httpClient`, which pulls axios into
 * the landing bundle. The landing page shares the app's origin, so the session cookie rides along with `credentials`.
 */
export async function requestBeta(fetchImpl: typeof fetch = fetch): Promise<BetaOutcome> {
  let response: Response;
  try {
    response = await fetchImpl(`${API_BASE_URL}/api/beta-access/request`, {
      method: "POST",
      credentials: "include",
      headers: { [CSRF_HEADER]: CSRF_HEADER_VALUE },
    });
  } catch {
    return "error";
  }
  switch (response.status) {
    case 204:
      return "success";
    case 401:
      return "signedOut";
    case 409:
      return "alreadyBeta";
    case 429:
      return "cooldown";
    case 503:
      return "unavailable";
    default:
      return "error";
  }
}

export const BETA_MESSAGES: Record<Exclude<BetaOutcome, "signedOut">, string> = {
  success: "Request sent. We'll be in touch.",
  alreadyBeta: "Your account already has beta access.",
  cooldown: "You asked recently. Please try again later.",
  unavailable: "Beta requests aren't available right now.",
  error: "Something went wrong. Please try again.",
};
