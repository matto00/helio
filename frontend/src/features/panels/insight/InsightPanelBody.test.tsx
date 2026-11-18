// HEL-1744 D4/D7 -- the insight panel body through the real service mapping (httpClient mocked): states, footer time,
// refresh re-fetch, and never a cost/model/token value.
import { configureStore } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import { httpClient } from "../../../services/httpClient";
import { authReducer } from "../../auth/state/authSlice";
import type { UserTier } from "../../auth/types/user";
import { resetProvenanceCache } from "../provenance/provenanceCache";
import * as fanout from "../services/pipelineRunFanout";
import { InsightPanelBody } from "./InsightPanelBody";
import { getInsightChrome, resetInsightChrome } from "./insightChromeStore";
import { resetPipelineOwnership } from "./usePipelineOwnership";
import type { Output, PublicOutputMeta } from "../../pipelines/types/output";

jest.mock("../../../services/httpClient", () => ({ httpClient: { get: jest.fn() } }));
jest.mock("../services/pipelineRunFanout", () => ({
  subscribeToPipelineTerminal: jest.fn(() => jest.fn()),
}));
jest.mock("../provenance/provenanceTelemetry", () => ({ onProvenanceOpened: jest.fn() }));
// react-markdown is mocked in jest; the real renderer is asserted in e2e. This stub renders text and the chips for known markers.
jest.mock("./InsightMarkdown", () => ({
  InsightMarkdown: ({
    markdown,
    citations,
    renderCitation,
  }: {
    markdown: string;
    citations: string[];
    renderCitation: (id: string) => import("react").ReactNode;
  }) => (
    <p>
      {markdown.split(/(\[c\d+\])/).map((part, i) => {
        const id = /^\[(c\d+)\]$/.exec(part)?.[1];
        return id && citations.includes(id) ? <span key={i}>{renderCitation(id)}</span> : part;
      })}
    </p>
  ),
}));
const http = jest.mocked(httpClient);
const subscribeTerminal = jest.mocked(fanout.subscribeToPipelineTerminal);

const OUTPUT: Output = {
  id: "o-1",
  pipelineId: "p-1",
  nodeStepId: "s-1",
  ownerId: "u-editor",
  name: "Insight",
  kind: "insight",
  config: {},
  schema: [],
  createdAt: "",
  updatedAt: "",
};

const SECRETS = { model: "model-secret-xyz", inputTokens: 987654, costMicros: 4242421 };

function renderResponse(over: Record<string, unknown> = {}) {
  return {
    id: "r-1",
    markdown: "Revenue rose [c1]. Churn fell [c2].",
    citations: [
      { id: "c1", outputId: "t-1", field: "revenue", number: 12.5, isPct: false },
      { id: "c2", outputId: "t-2", field: "churn", number: 3, isPct: true },
    ],
    trigger: "on_run",
    createdAt: "2026-11-01T10:00:00Z",
    ...SECRETS,
    ...over,
  };
}

