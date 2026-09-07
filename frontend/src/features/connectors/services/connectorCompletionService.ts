// HEL-955 design.md D8: an UNAUTHENTICATED service call for the completion page's submission --
// deliberately NOT a re-use of `connectorEntityService.ts`'s authenticated thunks (which assume
// a logged-in session and would 401 for the out-of-band human this page exists for). Uses the
// shared `httpClient` directly, same as `connectorEntityService.ts`, just without any auth
// assumption baked in -- the backend route itself is optional-auth (`ApiRoutes` mounts this
// beside `PublicDashboardRoutes`).

import { httpClient } from "../../../services/httpClient";

export interface CompletionRequest {
  token: string;
  credential: string;
}

/** `POST /api/connectors/completion` -- submits a completion token + credential. Every failure
 *  mode (unknown/expired/consumed/superseded token, wrong owner, encryption failure) surfaces as
 *  the SAME generic HTTP error from the backend (design.md D5) -- this call does not attempt to
 *  interpret or distinguish it. */
export async function completeConnector(request: CompletionRequest): Promise<void> {
  await httpClient.post("/api/connectors/completion", request);
}

export interface PendingConnectorAuthShape {
  authType: string;
  apiKeyName?: string;
  apiKeyPlacement?: string;
}

/** `GET /api/connectors/completion?token=...` -- HEL-955 evaluation-1.md CR4: the pending
 *  Connector's INTENDED auth shape (design.md D9: "the completion page renders from it"), so the
 *  page never asks the human to pick an auth type it then discards. Same byte-identical refusal
 *  as the POST for every invalid-token case. */
export async function getPendingConnectorAuthShape(
  token: string,
): Promise<PendingConnectorAuthShape> {
  const response = await httpClient.get<PendingConnectorAuthShape>("/api/connectors/completion", {
    params: { token },
  });
  return response.data;
}
