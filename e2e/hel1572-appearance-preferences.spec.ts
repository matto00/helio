import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import { CSRF_HEADER, registerAndLogin, TEST_PASSWORD } from "./support/auth";
import { isolateLivePage, uiLogin } from "./support/isolateLivePage";
import { bisectHitExtent, measureBox } from "./support/touchTargetProbe";
import { assertTypeStyleActive, seedTypeStyle } from "./support/typeStyle";
import { waitForWebFonts } from "./support/webFonts";

// HEL-1572 — Settings -> Appearance in a real browser: type style (no reload, survives a fresh browser context =
// another device, no flash of the default face), density (grid gutter + list rows), motion (Off / Full vs OS
// reduced-motion) and the accent / segment tap floor. Every test registers its own user (parallel-safe).
test.describe.configure({ mode: "parallel" });

const AUTH = { prefix: "hel1572", displayName: "HEL-1572" } as const;
const json = { [CSRF_HEADER]: "1" };

async function setPref(request: APIRequestContext, body: Record<string, unknown>) {
  const res = await request.patch("/api/users/me/preferences", { data: body, headers: json });
  expect(res.status()).toBe(200);
}

async function fontFamily(page: Page, selector: string): Promise<string> {
  return (
    await page
      .locator(selector)
      .first()
      .evaluate((el) => getComputedStyle(el).fontFamily)
  )
    .replace(/["']/g, "")
    .trim();
}

async function newDeviceLogin(
  browser: Browser,
  email: string,
): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const page = await ctx.newPage();
  await uiLogin(page, { email, password: TEST_PASSWORD });
  return { ctx, page };
}

/** Records, at DOM insertion time, the computed font-family of the first heading and WHEN each root attribute was
 *  first written relative to React's first DOM (`#root` empty or not). Installed before any page script runs. */
const PROBE = () => {
  const w = window as unknown as { __probe: Record<string, unknown> };
  w.__probe = { firstHeadingFont: null, typeStyleSetWithRootEmpty: null };
  // `document` always exists at init-script time; `<html>` may not yet, so observe the document itself.
  new MutationObserver(() => {
    const p = w.__probe;
    const root = document.documentElement;
    if (p.typeStyleSetWithRootEmpty === null && root?.hasAttribute("data-type-style")) {
      const mount = document.getElementById("root");
      p.typeStyleSetWithRootEmpty = mount === null || mount.childElementCount === 0;
    }
    if (p.firstHeadingFont === null) {
      const heading = document.querySelector("h1, h2");
      if (heading) p.firstHeadingFont = getComputedStyle(heading).fontFamily;
    }
  }).observe(document, {
    attributes: true,
    attributeFilter: ["data-type-style"],
    childList: true,
    subtree: true,
  });
};

/** "Clipped" = a block/inline-block/flex container whose computed `text-overflow` is NOT `ellipsis` and whose TEXT is
 *  wider than its box. The text width comes from a Range over the element's contents, not `scrollWidth`: a
 *  control's `::after` hit expander overflows its box by design and must not read as clipping. Intentionally
 *  ellipsized text is excluded by definition; bare inline spans have no box of their own and are skipped. */
async function findClipped(page: Page, selectors: string[]): Promise<string[]> {
  return page.evaluate((list) => {
    const bad: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(list.join(","))) {
      const style = getComputedStyle(el);
      if (style.display === "inline" || style.display === "none") continue;
      if (style.textOverflow === "ellipsis") continue;
      if (!el.textContent?.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(el);
      if (range.getBoundingClientRect().width > el.clientWidth + 1) {
        bad.push(`${el.className} "${el.textContent.trim().slice(0, 30)}"`);
      }
    }
    return bad;
  }, selectors);
}

async function probe(page: Page) {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __probe: { firstHeadingFont: string | null; typeStyleSetWithRootEmpty: boolean | null };
        }
      ).__probe,
  );
}

