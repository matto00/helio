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
 * adding `EXPECTED_TOOL_NAMES`, the full tool list (originally 60, enumerated via
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
  "add_output_control",
  "add_outputs_from_shape",
  "add_pipeline_step",
  "add_root",
  "analyze_pipeline",
  "analyze_pipeline_proposal",
  "append_dataset_rows",
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
  "delete_dataset_row",
  "delete_output",
  "delete_panel",
  "delete_pipeline",
  "delete_pipeline_schedule",
  "delete_pipeline_step",
  "get_dashboard",
  "get_dataset_rows",
  "get_dataset_schema",
  "get_output",
  "get_output_assertion_status",
  "get_output_capabilities",
  "get_output_filter_capabilities",
  "get_output_history",
  "get_output_panels",
  "get_output_provenance",
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
  "remove_output_control",
  "remove_root",
  "replace_dashboard_contents",
  "replace_dataset_rows",
  "run_pipeline",
  "set_pipeline_schedule",
  "teardown_resources",
  "undo_patch_set",
  "update_dashboard",
  "update_dashboard_layout",
  "update_data_source",
  "update_dataset_row",
  "update_dataset_schema",
  "update_output",
  "update_output_control",
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

// HEL-1193 D1: get_output_capabilities (pipeline step binding menu) and
// get_output_filter_capabilities (an Output's filter operators/control kinds) are easy to confuse;
// each description must name the other and say which id it takes.
describe("analyze tools document the non-blocking warnings array (HEL-1235)", () => {
  it.each(["analyze_pipeline", "analyze_pipeline_proposal"])(
    "%s names warnings, the three codes, and that they never block or affect canRun",
    async (name) => {
      const tools = await listRegisteredTools();
      const description = tools.find((t) => t.name === name)?.description ?? "";

      expect(description).toContain("warnings");
      expect(description).toContain("field-not-in-input-schema");
      expect(description).toContain("join-key-type-mismatch");
      expect(description).toContain("join-column-renamed");
      expect(description).toContain("numeric-op-on-text-field");
      expect(description).toContain("NON-BLOCKING");
      expect(description).toContain("NOT affect canRun");
      // distinguished from propose_pipeline's string warnings and from run warnings
      expect(description).toContain("propose_pipeline's warnings");
      expect(description).toContain("run");
    },
  );
});

describe("filter-capabilities vs step-capabilities tool descriptions (HEL-1193 D1)", () => {
  it("each description names the other tool and the id it takes", async () => {
    const tools = await listRegisteredTools();
    const stepMenu = tools.find((t) => t.name === "get_output_capabilities")?.description ?? "";
    const filterMenu =
      tools.find((t) => t.name === "get_output_filter_capabilities")?.description ?? "";

    expect(stepMenu).toContain("get_output_filter_capabilities");
    expect(stepMenu).toContain("takes a pipeline id");
    expect(filterMenu).toContain("NOT get_output_capabilities");
    expect(filterMenu).toContain("takes an OUTPUT id");
  });
});

// HEL-1193 C2: status codes in tool copy are the ones observed from the running backend
// (openspec/changes/mcp-output-panel-controls/evidence-status-codes.md), never spec/prior copy.
describe("control tool copy states the observed status codes (HEL-1193 C2)", () => {
  it.each(["add_output_control", "update_output_control"])(
    "%s documents the 400 control-not-eligible message and the client-side refusals",
    async (name) => {
      const tools = await listRegisteredTools();
      const description = tools.find((t) => t.name === name)?.description ?? "";

      expect(description).toContain("HTTP 400");
      expect(description).toContain("control not eligible: column '<c>', kind '<k>'");
      expect(description).toContain("HTTP 404 `Dashboard not found`");
      expect(description).not.toContain("422");
    },
  );

  it("apply_patch_set documents the 200-with-failure shape, not an HTTP error", async () => {
    const tools = await listRegisteredTools();
    const description = tools.find((t) => t.name === "apply_patch_set")?.description ?? "";

    expect(description).toContain("HTTP 200");
    expect(description).toContain("control not eligible");
  });

  // HEL-1313: every tool that writes Output config lists the per-kind keys and aggregation shapes and
  // no longer claims the dead legend/tooltip deep merge.
  it.each([
    "add_output",
    "update_output",
    "create_pipeline",
    "propose_pipeline",
    "analyze_pipeline_proposal",
    "apply_pipeline_proposal",
    "apply_combined_proposal",
    "apply_patch_set",
  ])("%s documents the Output config key set and aggregation shapes", async (name) => {
    const tools = await listRegisteredTools();
    const description = tools.find((t) => t.name === name)?.description ?? "";

    for (const key of [
      "chartType",
      "chartOptions",
      "columnOrder",
      "columnFormats",
      "pinnedColumns",
      "layout",
      "sort",
      "content",
      "{ groupBy, agg, yField }",
      "{ agg }",
      "{ value, agg }",
    ]) {
      expect(description).toContain(key);
    }
    expect(description).toContain("rejected with a 400");
    expect(description).not.toContain("merges one level deep");
  });

  it.each([
    "propose_dashboard",
    "apply_proposal",
    "apply_combined_proposal",
    "replace_dashboard_contents",
  ])("%s documents controls and the apply-time 400", async (name) => {
    const tools = await listRegisteredTools();
    const description = tools.find((t) => t.name === name)?.description ?? "";

    expect(description).toContain("controls: [{ kind:");
    expect(description).toContain("HTTP 400");
  });
});

describe("HEL-1274 get_output_history + compare documentation", () => {
  async function descriptions(): Promise<Record<string, string>> {
    const server = createServer({} as HelioApi);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const { tools } = await client.listTools();
      return Object.fromEntries(tools.map((t) => [t.name, t.description ?? ""]));
    } finally {
      await client.close();
      await server.close();
    }
  }

  it("get_output_history says non-metric values are null and history is thinned, never 'previous run'", async () => {
    const d = (await descriptions()).get_output_history ?? "";

    expect(d).toMatch(/non-null ONLY for metric/);
    expect(d).toMatch(/thinned/);
    expect(d).toMatch(/never an Output's newest 101 points/);
    expect(d).not.toMatch(/RETAINED/);
    expect(d.toLowerCase()).not.toContain("previous run");
  });

  it("documents compare on add_output, update_output, create_pipeline, propose_pipeline only", async () => {
    const all = await descriptions();

    for (const tool of ["add_output", "update_output", "create_pipeline", "propose_pipeline"]) {
      expect(all[tool]).toContain("compare");
      expect(all[tool]).toContain("previous_run");
    }
    expect(all.place_outputs).not.toContain("compare");
  });
});

// HEL-1331: `update_output` is the MCP path to `config.historyPayloads`; the description is the
// only place an agent learns the key, the caps, the tier rule and the opt-out behaviour.
describe("update_output description documents config.historyPayloads (HEL-1331)", () => {
  it("names the key, both caps, the tier rule, historyPayloadsAvailable and the no-purge opt-out", async () => {
    const tools = await listRegisteredTools();
    const description = tools.find((t) => t.name === "update_output")?.description ?? "";

    expect(description).toContain("historyPayloads");
    expect(description).toContain("historyPayloadLimits");
    expect(description).not.toContain("1,000 rows");
    expect(description).not.toContain("1 MiB");
    expect(description).toContain("historyPayloadsAvailable");
    expect(description).toContain("free keeps none");
    expect(description).toContain("does not purge");
  });
});
