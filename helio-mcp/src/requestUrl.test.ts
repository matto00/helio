/** HEL-1161 -- `buildRequestUrl`, the one place a base URL and a request path are joined. */
import { buildRequestUrl, HelioRequestUrlError } from "./requestUrl.js";

describe("buildRequestUrl", () => {
  it("RED-FIRST keeps the base path prefix, with or without a trailing slash", () => {
    expect(buildRequestUrl("https://h/helio", "/api/x")).toBe("https://h/helio/api/x");
    expect(buildRequestUrl("https://h/helio/", "/api/x")).toBe("https://h/helio/api/x");
    expect(buildRequestUrl("https://h", "/api/x")).toBe("https://h/api/x");
    expect(buildRequestUrl("https://h/", "/api/x")).toBe("https://h/api/x");
  });

  it("RED-FIRST sets query parameters and skips undefined ones", () => {
    expect(buildRequestUrl("https://h/helio", "/api/x", { a: 1, b: undefined, c: "z" })).toBe(
      "https://h/helio/api/x?a=1&c=z",
    );
  });

  it.each([
    "/api/../../tokens",
    "/../x",
    "/%2e%2e/x",
    "/.%2e/x",
    "/../helio2/x",
    "//evil.example/x",
    "/https://evil.example/x",
    "/\\evil.example/x",
    "/\t/evil.example/x",
    "/api/x y",
    "/api/x\u0000",
  ])("RED-FIRST refuses %j under base https://h/helio", (path) => {
    expect(() => buildRequestUrl("https://h/helio", path)).toThrow(HelioRequestUrlError);
  });

  it.each([
    "localhost:8080",
    "helio.test/api",
    "ftp://h",
    "file:///x",
    "https://h/?q=1",
    "https://h/#f",
    "https://h/?",
    "",
  ])("RED-FIRST refuses base %j with a typed error", (base) => {
    expect(() => buildRequestUrl(base, "/api/x")).toThrow(HelioRequestUrlError);
  });
});
