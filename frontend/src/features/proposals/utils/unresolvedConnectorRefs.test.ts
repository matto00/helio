import {
  detectUnresolvedConnectorRefs,
  detectUnresolvedConnectorRefsForCombined,
  narrowRestApiConfigClient,
  resolveCombinedConnectorRef,
  resolvePipelineConnectorRef,
} from "./unresolvedConnectorRefs";
import type { Connector } from "../../connectors/types/connector";
import type { PipelineProposal } from "../../pipelines/types/pipelineProposal";
import type { CombinedProposal } from "../types/combinedProposal";

const draft = {
  name: "Stripe",
  baseUrl: "https://api.stripe.com",
  authType: "api_key",
  apiKeyName: "Authorization",
  apiKeyPlacement: "header",
  retrievalInstructions: "Generate an API key at https://dashboard.stripe.com/apikeys",
};

function connector(id: string): Connector {
  return {
    id,
    ownerId: "u1",
    name: "Existing",
    kind: "rest_api",
    baseUrl: "https://existing.example.com",
    config: { authType: "none" },
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    dependentCount: 0,
  };
}

function pipelineProposal(config: Record<string, unknown> | undefined): PipelineProposal {
  return {
    pipelineName: "P",
    source: { type: "rest_api", name: "Inline REST", config },
    outputDataTypeName: "Out",
    steps: [],
  };
}

describe("narrowRestApiConfigClient", () => {
  it("returns null for a non-object config", () => {
    expect(narrowRestApiConfigClient(undefined)).toBeNull();
  });

  it("narrows a connectorId-only config", () => {
    expect(narrowRestApiConfigClient({ connectorId: "conn-1" })).toEqual({ connectorId: "conn-1" });
  });

  it("degrades a malformed newConnector to absent rather than throwing", () => {
    expect(() => narrowRestApiConfigClient({ newConnector: { name: 1 } })).not.toThrow();
    expect(narrowRestApiConfigClient({ newConnector: { name: 1 } })).toEqual({});
  });

  it("narrows a full newConnector draft", () => {
    expect(narrowRestApiConfigClient({ newConnector: draft })).toEqual({ newConnector: draft });
  });
});

describe("detectUnresolvedConnectorRefs", () => {
  it("returns empty for a non-rest_api source", () => {
    const proposal: PipelineProposal = {
      pipelineName: "P",
      source: { type: "static", name: "Inline", config: {} },
      outputDataTypeName: "Out",
      steps: [],
    };
    expect(detectUnresolvedConnectorRefs(proposal, [])).toEqual([]);
  });

  it("returns empty for a legacy bare-url rest_api source, even with no matching connector", () => {
    const proposal = pipelineProposal({ url: "https://api.example.com" });
    expect(detectUnresolvedConnectorRefs(proposal, [])).toEqual([]);
  });

  it("returns empty for a rest_api source whose connectorId is present in the connector list", () => {
    const proposal = pipelineProposal({ connectorId: "conn-1" });
    expect(detectUnresolvedConnectorRefs(proposal, [connector("conn-1")])).toEqual([]);
  });

  it("flags a dangling connectorId not present in the connector list", () => {
    const proposal = pipelineProposal({ connectorId: "conn-missing" });
    const result = detectUnresolvedConnectorRefs(proposal, [connector("conn-1")]);
    expect(result).toHaveLength(1);
    expect(result[0].danglingConnectorId).toBe("conn-missing");
    expect(result[0].draft).toBeUndefined();
  });

  it("flags a newConnector draft", () => {
    const proposal = pipelineProposal({ newConnector: draft });
    const result = detectUnresolvedConnectorRefs(proposal, []);
    expect(result).toHaveLength(1);
    expect(result[0].draft).toEqual(draft);
  });

  it("degrades a malformed config to no unresolved reference rather than throwing", () => {
    const proposal = pipelineProposal(undefined);
    expect(() => detectUnresolvedConnectorRefs(proposal, [])).not.toThrow();
    expect(detectUnresolvedConnectorRefs(proposal, [])).toEqual([]);
  });
});

describe("detectUnresolvedConnectorRefsForCombined", () => {
  it("scans only the nested pipeline half — the dashboard half has no source field at all", () => {
    const combined: CombinedProposal = {
      pipeline: pipelineProposal({ newConnector: draft }),
      dashboard: { dashboardName: "D", panels: [] },
    };
    const result = detectUnresolvedConnectorRefsForCombined(combined, []);
    expect(result).toHaveLength(1);
    expect(result[0].draft).toEqual(draft);
  });
});

describe("resolvePipelineConnectorRef", () => {
  it("replaces newConnector with connectorId, preserving other config fields, without mutating the input", () => {
    const proposal = pipelineProposal({
      newConnector: draft,
      endpoint: "/v1/charges",
      method: "GET",
    });
    const resolved = resolvePipelineConnectorRef(proposal, "conn-new");

    expect(resolved.source.config).toEqual({
      endpoint: "/v1/charges",
      method: "GET",
      connectorId: "conn-new",
    });
    expect(proposal.source.config).toEqual({
      newConnector: draft,
      endpoint: "/v1/charges",
      method: "GET",
    });
  });

  it("replaces a dangling connectorId with the new one", () => {
    const proposal = pipelineProposal({ connectorId: "conn-missing", endpoint: "/x" });
    const resolved = resolvePipelineConnectorRef(proposal, "conn-new");
    expect(resolved.source.config).toEqual({ endpoint: "/x", connectorId: "conn-new" });
  });
});

describe("resolveCombinedConnectorRef", () => {
  it("patches only the nested pipeline half", () => {
    const combined: CombinedProposal = {
      pipeline: pipelineProposal({ newConnector: draft }),
      dashboard: { dashboardName: "D", panels: [] },
    };
    const resolved = resolveCombinedConnectorRef(combined, "conn-new");
    expect(resolved.pipeline.source.config).toEqual({ connectorId: "conn-new" });
    expect(resolved.dashboard).toBe(combined.dashboard);
  });
});
