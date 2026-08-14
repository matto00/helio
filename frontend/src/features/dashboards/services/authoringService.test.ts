import { httpClient } from "../../../services/httpClient";
import { fetchAuthoringConversation, postAuthoringOutcome } from "./authoringService";

jest.mock("../../../services/httpClient", () => ({
  httpClient: { get: jest.fn(), post: jest.fn() },
}));

const mockedHttpClient = jest.mocked(httpClient);

beforeEach(() => {
  jest.resetAllMocks();
});

describe("fetchAuthoringConversation", () => {
  it("GETs /api/authoring/conversations/:id and returns the parsed view", async () => {
    const view = {
      conversationId: "conv-1",
      displayTurns: [
        { role: "user", text: "Show total revenue" },
        { role: "assistant", text: 'Proposed "Sales" (1 panel(s))' },
      ],
      latestProposal: { dashboardName: "Sales", panels: [] },
    };
    mockedHttpClient.get.mockResolvedValueOnce({ data: view });

    const result = await fetchAuthoringConversation("conv-1");

    expect(mockedHttpClient.get).toHaveBeenCalledWith("/api/authoring/conversations/conv-1");
    expect(result).toEqual(view);
  });

  it("resolves null on a 404 (missing/not-owned) rather than throwing", async () => {
    const notFound = Object.assign(new Error("Not Found"), {
      isAxiosError: true,
      response: { status: 404 },
    });
    mockedHttpClient.get.mockRejectedValueOnce(notFound);

    const result = await fetchAuthoringConversation("conv-missing");

    expect(result).toBeNull();
  });

  it("rethrows a non-404 failure", async () => {
    const serverError = Object.assign(new Error("Server Error"), {
      isAxiosError: true,
      response: { status: 500 },
    });
    mockedHttpClient.get.mockRejectedValueOnce(serverError);

    await expect(fetchAuthoringConversation("conv-1")).rejects.toThrow("Server Error");
  });
});

// HEL-401 design.md D4 — POST /api/authoring/requests/:id/outcome (telemetry-only correlation).
describe("postAuthoringOutcome", () => {
  it("POSTs {outcome} to /api/authoring/requests/:id/outcome", async () => {
    mockedHttpClient.post.mockResolvedValueOnce({ data: undefined });

    await postAuthoringOutcome("req-1", "accepted");

    expect(mockedHttpClient.post).toHaveBeenCalledWith("/api/authoring/requests/req-1/outcome", {
      outcome: "accepted",
    });
  });

  it("POSTs a 'rejected' outcome", async () => {
    mockedHttpClient.post.mockResolvedValueOnce({ data: undefined });

    await postAuthoringOutcome("req-2", "rejected");

    expect(mockedHttpClient.post).toHaveBeenCalledWith("/api/authoring/requests/req-2/outcome", {
      outcome: "rejected",
    });
  });
});
