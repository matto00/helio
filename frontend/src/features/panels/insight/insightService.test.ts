// HEL-1744 D4 -- the service maps every response through an allow-list: cost, model and tokens never reach state.
import { httpClient } from "../../../services/httpClient";
import {
  fetchOutputInsight,
  fetchPublicPanelInsight,
  refreshOutputInsight,
} from "./insightService";

jest.mock("../../../services/httpClient", () => ({
  httpClient: { get: jest.fn(), post: jest.fn() },
}));
const http = jest.mocked(httpClient);

const AUTHENTICATED = {
  outputId: "o-1",
  render: {
    id: "r-1",
    markdown: "Up [c1].",
    citations: [
      {
        id: "c1",
        outputId: "cited-1",
        field: "revenue",
        number: 12.5,
        isPct: false,
        costMicros: 4242421,
      },
    ],
    trigger: "on_run",
    runId: "run-secret",
    inputDigest: "digest-secret",
    model: "model-secret-xyz",
    inputTokens: 987654,
    outputTokens: 987655,
    cacheCreationTokens: 987656,
    cacheReadTokens: 987657,
    costMicros: 4242421,
    createdAt: "2026-11-01T10:00:00Z",
  },
  lastAttempt: {
    id: "a-1",
    status: "failed",
    trigger: "on_run",
    createdAt: "2026-11-02T10:00:00Z",
  },
};

describe("insightService", () => {
  it("maps the authenticated read through an allow-list with no model, token or cost key", async () => {
    http.get.mockResolvedValueOnce({ data: AUTHENTICATED });
    const data = await fetchOutputInsight("o-1");
    expect(http.get).toHaveBeenCalledWith("/api/outputs/o-1/insight");
    expect(data.render?.renderedAt).toBe("2026-11-01T10:00:00Z");
    expect(data.render?.citations[0]).toEqual({
      id: "c1",
      outputId: "cited-1",
      field: "revenue",
      number: 12.5,
      isPct: false,
    });
    expect(data.lastAttempt).toEqual({
      id: expect.any(String),
      status: "failed",
      createdAt: "2026-11-02T10:00:00Z",
    });
    expect(data.canRefresh).toBe(false);
    const json = JSON.stringify(data);
    for (const leak of [
      "model-secret",
      "987654",
      "987655",
      "4242421",
      "run-secret",
      "digest-secret",
      "costMicros",
      "inputTokens",
      "model",
    ]) {
      expect(json).not.toContain(leak);
    }
  });

  it("returns a null render and attempt untouched", async () => {
    http.get.mockResolvedValueOnce({ data: { outputId: "o-1", render: null, lastAttempt: null } });
    expect(await fetchOutputInsight("o-1")).toEqual({
      render: null,
      lastAttempt: null,
      canRefresh: false,
    });
  });

  it("maps the public read, carrying only the panel id of a placed citation", async () => {
    http.get.mockResolvedValueOnce({
      data: {
        render: {
          markdown: "A [c1] B [c2].",
          renderedAt: "2026-11-01T10:00:00Z",
          citations: [
            { id: "c1", field: "a", isPct: false, panelId: "pan-1", costMicros: 1 },
            { id: "c2", field: "b", isPct: true },
          ],
        },
      },
    });
    const data = await fetchPublicPanelInsight("d-1", "pan-9", "tok");
    expect(http.get).toHaveBeenCalledWith("/api/dashboards/d-1/panels/pan-9/insight", {
      params: { token: "tok" },
    });
    expect(data.lastAttempt).toBeNull();
    expect(data.render?.citations).toEqual([
      { id: "c1", field: "a", isPct: false, panelId: "pan-1" },
      { id: "c2", field: "b", isPct: true },
    ]);
    expect(JSON.stringify(data)).not.toContain("costMicros");
  });

  it("reads canRefresh only when the server sends true", async () => {
    http.get.mockResolvedValueOnce({
      data: { outputId: "o-1", render: null, lastAttempt: null, canRefresh: true },
    });
    expect((await fetchOutputInsight("o-1")).canRefresh).toBe(true);
  });

  it("posts the refresh with no body, or the pin trigger, and reads started", async () => {
    http.post.mockResolvedValue({ data: { outputId: "o-1", started: true } });
    expect(await refreshOutputInsight("o-1")).toEqual({ started: true });
    expect(http.post).toHaveBeenLastCalledWith("/api/outputs/o-1/insight/refresh", undefined);
    await refreshOutputInsight("o-1", "pin");
    expect(http.post).toHaveBeenLastCalledWith("/api/outputs/o-1/insight/refresh", {
      trigger: "pin",
    });
  });
});
