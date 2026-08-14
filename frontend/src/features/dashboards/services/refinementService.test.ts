import { httpClient } from "../../../services/httpClient";
import { postRefinement, RefinementRequestError } from "./refinementService";
import type { RefinementResult } from "../types/refinement";

jest.mock("../../../services/httpClient", () => ({
  httpClient: { get: jest.fn(), post: jest.fn() },
}));

const mockedHttpClient = jest.mocked(httpClient);

beforeEach(() => {
  jest.resetAllMocks();
});

describe("postRefinement", () => {
  it("POSTs /api/refinements with the given request body and returns the parsed result", async () => {
    const result: RefinementResult = {
      patchSet: {
        summary: "Rename panel",
        edits: [
          { target: { kind: "panel", id: "p-1" }, op: "update", patch: { title: "New title" } },
        ],
      },
      conversationId: "conv-1",
    };
    mockedHttpClient.post.mockResolvedValueOnce({ data: result });

    const request = {
      target: { kind: "dashboard" as const, id: "dash-1" },
      message: "rename the panel",
    };
    const returned = await postRefinement(request);

    expect(mockedHttpClient.post).toHaveBeenCalledWith("/api/refinements", request);
    expect(returned).toEqual(result);
  });

  it("forwards conversationId when supplied, to continue an existing conversation", async () => {
    const result: RefinementResult = { patchSet: { edits: [] }, conversationId: "conv-1" };
    mockedHttpClient.post.mockResolvedValueOnce({ data: result });

    const request = {
      target: { kind: "dashboard" as const, id: "dash-1" },
      message: "and again",
      conversationId: "conv-1",
    };
    await postRefinement(request);

    expect(mockedHttpClient.post).toHaveBeenCalledWith("/api/refinements", request);
  });

  it("throws a RefinementRequestError with the server's message + kind on a structured error response", async () => {
    const apiError = Object.assign(new Error("Unprocessable Entity"), {
      isAxiosError: true,
      response: {
        status: 422,
        data: { message: "Model output was invalid twice.", kind: "InvalidProposal" },
      },
    });
    mockedHttpClient.post.mockRejectedValueOnce(apiError);

    const request = {
      target: { kind: "dashboard" as const, id: "dash-1" },
      message: "do something",
    };

    await expect(postRefinement(request)).rejects.toMatchObject({
      message: "Model output was invalid twice.",
      kind: "InvalidProposal",
    });
    await expect(postRefinement(request)).rejects.toBeInstanceOf(RefinementRequestError);
  });

  it("throws a RefinementRequestError with kind null when the error body carries no kind (e.g. a missing/foreign conversationId)", async () => {
    const apiError = Object.assign(new Error("Not Found"), {
      isAxiosError: true,
      response: { status: 404, data: { message: "Not Found" } },
    });
    mockedHttpClient.post.mockRejectedValueOnce(apiError);

    const request = {
      target: { kind: "dashboard" as const, id: "dash-1" },
      message: "do something",
    };

    await expect(postRefinement(request)).rejects.toMatchObject({
      message: "Not Found",
      kind: null,
    });
  });

  it("throws a generic RefinementRequestError('Connection failed') when the failure never reached the server", async () => {
    mockedHttpClient.post.mockRejectedValueOnce(new Error("Network Error"));

    const request = {
      target: { kind: "dashboard" as const, id: "dash-1" },
      message: "do something",
    };

    await expect(postRefinement(request)).rejects.toMatchObject({
      message: "Connection failed",
      kind: null,
    });
  });
});
