/**
 * HEL-907 tasks.md 3.9/5.3 — exact-tool-name-set test: pins the FULL registered
 * tool list, asserting every removed tool (task 3.9's sweep, plus the earlier
 * bind_panel/create_bound_panel/get_panel_capabilities/create_panel/
 * create_panels/create_pipeline_from_shape removals from cycles 6-7) is
 * genuinely ABSENT, and that no alias was left behind for any of them
 * (design.md decision 10: "no aliases"). Uses a real in-process MCP client
 * over `InMemoryTransport` (the SDK's own linked-pair transport) rather than
 * reaching into `McpServer`'s private `_registeredTools` map — this is the
 * same "connect a real MCP client" shape `scripts/verify.ts` uses, just
 * in-process instead of over stdio, so a future SDK internal-shape change
 * can't silently break this test's premise.
 *
 * evaluator-1 CR4: the file's own docstring claimed to "pin the FULL
 * registered tool list", but the original assertions were only
 * `not.toContain` (removed tools) + `arrayContaining` (a subset of
 * replacements) + a duplicate check — none of which is an EXACT set, so an
 * accidentally re-added or renamed tool would have passed silently. Fixed by
 * adding `EXPECTED_TOOL_NAMES`, the full 60-tool list (enumerated via
 * `grep -rhoE 'registerTool\(\s*\n?\s*"[a-z_]+"' src/tools/*.ts`, cross-checked
 * against every `registerXTools` call in `server.ts`), asserted via a sorted
 * equality — the comment now backs what the code actually does.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "./server.js";
import type { HelioApi } from "./helioApi.js";

const REMOVED_TOOLS = [
  // HEL-907 task 3.9 (this cycle) -- DataType/Metric model retired by HEL-904;
  // every one of these called a route that no longer exists.
  "list_data_types",
  "update_data_type",
  "delete_data_type",
  "get_data_type_rows",
  "list_metrics",
  "get_metric",
  "create_metric",
  "update_metric",
  "delete_metric",
  // Earlier cycles (6-7), also design.md decision 10 "no aliases" removals.
  "bind_panel",
  "create_bound_panel",
  "get_panel_capabilities",
  "create_panel",
  "create_panels",
  "create_pipeline_from_shape",
];

/** The full, exact set of currently-registered tool names — every
 *  `server.registerTool("...")` call site across `src/tools/*.ts`, kept in
 *  sync by the test below failing loudly (not silently) the moment a tool
 *  is added, removed, or renamed without updating this list too. */
const EXPECTED_TOOL_NAMES = [
  "add_output",
  "add_outputs_from_shape",
  "add_pipeline_step",
  "analyze_pipeline",
  "analyze_pipeline_proposal",
  "apply_combined_proposal",
  "apply_patch_set",
  "apply_pipeline_proposal",
  "apply_proposal",
  "auto_layout_dashboard",
  "create_connector",
  "create_content_panel",
  "create_csv_data_source",
  "create_dashboard",
  "create_data_source",
  "create_pipeline",
  "create_rest_data_source",
  "create_sql_data_source",
  "delete_dashboard",
  "delete_data_source",
  "delete_output",
  "delete_panel",
  "delete_pipeline",
  "delete_pipeline_schedule",
  "delete_pipeline_step",
  "get_dashboard",
  "get_output",
  "get_output_assertion_status",
  "get_output_capabilities",
  "get_output_panels",
  "get_output_rows",
  "get_pipeline",
  "get_pipeline_schedule",
  "get_workspace_context",
  "list_connectors",
  "list_connector_types",
  "list_dashboards",
  "list_data_sources",
  "list_outputs",
  "list_pipelines",
  "list_pipeline_shapes",
  "list_source_objects",
  "place_outputs",
  "preview_outputs",
  "propose_dashboard",
  "propose_patch_set",
  "propose_pipeline",
  "replace_dashboard_contents",
  "run_pipeline",
  "set_pipeline_schedule",
  "teardown_resources",
  "undo_patch_set",
  "update_dashboard",
  "update_dashboard_layout",
  "update_data_source",
  "update_output",
  "update_panel",
  "update_panel_appearance",
  "update_pipeline",
  "update_pipeline_step",
  "upload_image",
];

