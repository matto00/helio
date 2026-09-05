/**
 * HEL-982 — proves the seam design.md D4 names: what the outgoing `POST /api/sources` request
 * actually CONTAINS, asserted against a real `node:http` server (no mocked fetch, no stubbed
 * transport), for both authoring paths that carry `queryParams`.
 *
 * Fixture (design.md D5): SIX pairs, deliberately non-alphabetical, with a NON-ADJACENT
 * duplicate name (`tag` appears at index 1 and index 3) and no numeric-like names, so neither
 * "collapse to unique keys" nor "sort by name" nor "group duplicates together" can pass by
 * accident.
 */

import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { HelioApi } from "../helioApi.js";
import { HelioHttpClient } from "../httpClient.js";
import type { HelioConfig } from "../config.js";
import { createRestDataSourceSchema } from "./restDataSourceSchema.js";
import { addPipelineRootHandler } from "./pipelinesHandlers.js";
import type { QueryParamPair } from "../types.js";

// D5: six pairs, non-alphabetical, non-adjacent duplicate ("tag" at index 1 and 3), no
// numeric-like names. Sorting by name OR grouping duplicates together would both change this
// order, so either mutation turns an assertion against it red.
const FIXTURE: QueryParamPair[] = [
  { name: "z", value: "1" },
  { name: "tag", value: "a" },
  { name: "alpha", value: "2" },
  { name: "tag", value: "b" },
  { name: "m", value: "3" },
  { name: "beta", value: "4" },
];

interface RecordedRequest {
  method: string | undefined;
  path: string | undefined;
  body: unknown;
}

/** Starts a real HTTP server recording every request's method/path/parsed-JSON-body, and a
 *  `HelioApi` pointed at it — the actual transport, not a stub. */
