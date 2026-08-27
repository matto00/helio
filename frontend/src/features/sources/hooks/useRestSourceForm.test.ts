import { act, renderHook } from "@testing-library/react";

import { detectTemplateParameterNames, useRestSourceForm } from "./useRestSourceForm";

const testConnector = {
  id: "connector-1",
  ownerId: "user-1",
  name: "Test API",
  kind: "rest_api",
  baseUrl: "https://api.example.com",
  config: { authType: "none" as const },
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  dependentCount: 0,
};

describe("detectTemplateParameterNames", () => {
  it("extracts distinct {{name}} placeholders in first-seen order", () => {
    expect(
      detectTemplateParameterNames(["/v1/{{accountId}}", "x={{accountId}}&y={{page}}", ""]),
    ).toEqual(["accountId", "page"]);
  });

  it("returns an empty array when no placeholders are present", () => {
    expect(detectTemplateParameterNames(["/v1/accounts", ""])).toEqual([]);
  });
});

describe("useRestSourceForm", () => {
  it("buildRestSourceConfig never includes url and includes connectorId once a Connector is set", () => {
    const { result } = renderHook(() => useRestSourceForm());

    act(() => {
      result.current.setConnector(testConnector);
      result.current.setEndpoint("/v1/accounts");
    });

    const config = result.current.buildRestSourceConfig();
    expect(config).toMatchObject({ connectorId: "connector-1", endpoint: "/v1/accounts" });
    expect(config).not.toHaveProperty("url");
  });

  it("omits connectorId when no Connector is selected", () => {
    const { result } = renderHook(() => useRestSourceForm());
    act(() => {
      result.current.setEndpoint("/v1/accounts");
    });
    const config = result.current.buildRestSourceConfig();
    expect(config).not.toHaveProperty("connectorId");
    expect(config).not.toHaveProperty("url");
  });

  it("collapses ordered queryParams/headers into Record maps in the composed config", () => {
    const { result } = renderHook(() => useRestSourceForm());
    act(() => {
      result.current.setConnector(testConnector);
      result.current.setQueryParams([{ key: "limit", value: "50" }]);
      result.current.setHeaders([{ key: "X-Test", value: "1" }]);
    });
    const config = result.current.buildRestSourceConfig();
    expect(config.queryParams).toEqual({ limit: "50" });
    expect(config.headers).toEqual({ "X-Test": "1" });
  });

  it("detects template parameters across endpoint/queryParams/headers/body and resolves values into the composed config", () => {
    const { result } = renderHook(() => useRestSourceForm());
    act(() => {
      result.current.setConnector(testConnector);
      result.current.setEndpoint("/v1/{{accountId}}");
      result.current.setMethod("POST");
      result.current.setBody('{"q":"{{query}}"}');
    });
    expect(result.current.templateParameterNames).toEqual(["accountId", "query"]);

    act(() => {
      result.current.setParameterValue("accountId", "acc-1");
      result.current.setParameterValue("query", "sales");
    });
    const config = result.current.buildRestSourceConfig();
    expect(config.parameters).toEqual({ accountId: "acc-1", query: "sales" });
  });

  it("only includes body/bodyContentType for methods that support a body", () => {
    const { result } = renderHook(() => useRestSourceForm());
    act(() => {
      result.current.setConnector(testConnector);
      result.current.setBody("{}");
      result.current.setBodyContentType("application/json");
    });
    // method defaults to GET
    expect(result.current.buildRestSourceConfig()).not.toHaveProperty("body");

    act(() => {
      result.current.setMethod("POST");
    });
    const config = result.current.buildRestSourceConfig();
    expect(config.body).toBe("{}");
    expect(config.bodyContentType).toBe("application/json");
  });
});
