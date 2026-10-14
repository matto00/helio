import {
  navigateFallback,
  navigateFallbackDenylist,
  pwaManifest,
  pwaRuntimeCaching,
  swTakeoverOptions,
} from "./pwaConfig";

describe("pwaConfig", () => {
  describe("API responses are never cached (spec: pwa-installability)", () => {
    it("has no runtimeCaching rule matching /api", () => {
      const apiPath = "/api/dashboards";
      const apiUrl = new URL(`https://helioapp.dev${apiPath}`);

      for (const rule of pwaRuntimeCaching) {
        const pattern = rule.urlPattern;
        expect(pattern.test(apiPath)).toBe(false);
        expect(pattern.test(apiUrl.href)).toBe(false);
      }
    });

    it("denylists /api/** from the SPA navigate fallback", () => {
      expect(navigateFallbackDenylist.some((pattern) => pattern.test("/api/auth/google"))).toBe(
        true,
      );
      expect(navigateFallbackDenylist.some((pattern) => pattern.test("/api/auth/me"))).toBe(true);
    });

    it("does not denylist non-API app routes", () => {
      const denied = (path: string) =>
        navigateFallbackDenylist.some((pattern) => pattern.test(path));
      expect(denied("/sources")).toBe(false);
      expect(denied("/home")).toBe(false);
      expect(denied("/home?x=1")).toBe(false);
      expect(denied("/dashboards/abc")).toBe(false);
    });
  });

  describe("the landing page owns / (spec: pwa-installability)", () => {
    const denied = (path: string) => navigateFallbackDenylist.some((pattern) => pattern.test(path));

    it.each(["/", "/?ref=x", "/?gclid=abc&x=1", "/index.html", "/index.html?x"])(
      "never answers %s with the app shell",
      (path) => {
        expect(denied(path)).toBe(true);
      },
    );

    it("lets a new service worker take over from the previous build's immediately", () => {
      expect(swTakeoverOptions).toEqual({ skipWaiting: true, clientsClaim: true });
    });

    it("falls back to the app shell, not the landing page", () => {
      expect(navigateFallback).toBe("/app.html");
    });
  });

  describe("manifest fields (spec: pwa-installability)", () => {
    it("is installable standalone, scoped to the app root", () => {
      expect(pwaManifest.name).toBe("Helio");
      expect(pwaManifest.short_name).toBe("Helio");
      expect(pwaManifest.display).toBe("standalone");
      expect(pwaManifest.start_url).toBe("/home");
      expect(pwaManifest.scope).toBe("/");
    });

    it("includes 192, 512, and 512-maskable icon entries", () => {
      const icons = pwaManifest.icons ?? [];
      const sizes = icons.map((icon) => icon.sizes);
      const maskable = icons.find((icon) => icon.purpose === "maskable");

      expect(sizes).toContain("192x192");
      expect(sizes).toContain("512x512");
      expect(maskable?.sizes).toBe("512x512");
    });
  });

  describe("font caching (spec: pwa-installability)", () => {
    it("stale-while-revalidates the Google Fonts stylesheet", () => {
      const rule = pwaRuntimeCaching.find((r) =>
        r.urlPattern.test("https://fonts.googleapis.com/css2"),
      );
      expect(rule?.handler).toBe("StaleWhileRevalidate");
    });

    it("cache-firsts the Google Fonts webfont files with a long expiry", () => {
      const rule = pwaRuntimeCaching.find((r) =>
        r.urlPattern.test("https://fonts.gstatic.com/s/fraunces/v1/font.woff2"),
      );
      expect(rule?.handler).toBe("CacheFirst");
      expect(rule?.options.expiration?.maxAgeSeconds).toBeGreaterThan(60 * 60 * 24 * 30);
    });
  });
});