async function startHarness(): Promise<{
  api: HelioApi;
  requests: RecordedRequest[];
  close: () => Promise<void>;
}> {
  const requests: RecordedRequest[] = [];
  const server: http.Server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let body: unknown = undefined;
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw);
        } catch {
          body = raw;
        }
      }
      requests.push({ method: req.method, path: req.url, body });
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          source: { id: "src-1", name: "n", type: "rest_api", createdAt: "", updatedAt: "" },
          inferredSchema: null,
          fetchError: null,
        }),
      );
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const config: HelioConfig = { baseUrl: `http://127.0.0.1:${port}`, pat: "helio_pat_test" };
  const client = new HelioHttpClient(config);
  const api = new HelioApi(client);

  return {
    api,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

describe("HEL-982 queryParams ordering — real HTTP server, create_rest_data_source", () => {
  let harness: Awaited<ReturnType<typeof startHarness>>;

  afterEach(async () => {
    if (harness) {
      await harness.close();
      harness = undefined as unknown as typeof harness;
    }
  });

  it(
    "RED-BEFORE-FIX PROOF: the array fixture is rejected by the zod schema pre-fix, so the " +
      "capability is genuinely unreachable, not merely inconvenient (acceptance criterion 4)",
    () => {
      // This assertion is a permanent GREEN pin, not a live re-run of the old failing behavior --
      // the old schema is gone. The red transcript was captured manually before the fix landed
      // (see commit notes) by running this exact safeParse against the pre-fix
      // `z.record(z.string(), z.string())` schema, which rejected an array outright:
      //   { success: false, error: ZodError: [{ code: "invalid_type", expected: "object",
      //     received: "array", path: ["queryParams"], message: "Expected object, received array" }] }
      // Post-fix, the same input is accepted -- proving the schema is what changed.
      const result = createRestDataSourceSchema.safeParse({
        name: "Widgets",
        connectorId: "conn-1",
        queryParams: FIXTURE,
      });

      expect(result.success).toBe(true);
    },
  );

  it(
    "issues the request body with queryParams as the full ordered array fixture, both " +
      "duplicate entries present, in AUTHORED order (not alphabetical, not grouped)",
    async () => {
      harness = await startHarness();

      const parsed = createRestDataSourceSchema.parse({
        name: "Widgets",
        connectorId: "conn-1",
        queryParams: FIXTURE,
      });
      await harness.api.createRestDataSource(parsed);

      expect(harness.requests).toHaveLength(1);
      expect(harness.requests[0]?.method).toBe("POST");
      expect(harness.requests[0]?.path).toBe("/api/sources");
      const body = harness.requests[0]?.body as { config: { queryParams: unknown } };
      expect(body.config.queryParams).toEqual(FIXTURE);
    },
  );

  it(
    "legacy object encoding: forwarded UNCHANGED, proving criterion 3 / D3's no-normalization " +
      "rule (existing callers sending the object form are unaffected)",
    async () => {
      harness = await startHarness();

      const objectForm = { z: "1", tag: "b", alpha: "2" };
      const parsed = createRestDataSourceSchema.parse({
        name: "Widgets",
        connectorId: "conn-1",
        queryParams: objectForm,
      });
      await harness.api.createRestDataSource(parsed);

      const body = harness.requests[0]?.body as { config: { queryParams: unknown } };
      expect(body.config.queryParams).toEqual(objectForm);
    },
  );

  it("malformed array entry (missing `value`) fails validation loudly, not silently dropped", () => {
    const result = createRestDataSourceSchema.safeParse({
      name: "Widgets",
      connectorId: "conn-1",
      queryParams: [{ name: "tag" }],
    });

    expect(result.success).toBe(false);
  });

  it("malformed array entry (extra key) fails validation loudly via .strict() on the pair object", () => {
    const result = createRestDataSourceSchema.safeParse({
      name: "Widgets",
      connectorId: "conn-1",
      queryParams: [{ name: "tag", value: "a", extra: "nope" }],
    });

    expect(result.success).toBe(false);
  });

  it(
    "MUTATION-PROOF (sort-by-name): sorting the fixture the way a name-sorting handler bug " +
      "would turns the ordering assertion RED — recorded per design.md's mutation-proof step. " +
      "This test asserts the MUTATED (wrong) order does NOT match the real handler's output.",
    async () => {
      harness = await startHarness();
      const parsed = createRestDataSourceSchema.parse({
        name: "Widgets",
        connectorId: "conn-1",
        queryParams: FIXTURE,
      });
      await harness.api.createRestDataSource(parsed);

      const sortedByName = [...FIXTURE].sort((a, b) => a.name.localeCompare(b.name));
      const body = harness.requests[0]?.body as { config: { queryParams: unknown } };
      expect(body.config.queryParams).not.toEqual(sortedByName);
    },
  );

  it(
    "MUTATION-PROOF (group-duplicates): grouping the two `tag` entries together (destroying " +
      "their non-adjacent interleaving while preserving multiplicity) does not match real output",
    async () => {
      harness = await startHarness();
      const parsed = createRestDataSourceSchema.parse({
        name: "Widgets",
        connectorId: "conn-1",
        queryParams: FIXTURE,
      });
      await harness.api.createRestDataSource(parsed);

      const grouped = [
        FIXTURE[0]!,
        FIXTURE[1]!,
        FIXTURE[3]!, // both "tag" entries adjacent now
        FIXTURE[2]!,
        FIXTURE[4]!,
        FIXTURE[5]!,
      ];
      const body = harness.requests[0]?.body as { config: { queryParams: unknown } };
      expect(body.config.queryParams).not.toEqual(grouped);
    },
  );
});

describe("HEL-982 queryParams — inline pipeline root (create_pipeline / add_root)", () => {
  let harness: Awaited<ReturnType<typeof startHarness>>;

  afterEach(async () => {
    if (harness) {
      await harness.close();
      harness = undefined as unknown as typeof harness;
    }
  });

  // GUARD, not a proof (design.md D4): the inline-root path's `config.queryParams as
  // Record<string, string> | undefined` cast is a type-only assertion with no runtime effect,
  // so an array already flowed through to the backend BEFORE this fix -- there is no red-before
  // transcript for this path, and claiming one would be false. This test pins the (correct)
  // behavior the type system used to contradict, and is failable by mutating the handler to
  // collapse/reorder the value -- see the mutation-proof tests above for that failure mode.
  it("GUARD: the ordered array survives unmodified to the server for an inline rest_api root", async () => {
    harness = await startHarness();

    await addPipelineRootHandler(harness.api, {
      pipelineId: "pipeline-1",
      source: {
        type: "rest_api",
        name: "Inline REST Root",
        config: { connectorId: "conn-1", queryParams: FIXTURE },
      },
    });

    // Two real requests happen: POST /api/sources (inline source creation, carries
    // queryParams), then POST /api/pipelines/:id/roots (references the created source by id,
    // carries no queryParams). Only the first is this ticket's concern.
    expect(harness.requests).toHaveLength(2);
    expect(harness.requests[0]?.path).toBe("/api/sources");
    const body = harness.requests[0]?.body as { config: { queryParams: unknown } };
    expect(body.config.queryParams).toEqual(FIXTURE);
  });
});
