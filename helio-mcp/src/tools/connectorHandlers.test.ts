/**
 * HEL-886 tasks.md 4.4/4.5b — `createConnectorHandler` (design.md Decision 2's actionable
 * refusal, and the no-half-created-state proof) and `augmentFetchErrorWithConnectorsHint`
 * (Decision 4b). Imports the narrow `connectorHandlers.ts` module directly (not `write.ts`),
 * mirroring `write.test.ts`'s established pattern for the same compile-cost reason.
 */

import type { HelioApi } from "../helioApi.js";
import type { CreateConnectorResult } from "../types.js";
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
} {
  const calls: Array<{ name: string; kind: string; baseUrl: string }> = [];
  const fake = {
    createConnector: async (input: {
      name: string;
      kind: string;
      baseUrl: string;
    }): Promise<CreateConnectorResult> => {
      calls.push(input);
      return { id: "conn-1", name: input.name, kind: input.kind, host: input.baseUrl };
    },
  };
  return { api: fake as unknown as HelioApi, calls };
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

  it("refuses authType: bearer with a /connectors-naming message and makes ZERO http calls", async () => {
    const { api, calls } = makeFakeApi();

    const result = await createConnectorHandler(api, {
      name: "GitHub",
      baseUrl: "https://api.github.com",
      authType: "bearer",
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("/connectors");
    expect(calls).toHaveLength(0);
  });

  it("refuses authType: api_key with a /connectors-naming message and makes ZERO http calls", async () => {
    const { api, calls } = makeFakeApi();

    const result = await createConnectorHandler(api, {
      name: "GitHub",
      baseUrl: "https://api.github.com",
      authType: "api_key",
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("/connectors");
    expect(calls).toHaveLength(0);
  });

  // evaluation-1.md CR1: this is the GENERAL case -- an authType the schema/handler never
  // predicted, not one of the two named enum values. `connectorSchema.ts` widened `authType`
  // to a free-form string specifically so a value like this reaches this handler (rather than
  // dying at a bare Zod enum error), and this handler already refuses anything !== "none"
  // unconditionally -- so an arbitrary value gets the exact same actionable refusal proof.
  it("refuses an arbitrary unpredicted authType (e.g. oauth) with a /connectors-naming message and makes ZERO http calls", async () => {
    const { api, calls } = makeFakeApi();

    const result = await createConnectorHandler(api, {
      name: "GitHub",
      baseUrl: "https://api.github.com",
      authType: "oauth",
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("/connectors");
    expect(calls).toHaveLength(0);
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
