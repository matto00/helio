/**
 * HEL-1013 — `pagination` on a REST source, MCP half. Covers (1) the zod schema, (2) the two forwarding sites an agent can
 * reach (the `create_rest_data_source` handler and an inline `rest_api` pipeline root) asserted against a real `node:http`
 * server so the outgoing `POST /api/sources` body is what is checked, and (3) the `pagingNotice` relay.
 *
 * The seam tests go red when a forward is removed: the zod schema accepts `pagination` regardless, so only the body the
 * server receives can prove it was sent.
 */

import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { HelioApi } from "../helioApi.js";
import { HelioHttpClient } from "../httpClient.js";
import type { HelioConfig } from "../config.js";
import { createRestDataSourceSchema } from "./restDataSourceSchema.js";
import { addPipelineRootHandler } from "./pipelinesHandlers.js";
import { registerWriteTools } from "./write.js";

const PAGING_NOTICE = "This response looks paged: the source may be limited to its first page.";

interface RecordedRequest {
  path: string | undefined;
  body: unknown;
}

async function startHarness(inferredSchema: unknown): Promise<{
  api: HelioApi;
  requests: RecordedRequest[];
  close: () => Promise<void>;
}> {
  const requests: RecordedRequest[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      requests.push({ path: req.url, body: raw.length > 0 ? JSON.parse(raw) : undefined });
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          source: { id: "src-1", name: "n", type: "rest_api", createdAt: "", updatedAt: "" },
          inferredSchema,
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const config: HelioConfig = { baseUrl: `http://127.0.0.1:${port}`, pat: "helio_pat_test" };
  return {
    api: new HelioApi(new HelioHttpClient(config)),
    requests,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

const base = { name: "Widgets", connectorId: "conn-1" };

describe("createRestDataSourceSchema pagination", () => {
  const valid = [
    { style: "link" },
    { style: "next_url", nextUrlPath: "meta.next" },
    { style: "cursor", cursorPath: "meta.next", cursorParam: "after", maxRequests: 100 },
    { style: "page", pageParam: "p", startPage: 0, pageSizeParam: "per", pageSize: 50 },
    { style: "offset", limit: 25, offsetParam: "skip", limitParam: "take", maxRequests: 1 },
  ];
  it.each(valid)("accepts %j", (pagination) => {
    expect(createRestDataSourceSchema.safeParse({ ...base, pagination }).success).toBe(true);
  });

  const invalid: unknown[] = [
    { style: "offset" },
    { style: "cursor", cursorPath: "a" },
    { style: "next_url" },
    { style: "link", maxRequests: 0 },
    { style: "link", maxRequests: 101 },
    { style: "link", maxRequests: 1.5 },
    { style: "offset", limit: 0 },
    { style: "page", pageSize: 0 },
    { style: "page", startPage: 1000001 },
    { style: "bogus" },
    {},
    { style: "link", surprise: true },
    { style: "link", cursorPath: "a" },
  ];
  it.each(invalid)("rejects %j", (pagination) => {
    expect(createRestDataSourceSchema.safeParse({ ...base, pagination }).success).toBe(false);
  });
});

describe("HEL-1013 pagination forwarding — real HTTP server", () => {
  let harness: Awaited<ReturnType<typeof startHarness>>;
  const pagination = {
    style: "cursor",
    cursorPath: "meta.next",
    cursorParam: "after",
    maxRequests: 7,
  };

  afterEach(async () => {
    await harness?.close();
  });

  it("the create_rest_data_source tool handler sends pagination in the POST /api/sources body", async () => {
    harness = await startHarness(undefined);
    const handlers: Record<string, (args: unknown) => Promise<unknown>> = {};
    registerWriteTools(
      {
        registerTool: (
          name: string,
          _def: unknown,
          handler: (args: unknown) => Promise<unknown>,
        ) => {
          handlers[name] = handler;
        },
      } as never,
      harness.api,
    );

    await handlers["create_rest_data_source"]!(
      createRestDataSourceSchema.parse({ ...base, pagination }),
    );

    expect(harness.requests).toHaveLength(1);
    expect(harness.requests[0]?.path).toBe("/api/sources");
    expect(
      (harness.requests[0]?.body as { config: { pagination: unknown } }).config.pagination,
    ).toEqual(pagination);
  });

  it("an inline rest_api pipeline root sends pagination in the POST /api/sources body", async () => {
    harness = await startHarness(undefined);

    await addPipelineRootHandler(harness.api, {
      pipelineId: "pipeline-1",
      source: { type: "rest_api", name: "Inline", config: { connectorId: "conn-1", pagination } },
    });

    expect(harness.requests[0]?.path).toBe("/api/sources");
    expect(
      (harness.requests[0]?.body as { config: { pagination: unknown } }).config.pagination,
    ).toEqual(pagination);
  });

  it("sends no pagination key at all when none is given", async () => {
    harness = await startHarness(undefined);
    await harness.api.createRestDataSource({ name: "n", connectorId: "c" });
    expect(
      (harness.requests[0]?.body as { config: Record<string, unknown> }).config,
    ).not.toHaveProperty("pagination");
  });
});

describe("HEL-1013 pagingNotice relay", () => {
  let harness: Awaited<ReturnType<typeof startHarness>>;
  afterEach(async () => {
    await harness?.close();
  });

  it("relays inferredSchema.pagingNotice into the create result", async () => {
    harness = await startHarness({ fields: [], pagingNotice: PAGING_NOTICE });
    const result = await harness.api.createRestDataSource({ name: "n", connectorId: "c" });
    expect(result.pagingNotice).toBe(PAGING_NOTICE);
  });

  it("reports null when the response carried no notice, or no inferred schema", async () => {
    harness = await startHarness({ fields: [] });
    expect(
      (await harness.api.createRestDataSource({ name: "n", connectorId: "c" })).pagingNotice,
    ).toBeNull();
    await harness.close();
    harness = await startHarness(undefined);
    expect(
      (await harness.api.createRestDataSource({ name: "n", connectorId: "c" })).pagingNotice,
    ).toBeNull();
  });
});
