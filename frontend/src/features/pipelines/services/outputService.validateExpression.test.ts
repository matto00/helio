// HEL-1437 seam test. The response body here is the SAME committed fixture the backend's
// `PipelineCapabilitiesRoutesSpec` compares with the real `POST .../validate-expression` response
// for a type-error expression, so drift on either side turns one of the two tests red.

import { readFileSync } from "fs";
import { resolve } from "path";

import { httpClient } from "../../../services/httpClient";
import { validateExpression } from "./outputService";

jest.mock("../../../services/httpClient", () => ({
  httpClient: { post: jest.fn() },
}));

const mockedHttpClient = jest.mocked(httpClient);

const FIXTURE_PATH = resolve(
  __dirname,
  "../../../../../backend/src/test/resources/validate-expression/type-error-response.json",
);
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as {
  valid: boolean;
  error: string;
};

describe("outputService.validateExpression (HEL-1437 seam)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("the fixture is the invalid-with-message shape the backend sends for a type error", () => {
    expect(fixture.valid).toBe(false);
    expect(typeof fixture.error).toBe("string");
    expect(fixture.error).toContain("coalesce arguments must all be numbers or all be text");
  });

  it("surfaces valid:false and the server's error text from the shared fixture", async () => {
    mockedHttpClient.post.mockResolvedValue({ data: fixture });

    const result = await validateExpression("p1", 'coalesce($amount, "n/a")', "s1");

    expect(mockedHttpClient.post).toHaveBeenCalledWith(
      "/api/pipelines/p1/validate-expression",
      { expression: 'coalesce($amount, "n/a")' },
      { params: { stepId: "s1" } },
    );
    expect(result).toEqual({ valid: false, error: fixture.error });
  });

  it("normalises an absent error to undefined for a valid expression", async () => {
    mockedHttpClient.post.mockResolvedValue({ data: { valid: true } });

    await expect(validateExpression("p1", "$amount")).resolves.toEqual({
      valid: true,
      error: undefined,
    });
  });
});