test.describe("HEL-1572 type style", () => {
  test("re-renders headings with no reload and survives a fresh browser context (another device)", async ({
    page,
    request,
    browser,
  }) => {
    const creds = await registerAndLogin(page, request, { ...AUTH, label: "type" });
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();
    await page.evaluate(() => ((window as unknown as { __noReload: boolean }).__noReload = true));

    expect(await fontFamily(page, "h1.page-title")).toMatch(/^Schibsted Grotesk/);
    await page.getByRole("radio", { name: /Serif headings/ }).click();
    await expect(page.locator("html")).toHaveAttribute("data-type-style", "serif");
    expect(await fontFamily(page, "h1.page-title")).toMatch(/^Fraunces/);
    // Body copy and controls are untouched by the serif style.
    expect(await fontFamily(page, "body")).toMatch(/^Schibsted Grotesk/);
    expect(
      await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload),
    ).toBe(true);

    // Mono: the WHOLE UI, without a reload.
    await page.getByRole("radio", { name: /^Markets.*Mono$/ }).click();
    await assertTypeStyleActive(page, "mono");
    expect(await fontFamily(page, "h1.page-title")).toMatch(/^JetBrains Mono/);
    // Each preview card shows its own face whatever style is active.
    expect(
      await fontFamily(page, '[data-type-style-option="sans"] .appearance__type-card-title'),
    ).toMatch(/^Schibsted Grotesk/);
    expect(
      await fontFamily(page, '[data-type-style-option="serif"] .appearance__type-card-title'),
    ).toMatch(/^Fraunces/);
    await page.getByRole("radio", { name: /Serif headings/ }).click();
    expect(
      await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload),
    ).toBe(true);

    // Saved server-side: a brand-new browser context (no localStorage, no cookies) signed in as the same user.
    await expect
      .poll(async () => (await (await request.get("/api/auth/me")).json()).preferences?.typeStyle)
      .toBe("serif");
    const { ctx, page: other } = await newDeviceLogin(browser, creds.email);
    await other.goto("/settings");
    await expect(other.locator("html")).toHaveAttribute("data-type-style", "serif");
    expect(await fontFamily(other, "h1.page-title")).toMatch(/^Fraunces/);
    await ctx.close();
  });

  test("no flash: cached reload applies the style before React's first DOM, and the first heading is already serif", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, { ...AUTH, label: "flash" });
    await setPref(page.request, { typeStyle: "serif" });
    await page.goto("/home"); // populates the cache via ThemeProvider
    await expect(page.locator("html")).toHaveAttribute("data-type-style", "serif");

    await page.addInitScript(PROBE);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-type-style", "serif");
    await expect(page.locator("h1, h2").first()).toBeVisible();
    const result = await probe(page);
    expect(
      result.typeStyleSetWithRootEmpty,
      "the attribute is written before any React DOM exists",
    ).toBe(true);
    expect(result.firstHeadingFont).toMatch(/^Fraunces/);
  });

  test("no flash: first heading is serif on a new device (no cache) too", async ({
    page,
    request,
    browser,
  }) => {
    const creds = await registerAndLogin(page, request, { ...AUTH, label: "flash-new" });
    await setPref(page.request, { typeStyle: "serif" });
    const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    const other = await ctx.newPage();
    await other.addInitScript(PROBE);
    // The signed-out login page has default-face headings by design; only the AUTHENTICATED headings are the claim.
    await other.goto("/login");
    await other.fill("#email", creds.email);
    await other.fill("#password", TEST_PASSWORD);
    await other.evaluate(() => {
      (
        window as unknown as { __probe: { firstHeadingFont: string | null } }
      ).__probe.firstHeadingFont = null;
    });
    await other.click("button[type=submit]");
    await other.waitForURL("/home");
    await expect(other.locator("html")).toHaveAttribute("data-type-style", "serif");
    await expect(other.locator("h1, h2").first()).toBeVisible();
    const result = await probe(other);
    // The probe resets per document; assert on the post-login document's first authenticated heading.
    expect(result.firstHeadingFont).toMatch(/^Fraunces/);
    await ctx.close();
  });

  test("probe sensitivity (negative control): the heading probe FAILS when the server value is withheld", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, { ...AUTH, label: "neg-heading" });
    await setPref(page.request, { typeStyle: "serif" });
    await isolateLivePage(page);
    await page.route("**/api/auth/me", async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      if (body.preferences) delete body.preferences.typeStyle;
      await route.fulfill({ response, json: body });
    });
    await page.addInitScript(PROBE);
    await page.goto("/home");
    await expect(page.locator("h1, h2").first()).toBeVisible();
    const result = await probe(page);
    expect(result.firstHeadingFont).not.toMatch(/^Fraunces/);
  });

  test("probe sensitivity (negative control): with the pre-paint script stripped, the attribute lands only after React's first DOM", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, { ...AUTH, label: "neg-prepaint" });
    await setPref(page.request, { typeStyle: "serif" });
    await page.goto("/home");
    await expect(page.locator("html")).toHaveAttribute("data-type-style", "serif"); // cache primed
    await page.route("**/*", async (route) => {
      const request = route.request();
      if (request.resourceType() !== "document") return route.continue();
      const response = await route.fetch();
      // String slicing, not a regex over tags: cut the inline pre-paint script (the one holding the IIFE).
      const text = await response.text();
      const marker = text.indexOf("(function ()");
      const start = text.lastIndexOf("<script", marker);
      const end = text.indexOf(">", text.indexOf("</script", marker)) + 1;
      expect(marker, "inline pre-paint script present in app.html").toBeGreaterThan(-1);
      const html = text.slice(0, start) + text.slice(end);
      await route.fulfill({ response, body: html });
    });
    await page.addInitScript(PROBE);
    await page.goto("/home");
    await expect(page.locator("html")).toHaveAttribute("data-type-style", "serif");
    const result = await probe(page);
    expect(result.typeStyleSetWithRootEmpty).toBe(false);
  });
});

