/**
 * HEL-862 — `HelioApi.createCsvDataSource`'s transport dispatch: `content`
 * posts `multipart/form-data` unchanged; `sourceUrl` posts a JSON `{name,
 * type: "csv", config: {url}, tag?}` body to the same endpoint. `fetch` is
 * injected (mirrors `httpClient.test.ts`'s harness) so these tests assert
 * the REQUEST SHAPE without a real network call.
 */

import { HelioApi } from "./helioApi.js";
import { HelioHttpClient, type HelioRequestInit } from "./httpClient.js";
import type { HelioConfig } from "./config.js";

const config: HelioConfig = { baseUrl: "https://helio.test", pat: "pat-abc" } as HelioConfig;

function reply(status: number, body: unknown) {
  return {
    status,
    statusText: String(status),
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

function harness() {
  const calls: { url: string; init: HelioRequestInit }[] = [];
  const fetchImpl = (url: string, init: HelioRequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(
      reply(201, { id: "ds-1", name: "n", type: "csv", createdAt: "", updatedAt: "" }),
    );
  };
  const client = new HelioHttpClient(config, { fetchImpl });
  return { api: new HelioApi(client), calls };
}

describe("HelioApi.createCsvDataSource", () => {
  it("posts multipart/form-data when content is supplied, unchanged from before HEL-862", async () => {
    const { api, calls } = harness();
    await api.createCsvDataSource({ name: "Sales", content: "a,b\n1,2" });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.body).toBeInstanceOf(FormData);
  });

  it("posts a JSON {name, type: csv, config: {url}} body when sourceUrl is supplied, not multipart", async () => {
    const { api, calls } = harness();
    await api.createCsvDataSource({ name: "Sales", sourceUrl: "https://example.com/data.csv" });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.init.body).not.toBeInstanceOf(FormData);
    const parsedBody = JSON.parse(calls[0]?.init.body as string);
    expect(parsedBody).toEqual({
      name: "Sales",
      type: "csv",
      config: { url: "https://example.com/data.csv" },
      tag: undefined,
    });
  });

  it("propagates tag on the JSON create path", async () => {
    const { api, calls } = harness();
    await api.createCsvDataSource({
      name: "Sales",
      sourceUrl: "https://example.com/data.csv",
      tag: "workflow-1",
    });

    const parsedBody = JSON.parse(calls[0]?.init.body as string);
    expect(parsedBody.tag).toBe("workflow-1");
  });
});

