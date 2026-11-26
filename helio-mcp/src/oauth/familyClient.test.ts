/** HEL-1160 -- rotate never lets a traversal familyId reach a request path. */
import { FamilyClient } from "./familyClient.js";

describe("FamilyClient.rotate path safety", () => {
  const request = {
    clientIdHash: "c",
    resource: "r",
    presentedJtiHash: "p",
    nextJtiHash: "n",
  };

  afterEach(() => jest.restoreAllMocks());

  it.each(["..", "a/b"])("familyId %j is refused as unknown with no request", async (familyId) => {
    const spy = jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("must not be called"));
    const outcome = await new FamilyClient("https://helio.test").rotate("pat", {
      ...request,
      familyId,
    });
    expect(outcome).toEqual({ kind: "refused", reason: "unknown" });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("FamilyClient.create request URL (HEL-1161)", () => {
  const request = { clientIdHash: "c", resource: "r", jtiHash: "j" };
  const reply = () => Promise.resolve(new Response("{}", { status: 500 }));

  afterEach(() => jest.restoreAllMocks());

  // RED-FIRST: main concatenates, producing `//api/...` for a trailing-slash base.
  it("RED-FIRST a trailing-slash prefixed base requests https://h/helio/api/mcp-refresh-families", async () => {
    const spy = jest.spyOn(globalThis, "fetch").mockImplementation(reply);
    await new FamilyClient("https://h/helio/").create("pat", request);
    expect(String(spy.mock.calls[0]?.[0])).toBe("https://h/helio/api/mcp-refresh-families");
  });

  it("GUARD a prefixed base without a trailing slash keeps its prefix", async () => {
    const spy = jest.spyOn(globalThis, "fetch").mockImplementation(reply);
    await new FamilyClient("https://h/helio").create("pat", request);
    expect(String(spy.mock.calls[0]?.[0])).toBe("https://h/helio/api/mcp-refresh-families");
  });

  it("RED-FIRST rotate keeps the prefix and a trailing-slash base", async () => {
    const spy = jest.spyOn(globalThis, "fetch").mockImplementation(reply);
    await new FamilyClient("https://h/helio/").rotate("pat", {
      familyId: "fam1",
      clientIdHash: "c",
      resource: "r",
      presentedJtiHash: "p",
      nextJtiHash: "n",
    });
    expect(String(spy.mock.calls[0]?.[0])).toBe(
      "https://h/helio/api/mcp-refresh-families/fam1/rotate",
    );
  });

  // RED-FIRST: main's outcome detail is a fetch error name, and a request is attempted.
  it("RED-FIRST a base that is not an absolute URL is unavailable/HelioRequestUrlError, nothing sent", async () => {
    const spy = jest.spyOn(globalThis, "fetch").mockImplementation(reply);
    const outcome = await new FamilyClient("localhost:8080").create("pat", request);
    expect(outcome).toEqual({ kind: "unavailable", detail: "HelioRequestUrlError" });
    expect(spy).not.toHaveBeenCalled();
  });
});
