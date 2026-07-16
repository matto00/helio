// react-markdown is mapped to the test mock (jest.config.cjs), whose
// `defaultUrlTransform` faithfully mirrors the real protocol-allowlist
// behavior — so these tests exercise the same fall-through semantics prod
// hits.
import { resolveMarkdownUrl } from "./markdownUrls";

describe("resolveMarkdownUrl", () => {
  it("rewrites a helio uploads-image ref to the public uploads route", () => {
    expect(resolveMarkdownUrl("helio://uploads/image/abc123")).toBe("/api/uploads/image/abc123");
  });

  it("accepts a UUID-style id (dots, dashes, underscores are safe segment chars)", () => {
    expect(resolveMarkdownUrl("helio://uploads/image/6f1e_2a-3b.4c")).toBe(
      "/api/uploads/image/6f1e_2a-3b.4c",
    );
  });

  it("leaves a bare relative uploads URL untouched (survives the default transform)", () => {
    expect(resolveMarkdownUrl("/api/uploads/image/abc123")).toBe("/api/uploads/image/abc123");
  });

  it("passes an https image URL through unchanged", () => {
    expect(resolveMarkdownUrl("https://example.com/x.png")).toBe("https://example.com/x.png");
  });

  it("strips a non-uploads helio:// URL (falls to the default transform)", () => {
    expect(resolveMarkdownUrl("helio://something/else")).toBe("");
  });

  it("rejects an id containing a path separator and strips it", () => {
    // The `/` breaks the single-safe-segment rule, so it is not rewritten and
    // the unknown `helio://` protocol is stripped by the default transform.
    expect(resolveMarkdownUrl("helio://uploads/image/abc/def")).toBe("");
  });

  it("rejects a traversal id (`..`) and strips it", () => {
    expect(resolveMarkdownUrl("helio://uploads/image/..")).toBe("");
  });

  it("rejects a single-dot id and strips it", () => {
    expect(resolveMarkdownUrl("helio://uploads/image/.")).toBe("");
  });

  it("rejects an empty id and strips it", () => {
    expect(resolveMarkdownUrl("helio://uploads/image/")).toBe("");
  });

  it("rejects an id with a query string and strips it", () => {
    expect(resolveMarkdownUrl("helio://uploads/image/abc?x=1")).toBe("");
  });
});
