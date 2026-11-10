import { randomBytes } from "node:crypto";
import { loadHttpConfig } from "./httpConfig.js";

const KEY = randomBytes(32).toString("base64");
const base = (): Record<string, string> => ({
  HELIO_MCP_PUBLIC_URL: "https://mcp.example.dev",
  HELIO_APP_URL: "https://app.example.dev",
  HELIO_API_BASE_URL: "https://api.example.dev/",
  HELIO_MCP_TOKEN_KEY: KEY,
});

describe("loadHttpConfig", () => {
  it("loads defaults", () => {
    const c = loadHttpConfig(base());
    expect(c.resourceUrl.href).toBe("https://mcp.example.dev/mcp");
    expect(c.apiBaseUrl).toBe("https://api.example.dev");
    expect(c.port).toBe(8080);
    expect(c.livenessTtlSeconds).toBe(300);
    expect(c.largeBodySlots).toBeGreaterThanOrEqual(1);
    expect(c.allowedRedirectHosts).toBeUndefined();
  });

  it.each(["HELIO_MCP_PUBLIC_URL", "HELIO_APP_URL", "HELIO_API_BASE_URL", "HELIO_MCP_TOKEN_KEY"])(
    "names %s when missing",
    (name) => {
      const env = base();
      delete env[name];
      expect(() => loadHttpConfig(env)).toThrow(name);
    },
  );

  it("rejects a public URL with a path, and a non-https app URL", () => {
    expect(() => loadHttpConfig({ ...base(), HELIO_MCP_PUBLIC_URL: "https://x.dev/mcp" })).toThrow(
      "HELIO_MCP_PUBLIC_URL",
    );
    expect(() => loadHttpConfig({ ...base(), HELIO_APP_URL: "https://x.dev/app" })).toThrow(
      "HELIO_APP_URL",
    );
    expect(() => loadHttpConfig({ ...base(), HELIO_APP_URL: "http://evil.dev" })).toThrow(
      "HELIO_APP_URL",
    );
    expect(
      loadHttpConfig({ ...base(), HELIO_APP_URL: "http://localhost:5173" }).appUrl.origin,
    ).toBe("http://localhost:5173");
  });

  it("rejects a wrong-length key without echoing it", () => {
    const bad = randomBytes(16).toString("base64");
    try {
      loadHttpConfig({ ...base(), HELIO_MCP_TOKEN_KEY: bad });
      throw new Error("expected throw");
    } catch (e) {
      expect((e as Error).message).toContain("HELIO_MCP_TOKEN_KEY");
      expect((e as Error).message).not.toContain(bad);
    }
    expect(() => loadHttpConfig({ ...base(), HELIO_MCP_TOKEN_KEY_PREVIOUS: "AAAA" })).toThrow(
      "HELIO_MCP_TOKEN_KEY_PREVIOUS",
    );
  });

  it("validates ranges", () => {
    for (const v of ["0", "3601", "abc", "1.5"]) {
      expect(() => loadHttpConfig({ ...base(), HELIO_MCP_LIVENESS_TTL_SECONDS: v })).toThrow(
        "HELIO_MCP_LIVENESS_TTL_SECONDS",
      );
    }
    expect(
      loadHttpConfig({ ...base(), HELIO_MCP_LIVENESS_TTL_SECONDS: "1" }).livenessTtlSeconds,
    ).toBe(1);
    expect(() => loadHttpConfig({ ...base(), HELIO_MCP_LARGE_BODY_SLOTS: "0" })).toThrow(
      "HELIO_MCP_LARGE_BODY_SLOTS",
    );
    expect(() => loadHttpConfig({ ...base(), PORT: "99999" })).toThrow("PORT");
  });

  it("parses the redirect host allow-list and previous key", () => {
    const c = loadHttpConfig({
      ...base(),
      HELIO_MCP_ALLOWED_REDIRECT_HOSTS: " Claude.ai, claude.com ,",
      HELIO_MCP_TOKEN_KEY_PREVIOUS: randomBytes(32).toString("base64"),
    });
    expect([...(c.allowedRedirectHosts ?? [])]).toEqual(["claude.ai", "claude.com"]);
    expect(c.keys.previous).toBeDefined();
  });
});