// HEL-863 tasks.md 7.1/7.2/7.5/7.7 — schedule + dashboard-rename transport
// dispatch. These assert request PATH and METHOD, which is out of reach for
// a handler-level test against a fake `HelioApi` (scheduleTools.test.ts):
// this is the layer that actually builds the URL/verb.
describe("HelioApi pipeline schedule + dashboard rename methods", () => {
  it("setPipelineSchedule PUTs to /api/pipelines/:id/schedule with a body carrying no `enabled` key when omitted", async () => {
    const { api, calls } = harness();
    await api.setPipelineSchedule("pipe-1", {
      kind: "cron",
      expression: "0 9 * * *",
      timezone: "UTC",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.init.method).toBe("PUT");
    expect(calls[0]?.url).toBe("https://helio.test/api/pipelines/pipe-1/schedule");
    const body = JSON.parse(calls[0]?.init.body as string);
    expect("enabled" in body).toBe(false);
  });

  it("issues two PUTs to the SAME path on a second call against the same pipeline (upsert, not a create/update fork)", async () => {
    const { api, calls } = harness();
    const body = { kind: "cron", expression: "0 9 * * *", timezone: "UTC" };
    await api.setPipelineSchedule("pipe-1", body);
    await api.setPipelineSchedule("pipe-1", body);

    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe(calls[1]?.url);
    expect(calls[0]?.init.method).toBe("PUT");
    expect(calls[1]?.init.method).toBe("PUT");
  });

  it("getPipelineSchedule GETs /api/pipelines/:id/schedule", async () => {
    const { api, calls } = harness();
    await api.getPipelineSchedule("pipe-1");

    expect(calls[0]?.init.method).toBe("GET");
    expect(calls[0]?.url).toBe("https://helio.test/api/pipelines/pipe-1/schedule");
  });

  it("deletePipelineSchedule DELETEs /api/pipelines/:id/schedule and returns { deleted: true, pipelineId }", async () => {
    const calls: { url: string; init: HelioRequestInit }[] = [];
    const fetchImpl = (url: string, init: HelioRequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(reply(204, undefined));
    };
    const client = new HelioHttpClient(config, { fetchImpl });
    const api = new HelioApi(client);

    const result = await api.deletePipelineSchedule("pipe-1");

    expect(calls[0]?.init.method).toBe("DELETE");
    expect(calls[0]?.url).toBe("https://helio.test/api/pipelines/pipe-1/schedule");
    expect(result).toEqual({ deleted: true, pipelineId: "pipe-1" });
  });

  it("updateDashboard PATCHes /api/dashboards/:id with a body of exactly { name }", async () => {
    const { api, calls } = harness();
    await api.updateDashboard("dash-1", "New Name");

    expect(calls[0]?.init.method).toBe("PATCH");
    expect(calls[0]?.url).toBe("https://helio.test/api/dashboards/dash-1");
    const body = JSON.parse(calls[0]?.init.body as string);
    expect(body).toEqual({ name: "New Name" });
    expect(Object.keys(body)).toEqual(["name"]);
  });
});

/**
 * HEL-934/HEL-907 task 3.12 — `expandPipelineShape`'s real wire response is
 * `{steps, outputs?}` (`ExpandPipelineShapeResponse`), not a bare
 * `ShapeStepExpansionResponse[]`. The pre-fix method typed (and returned) the
 * raw HTTP body as if it WERE the bare array -- every real caller iterating
 * the result directly would throw at runtime the first time a shape expanded
 * to any steps. This test exercises the REAL HTTP-layer parsing (not a
 * mocked `HelioApi`, which is what every other test of this method's callers
 * used and which never touched this bug at all) to prove the fix.
 */
describe("HelioApi.expandPipelineShape (HEL-934 envelope unwrap)", () => {
  function harnessWithReply(body: unknown) {
    const calls: { url: string; init: HelioRequestInit }[] = [];
    const fetchImpl = (url: string, init: HelioRequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(reply(200, body));
    };
    const client = new HelioHttpClient(config, { fetchImpl });
    return { api: new HelioApi(client), calls };
  }

  it("unwraps the real {steps, outputs} envelope, returning just the steps array", async () => {
    const { api, calls } = harnessWithReply({
      steps: [
        { kind: "sort", config: { field: "revenue" } },
        { kind: "limit", config: { count: 10 } },
      ],
      outputs: null,
    });

    const result = await api.expandPipelineShape("top-n", { measure: "revenue", n: 10 });

    expect(result).toEqual([
      { kind: "sort", config: { field: "revenue" } },
      { kind: "limit", config: { count: 10 } },
    ]);
    expect(calls[0]?.url).toBe("https://helio.test/api/pipeline-shapes/top-n/expand");
  });

  it("returns [] for a shape that expands to zero steps, without throwing", async () => {
    const { api } = harnessWithReply({ steps: [], outputs: null });

    const result = await api.expandPipelineShape("passthrough", { fields: [] });

    expect(result).toEqual([]);
  });
});

/**
 * HEL-934/HEL-907 task 3.12 — `DELETE /api/pipeline-steps/:id` answers `200`
 * with a real `{removedTailStepCount}` splice-on-delete report, not an empty
 * `204` like every other delete endpoint. The pre-fix method discarded the
 * response body entirely.
 */
describe("HelioApi.deletePipelineStep (HEL-934 removedTailStepCount surfaced)", () => {
  it("reads and surfaces removedTailStepCount from the real 200 response body", async () => {
    const calls: { url: string; init: HelioRequestInit }[] = [];
    const fetchImpl = (url: string, init: HelioRequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(reply(200, { removedTailStepCount: 3 }));
    };
    const client = new HelioHttpClient(config, { fetchImpl });
    const api = new HelioApi(client);

    const result = await api.deletePipelineStep("step-1");

    expect(calls[0]?.init.method).toBe("DELETE");
    expect(calls[0]?.url).toBe("https://helio.test/api/pipeline-steps/step-1");
    expect(result).toEqual({ deleted: true, id: "step-1", removedTailStepCount: 3 });
  });

  it("surfaces removedTailStepCount: 0 for a leaf step with no descendants", async () => {
    const fetchImpl = () => Promise.resolve(reply(200, { removedTailStepCount: 0 }));
    const client = new HelioHttpClient(config, { fetchImpl });
    const api = new HelioApi(client);

    const result = await api.deletePipelineStep("step-leaf");

    expect(result).toEqual({ deleted: true, id: "step-leaf", removedTailStepCount: 0 });
  });
});

/**
 * HEL-1081 — transport dispatch for the new dataset rows/schema methods.
 * `deleteDatasetRow`'s query-string encoding of `updatedAt` is the one
 * genuinely new transport behavior (task 2.1); the rest assert path/method/
 * body shape the same way the schedule/dashboard-rename tests above do.
 */
describe("HelioApi dataset rows/schema methods (HEL-1081)", () => {
  it("appendDatasetRows POSTs to /rows with a {rows} body", async () => {
    const calls: { url: string; init: HelioRequestInit }[] = [];
    const fetchImpl = (url: string, init: HelioRequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(reply(200, { rows: [], updatedAt: "t1" }));
    };
    const api = new HelioApi(new HelioHttpClient(config, { fetchImpl }));

    await api.appendDatasetRows("ds-1", [["a", 1]]);

    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.url).toBe("https://helio.test/api/data-sources/ds-1/rows");
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({ rows: [["a", 1]] });
  });

  it("replaceDatasetRows PUTs to /rows with a {rows} body", async () => {
    const calls: { url: string; init: HelioRequestInit }[] = [];
    const fetchImpl = (url: string, init: HelioRequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(reply(200, { rows: [], updatedAt: "t1" }));
    };
    const api = new HelioApi(new HelioHttpClient(config, { fetchImpl }));

    await api.replaceDatasetRows("ds-1", []);

    expect(calls[0]?.init.method).toBe("PUT");
    expect(calls[0]?.url).toBe("https://helio.test/api/data-sources/ds-1/rows");
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({ rows: [] });
  });

  it("getDatasetRows GETs /rows with cursor/limit query params, response parsed verbatim", async () => {
    const calls: { url: string; init: HelioRequestInit }[] = [];
    const fetchImpl = (url: string, init: HelioRequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(reply(200, { rows: [], nextCursor: 42, total: 100 }));
    };
    const api = new HelioApi(new HelioHttpClient(config, { fetchImpl }));

    const result = await api.getDatasetRows("ds-1", 10, 25);

    expect(calls[0]?.init.method).toBe("GET");
    expect(calls[0]?.url).toBe("https://helio.test/api/data-sources/ds-1/rows?cursor=10&limit=25");
    expect(result).toEqual({ rows: [], nextCursor: 42, total: 100 });
  });

  it("getDatasetSchema GETs /schema", async () => {
    const calls: { url: string; init: HelioRequestInit }[] = [];
    const fetchImpl = (url: string, init: HelioRequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(reply(200, { fields: [] }));
    };
    const api = new HelioApi(new HelioHttpClient(config, { fetchImpl }));

    await api.getDatasetSchema("ds-1");

    expect(calls[0]?.init.method).toBe("GET");
    expect(calls[0]?.url).toBe("https://helio.test/api/data-sources/ds-1/schema");
  });

  it("updateDatasetSchema PATCHes /schema with {fields, confirmDrop}", async () => {
    const calls: { url: string; init: HelioRequestInit }[] = [];
    const fetchImpl = (url: string, init: HelioRequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(reply(200, { fields: [], rowsMigrated: 0 }));
    };
    const api = new HelioApi(new HelioHttpClient(config, { fetchImpl }));

    await api.updateDatasetSchema("ds-1", [{ name: "a", type: "string" }], true);

    expect(calls[0]?.init.method).toBe("PATCH");
    expect(calls[0]?.url).toBe("https://helio.test/api/data-sources/ds-1/schema");
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
      fields: [{ name: "a", type: "string" }],
      confirmDrop: true,
    });
  });

  it("updateDatasetRow PATCHes /rows/:rowId with {updatedAt, data} in the BODY", async () => {
    const calls: { url: string; init: HelioRequestInit }[] = [];
    const fetchImpl = (url: string, init: HelioRequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(
        reply(200, {
          row: { id: "r1", seq: 1, updatedAt: "t2", data: ["x"] },
          sourceUpdatedAt: "t2",
        }),
      );
    };
    const api = new HelioApi(new HelioHttpClient(config, { fetchImpl }));

    await api.updateDatasetRow("ds-1", "r1", "t1", ["x"]);

    expect(calls[0]?.init.method).toBe("PATCH");
    expect(calls[0]?.url).toBe("https://helio.test/api/data-sources/ds-1/rows/r1");
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({ updatedAt: "t1", data: ["x"] });
  });

  it("deleteDatasetRow DELETEs /rows/:rowId with updatedAt as a QUERY parameter, not the body", async () => {
    const calls: { url: string; init: HelioRequestInit }[] = [];
    const fetchImpl = (url: string, init: HelioRequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(reply(204, undefined));
    };
    const api = new HelioApi(new HelioHttpClient(config, { fetchImpl }));

    const result = await api.deleteDatasetRow("ds-1", "r1", "2026-09-12T00:00:00Z");

    expect(calls[0]?.init.method).toBe("DELETE");
    expect(calls[0]?.url).toBe(
      "https://helio.test/api/data-sources/ds-1/rows/r1?updatedAt=2026-09-12T00%3A00%3A00Z",
    );
    expect(calls[0]?.init.body).toBeUndefined();
    expect(result).toEqual({ deleted: true, id: "r1" });
  });
});

