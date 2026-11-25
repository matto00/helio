/** HEL-1160 -- a rejected id is a typed isError tool result and no request is sent. */
import { connectMcp, resultText, type FakeFetch } from "./testing/mcpFetchHarness.js";

const BAD = "1/../../tokens";

function recorder() {
  const urls: string[] = [];
  const fake: FakeFetch = (url) => {
    urls.push(url);
    return { status: 200, body: { items: [], total: 0, offset: 0, limit: 200 } };
  };
  return { urls, fake };
}

describe("tool-level path id rejection", () => {
  it.each([
    ["get_pipeline", { pipelineId: BAD }],
    ["list_source_objects", { sourceId: BAD }],
    ["get_dashboard", { dashboardId: BAD }],
  ])("%s with a traversal id returns isError and makes no request", async (name, args) => {
    const { urls, fake } = recorder();
    const h = await connectMcp(fake);
    try {
      const result = await h.client.callTool({ name, arguments: args });
      expect(result.isError).toBe(true);
      const text = resultText(result);
      expect(text).toContain("HelioInvalidIdError");
      expect(text).toContain(BAD);
      expect(urls).toEqual([]);
    } finally {
      await h.close();
    }
  });

  it("a UUID id still reaches the expected URL", async () => {
    const id = "3f2b8c1e-7a4d-4e0b-9c51-0d6a2f9b1e77";
    const urls: string[] = [];
    const h = await connectMcp((url) => {
      urls.push(new URL(url).pathname);
      return { status: 200, body: { id, name: "p" } };
    });
    try {
      await h.client.callTool({ name: "get_pipeline", arguments: { pipelineId: id } });
      expect(urls).toContain(`/api/pipelines/${id}`);
      expect(urls).toContain(`/api/pipelines/${id}/steps`);
    } finally {
      await h.close();
    }
  });
});
