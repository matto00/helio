/**
 * HEL-1304 — the `place_outputs` and `update_panel_appearance` tool descriptions must state the
 * chart-type precedence the dashboard renders with (panel appearance -> Output config.chartType ->
 * line). Wording is behaviour: an agent that reads "chartType lives on the Output itself" never
 * learns a panel can override it. `place_outputs` is read off the registered tool; `write.ts` is
 * read as source text (its full Zod surface is unimportable under ts-jest — see
 * scheduleTools.test.ts's header), sliced to the `update_panel_appearance` registration.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HelioApi } from "../helioApi.js";
import { registerPlacementTools } from "./placements.js";

function descriptionOf(tool: string): string {
  let found = "";
  const server = {
    registerTool: (name: string, config: { description?: string }) => {
      if (name === tool) found = config.description ?? "";
    },
  } as unknown as McpServer;
  registerPlacementTools(server, {} as HelioApi);
  return found;
}

describe("place_outputs description (HEL-1304)", () => {
  const description = descriptionOf("place_outputs");

  it("names the precedence: panel chartType, else Output config.chartType, else line", () => {
    expect(description).toMatch(/appearance\.chart\.chartType/);
    expect(description).toMatch(/Output's config\.chartType/);
    expect(description).toMatch(/else line/);
  });

  it("names update_output and update_panel_appearance as the two ways to change it", () => {
    expect(description).toMatch(/update_output \(config\.chartType\)/);
    expect(description).toMatch(/update_panel_appearance/);
  });

  it("no longer claims chartType exists only on the Output", () => {
    expect(description).not.toMatch(/fieldMapping\/aggregation\/chartType/);
  });
});

describe("update_panel_appearance description (HEL-1304)", () => {
  const source = readFileSync(resolve(__dirname, "write.ts"), "utf8");
  const start = source.indexOf('"update_panel_appearance"');
  const registration = source.slice(start, source.indexOf("inputSchema", start));
  // Collapse the concatenated string literals into the runtime description text.
  const description = registration.replace(/"\s*\+\s*['"]/g, "").replace(/\\'/g, "'");

  it("says clearing chartType with null renders the Output's type, not a fixed line default", () => {
    expect(start).toBeGreaterThan(-1);
    expect(description).toMatch(/Output's config\.chartType, else line/);
    expect(description).not.toMatch(/renders as the line default/);
  });

  it("says a panel's chartType overrides the Output's", () => {
    expect(description).toMatch(/overrides the Output's config\.chartType/);
  });
});