function mockApi(opts: {
  render?: Record<string, unknown> | null;
  attempt?: string | null;
  pipelineOwner?: string;
}) {
  http.get.mockImplementation((url: string) => {
    if (url === "/api/outputs/o-1/insight") {
      return Promise.resolve({
        data: {
          outputId: "o-1",
          render: opts.render === undefined ? renderResponse() : opts.render,
          lastAttempt:
            opts.attempt == null
              ? null
              : {
                  id: "a-1",
                  status: opts.attempt,
                  trigger: "on_run",
                  createdAt: "2026-11-02T00:00:00Z",
                },
        },
      });
    }
    if (url === "/api/pipelines/p-1") {
      return Promise.resolve({ data: { id: "p-1", ownerId: opts.pipelineOwner ?? "u-owner" } });
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

function renderBody(
  tier: UserTier = "beta",
  output: Output | PublicOutputMeta = OUTPUT,
  historySource?: { variant: "public"; dashboardId: string; token: string },
  currentUserId = "u-owner",
) {
  const initial = authReducer(undefined, { type: "init" });
  const store = configureStore({
    reducer: { auth: authReducer },
    preloadedState: {
      auth: {
        ...initial,
        currentUser: {
          id: currentUserId,
          email: "u@test.local",
          displayName: null,
          avatarUrl: null,
          createdAt: "2026-01-01T00:00:00Z",
          tier,
        },
      },
    },
  });
  return render(
    <MemoryRouter>
      <Provider store={store}>
        <InsightPanelBody
          panelId="pan-1"
          outputId="o-1"
          output={output}
          historySource={historySource}
        />
      </Provider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  resetProvenanceCache();
  resetInsightChrome();
  resetPipelineOwnership();
});

describe("InsightPanelBody", () => {
  it("shows both sentences with one chip each and publishes the render time to the chrome", async () => {
    mockApi({ attempt: "ok" });
    renderBody();
    expect(await screen.findByRole("button", { name: /Source: revenue/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Source: churn/ })).toBeInTheDocument();
    expect(screen.getByText(/Revenue rose/)).toBeInTheDocument();
    expect(getInsightChrome("o-1")?.renderedAt).toBe("2026-11-01T10:00:00Z");
  });

  it("never shows model, token or cost values or words", async () => {
    mockApi({ attempt: "ok", pipelineOwner: "u-owner" });
    const { container } = renderBody();
    await screen.findByRole("button", { name: /Source: revenue/ });
    const text = container.textContent ?? "";
    for (const leak of ["model-secret", "987654", "4242421"]) expect(text).not.toContain(leak);
    expect(text).not.toMatch(/cost|tokens/i);
  });

  it("shows not-yet-rendered as a status", async () => {
    mockApi({ render: null, attempt: null });
    renderBody();
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Not yet rendered");
    expect(getInsightChrome("o-1")?.renderedAt).toBeNull();
  });

  it("failed keeps the previous render visible with a note", async () => {
    mockApi({ attempt: "failed" });
    renderBody();
    expect(await screen.findByText(/Revenue rose/)).toBeInTheDocument();
    expect(screen.getByText(/last update failed/i)).toBeInTheDocument();
  });

  it("unchanged keeps the render with a quiet note", async () => {
    mockApi({ attempt: "skipped_unchanged" });
    renderBody();
    expect(await screen.findByText(/Revenue rose/)).toBeInTheDocument();
    expect(screen.getByText(/unchanged/i)).toBeInTheDocument();
  });

  it("quota note goes to the PIPELINE owner even though an editor created the Output", async () => {
    mockApi({ attempt: "skipped_quota", pipelineOwner: "u-owner" });
    renderBody("beta", OUTPUT, undefined, "u-owner");
    expect(await screen.findByText(/Revenue rose/)).toBeInTheDocument();
    expect(await screen.findByText(/quota/i)).toBeInTheDocument();
  });

  it("the Output's creator who is not the pipeline owner sees the neutral note, no quota wording", async () => {
    mockApi({ attempt: "skipped_quota", pipelineOwner: "u-owner" });
    renderBody("beta", { ...OUTPUT, ownerId: "u-editor" }, undefined, "u-editor");
    expect(await screen.findByText(/Revenue rose/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/not updated/i)).toBeInTheDocument());
    expect(screen.queryByText(/quota|plan|beta/i)).toBeNull();
  });

  it("a free-tier pipeline owner with no render sees the upsell with a beta-access link", async () => {
    mockApi({ render: null, attempt: null, pipelineOwner: "u-owner" });
    renderBody("free", OUTPUT, undefined, "u-owner");
    expect(await screen.findByRole("link", { name: /beta access/i })).toHaveAttribute(
      "href",
      "/settings#beta-access",
    );
  });

  it("holds its state while the pipeline lookup is pending: no not-yet-rendered flash before the upsell", async () => {
    let release: (v: unknown) => void = () => undefined;
    http.get.mockImplementation((url: string) => {
      if (url === "/api/outputs/o-1/insight") {
        return Promise.resolve({ data: { outputId: "o-1", render: null, lastAttempt: null } });
      }
      if (url === "/api/pipelines/p-1") {
        return new Promise((resolve) => {
          release = resolve;
        });
      }
      return Promise.reject(new Error(`unexpected GET ${url}`));
    });
    renderBody("free", OUTPUT, undefined, "u-owner");
    await waitFor(() =>
      expect(http.get.mock.calls.some(([u]) => u === "/api/pipelines/p-1")).toBe(true),
    );
    await act(async () => {});
    expect(screen.queryByTestId("insight-not-rendered")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByTestId("insight-upsell")).toBeNull();
    await act(async () => {
      release({ data: { id: "p-1", ownerId: "u-owner" } });
    });
    expect(await screen.findByTestId("insight-upsell")).toBeInTheDocument();
    expect(screen.queryByTestId("insight-not-rendered")).toBeNull();
  });

  it("holds its state while the signed-in user (and so their tier) is not loaded yet", async () => {
    mockApi({ render: null, attempt: null, pipelineOwner: "u-owner" });
    const store = configureStore({
      reducer: { auth: authReducer },
      preloadedState: {
        auth: { ...authReducer(undefined, { type: "init" }), status: "loading" as const },
      },
    });
    render(
      <MemoryRouter>
        <Provider store={store}>
          <InsightPanelBody panelId="pan-1" outputId="o-1" output={OUTPUT} />
        </Provider>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(http.get.mock.calls.some(([u]) => u === "/api/outputs/o-1/insight")).toBe(true),
    );
    await act(async () => {});
    expect(screen.queryByTestId("insight-not-rendered")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("a free-tier non-owner with no render sees not-yet-rendered, not the upsell", async () => {
    mockApi({ render: null, attempt: null, pipelineOwner: "u-owner" });
    renderBody("free", OUTPUT, undefined, "u-editor");
    expect(await screen.findByRole("status")).toHaveTextContent("Not yet rendered");
    expect(screen.queryByRole("link", { name: /beta access/i })).toBeNull();
  });

  it("refetch from the chrome re-reads the insight", async () => {
    mockApi({ attempt: "ok" });
    renderBody();
    await screen.findByText(/Revenue rose/);
    const reads = () =>
      http.get.mock.calls.filter(([u]) => u === "/api/outputs/o-1/insight").length;
    expect(reads()).toBe(1);
    await act(async () => {
      getInsightChrome("o-1")?.refetch();
    });
    await waitFor(() => expect(reads()).toBe(2));
  });

  it("a completed pipeline run re-fetches the insight", async () => {
    mockApi({ attempt: "ok" });
    renderBody();
    await screen.findByText(/Revenue rose/);
    const listener = subscribeTerminal.mock.calls[0][1];
    await act(async () => {
      (listener as () => void)();
    });
    await waitFor(() =>
      expect(http.get.mock.calls.filter(([u]) => u === "/api/outputs/o-1/insight")).toHaveLength(2),
    );
  });

  it("shows an error state when the read fails, never an empty panel", async () => {
    http.get.mockRejectedValue(new Error("boom"));
    renderBody();
    expect(await screen.findByText(/could not load/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("public: reads the public route, shows no note and never asks for the pipeline", async () => {
    http.get.mockImplementation((url: string) =>
      url === "/api/dashboards/d-1/panels/pan-1/insight"
        ? Promise.resolve({
            data: {
              render: {
                markdown: "A [c1].",
                renderedAt: "2026-11-01T10:00:00Z",
                citations: [
                  { id: "c1", field: "revenue", number: 1, isPct: false, panelId: "pan-9" },
                ],
              },
            },
          })
        : Promise.reject(new Error(`unexpected GET ${url}`)),
    );
    renderBody(
      "free",
      { kind: "insight", config: {}, schema: [], ownerId: null },
      { variant: "public", dashboardId: "d-1", token: "tok" },
    );
    fireEvent.click(await screen.findByRole("button", { name: /Source: revenue/ }));
    expect(http.get.mock.calls.some(([u]) => String(u).startsWith("/api/pipelines"))).toBe(false);
  });
});
