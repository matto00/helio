/** HEL-1161 -- `HELIO_API_BASE_URL` is validated once, when the configuration loads. */
import { loadConfig } from "./config.js";

const PAT = "helio_pat_abc";
const env = (base?: string): Record<string, string | undefined> => ({
  HELIO_PAT: PAT,
  HELIO_API_BASE_URL: base,
});

describe("loadConfig HELIO_API_BASE_URL", () => {
  it.each([
    "localhost:8080",
    "helio.test/api",
    "ftp://h",
    "file:///x",
    "https://h/?q=1",
    "https://h/#f",
    "https://h/?",
    "https://h/#",
  ])("RED-FIRST rejects %j, naming the variable", (base) => {
    expect(() => loadConfig(env(base))).toThrow("HELIO_API_BASE_URL");
  });

  it("RED-FIRST never echoes a credential-bearing value in the message", () => {
    let message = "";
    try {
      loadConfig(env("ftp://user:s3cret@h"));
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("HELIO_API_BASE_URL");
    expect(message).not.toContain("s3cret");
  });

  it("RED-FIRST treats a blank value as unset and loads the default", () => {
    expect(loadConfig(env("  ")).baseUrl).toBe("http://localhost:8080");
  });

  it("GUARD loads the default when unset", () => {
    expect(loadConfig(env(undefined)).baseUrl).toBe("http://localhost:8080");
  });

  it("RED-FIRST trims surrounding whitespace", () => {
    expect(loadConfig(env("  https://h/helio/  ")).baseUrl).toBe("https://h/helio");
  });

  it.each([
    ["https://h", "https://h"],
    ["https://h/helio", "https://h/helio"],
    ["https://h/helio/", "https://h/helio"],
  ])("GUARD accepts %j as %j", (base, expected) => {
    expect(loadConfig(env(base)).baseUrl).toBe(expected);
  });
});
