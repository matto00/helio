/**
 * HEL-1081 tasks.md 2.2 — handler-level tests for the new dataset row/schema
 * tools registered in `write.ts`/`read.ts` (append/replace/get rows,
 * update/delete row, get/update schema). Each new tool is a thin
 * `guarded(() => api.xxx(...))` wrapper (design.md Decision 6 — no branching
 * logic of its own), so these exercise the real MCP call path (a real
 * `Client`/`McpServer` pair over `InMemoryTransport`, same shape
 * `server.test.ts` already uses) against a fake `HelioApi`, rather than
 * reaching into `write.ts`'s internals directly.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../server.js";
import { HelioApiError } from "../httpClient.js";
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

describe("append_dataset_rows / replace_dataset_rows (HEL-1081)", () => {
  it("happy path: append_dataset_rows calls api.appendDatasetRows and returns its result", async () => {
    const calls: unknown[] = [];
    const fakeApi = {
      appendDatasetRows: async (dataSourceId: string, rows: unknown[][]) => {
        calls.push({ dataSourceId, rows });
        return { rows: [{ id: "r1", seq: 1, updatedAt: "t1" }], updatedAt: "t1" };
      },
    } as unknown as HelioApi;

    const { text, isError } = await callTool(fakeApi, "append_dataset_rows", {
      dataSourceId: "ds-1",
      rows: [["a", 1]],
    });

    expect(isError).toBe(false);
    expect(calls).toEqual([{ dataSourceId: "ds-1", rows: [["a", 1]] }]);
    expect(JSON.parse(text)).toEqual({
      rows: [{ id: "r1", seq: 1, updatedAt: "t1" }],
      updatedAt: "t1",
    });
  });

  it("a schema-violating row is rejected VERBATIM — the backend's message text is surfaced unchanged", async () => {
    const fakeApi = {
      appendDatasetRows: async () => {
        throw new HelioApiError(
          400,
          "https://helio.test/api/data-sources/ds-1/rows",
          "row 0: expected 2 values, got 1",
        );
      },
    } as unknown as HelioApi;

    const { text, isError } = await callTool(fakeApi, "append_dataset_rows", {
      dataSourceId: "ds-1",
      rows: [["only-one-value"]],
    });

    expect(isError).toBe(true);
    expect(text).toContain("row 0: expected 2 values, got 1");
  });

  it("happy path: replace_dataset_rows calls api.replaceDatasetRows with the full new set", async () => {
    const calls: unknown[] = [];
    const fakeApi = {
      replaceDatasetRows: async (dataSourceId: string, rows: unknown[][]) => {
        calls.push({ dataSourceId, rows });
        return { rows: [], updatedAt: "t2" };
      },
    } as unknown as HelioApi;

    const { isError } = await callTool(fakeApi, "replace_dataset_rows", {
      dataSourceId: "ds-1",
      rows: [],
    });

    expect(isError).toBe(false);
    expect(calls).toEqual([{ dataSourceId: "ds-1", rows: [] }]);
  });
});

describe("update_dataset_row / delete_dataset_row (HEL-1081)", () => {
  it("happy path: update_dataset_row forwards updatedAt/data and returns the edited row", async () => {
    const calls: unknown[] = [];
    const fakeApi = {
      updateDatasetRow: async (
        dataSourceId: string,
        rowId: string,
        updatedAt: string,
        data: unknown[],
      ) => {
        calls.push({ dataSourceId, rowId, updatedAt, data });
        return { row: { id: rowId, seq: 1, updatedAt: "t2", data }, sourceUpdatedAt: "t2" };
      },
    } as unknown as HelioApi;

    const { isError } = await callTool(fakeApi, "update_dataset_row", {
      dataSourceId: "ds-1",
      rowId: "r1",
      updatedAt: "t1",
      data: ["x"],
    });

    expect(isError).toBe(false);
    expect(calls).toEqual([{ dataSourceId: "ds-1", rowId: "r1", updatedAt: "t1", data: ["x"] }]);
  });

  it("a STALE updatedAt precondition conflict is rejected verbatim, never retried", async () => {
    let callCount = 0;
    const fakeApi = {
      updateDatasetRow: async () => {
        callCount += 1;
        throw new HelioApiError(
          409,
          "https://helio.test/api/data-sources/ds-1/rows/r1",
          "row was modified since updatedAt=t0",
        );
      },
    } as unknown as HelioApi;

    const { text, isError } = await callTool(fakeApi, "update_dataset_row", {
      dataSourceId: "ds-1",
      rowId: "r1",
      updatedAt: "t0",
      data: ["x"],
    });

    expect(isError).toBe(true);
    expect(text).toContain("row was modified since updatedAt=t0");
    expect(callCount).toBe(1); // never retried
  });

  it("delete_dataset_row happy path calls api.deleteDatasetRow with the query-param updatedAt", async () => {
    const calls: unknown[] = [];
    const fakeApi = {
      deleteDatasetRow: async (dataSourceId: string, rowId: string, updatedAt: string) => {
        calls.push({ dataSourceId, rowId, updatedAt });
        return { deleted: true, id: rowId };
      },
    } as unknown as HelioApi;

    const { isError } = await callTool(fakeApi, "delete_dataset_row", {
      dataSourceId: "ds-1",
      rowId: "r1",
      updatedAt: "t1",
    });

    expect(isError).toBe(false);
    expect(calls).toEqual([{ dataSourceId: "ds-1", rowId: "r1", updatedAt: "t1" }]);
  });

  it("delete_dataset_row's stale-precondition conflict is also rejected verbatim, never retried", async () => {
    let callCount = 0;
    const fakeApi = {
      deleteDatasetRow: async () => {
        callCount += 1;
        throw new HelioApiError(409, "https://helio.test/x", "row was modified since updatedAt=t0");
      },
    } as unknown as HelioApi;

    const { text, isError } = await callTool(fakeApi, "delete_dataset_row", {
      dataSourceId: "ds-1",
      rowId: "r1",
      updatedAt: "t0",
    });

    expect(isError).toBe(true);
    expect(text).toContain("row was modified since updatedAt=t0");
    expect(callCount).toBe(1);
  });
});

describe("update_dataset_schema (HEL-1081)", () => {
  it("happy path: rename via previousName forwards unchanged and returns the resulting schema", async () => {
    const calls: unknown[] = [];
    const fakeApi = {
      updateDatasetSchema: async (
        dataSourceId: string,
        fields: unknown[],
        confirmDrop: boolean,
      ) => {
        calls.push({ dataSourceId, fields, confirmDrop });
        return { fields: [{ name: "newName", type: "string", required: false }], rowsMigrated: 3 };
      },
    } as unknown as HelioApi;

    const { isError } = await callTool(fakeApi, "update_dataset_schema", {
      dataSourceId: "ds-1",
      fields: [{ name: "newName", previousName: "oldName", type: "string" }],
    });

    expect(isError).toBe(false);
    expect(calls).toEqual([
      {
        dataSourceId: "ds-1",
        fields: [{ name: "newName", previousName: "oldName", type: "string" }],
        confirmDrop: false, // omitted confirmDrop defaults to false, never left undefined
      },
    ]);
  });

  it("a destructive edit WITHOUT confirmDrop is rejected verbatim, naming the rejected field", async () => {
    const fakeApi = {
      updateDatasetSchema: async () => {
        throw new HelioApiError(
          409,
          "https://helio.test/api/data-sources/ds-1/schema",
          'field "legacyCol" has existing data; pass confirmDrop: true to drop it',
        );
      },
    } as unknown as HelioApi;

    const { text, isError } = await callTool(fakeApi, "update_dataset_schema", {
      dataSourceId: "ds-1",
      fields: [{ name: "keptCol", type: "string" }],
    });

    expect(isError).toBe(true);
    expect(text).toContain("legacyCol");
    expect(text).toContain("confirmDrop: true");
  });

  it("confirmDrop: true is forwarded through when the caller opts into the destructive edit", async () => {
    const calls: unknown[] = [];
    const fakeApi = {
      updateDatasetSchema: async (
        dataSourceId: string,
        fields: unknown[],
        confirmDrop: boolean,
      ) => {
        calls.push({ dataSourceId, fields, confirmDrop });
        return { fields: [], rowsMigrated: 5 };
      },
    } as unknown as HelioApi;

    await callTool(fakeApi, "update_dataset_schema", {
      dataSourceId: "ds-1",
      fields: [{ name: "keptCol", type: "string" }],
      confirmDrop: true,
    });

    expect((calls[0] as { confirmDrop: boolean }).confirmDrop).toBe(true);
  });
});
