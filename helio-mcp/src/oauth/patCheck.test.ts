/** HEL-1161 -- checkPat builds its URL with the shared builder (prefix kept, bad base refused). */
import { checkPat } from "./patCheck.js";

describe("checkPat request URL", () => {
  afterEach(() => jest.restoreAllMocks());

  // RED-FIRST: main concatenates, producing `https://h/helio//api/tokens` for a trailing-slash base.
  it("RED-FIRST a trailing-slash prefixed base requests https://h/helio/api/tokens", async () => {
    const spy = jest
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(new Response(null, { status: 200 })));
    await expect(checkPat("https://h/helio/", "pat")).resolves.toBe("live");
    expect(String(spy.mock.calls[0]?.[0])).toBe("https://h/helio/api/tokens");
  });

  it("GUARD a prefixed base without a trailing slash keeps its prefix", async () => {
    const spy = jest
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(new Response(null, { status: 200 })));
    await checkPat("https://h/helio", "pat");
    expect(String(spy.mock.calls[0]?.[0])).toBe("https://h/helio/api/tokens");
  });

  // RED-FIRST: main calls fetch with `localhost:8080/api/tokens`.
  it("RED-FIRST a base that is not an absolute URL is unknown and sends nothing", async () => {
    const spy = jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("must not be called"));
    await expect(checkPat("localhost:8080", "pat")).resolves.toBe("unknown");
    expect(spy).not.toHaveBeenCalled();
  });
});
