/**
 * `create_connector`'s validate-then-call handler + `create_rest_data_source`'s `fetchError`
 * augmentation (HEL-886 design.md Decisions 2/4b). Split into its own small module, mirroring
 * `assertSchemas.ts`'s precedent — `write.ts`'s full ~20-tool Zod-schema surface is
 * pathologically expensive to type-check under this repo's root `tsconfig.json`/ts-jest
 * combination, so a unit test imports just this narrow surface instead.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { HelioApi } from "../helioApi.js";
import { HelioApiError } from "../httpClient.js";

function jsonResult(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

async function guarded(produce: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return jsonResult(await produce());
  } catch (err) {
    const message =
      err instanceof HelioApiError
        ? `${err.name} (status ${err.status}) for ${err.url}: ${err.message}`
        : `${(err as Error)?.name ?? "Error"}: ${(err as Error)?.message ?? String(err)}`;
    return { content: [{ type: "text", text: message }], isError: true };
  }
}

/** `create_connector`'s full validate-then-call logic (design.md Decisions 2/4b(i)). Refuses
 *  any `authType !== "none"` BEFORE any HTTP call (Decision 2) -- the no-half-created-state
 *  proof is that `api.createConnector` is never invoked in that branch. Every success result
 *  carries the constant `note` (Decision 4b(i)), unconditionally -- this does not depend on
 *  4b(ii)'s best-effort `fetchError` augmentation below. */
export async function createConnectorHandler(
  api: HelioApi,
  input: { name: string; baseUrl: string; kind?: string; authType?: string },
): Promise<CallToolResult> {
  if (input.authType !== undefined && input.authType !== "none") {
    return {
      content: [
        {
          type: "text",
          text:
            `create_connector only creates unauthenticated Connectors (authType: none) — ` +
            `authType "${input.authType}" needs a credential, which cannot be supplied through ` +
            "MCP. A human must create this Connector at the in-app /connectors page " +
            "(frontend/src/app/AppRoutes.tsx) instead. No Connector was created.",
        },
      ],
      isError: true,
    };
  }
  return guarded(async () => {
    const connector = await api.createConnector({
      name: input.name,
      kind: input.kind ?? "rest_api",
      baseUrl: input.baseUrl,
    });
    return {
      ...connector,
      note:
        "This Connector was created with no credential (authType: none). If the host " +
        "actually requires authentication, requests against it will fail with 401/403 — " +
        "a human must create a credentialed Connector at the in-app /connectors page instead.",
    };
  });
}

/** HEL-886 design.md Decision 4b(ii): best-effort augmentation of `create_rest_data_source`'s
 *  `fetchError` -- a 401/403 fetchError means the underlying Connector needs a credential a
 *  human must supply, so this appends the `/connectors` out-of-band pointer. Deliberately
 *  best-effort string matching over a message the backend forwards unmodified
 *  (`ConnectorDriver.scala`), NOT the load-bearing signpost -- that is `createConnectorHandler`'s
 *  constant `note` above, which does not depend on this. Every other `fetchError` (including
 *  `null`) passes through byte-identical. */
export function augmentFetchErrorWithConnectorsHint(fetchError: string | null): string | null {
  if (fetchError === null) return null;
  if (!/\b(401|403)\b/.test(fetchError)) return fetchError;
  return (
    fetchError +
    " This host appears to require authentication — a human must create a credentialed " +
    "Connector at the in-app /connectors page; create_connector only creates unauthenticated " +
    "Connectors."
  );
}
