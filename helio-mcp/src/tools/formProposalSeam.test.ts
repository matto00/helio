/**
 * HEL-1148 seam test, MCP half. `shared-test-fixtures/form-proposal.json` is the wire an
 * agent-proposed `form` panel travels in; the backend half (`DashboardApplyProposalFormSeamSpec`)
 * posts the SAME file, unmodified, to the real `POST /api/dashboards/apply-proposal` route and
 * proves it applies, binds, and accepts a submit. This half proves the MCP side (a) accepts that
 * wire through its zod `panelSchema`, (b) runs the real `propose_dashboard` handler over it with
 * no warnings, and (c) serializes it through the real `HelioApi.applyProposal` + `HelioHttpClient`
 * as exactly the fixture bytes. A live MCP-to-backend call is deliberately not made here (it needs a
 * running backend plus a minted PAT, which the jest harness has neither of, and the session MCP
 * client points at production); the shared fixture is what binds the two halves together.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import type { HelioConfig } from "../config.js";
import { HelioApi } from "../helioApi.js";
import { HelioHttpClient, type HelioRequestInit } from "../httpClient.js";
import type { DashboardProposal } from "../types.js";
import { proposeDashboardHandler } from "./proposalHandlers.js";
import { panelSchema } from "./proposal.js";

const fixture = JSON.parse(
  readFileSync(join(__dirname, "../../../shared-test-fixtures/form-proposal.json"), "utf8"),
) as { datasetSourcePlaceholder: string; proposal: DashboardProposal };

const SOURCE_ID = "11111111-1111-1111-1111-111111111111";
const wire = JSON.parse(
  JSON.stringify(fixture.proposal).replaceAll(fixture.datasetSourcePlaceholder, SOURCE_ID),
) as DashboardProposal;

const config = { baseUrl: "https://helio.test", pat: "pat" } as HelioConfig;

function reply(body: unknown) {
  return {
    status: 201,
    statusText: "Created",
    ok: true,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

describe("form-proposal shared wire fixture (MCP side)", () => {
  it("is accepted by the MCP panel schema, dataSourceId included", () => {
    const parsed = z.array(panelSchema).parse(wire.panels);
    expect(parsed[0]).toMatchObject({ type: "form", dataSourceId: SOURCE_ID });
  });

  it("propose_dashboard's handler reports no warnings for a form bound to a known dataset source", async () => {
    const api = {
      listAllOutputs: async () => ({ items: [], total: 0 }),
      listDataSources: async () => ({
        items: [{ id: SOURCE_ID, name: "orders", type: "dataset" }],
        total: 1,
      }),
      getOutputFilterCapabilities: async () => ({ columns: [] }),
    } as unknown as HelioApi;
    const result = await proposeDashboardHandler(api, wire.dashboardName, wire.panels);
    expect(result.warnings).toEqual([]);
    expect(result.applyReady).toBe(true);
    expect(result.proposal).toEqual(wire);
  });

  it("serializes through the real HelioApi.applyProposal as exactly the fixture bytes", async () => {
    const calls: { url: string; init: HelioRequestInit }[] = [];
    const fetchImpl = (url: string, init: HelioRequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(reply({ dashboard: {}, panels: [] }));
    };
    const api = new HelioApi(new HelioHttpClient(config, { fetchImpl }));
    await api.applyProposal(wire);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://helio.test/api/dashboards/apply-proposal");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual(wire);
  });
});