test.describe("HEL-1572 density", () => {
  async function seedDashboard(request: APIRequestContext) {
    const dash = await request.post("/api/dashboards", {
      data: { name: "HEL-1572 Density" },
      headers: json,
    });
    expect(dash.status()).toBe(201);
    const dashboardId = ((await dash.json()) as { id: string }).id;
    const ids: string[] = [];
    for (const title of ["A", "B", "C"]) {
      const panel = await request.post("/api/panels", {
        data: {
          dashboardId,
          title: `HEL-1572 ${title}`,
          type: "markdown",
          config: { content: title },
        },
        headers: json,
      });
      expect(panel.status()).toBe(201);
      ids.push(((await panel.json()) as { id: string }).id);
    }
    const item = (panelId: string, x: number, y: number, w: number) => ({ panelId, x, y, w, h: 5 });
    const row = (w: number) => [
      item(ids[0], 0, 0, w),
      item(ids[1], w, 0, w),
      item(ids[2], 0, 5, w),
    ];
    // Two columns per row on lg / md / sm (half of 12 / 10 / 6 columns); xs is one 2-wide column.
    const layout = {
      lg: row(6),
      md: row(5),
      sm: row(3),
      xs: [item(ids[0], 0, 0, 2), item(ids[1], 0, 5, 2), item(ids[2], 0, 10, 2)],
    };
    const patch = await request.patch(`/api/dashboards/${dashboardId}/update`, {
      data: { fields: ["layout"], dashboard: { layout } },
      headers: json,
    });
    expect(patch.status(), await patch.text()).toBe(200);
  }

  /** Grid items in visual order (top, then left): DOM order follows the panel list, not the layout. */
  async function gridBoxes(page: Page) {
    const boxes = await page.locator(".react-grid-item").evaluateAll((els) =>
      els.map((el) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return { top: r.top, left: r.left, width: r.width, height: r.height };
      }),
    );
    return boxes.sort((a, b) => a.top - b.top || a.left - b.left);
  }

  test("Compact changes the grid gutter and row padding; panel tops do not move", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, { ...AUTH, label: "density", isolate: true });
    await seedDashboard(page.request);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto("/home");
    await expect(page.locator(".react-grid-item")).toHaveCount(3);
    await expect(page.locator("html")).toHaveAttribute("data-density", "comfortable");
    // Resolve the token to px through a real box (the computed custom property may still read "0.5rem").
    const gapToken = () =>
      page.evaluate(() => {
        const probe = document.createElement("div");
        probe.style.width = "var(--density-grid-gap)";
        document.body.appendChild(probe);
        const px = probe.getBoundingClientRect().width;
        probe.remove();
        return px;
      });
    const comfortableGap = await gapToken();
    // Let RGL settle its first layout pass.
    await expect.poll(async () => (await gridBoxes(page))[0]?.height).toBeGreaterThan(100);
    const before = await gridBoxes(page);
    const horizontalGapBefore = before[1].left - (before[0].left + before[0].width);
    expect(horizontalGapBefore).toBeCloseTo(comfortableGap, 0);

    await page.goto("/settings");
    await page.getByRole("radio", { name: "Compact" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
    const compactGap = await gapToken();
    expect(compactGap).toBeLessThan(comfortableGap);
    await page.goto("/home");
    await expect(page.locator(".react-grid-item")).toHaveCount(3);
    await expect.poll(async () => (await gridBoxes(page))[0]?.height).toBeGreaterThan(100);
    const after = await gridBoxes(page);

    const horizontalGapAfter = after[1].left - (after[0].left + after[0].width);
    expect(horizontalGapAfter).toBeCloseTo(compactGap, 0);
    // Panel tops never move; every panel is exactly the gutter difference taller.
    after.forEach((box, i) => {
      expect(box.top).toBeCloseTo(before[i].top, 0);
      expect(box.height).toBeCloseTo(before[i].height + (comfortableGap - compactGap), 0);
    });
    // The vertical gutter between row 1 and row 2 shrank by the same difference.
    const verticalGapBefore = before[2].top - (before[0].top + before[0].height);
    const verticalGapAfter = after[2].top - (after[0].top + after[0].height);
    expect(verticalGapBefore).toBeCloseTo(comfortableGap, 0);
    expect(verticalGapAfter).toBeCloseTo(compactGap, 0);
  });

  test("Compact tightens overview list rows and the context list by the documented token difference", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, { ...AUTH, label: "density-rows", isolate: true });
    const source = await page.request.post("/api/data-sources", {
      data: {
        name: "HEL-1572 Source",
        type: "static",
        columns: [{ name: "a", type: "string" }],
        rows: [["x"]],
      },
      headers: json,
    });
    expect(source.status()).toBe(201);
    await page.setViewportSize({ width: 1280, height: 900 });
    const rowHeight = async () =>
      (await measureBox(page.locator(".source-list-table tbody tr").first())).height;
    await page.goto("/sources");
    await expect(page.locator(".source-list-table tbody tr").first()).toBeVisible();
    const padTop = () =>
      page
        .locator(".source-list-table tbody td")
        .first()
        .evaluate((el) => parseFloat(getComputedStyle(el).paddingTop));
    expect(await padTop()).toBe(8);
    // The row re-flows ~2px when the web face swaps in; measure only after it has (HEL-1613).
    await waitForWebFonts(page.locator(".source-list-table tbody tr").first());
    const comfortable = await rowHeight();

    await setPref(page.request, { density: "compact" });
    await page.goto("/sources");
    await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
    await expect(page.locator(".source-list-table tbody tr").first()).toBeVisible();
    expect(await padTop()).toBe(4);
    // Top and bottom padding each shrink 8 -> 4.
    await waitForWebFonts(page.locator(".source-list-table tbody tr").first());
    expect(comfortable - (await rowHeight())).toBeCloseTo(8, 0);
  });
});

