import { AxiosError, type AxiosResponse } from "axios";

import { runPipeline } from "./pipelineService";
import { runToUpdate } from "./runToUpdate";

jest.mock("./pipelineService");
const runMock = runPipeline as jest.MockedFunction<typeof runPipeline>;

function axiosError(status: number, headers: Record<string, string> = {}): AxiosError {
  const error = new AxiosError("failed");
  error.response = { status, headers, data: {}, statusText: "", config: {} } as AxiosResponse;
  return error;
}

describe("runToUpdate", () => {
  beforeEach(() => runMock.mockReset());

  it("reports a started run", async () => {
    runMock.mockResolvedValue({} as never);
    expect(await runToUpdate("p1")).toEqual({ ok: true, message: "Run started." });
  });

  it("keeps the 429 and its Retry-After as structured fields (HEL-1578 reads them) and in the message", async () => {
    runMock.mockRejectedValue(axiosError(429, { "retry-after": "15" }));
    expect(await runToUpdate("p1")).toEqual({
      ok: false,
      message: "Too many runs right now — try again in 15s.",
      rejected: true,
      retryAfterSeconds: 15,
    });
  });

  it("flags a 429 without a parseable Retry-After as rejected with no wait", async () => {
    runMock.mockRejectedValue(axiosError(429, { "retry-after": "soon" }));
    const result = await runToUpdate("p1");
    expect(result.rejected).toBe(true);
    expect(result.retryAfterSeconds).toBeUndefined();
    expect(result.message).toBe("Too many runs right now — try again shortly.");
  });

  it("does not flag any other failure as a guard rejection", async () => {
    runMock.mockRejectedValue(axiosError(500));
    const result = await runToUpdate("p1");
    expect(result.ok).toBe(false);
    expect(result.rejected).toBeUndefined();
  });
});