/**
 * HEL-1081 skeptic round-2 note 3 — `createDataSource`'s per-column
 * `default` forwarding must distinguish "no default supplied" (key absent
 * entirely) from "an explicit null default" (key present, value `null`) —
 * both would collapse to the same `undefined` under a naive
 * `c.default !== undefined` check.
 */
describe("HelioApi.createDataSource default forwarding (absent vs explicit null, HEL-1081)", () => {
  it("omits the default key entirely when the column has no default", async () => {
    const calls: { url: string; init: HelioRequestInit }[] = [];
    const fetchImpl = (url: string, init: HelioRequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(
        reply(201, { id: "ds-1", name: "n", type: "dataset", createdAt: "", updatedAt: "" }),
      );
    };
    const api = new HelioApi(new HelioHttpClient(config, { fetchImpl }));

    await api.createDataSource({
      name: "n",
      columns: [{ name: "a", type: "string" }],
      rows: [],
    });

    const body = JSON.parse(calls[0]?.init.body as string);
    expect(body.columns[0]).toEqual({ name: "a", type: "string" });
    expect("default" in body.columns[0]).toBe(false);
  });

  it("forwards an explicit null default as a real default: null key", async () => {
    const calls: { url: string; init: HelioRequestInit }[] = [];
    const fetchImpl = (url: string, init: HelioRequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(
        reply(201, { id: "ds-1", name: "n", type: "dataset", createdAt: "", updatedAt: "" }),
      );
    };
    const api = new HelioApi(new HelioHttpClient(config, { fetchImpl }));

    await api.createDataSource({
      name: "n",
      columns: [{ name: "a", type: "string", default: null, required: true }],
      rows: [],
    });

    const body = JSON.parse(calls[0]?.init.body as string);
    expect(body.columns[0]).toEqual({ name: "a", type: "string", required: true, default: null });
  });
});