test.describe("HEL-1572 motion", () => {
  const duration = (page: Page) =>
    page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const probe = document.createElement("button");
      probe.style.transition = "color var(--app-transition)";
      document.body.appendChild(probe);
      const element = getComputedStyle(probe).transitionDuration;
      probe.remove();
      return {
        quick: root.getPropertyValue("--motion-duration-quick").trim(),
        element,
      };
    });

  test("Off pins the tokens near zero; Full keeps them; no saved choice follows OS reduce-motion; explicit Full beats it", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, { ...AUTH, label: "motion", isolate: true });
    await page.goto("/settings");
    await expect(page.locator("html")).not.toHaveAttribute("data-motion", /.*/);

    // No saved choice, OS without reduce -> Full.
    await page.emulateMedia({ reducedMotion: "no-preference" });
    expect((await duration(page)).quick).toBe("160ms");
    await expect(page.getByRole("radio", { name: "Full", checked: true })).toBeVisible();

    // No saved choice, OS reduce -> behaves as Off, and Off is shown as selected.
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect((await duration(page)).quick).toBe("0.01ms");
    expect((await duration(page)).element).toBe("1e-05s");
    await expect(page.getByRole("radio", { name: "Off", checked: true })).toBeVisible();

    // An explicit Full beats the OS setting.
    await page.getByRole("radio", { name: "Full" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-motion", "full");
    expect((await duration(page)).quick).toBe("160ms");
    expect((await duration(page)).element).toBe("0.16s");

    // Off with the OS NOT asking for reduce.
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.getByRole("radio", { name: "Off" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-motion", "off");
    expect((await duration(page)).quick).toBe("0.01ms");
    expect((await duration(page)).element).toBe("1e-05s");

    // Saved server-side, survives a reload; "Use system setting" removes it again.
    await page.goto("/settings");
    await expect(page.locator("html")).toHaveAttribute("data-motion", "off");
    await page.getByRole("button", { name: "Use system setting" }).click();
    await expect(page.locator("html")).not.toHaveAttribute("data-motion", /.*/);
    await expect
      .poll(async () => (await (await page.request.get("/api/auth/me")).json()).preferences?.motion)
      .toBeUndefined();
  });
});

