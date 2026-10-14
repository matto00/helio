import { expect, test } from "@playwright/test";

import { registerAndLogin } from "./support/auth";
import { bisectHitExtent, measureBox } from "./support/touchTargetProbe";

// HEL-1562: the static landing page at `/`, the app at `/home`, and everything that has to keep working around
// that move. The beta endpoint is only ever really called unauthenticated (401): a real authenticated send would
// email the owner when Resend is configured, so 204/409/429/503 are page.route mocks.

const HINT_KEY = "helio.signedIn";

test.describe("HEL-1562 landing page", () => {
  test("GET / returns the hero text and the share tags as raw HTML, with no app shell", async ({
    request,
  }) => {
    const res = await request.get("/");
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain("Give me a dashboard for");
    expect(body).toContain('rel="canonical" href="https://helioapp.dev/"');
    expect(body).toContain('property="og:image"');
    expect(body).toContain('name="twitter:card" content="summary_large_image"');
    expect(body).not.toContain('id="root"');
    expect(body).not.toContain("/src/main.tsx");
  });

  for (const path of [
    "/home",
    "/dashboards/00000000-0000-0000-0000-000000000000",
    "/pipelines/00000000-0000-0000-0000-000000000000",
    "/login",
    "/register",
    "/auth/callback",
    "/dashboards/00000000-0000-0000-0000-000000000000/panels",
  ]) {
    test(`a hard refresh on ${path} is served the app shell`, async ({ request }) => {
      const body = await (await request.get(path)).text();
      expect(body).toContain('id="root"');
      expect(body).not.toContain("Give me a dashboard for");
    });
  }

  test("the login page renders in a real browser after a hard refresh", async ({ page }) => {
    await page.goto("/login");
    await page.reload();
    await expect(page.locator("#email")).toBeVisible();
  });

  test("a signed-out visitor sees the landing page at /", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Give me a dashboard for");
    await expect(page).toHaveURL(/\/$/);
  });

  test("a signed-in user is sent from / to /home, and signing out brings the landing page back", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, {
      prefix: "hel1562",
      label: "hint",
      displayName: "HEL-1562 E2E Hint",
      waitForShell: true,
    });
    expect(await page.evaluate((k) => localStorage.getItem(k), HINT_KEY)).toBe("1");

    await page.goto("/");
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.getByRole("button", { name: "Add dashboard" })).toBeVisible();

    await page.getByRole("button", { name: "User menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await page.waitForURL("/login");
    expect(await page.evaluate((k) => localStorage.getItem(k), HINT_KEY)).toBeNull();

    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Give me a dashboard for");
  });

  test("a stale hint bounces once through /home to /login and clears itself", async ({ page }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.evaluate((k) => localStorage.setItem(k, "1"), HINT_KEY);
    await page.goto("/");
    await page.waitForURL("/login");
    expect(await page.evaluate((k) => localStorage.getItem(k), HINT_KEY)).toBeNull();
  });

  test("Request beta access as a signed-out visitor offers the free account, via the real endpoint", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Request beta access" }).first().click();
    const status = page.getByRole("status").filter({ hasText: "Create a free account first" });
    await expect(status.first()).toBeVisible();
    await expect(status.first().getByRole("link", { name: "Start free" })).toHaveAttribute(
      "href",
      "/register",
    );
  });

  for (const [status, text] of [
    [204, "Request sent"],
    [409, "already has beta access"],
    [429, "try again later"],
    [503, "aren't available right now"],
  ] as const) {
    test(`Request beta access announces the ${status} outcome`, async ({ page }) => {
      await page.route("**/api/beta-access/request", (route) => route.fulfill({ status }));
      await page.goto("/");
      await page.getByRole("button", { name: "Request beta access" }).first().click();
      await expect(page.getByRole("status").filter({ hasText: text }).first()).toBeVisible();
    });
  }

  for (const scheme of ["light", "dark"] as const) {
    for (const width of [375, 1440]) {
      test(`no horizontal scroll at ${width}px in ${scheme}`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.setViewportSize({ width, height: 800 });
        await page.goto("/");
        await expect(page.locator("html")).toHaveAttribute("data-theme", scheme);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
      });
    }
  }
  test("single-class spacing rules are not zeroed by the paragraph reset", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const margins = await page.evaluate(() => {
      const m = (sel: string) => {
        const cs = getComputedStyle(document.querySelector(sel) as Element);
        return { top: parseFloat(cs.marginTop), bottom: parseFloat(cs.marginBottom) };
      };
      return { closingSub: m(".closing-sub"), caption2: m(".caption2") };
    });
    expect(margins.closingSub.top).toBeGreaterThan(0);
    expect(margins.closingSub.bottom).toBeGreaterThan(0);
    expect(margins.caption2.top).toBeGreaterThan(0);
  });

  test("at 375px the reel pills and the nav button hit 44px through the expander, with a painted box under it", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/");
    const targets = [
      page.getByRole("button", { name: "Launch week" }).first(),
      page.getByRole("button", { name: "Building Helio" }).first(),
      page.getByRole("banner").getByRole("link", { name: "Start free" }),
    ];
    for (const target of targets) {
      await bisectHitExtent(page, target, "y", 0.25);
      expect((await measureBox(target)).height).toBeLessThan(44);
    }
  });
  test("the wordmark, headlines and closing line use the heading face token", async ({ page }) => {
    await page.goto("/");
    const fonts = await page.evaluate(() => {
      const first = (el: Element) => getComputedStyle(el).fontFamily.split(",")[0].trim();
      const probe = document.createElement("span");
      probe.style.fontFamily = "var(--font-heading)";
      document.body.appendChild(probe);
      const heading = first(probe);
      probe.remove();
      const sel = (s: string) => first(document.querySelector(s) as Element);
      return {
        heading,
        wordmark: sel(".brand"),
        h1: sel("h1"),
        h2: sel("#center h2"),
        closing: sel(".closing-line"),
      };
    });
    expect(fonts.wordmark).toBe(fonts.heading);
    expect(fonts.h1).toBe(fonts.heading);
    expect(fonts.h2).toBe(fonts.heading);
    expect(fonts.closing).toBe(fonts.heading);
  });
});
