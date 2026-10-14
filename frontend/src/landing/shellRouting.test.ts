import { acceptsHtml, shellHtmlFor } from "./shellRouting";

describe("shellHtmlFor", () => {
  it.each(["/", "/index.html"])("serves the landing page for %s", (path) => {
    expect(shellHtmlFor(path)).toBe("index.html");
  });

  it.each([
    "/home",
    "/dashboards/abc",
    "/dashboards/abc/panels",
    "/pipelines/p1",
    "/login",
    "/register",
    "/auth/callback",
    "/some/unknown/route",
  ])("serves the app shell for the deep link %s", (path) => {
    expect(shellHtmlFor(path)).toBe("app.html");
  });

  it.each([
    "/assets/index-abc123.js",
    "/orbit-mark.svg",
    "/landing/og.jpg",
    "/manifest.webmanifest",
    "/sw.js",
    "/app.html",
  ])("serves the built file %s as-is", (path) => {
    expect(shellHtmlFor(path)).toBeNull();
  });

  it.each(["/api/auth/me", "/health", "/@vite/client", "/src/main.tsx", "/node_modules/.vite/x"])(
    "leaves %s to the API proxy or Vite",
    (path) => {
      expect(shellHtmlFor(path)).toBeNull();
    },
  );
});

describe("acceptsHtml", () => {
  it("treats a missing or empty Accept as HTML, like curl and request.get", () => {
    expect(acceptsHtml(undefined)).toBe(true);
    expect(acceptsHtml("")).toBe(true);
  });

  it("accepts text/html and the wildcard", () => {
    expect(acceptsHtml("text/html,application/xhtml+xml")).toBe(true);
    expect(acceptsHtml("*/*")).toBe(true);
  });

  it("rejects a non-HTML Accept", () => {
    expect(acceptsHtml("application/json")).toBe(false);
  });
});
