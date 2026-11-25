/** HEL-1160 -- an agent-supplied id is one opaque, encoded path segment or a typed rejection. */
import { HelioInvalidIdError, pathSegment } from "./pathSegment.js";

describe("pathSegment", () => {
  it.each(["..", ".", "a/b", "a?b=1", "a#b", "a\\b", "", "1/../../tokens", "x?force=true"])(
    "rejects %j with HelioInvalidIdError",
    (bad) => {
      expect(() => pathSegment(bad, "pipelineId")).toThrow(HelioInvalidIdError);
    },
  );

  it("names the label and the value in the message", () => {
    let error: unknown;
    try {
      pathSegment("1/../../tokens", "pipelineId");
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(HelioInvalidIdError);
    const e = error as HelioInvalidIdError;
    expect(e.name).toBe("HelioInvalidIdError");
    expect(e.message).toContain("pipelineId");
    expect(e.message).toContain("1/../../tokens");
    expect(e.value).toBe("1/../../tokens");
  });

  it("rejects a non-string", () => {
    expect(() => pathSegment(undefined as unknown as string)).toThrow(HelioInvalidIdError);
  });

  it.each(["3f2b8c1e-7a4d-4e0b-9c51-0d6a2f9b1e77", "top-n", "dash_1", "abc.def"])(
    "passes %s unchanged",
    (ok) => {
      expect(pathSegment(ok)).toBe(ok);
    },
  );

  it("encodes a space and a percent sign", () => {
    expect(pathSegment("a b")).toBe("a%20b");
    expect(pathSegment("100%")).toBe("100%25");
  });
});
