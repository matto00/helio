/**
 * Drift guard for `verify.ts` (HEL-1264). Drives every write payload verify sends through the REAL
 * registered tool over an in-process MCP client, so a payload the tool's input schema rejects (the
 * HEL-913 `roots: Required` break) fails here with no backend. Bound to the live tool schema, not
 * `schemas/`: MCP inputs use `config` where the HTTP body uses `staticConfig`, so `schemas/` is the
 * wrong contract for this layer.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import type { HelioApi } from "../src/helioApi.js";
import * as payloads from "./verifyPayloads.js";
import type { VerifyToolCall } from "./verifyPayloads.js";

const RUN_ID = "drift00";
const PIPELINE_ID = "pipeline-stub";

/** Records which HelioApi methods a handler reached; a call that fails input validation never reaches one. */
function stubApi(reached: string[]): HelioApi {
  const record =
    <T>(method: string, value: T) =>
    async (): Promise<T> => {
      reached.push(method);
      return value;
    };
  return {
    createDataSource: record("createDataSource", { id: "source-stub" }),
    createPipeline: record("createPipeline", { id: PIPELINE_ID, name: "n", roots: [] }),
    expandPipelineShape: record("expandPipelineShape", [{ kind: "sort", config: {} }]),
    listPipelineSteps: record("listPipelineSteps", []),
    addPipelineStep: record("addPipelineStep", { id: "step-stub" }),
    createOutput: record("createOutput", { id: "output-stub" }),
    listOutputsByPipeline: record("listOutputsByPipeline", { items: [] }),
  } as unknown as HelioApi;
}

async function callThroughRealServer(call: VerifyToolCall): Promise<{
  reached: string[];
  isError: boolean;
  text: string;
}> {
  const reached: string[] = [];
  const server = createServer(stubApi(reached));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "drift-guard", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = (await client.callTool(call)) as {
      isError?: boolean;
      content: Array<{ type: string; text?: string }>;
    };
    return {
      reached,
      isError: Boolean(result.isError),
      text: result.content.map((c) => c.text ?? "").join("\n"),
    };
  } finally {
    await client.close();
    await server.close();
  }
}

const CALLS: Array<[string, VerifyToolCall, string]> = [
  ["buildCreatePipelineCall", payloads.buildCreatePipelineCall(RUN_ID), "createPipeline"],
  ["buildAddTopNOutputCall", payloads.buildAddTopNOutputCall(PIPELINE_ID, RUN_ID), "createOutput"],
  [
    "buildAddInvalidParamsCall",
    payloads.buildAddInvalidParamsCall(PIPELINE_ID, RUN_ID),
    "expandPipelineShape",
  ],
  [
    "buildAddUnknownShapeCall",
    payloads.buildAddUnknownShapeCall(PIPELINE_ID, RUN_ID),
    "expandPipelineShape",
  ],
];

describe("verify.ts write payloads vs the registered tool input schemas", () => {
  it.each(CALLS)("%s passes input validation and reaches its handler", async (_n, call, method) => {
    const { reached, isError, text } = await callThroughRealServer(call);

    expect(text).not.toMatch(/invalid|required/i);
    expect(isError).toBe(false);
    expect(reached).toContain(method);
  });

  it("sends create_pipeline a non-empty roots array and no retired source field", () => {
    const args = payloads.buildCreatePipelineCall(RUN_ID).arguments;

    expect(Array.isArray(args.roots) && args.roots.length > 0).toBe(true);
    expect(args).not.toHaveProperty("source");
  });
});

describe("verify.ts only makes write calls that have a checked payload", () => {
  const verifySource = readFileSync(join(__dirname, "verify.ts"), "utf8");
  const READ_PREFIX = /^(list_|get_|analyze_)/;

  it("has no hand-written write-tool call outside the payload builders", () => {
    const literalTools = [...verifySource.matchAll(/\bname:\s*"([a-z_]+)"/g)].map(
      (m) => m[1] ?? "",
    );
    const unchecked = literalTools.filter((t) => !READ_PREFIX.test(t));

    expect(unchecked).toEqual([]);
  });

  it("calls every exported payload builder", () => {
    for (const builder of payloads.VERIFY_WRITE_BUILDERS) {
      expect(verifySource).toContain(`${builder}(`);
    }
  });

  it("lists every exported builder in VERIFY_WRITE_BUILDERS and covers each in the drift cases", () => {
    const exportedBuilders = Object.keys(payloads)
      .filter((k) => /^build[A-Z]/.test(k))
      .sort();

    expect([...payloads.VERIFY_WRITE_BUILDERS].sort()).toEqual(exportedBuilders);
    expect(CALLS.map(([name]) => name).sort()).toEqual(exportedBuilders);
  });
});