async function listRegisteredToolNames(): Promise<string[]> {
  const fakeApi = {} as HelioApi; // never called -- this test only lists tools, never invokes one.
  const server = createServer(fakeApi);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const { tools } = await client.listTools();
    return tools.map((t) => t.name);
  } finally {
    await client.close();
    await server.close();
  }
}

/** Full `listTools()` records, not just names — for asserting on the advertised
 *  `inputSchema` itself (skeptic-final-2.md CR1: distinct from `callTool`, which never reads
 *  the advertised schema and so cannot catch a normalization regression like this one). */
async function listRegisteredTools(): Promise<Awaited<ReturnType<Client["listTools"]>>["tools"]> {
  const fakeApi = {} as HelioApi; // never called -- this test only lists tools, never invokes one.
  const server = createServer(fakeApi);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const { tools } = await client.listTools();
    return tools;
  } finally {
    await client.close();
    await server.close();
  }
}

describe("registered tool set (HEL-907 tasks.md 3.9/5.3)", () => {
  it("does not register any removed tool (no alias left behind)", async () => {
    const names = await listRegisteredToolNames();

    for (const removed of REMOVED_TOOLS) {
      expect(names).not.toContain(removed);
    }
  });

  it("registers the Output/pipeline/placement tools that replaced them", async () => {
    const names = await listRegisteredToolNames();

    expect(names).toEqual(
      expect.arrayContaining([
        "create_pipeline",
        "add_outputs_from_shape",
        "add_output",
        "update_output",
        "delete_output",
        "list_outputs",
        "get_output_rows",
        "preview_outputs",
        "get_output_capabilities",
        "place_outputs",
        "create_content_panel",
        "get_workspace_context",
      ]),
    );
  });

  it("has no duplicate tool name (each tool registered exactly once)", async () => {
    const names = await listRegisteredToolNames();
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const name of names) {
      if (seen.has(name)) duplicates.push(name);
      seen.add(name);
    }

    expect(duplicates).toEqual([]);
  });

  it("registers EXACTLY the expected tool set — no more, no fewer (evaluator-1 CR4)", async () => {
    const names = await listRegisteredToolNames();

    expect([...names].sort()).toEqual([...EXPECTED_TOOL_NAMES].sort());
  });
});

// skeptic-final-2.md CR1: `create_connector`'s schema regressed from a `ZodObject` to a
// `ZodEffects` (via `.passthrough()` + `.superRefine`) in an earlier revision of this change,
// which the MCP SDK's `normalizeObjectSchema` cannot unwrap (it only handles a `.shape`) --
// the tool silently advertised `{"type":"object","properties":{}}` to every `listTools()`
// caller, losing the required-field AND denylist-field advertisement entirely, even though
// runtime `callTool` enforcement still held. `callTool` never reads the advertised schema, so
// no test exercising only `callTool` could have caught this -- this MUST assert on
// `listTools()`'s own output.
describe("create_connector's advertised input schema (HEL-886, skeptic-final-2.md CR1)", () => {
  it("advertises a non-empty JSON Schema with the required fields and denylist keys", async () => {
    const tools = await listRegisteredTools();
    const createConnector = tools.find((t) => t.name === "create_connector");

    expect(createConnector).toBeDefined();
    const schema = createConnector?.inputSchema as {
      type?: string;
      properties?: Record<string, unknown>;
      required?: string[];
      additionalProperties?: boolean;
    };

    expect(schema.type).toBe("object");
    expect(Object.keys(schema.properties ?? {}).length).toBeGreaterThan(0);
    expect(schema.required).toEqual(expect.arrayContaining(["name", "baseUrl"]));
    expect(schema.additionalProperties).toBe(false);
    for (const denylisted of ["auth", "apiKey", "token", "password", "credential"]) {
      expect(schema.properties).toHaveProperty(denylisted);
    }
  });
});
