/**
 * HEL-886 tasks.md 4.4/4.5b — `createConnectorHandler` (design.md Decision 2's actionable
 * refusal, and the no-half-created-state proof) and `augmentFetchErrorWithConnectorsHint`
 * (Decision 4b). Imports the narrow `connectorHandlers.ts` module directly (not `write.ts`),
 * mirroring `write.test.ts`'s established pattern for the same compile-cost reason.
 */

import type { HelioApi } from "../helioApi.js";
import type { CreateConnectorResult, CreatePendingConnectorResult } from "../types.js";
import { HelioApiError } from "../httpClient.js";
import {
  augmentFetchErrorWithConnectorsHint,
  createConnectorHandler,
} from "./connectorHandlers.js";

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.find((c) => c.type === "text")?.text ?? "";
}

function makeFakeApi(): {
  api: HelioApi;
  calls: Array<{ name: string; kind: string; baseUrl: string }>;
  pendingCalls: Array<{ name: string; kind: string; baseUrl: string; authType: string }>;
} {
  const calls: Array<{ name: string; kind: string; baseUrl: string }> = [];
  const pendingCalls: Array<{ name: string; kind: string; baseUrl: string; authType: string }> = [];
  const fake = {
    createConnector: async (input: {
      name: string;
      kind: string;
      baseUrl: string;
    }): Promise<CreateConnectorResult> => {
      calls.push(input);
      return { id: "conn-1", name: input.name, kind: input.kind, host: input.baseUrl };
    },
    // HEL-955: any authType !== "none" now mints a PENDING Connector instead of refusing.
    createPendingConnector: async (input: {
      name: string;
      kind: string;
      baseUrl: string;
      authType: string;
    }): Promise<CreatePendingConnectorResult> => {
      pendingCalls.push(input);
      return {
        connectorId: "conn-pending-1",
        completionUrl: "/connectors/complete?token=fake-token",
        expiresAt: "2026-01-01T01:00:00Z",
      };
    },
  };
  return { api: fake as unknown as HelioApi, calls, pendingCalls };
}

describe("createConnectorHandler (HEL-886 design.md Decision 2)", () => {
  it("creates a Connector when authType is omitted (defaults to none)", async () => {
    const { api, calls } = makeFakeApi();

    const result = await createConnectorHandler(api, {
      name: "Sleeper",
      baseUrl: "https://api.sleeper.app",
    });

    expect(calls).toEqual([
      { name: "Sleeper", kind: "rest_api", baseUrl: "https://api.sleeper.app" },
    ]);
    expect(result.isError).toBeFalsy();
  });

  it("creates a Connector when authType: none is explicit", async () => {
    const { api, calls } = makeFakeApi();

    await createConnectorHandler(api, {
      name: "Sleeper",
      baseUrl: "https://api.sleeper.app",
      authType: "none",
    });

    expect(calls).toHaveLength(1);
  });

  it("every success result carries the constant note (Decision 4b(i))", async () => {
    const { api } = makeFakeApi();

    const result = await createConnectorHandler(api, {
      name: "Sleeper",
      baseUrl: "https://api.sleeper.app",
    });

    const parsed = JSON.parse(textOf(result));
    expect(parsed.note).toContain("/connectors");
    expect(parsed.note).toContain("401/403");
  });

  // HEL-955 design.md D1/D7/D9: `authType !== "none"` no longer refuses outright -- it mints a
  // PENDING Connector (no credential passes through this call) and returns its completion URL.
  // `api.createConnector` (the no-credential path) must never be invoked in this branch.
  it("authType: bearer creates a PENDING Connector via createPendingConnector, never api.createConnector", async () => {
    const { api, calls, pendingCalls } = makeFakeApi();

    const result = await createConnectorHandler(api, {
      name: "GitHub",
      baseUrl: "https://api.github.com",
      authType: "bearer",
    });

    expect(result.isError).toBeFalsy();
    expect(calls).toHaveLength(0);
    expect(pendingCalls).toEqual([
      { name: "GitHub", kind: "rest_api", baseUrl: "https://api.github.com", authType: "bearer" },
    ]);
    expect(textOf(result)).toContain("PENDING");
    expect(textOf(result)).toContain("/connectors/complete");
  });

  it("authType: api_key creates a PENDING Connector, never api.createConnector", async () => {
    const { api, calls, pendingCalls } = makeFakeApi();

    const result = await createConnectorHandler(api, {
      name: "GitHub",
      baseUrl: "https://api.github.com",
      authType: "api_key",
      apiKeyName: "X-Api-Key",
      apiKeyPlacement: "header",
    });

    expect(result.isError).toBeFalsy();
    expect(calls).toHaveLength(0);
    expect(pendingCalls).toHaveLength(1);
  });

  // evaluation-1.md CR1: this is the GENERAL case -- an authType the schema/handler never
  // predicted, not one of the two named enum values. `connectorSchema.ts` widened `authType`
  // to a free-form string specifically so a value like this reaches this handler (rather than
  // dying at a bare Zod enum error), and this handler already treats anything !== "none" as
  // credentialed -- so an arbitrary value gets the same pending-creation path.
  it("an arbitrary unpredicted authType (e.g. oauth) also creates a PENDING Connector, never api.createConnector", async () => {
    const { api, calls, pendingCalls } = makeFakeApi();

    const result = await createConnectorHandler(api, {
      name: "GitHub",
      baseUrl: "https://api.github.com",
      authType: "oauth",
    });

    expect(result.isError).toBeFalsy();
    expect(calls).toHaveLength(0);
    expect(pendingCalls).toHaveLength(1);
  });

  it("surfaces a backend error verbatim (Decision 6)", async () => {
    const fake = {
      createConnector: async (): Promise<CreateConnectorResult> => {
        throw new HelioApiError(400, "https://helio.test/api/connectors", "baseUrl is required");
      },
    };
    const api = fake as unknown as HelioApi;

    const result = await createConnectorHandler(api, { name: "Sleeper", baseUrl: "" });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("baseUrl is required");
  });
});

describe("augmentFetchErrorWithConnectorsHint (HEL-886 design.md Decision 4b(ii))", () => {
  it("leaves a null fetchError byte-identical", () => {
    expect(augmentFetchErrorWithConnectorsHint(null)).toBeNull();
  });

  it("leaves a non-401/403 fetchError byte-identical", () => {
    expect(augmentFetchErrorWithConnectorsHint("ECONNREFUSED: connection refused")).toBe(
      "ECONNREFUSED: connection refused",
    );
  });

  it("appends the /connectors pointer when the message indicates 401", () => {
    const result = augmentFetchErrorWithConnectorsHint("Request failed with status 401");
    expect(result).toContain("Request failed with status 401");
    expect(result).toContain("/connectors");
  });

  it("appends the /connectors pointer when the message indicates 403", () => {
    const result = augmentFetchErrorWithConnectorsHint("Request failed with status 403");
    expect(result).toContain("/connectors");
  });
});
