import { classifyRequestError } from "./classifyRequestError";
import { extractErrorMessage } from "./extractErrorMessage";

/** Minimal AxiosError-shaped rejection, matching `isAxiosError`'s duck-typed
 *  check (`payload.isAxiosError === true`) — the same pattern
 *  `PipelineDetailPage.test.tsx` uses. */
function axiosError(status: number, data?: unknown) {
  return { isAxiosError: true, response: { status, data } };
}

describe("classifyRequestError", () => {
  it("classifies a 403 response as forbidden", () => {
    const result = classifyRequestError(axiosError(403), "fallback");
    expect(result.kind).toBe("forbidden");
  });

  it("classifies a 404 response as not-found", () => {
    const result = classifyRequestError(axiosError(404), "fallback");
    expect(result.kind).toBe("not-found");
  });

  it("classifies any other status as error", () => {
    expect(classifyRequestError(axiosError(500), "fallback").kind).toBe("error");
    expect(classifyRequestError(axiosError(400), "fallback").kind).toBe("error");
  });

  it("classifies a network error (no response) as error", () => {
    const result = classifyRequestError(new Error("Network Error"), "fallback");
    expect(result.kind).toBe("error");
  });

  it("classifies a non-error rejection value as error", () => {
    expect(classifyRequestError(undefined, "fallback").kind).toBe("error");
    expect(classifyRequestError("some string", "fallback").kind).toBe("error");
  });

  it("delegates message extraction to extractErrorMessage — matches its output exactly", () => {
    const err = axiosError(403, { error: "You don't have access to this pipeline." });
    const classified = classifyRequestError(err, "fallback message");
    expect(classified.message).toBe(extractErrorMessage(err, "fallback message"));
    expect(classified.message).toBe("You don't have access to this pipeline.");
  });

  it("never falls through to a raw err.message — uses the caller's fallback instead", () => {
    // A plain Error's `.message` ("boom") is exactly what extractErrorMessage
    // is documented to never surface — classifyRequestError must not
    // reimplement that policy differently.
    const result = classifyRequestError(new Error("boom"), "Failed to load sources.");
    expect(result.message).toBe("Failed to load sources.");
    expect(result.message).not.toBe("boom");
  });
});
