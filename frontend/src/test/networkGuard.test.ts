import { httpClient } from "../services/httpClient";
import { allowlistOwner, takeNetworkViolations } from "./networkGuard";

// HEL-1600 -- the guard's own self-test. It deliberately issues an UNMOCKED httpClient request and
// asserts the guard saw it, opened no socket, and settled it as a network error (a request that
// hangs would turn every unmocked call in the suite into a stuck thunk).
describe("networkGuard", () => {
  it("records an unmocked httpClient request with method and URL, and rejects it as a network error", async () => {
    const consoleError = jest.spyOn(console, "error");
    try {
      await expect(httpClient.get("/api/guard-self-test")).rejects.toMatchObject({
        code: "ERR_NETWORK",
      });

      // No socket was opened: jsdom logs an XHR AggregateError (ECONNREFUSED) when one is.
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }

    const violations = takeNetworkViolations();
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ method: "GET", url: "/api/guard-self-test" });
    expect(violations[0].testName).toContain("records an unmocked httpClient request");
  });

  it("leaves nothing behind for the next test once violations are taken", () => {
    expect(takeNetworkViolations()).toEqual([]);
  });

  it("matches the allowlist by repo-relative path suffix, never by basename", () => {
    const list = { "src/app/App.test.tsx": "HEL-9999" };
    expect(allowlistOwner("/repo/frontend/src/app/App.test.tsx", list)).toBe("HEL-9999");
    expect(allowlistOwner("/repo/frontend/src/other/app/App.test.tsx", list)).toBeUndefined();
    expect(allowlistOwner("/repo/frontend/src/elsewhere/App.test.tsx", list)).toBeUndefined();
  });
});
