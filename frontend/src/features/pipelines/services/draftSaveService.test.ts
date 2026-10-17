import { AxiosError, type AxiosResponse } from "axios";

import { httpClient } from "../../../services/httpClient";
import type { DraftSaveRequest } from "../types/draftSave";
import { extractDraftSaveConflict, getPipelineWithDefinition, saveDraft } from "./draftSaveService";

jest.mock("../../../services/httpClient", () => ({
  httpClient: { get: jest.fn(), post: jest.fn() },
}));

const mockedHttpClient = jest.mocked(httpClient);

const request: DraftSaveRequest = {
  baseFingerprint: "v1:abc",
  steps: [{ id: "s1", type: "limit", config: { count: 1 }, rootId: "r1", position: 0 }],
  outputs: [],
};

const failure = (status: number, data: unknown): AxiosError => {
  const error = new AxiosError("request failed");
  error.response = { status, data } as AxiosResponse;
  return error;
};

describe("draftSaveService", () => {
  afterEach(() => jest.resetAllMocks());

  it("reads the pipeline together with its definition in one request", async () => {
    mockedHttpClient.get.mockResolvedValueOnce({ data: { id: "p1", fingerprint: "v1:abc" } });
    const pipeline = await getPipelineWithDefinition("p1");
    expect(mockedHttpClient.get).toHaveBeenCalledWith("/api/pipelines/p1", {
      params: { definition: true },
    });
    expect(pipeline.fingerprint).toBe("v1:abc");
  });

  it("posts the whole draft to the save endpoint and returns the body unchanged", async () => {
    const body = { saved: { fingerprint: "v1:def" }, run: null };
    mockedHttpClient.post.mockResolvedValueOnce({ data: body });
    await expect(saveDraft("p1", request)).resolves.toBe(body);
    expect(mockedHttpClient.post).toHaveBeenCalledWith("/api/pipelines/p1/draft/save", request);
  });

  it("offers no way to force a stale save: only the fingerprint travels", () => {
    expect(Object.keys(request).sort()).toEqual(["baseFingerprint", "outputs", "steps"]);
  });

  it("recognises a stale base and exposes the current fingerprint", () => {
    const conflict = extractDraftSaveConflict(
      failure(409, {
        code: "PATCH_SET_STALE",
        staleTargets: [{ index: 0, kind: "pipeline", id: "p1" }],
        currentFingerprint: "v1:new",
      }),
    );
    expect(conflict).toEqual({
      kind: "stale",
      currentFingerprint: "v1:new",
      staleTargets: [{ index: 0, kind: "pipeline", id: "p1" }],
    });
  });

  it("recognises an unconfirmed cascade and lists its impact", () => {
    const conflict = extractDraftSaveConflict(
      failure(422, {
        code: "CASCADE_CONFIRMATION_REQUIRED",
        impact: {
          stepIds: ["s2"],
          outputIds: ["o2"],
          panelIds: ["pa"],
          alertRuleIds: ["ra"],
          hints: ["Removes 1 step(s)."],
        },
      }),
    );
    expect(conflict).toEqual({
      kind: "cascadeRequired",
      impact: {
        stepIds: ["s2"],
        outputIds: ["o2"],
        panelIds: ["pa"],
        alertRuleIds: ["ra"],
        hints: ["Removes 1 step(s)."],
      },
    });
  });

  it("returns null for a validation failure and for a non-HTTP error", () => {
    expect(extractDraftSaveConflict(failure(400, { message: "bad" }))).toBeNull();
    expect(extractDraftSaveConflict(new Error("network"))).toBeNull();
  });
});
