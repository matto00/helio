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
