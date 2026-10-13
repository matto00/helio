/**
 * HEL-1440: the inert panel-level `fieldMapping`/`aggregation`/`label`/`unit` are advertised as deprecated on the
 * MCP proposal tools' emitted input schema (zod 3 has no `deprecated` flag the SDK emits, so the description carries
 * it). Reads the REAL `listTools()` output, not the zod object, so it pins what an agent actually sees.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../server.js";
import type { HelioApi } from "../helioApi.js";

const DEPRECATED = ["fieldMapping", "aggregation", "label", "unit"];

type JsonObject = Record<string, unknown>;

/** Every `properties` object in the schema tree that declares both `title` and `outputId`: the ProposalPanel shape. */
function panelPropertyObjects(node: unknown, found: JsonObject[] = []): JsonObject[] {
  if (Array.isArray(node)) {
    node.forEach((n) => panelPropertyObjects(n, found));
  } else if (node && typeof node === "object") {
    const obj = node as JsonObject;
    const props = obj.properties as JsonObject | undefined;
    if (props && "title" in props && "outputId" in props && "dataSourceId" in props)
      found.push(props);
    Object.values(obj).forEach((v) => panelPropertyObjects(v, found));
  }
  return found;
}

async function listTools() {
  const server = createServer({} as HelioApi); // never invoked: this only lists tools.
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    return (await client.listTools()).tools;
  } finally {
    await client.close();
    await server.close();
  }
}

describe("MCP proposal panel schema marks the inert panel-level fields deprecated (HEL-1440)", () => {
  it("describes each of the four as deprecated/ignored on propose_dashboard, and no other field that way", async () => {
    const tool = (await listTools()).find((t) => t.name === "propose_dashboard");
    expect(tool).toBeDefined();
    const panels = panelPropertyObjects(tool!.inputSchema);
    expect(panels.length).toBeGreaterThan(0);
    for (const props of panels) {
      for (const name of DEPRECATED) {
        const description = (props[name] as JsonObject).description as string;
        expect(description).toContain("Deprecated and ignored");
        expect(description).toContain("Output's `config`");
      }
      const others = Object.entries(props).filter(
        ([name, schema]) =>
          !DEPRECATED.includes(name) &&
          String((schema as JsonObject).description ?? "").includes("Deprecated and ignored"),
      );
      expect(others.map(([name]) => name)).toEqual([]);
    }
  });
});