test.describe("HEL-1572 Appearance tap targets", () => {
  for (const width of [375, 768, 1280]) {
    test(`accent swatches and segments clear the 44px floor by hit extent at ${width}px`, async ({
      page,
      request,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await registerAndLogin(page, request, { ...AUTH, label: `tap-${width}`, isolate: true });
      await page.goto("/settings");
      await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();
      const touch = width <= 768;
      const swatches = page.locator(".accent-picker__swatch");
      await expect(swatches).toHaveCount(8);
      if (touch) {
        for (const index of [0, 3, 7]) {
          await bisectHitExtent(page, swatches.nth(index), "x", 0.25);
          await bisectHitExtent(page, swatches.nth(index), "y", 0.25);
        }
        // Painted swatch stays 28px, expanders (44) never overlap: pitch is 44px.
        const a = await measureBox(swatches.nth(0));
        expect(a.width).toBe(28);
        const first = await swatches.nth(0).boundingBox();
        const second = await swatches.nth(1).boundingBox();
        const pitch = second!.x - first!.x;
        expect(Math.round(pitch)).toBe(44);
        for (const name of ["Comfortable", "Compact", "Full", "Subtle", "Off"]) {
          const option = page.getByRole("radio", { name, exact: true });
          // Below the fold at phone width: elementFromPoint is null off-screen, and an edge-aligned control would truncate the extent at the viewport edge, so centre it first.
          await option.evaluate((el) => el.scrollIntoView({ block: "center" }));
          await bisectHitExtent(page, option, "y", 0.25);
        }
      }
      // One row of 8 above 768px (the board), 4x2 at 768px and below.
      const rows = new Set(
        await swatches.evaluateAll((els) =>
          els.map((el) => Math.round(el.getBoundingClientRect().y)),
        ),
      );
      expect(rows.size).toBe(touch ? 2 : 1);
      // Type cards are at least 88px tall by content at every width.
      for (const card of await page.locator(".appearance__type-card").all()) {
        expect((await measureBox(card)).height).toBeGreaterThanOrEqual(88);
      }
    });
  }

  test("under Mono no Appearance control or bottom-nav/command-bar label is clipped (non-ellipsized overflow) at 375/768/820/1280", async ({
    page,
    request,
  }) => {
    const creds = await registerAndLogin(page, request, { ...AUTH, label: "clip", isolate: true });
    void creds;
    await seedTypeStyle(page.request, "mono");
    for (const width of [375, 768, 820, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/settings");
      await assertTypeStyleActive(page, "mono");
      await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const clipped = await findClipped(page, [
        ".appearance button",
        ".appearance .appearance__label",
        ".appearance .appearance__type-card-title",
        ".app-command-bar button",
        ".bottom-nav button",
        ".bottom-nav a",
        ".app-rail a",
        ".app-rail button",
      ]);
      expect(clipped, `clipped at ${width}px`).toEqual([]);
    }
  });

  test("clipping sweep is failable: an injected fixed-width label is flagged", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, { ...AUTH, label: "clip-mut", isolate: true });
    await seedTypeStyle(page.request, "mono");
    await page.setViewportSize({ width: 375, height: 900 });
    await page.goto("/settings");
    await assertTypeStyleActive(page, "mono");
    await page.evaluate(() => {
      const label = document.querySelector(".appearance__label") as HTMLElement;
      label.style.display = "block";
      label.style.width = "3ch";
      label.style.overflow = "visible";
      label.style.whiteSpace = "nowrap";
    });
    const flagged = await findClipped(page, [".appearance__label"]);
    expect(flagged.length).toBeGreaterThan(0);
  });
});

