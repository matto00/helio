/**
 * HEL-1081 tasks.md 2.2 (skeptic round-2 note 2) — this file did not exist
 * before this ticket; created here for the new `get_dataset_rows`/
 * `get_dataset_schema` read tools. Same real-`Client`/`McpServer`-over-
 * `InMemoryTransport` harness as `server.test.ts` (a thin
 * `guarded(() => api.xxx(...))` wrapper has no logic of its own worth
 * unit-testing below the MCP call boundary).
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../server.js";
import type { HelioApi } from "../helioApi.js";

async function callTool(
  api: HelioApi,
  name: string,
  args: Record<string, unknown>,
): Promise<{ text: string; isError: boolean }> {
  const server = createServer(api);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({ name, arguments: args });
    const content = result.content as Array<{ type: string; text: string }>;
    return {
      text: content.find((c) => c.type === "text")?.text ?? "",
      isError: Boolean(result.isError),
    };
  } finally {
    await client.close();
    await server.close();
  }
}

describe("get_dataset_rows / get_dataset_schema (HEL-1081, read tools)", () => {
  it("get_dataset_rows forwards a NUMERIC cursor and returns nextCursor/total verbatim", async () => {
    const calls: unknown[] = [];
    const fakeApi = {
      getDatasetRows: async (dataSourceId: string, cursor?: number, limit?: number) => {
        calls.push({ dataSourceId, cursor, limit });
        return { rows: [], nextCursor: 99, total: 500 };
      },
    } as unknown as HelioApi;

    const { text, isError } = await callTool(fakeApi, "get_dataset_rows", {
      dataSourceId: "ds-1",
      cursor: 42,
      limit: 100,
    });

    expect(isError).toBe(false);
    expect(calls).toEqual([{ dataSourceId: "ds-1", cursor: 42, limit: 100 }]);
    expect(JSON.parse(text)).toEqual({ rows: [], nextCursor: 99, total: 500 });
  });

  it("get_dataset_rows: nextCursor is genuinely ABSENT on the last page, not null", async () => {
    const fakeApi = {
      getDatasetRows: async () => ({ rows: [], total: 3 }),
    } as unknown as HelioApi;

    const { text } = await callTool(fakeApi, "get_dataset_rows", { dataSourceId: "ds-1" });

    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect("nextCursor" in parsed).toBe(false);
  });

  it("get_dataset_schema happy path returns fields verbatim", async () => {
    const fakeApi = {
      getDatasetSchema: async (dataSourceId: string) => {
        expect(dataSourceId).toBe("ds-1");
        return { fields: [{ name: "a", type: "string", required: true }] };
      },
    } as unknown as HelioApi;

    const { text, isError } = await callTool(fakeApi, "get_dataset_schema", {
      dataSourceId: "ds-1",
    });

    expect(isError).toBe(false);
    expect(JSON.parse(text)).toEqual({ fields: [{ name: "a", type: "string", required: true }] });
  });
});
