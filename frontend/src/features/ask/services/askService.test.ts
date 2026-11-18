import { httpClient } from "../../../services/httpClient";
import type { AskPin } from "../types/ask";
import { askDashboard, askOutput, mapAskResponse, pinInsight } from "./askService";

jest.mock("../../../services/httpClient", () => ({
  httpClient: { get: jest.fn(), post: jest.fn() },
}));
const http = jest.mocked(httpClient);

const BODY = {
  answer: "Revenue is 10 [c1].",
  citations: [
    { id: "c1", outputId: "o-1", field: "amount", number: 10, isPct: false, costMicros: 99 },
  ],
  citedOutputs: [{ id: "o-1", name: "Revenue" }],
  pin: null,
  model: "model-secret-xyz",
  inputTokens: 987654,
  costMicros: 4242421,
};

beforeEach(() => jest.resetAllMocks());

describe("askService", () => {
  it("askDashboard POSTs exactly {question} to the dashboard route", async () => {
    http.post.mockResolvedValue({ data: BODY });
    await askDashboard("d-1", "How is revenue?");
    expect(http.post).toHaveBeenCalledTimes(1);
    expect(http.post).toHaveBeenCalledWith("/api/dashboards/d-1/ask", {
      question: "How is revenue?",
    });
  });

  it("askOutput POSTs exactly {question} to the Output route", async () => {
    http.post.mockResolvedValue({ data: BODY });
    await askOutput("o-1", "Why?");
    expect(http.post).toHaveBeenCalledWith("/api/outputs/o-1/ask", { question: "Why?" });
  });

  it("maps through an allow-list: no model, token or cost value reaches the result", async () => {
    http.post.mockResolvedValue({ data: BODY });
    const result = await askDashboard("d-1", "q");
    const text = JSON.stringify(result);
    expect(text).not.toContain("model-secret-xyz");
    expect(text).not.toContain("987654");
    expect(text).not.toContain("4242421");
    expect(text).not.toContain("99");
    expect(result.citations[0]).toEqual({
      id: "c1",
      outputId: "o-1",
      field: "amount",
      number: 10,
      isPct: false,
    });
  });

  it("drops a malformed citation and keeps an explicit null pin as null", () => {
    const mapped = mapAskResponse({ ...BODY, citations: [{ id: "c1" }, BODY.citations[0]] });
    expect(mapped.citations).toHaveLength(1);
    expect(mapped.pin).toBeNull();
  });

  it("pinInsight POSTs pin.request unchanged to the pipeline's outputs route", async () => {
    const request = {
      kind: "insight",
      name: "Why?",
      rootId: "p-1",
      config: { prompt: "Why?", reads: { outputs: ["o-1"] }, refresh: "manual" },
    };
    const pin: AskPin = { pipelineId: "p-1", request };
    http.post.mockResolvedValue({
      data: { id: "new", pipelineId: "p-1", name: "Why?", kind: "insight" },
    });
    await pinInsight(pin);
    expect(http.post).toHaveBeenCalledTimes(1);
    const [path, body] = http.post.mock.calls[0];
    expect(path).toBe("/api/pipelines/p-1/outputs");
    expect(body).toBe(request);
  });
});