test.describe("HEL-1572 tabular numerals under every style", () => {
  // The failable alignment check (design D3): `.run-history-modal__row-duration` inherits the sans stack and sets
  // `tabular-nums`, so equal-digit-count values must render at EQUAL width under every style. `.mono` cannot serve:
  // it is always JetBrains Mono, so its widths are equal with or without `tabular-nums`.
  test("equal-digit durations render at equal width under sans / mono / serif, and the check fails without tabular-nums", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    await registerAndLogin(page, request, { ...AUTH, label: "tabular", isolate: true });
    const source = await page.request.post("/api/data-sources", {
      data: {
        name: "HEL-1572 Tabular",
        type: "static",
        columns: [{ name: "a", type: "string" }],
        rows: [["x"]],
      },
      headers: json,
    });
    expect(source.status()).toBe(201);
    const sourceId = ((await source.json()) as { id: string }).id;
    const pipeline = await page.request.post("/api/pipelines", {
      data: { name: "HEL-1572 Tabular Pipeline", roots: [{ sourceId }] },
      headers: json,
    });
    expect(pipeline.status()).toBe(201);
    const pipelineId = ((await pipeline.json()) as { id: string }).id;
    const run = await page.request.post(`/api/pipelines/${pipelineId}/run`, {
      data: {},
      headers: json,
    });
    expect(run.status()).toBe(200);

    const widths = (selector: string) =>
      page
        .locator(selector)
        .first()
        .evaluate((el) => {
          const measure = (text: string) => {
            el.textContent = text;
            return (el as HTMLElement).getBoundingClientRect().width;
          };
          // `min-width: 40px` would hide a difference: widen the box floor out of the way.
          (el as HTMLElement).style.minWidth = "0";
          (el as HTMLElement).style.display = "inline-block";
          return { ones: measure("1111"), eights: measure("8888") };
        });

    for (const style of ["sans", "mono", "serif"] as const) {
      await setPref(page.request, { typeStyle: style });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`/pipelines/${pipelineId}`);
      await assertTypeStyleActive(page, style);
      await page.getByRole("button", { name: "Pipeline actions" }).click();
      await page.getByRole("menuitem", { name: "Run history" }).click();
      await expect(page.locator(".run-history-modal__row-duration").first()).toBeVisible();
      await page.evaluate(() => document.fonts.ready);

      const { ones, eights } = await widths(".run-history-modal__row-duration");
      expect(Math.abs(ones - eights), `${style}: 1111 vs 8888`).toBeLessThanOrEqual(0.5);

      if (style === "sans") {
        // Mutation: without tabular-nums the Sans + mono run must go red (proportional digits differ in width).
        await page
          .locator(".run-history-modal__row-duration")
          .first()
          .evaluate((el) => ((el as HTMLElement).style.fontVariantNumeric = "proportional-nums"));
        const mutated = await widths(".run-history-modal__row-duration");
        expect(Math.abs(mutated.ones - mutated.eights)).toBeGreaterThan(0.5);
      }
    }
  });
});
