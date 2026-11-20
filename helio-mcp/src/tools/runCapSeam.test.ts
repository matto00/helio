/**
 * HEL-1696 -- the apply tools return the backend's capped run result unchanged. The `run` is the body the real
 * `POST /api/pipelines/:id/run` route writes (`shared-test-fixtures/pipeline-run/run-capped-response.json`, held to the
 * server by PipelineRunResponseCapSpec): 10 preview rows, the true `rowCount` and `rowsTruncated`. The tool descriptions say
 * so and point at `get_output_rows` for the full data.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { connectMcp, resultText, type FakeFetch } from "../testing/mcpFetchHarness.js";

const run = JSON.parse(
  readFileSync(
    path.resolve(__dirname, "../../../shared-test-fixtures/pipeline-run/run-capped-response.json"),
    "utf8",
  ),
) as { rows: unknown[]; rowCount: number; rowsTruncated: boolean };

const pipeline = { pipelineName: "Cap", roots: [{ sourceId: "source-1" }], steps: [], outputs: [] };

const applyResponse = {
  sources: [],
  pipeline: { id: "p-1", name: "Cap", roots: [] },
  outputs: [],
  run,
};

function fakeFetch(): FakeFetch {
  return (url) => {
    const p = new URL(url).pathname;
    if (p === "/api/pipelines/apply-proposal") return { status: 201, body: applyResponse };
    if (p === "/api/proposals/apply")
      return {
        status: 201,
        body: { pipeline: applyResponse, dashboard: { dashboard: {}, panels: [] } },
      };
    return { status: 500, body: { message: `unexpected ${p}` } };
  };
}

describe("apply tools and the capped run result", () => {
  it("apply_pipeline_proposal passes the capped run through intact", async () => {
    const h = await connectMcp(fakeFetch());
    try {
      const result = await h.client.callTool({
        name: "apply_pipeline_proposal",
        arguments: pipeline,
      });
      const body = JSON.parse(resultText(result)) as { run: typeof run };
      expect(body.run.rows).toHaveLength(10);
      expect(body.run.rowCount).toBe(25);
      expect(body.run.rowsTruncated).toBe(true);
    } finally {
      await h.close();
    }
  });

  it("apply_combined_proposal passes the capped run through intact", async () => {
    const h = await connectMcp(fakeFetch());
    try {
      const result = await h.client.callTool({
        name: "apply_combined_proposal",
        arguments: { pipeline, dashboard: { dashboardName: "D", panels: [] } },
      });
      const body = JSON.parse(resultText(result)) as { pipeline: { run: typeof run } };
      expect(body.pipeline.run.rowCount).toBe(25);
      expect(body.pipeline.run.rowsTruncated).toBe(true);
    } finally {
      await h.close();
    }
  });

  it.each(["apply_pipeline_proposal", "apply_combined_proposal"])(
    "%s describes the 10-row preview and where the full data is",
    async (name) => {
      const h = await connectMcp(fakeFetch());
      try {
        const tool = (await h.client.listTools()).tools.find((t) => t.name === name);
        expect(tool?.description).toContain("at most 10");
        expect(tool?.description).toContain("rowsTruncated");
        expect(tool?.description).toContain("get_output_rows");
      } finally {
        await h.close();
      }
    },
  );
});
