import { expect, test, type Locator, type Page } from "@playwright/test";
import { registerAndLogin } from "./support/auth";
import { seedProvenanceDashboard } from "./support/hel1756Seed";

// HEL-1756 -- the panel provenance popover keeps all of its content reachable inside the viewport. Before this change
// it was placed from the trigger rect alone (below unless under 320px of room, with no measurement of its own height),
// so in a short window a trigger mid-viewport pushed it past an edge. Each case opens the popover from a real card
// trigger, waits for its content, scrolls the last section into view inside the popover and asserts the popover is
// inside the viewport and that `document.elementFromPoint` at the section's centre returns it. The dashboard appearance editor
// grows after it opens (contrast warning, save error) and is covered the same way; UserMenu was probed and fits (probes.md). The throwaway user
// is recorded by registerUser and deleted by exact id in the run's global teardown.

const AUTH = { prefix: "hel1756", displayName: "HEL-1756" } as const;

const SIZES = [
  { name: "desktop short", width: 1280, height: 400 },
  { name: "desktop very short", width: 1280, height: 320 },
  { name: "phone short", width: 390, height: 400 },
] as const;

/** Resolves once the locator's box is unchanged across consecutive reads (cards reflow after a viewport change). */
async function boxSettled(locator: Locator) {
  const reads: string[] = [];
  await expect
    .poll(
      async () => {
        reads.push(JSON.stringify(await locator.boundingBox()));
        const last = reads.slice(-4);
        return last.length === 4 && last[0] !== "null" && last.every((r) => r === last[0]);
      },
      { timeout: 15_000, intervals: [50, 100, 100, 100, 250] },
    )
    .toBe(true);
}

async function openDashboard(page: Page, dashboardId: string) {
  await page.goto(`/dashboards/${dashboardId}`);
  await expect(page.getByRole("button", { name: "Data provenance" }).first()).toBeVisible({
    timeout: 20_000,
  });
}

/** What the viewport sees of the popover's last section right now. */
function probeLastSection(page: Page) {
  return page.evaluate(() => {
    const panel = document.querySelector(".provenance-popover") as HTMLElement;
    const sections = panel.querySelectorAll<HTMLElement>(".provenance-popover__content section");
    const last = sections[sections.length - 1];
    const p = panel.getBoundingClientRect();
    const l = last.getBoundingClientRect();
    const hit = document.elementFromPoint(l.left + l.width / 2, l.top + l.height / 2);
    return {
      innerHeight: window.innerHeight,
      innerWidth: window.innerWidth,
      panelTop: p.top,
      panelBottom: p.bottom,
      panelLeft: p.left,
      panelRight: p.right,
      lastTop: l.top,
      lastBottom: l.bottom,
      hitIsLast: hit === last || (hit !== null && last.contains(hit)),
    };
  });
}

for (const theme of ["light", "dark"] as const) {
  for (const size of SIZES) {
    test(`provenance popover: last section reachable (${size.name} ${size.width}x${size.height}, ${theme})`, async ({
      page,
      request,
    }) => {
      test.setTimeout(150_000);
      await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
      await page.setViewportSize({ width: size.width, height: 900 });
      await registerAndLogin(page, request, {
        ...AUTH,
        label: `${size.name.replaceAll(" ", "-")}-${theme}`,
      });
      const { dashboardId } = await seedProvenanceDashboard(page, `HEL-1756 ${theme}`, 6);
      await page.setViewportSize({ width: size.width, height: size.height });
      await openDashboard(page, dashboardId);

      const triggers = page.getByRole("button", { name: "Data provenance" });
      const count = await triggers.count();
      // The first card (trigger near the top), a middle one and the last one: neither side holds the popover for some.
      for (const index of [0, Math.floor(count / 2), count - 1]) {
        const trigger = triggers.nth(index);
        await trigger.scrollIntoViewIfNeeded();
        await boxSettled(trigger);
        await trigger.click();
        const popover = page.locator(".provenance-popover");
        await expect(popover).toBeVisible();
        await expect(popover.locator(".provenance-popover__content section").last()).toBeVisible();
        await popover
          .locator(".provenance-popover__content section")
          .last()
          .scrollIntoViewIfNeeded();
        await expect
          .poll(
            async () => {
              const p = await probeLastSection(page);
              return (
                p.panelTop >= 0 &&
                p.panelBottom <= p.innerHeight &&
                p.panelLeft >= 8 - 0.5 &&
                p.panelRight <= p.innerWidth - 8 + 0.5 &&
                p.hitIsLast
              );
            },
            {
              message: `trigger ${index}: popover inside the viewport and its last section hit-testable`,
              timeout: 4_000,
            },
          )
          .toBe(true);
        await page.keyboard.press("Escape");
        await expect(popover).toHaveCount(0);
      }
    });
  }
}

test("provenance popover: focus lands inside the panel after a keyboard open", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await registerAndLogin(page, request, { ...AUTH, label: "focus" });
  const { dashboardId } = await seedProvenanceDashboard(page, "HEL-1756 focus", 2);
  await openDashboard(page, dashboardId);
  const trigger = page.getByRole("button", { name: "Data provenance" }).first();
  await boxSettled(trigger);
  const popover = page.getByRole("dialog", { name: /Data provenance/ });
  // First open fetches (cache miss); close it, then reopen from the cache so the content is already there at mount.
  await trigger.click();
  await expect(popover.locator(".provenance-popover__content section").last()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(popover).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.querySelector(".provenance-popover")?.contains(document.activeElement),
      ),
    )
    .toBe(true);
  // Tab moves between the popover's own controls and does not close it.
  await page.keyboard.press("Tab");
  await expect(popover).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
});

test("provenance popover: a cache-miss open re-fits once its content arrives (tall window)", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await registerAndLogin(page, request, { ...AUTH, label: "cache-miss" });
  const { dashboardId } = await seedProvenanceDashboard(page, "HEL-1756 miss", 2);
  await openDashboard(page, dashboardId);
  // Hold the (first, uncached) provenance read so the popover opens in its small "Loading" state.
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/outputs/*/provenance", async (route) => {
    await gate;
    await route.continue();
  });
  const trigger = page.getByRole("button", { name: "Data provenance" }).first();
  await boxSettled(trigger);
  await trigger.click();
  const popover = page.locator(".provenance-popover");
  await expect(popover.getByText("Loading provenance…")).toBeVisible();
  const loadingHeight = (await popover.boundingBox())?.height ?? 0;
  release();
  await expect(popover.locator(".provenance-popover__content section").last()).toBeVisible();
  // The popover grew with its content: more than the loading state, and nothing left to scroll to (the window has room).
  await expect
    .poll(async () => {
      const m = await popover.evaluate((el) => ({
        height: el.getBoundingClientRect().height,
        overflow: el.scrollHeight - el.clientHeight,
      }));
      return m.height > loadingHeight + 40 && m.overflow <= 1;
    })
    .toBe(true);
  const p = await probeLastSection(page);
  expect(p.hitIsLast, JSON.stringify(p)).toBe(true);
});

test("provenance popover: its height never exceeds the 70vh design cap", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await registerAndLogin(page, request, { ...AUTH, label: "cap" });
  const { dashboardId } = await seedProvenanceDashboard(page, "HEL-1756 cap", 2);
  // 400px high: the popover's content (about 326px) is taller than 70% of the window (280px), and a trigger near the top
  // leaves room for the whole content below it, so only the cap keeps it at 280px.
  await page.setViewportSize({ width: 1280, height: 400 });
  await openDashboard(page, dashboardId);
  const trigger = page.getByRole("button", { name: "Data provenance" }).first();
  await trigger.scrollIntoViewIfNeeded();
  await boxSettled(trigger);
  await trigger.click();
  const popover = page.locator(".provenance-popover");
  await expect(popover.locator(".provenance-popover__content section").last()).toBeVisible();
  // CSS cap is min(70vh, 480px); here 70vh = 280px.
  await expect
    .poll(async () => (await popover.boundingBox())?.height ?? 9999)
    .toBeLessThanOrEqual(0.7 * 400 + 0.5);
});

// ---- Dashboard appearance editor (desktop only: App.css hides it at 768px and narrower) ----

const CSRF = { "X-Helio-Requested-With": "1" };

/** A preset that trips the contrast warning in this theme (the dark-surface presets in light, the pale ones in dark). */
const WARNING_PRESET = { light: "Twilight", dark: "Paper" } as const;

async function openEditor(page: Page, theme: "light" | "dark") {
  const res = await page.request.post("/api/dashboards", {
    data: { name: `HEL-1756 editor ${theme}` },
    headers: CSRF,
  });
  expect(res.status()).toBe(201);
  const { id } = (await res.json()) as { id: string };
  await page.goto(`/dashboards/${id}`);
  const trigger = page
    .getByRole("button", { name: "Customize dashboard appearance" })
    .locator("visible=true");
  await expect(trigger).toHaveCount(1, { timeout: 20_000 });
  await trigger.click();
  const form = page.locator("form.popover__panel");
  await expect(form).toBeVisible();
  return form;
}

/** Whether the element's centre is hit-testable right now and the form sits inside the viewport. */
function probeInEditor(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const form = document.querySelector("form.popover__panel") as HTMLElement;
    const el = form.querySelector(sel) as HTMLElement;
    const f = form.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      innerHeight: window.innerHeight,
      formTop: f.top,
      formBottom: f.bottom,
      formLeft: f.left,
      top: r.top,
      bottom: r.bottom,
      hit: hit === el || (hit !== null && el.contains(hit)),
    };
  }, selector);
}

for (const theme of ["light", "dark"] as const) {
  for (const height of [400, 320]) {
    test(`appearance editor: Save and a save error stay reachable after the contrast warning (1280x${height}, ${theme})`, async ({
      page,
      request,
    }) => {
      test.setTimeout(120_000);
      await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
      await page.setViewportSize({ width: 1280, height: 900 });
      await registerAndLogin(page, request, { ...AUTH, label: `editor-${height}-${theme}` });
      await page.setViewportSize({ width: 1280, height });
      const form = await openEditor(page, theme);
      await page
        .getByRole("group", { name: "Dashboard appearance presets" })
        .getByRole("button", { name: WARNING_PRESET[theme], exact: true })
        .click();
      await expect(form.getByRole("alert").filter({ hasText: "Low contrast" })).toBeVisible();

      const save = form.getByRole("button", { name: "Save dashboard style" });
      await save.scrollIntoViewIfNeeded();
      await expect
        .poll(
          async () => {
            const p = await probeInEditor(page, ".dashboard-appearance-editor__save");
            return (
              p.formTop >= 0 && p.formBottom <= p.innerHeight && p.formLeft >= 8 - 0.5 && p.hit
            );
          },
          { message: "form inside the viewport and Save hit-testable", timeout: 4_000 },
        )
        .toBe(true);

      // A failed save adds an inline error under Save: it must be reachable too.
      await page.route("**/api/dashboards/*", (route) =>
        route.request().method() === "PATCH"
          ? route.fulfill({ status: 500, body: "{}" })
          : route.continue(),
      );
      await save.click();
      const error = form.locator(".inline-error");
      await expect(error).toContainText("Failed to save dashboard appearance.");
      await error.scrollIntoViewIfNeeded();
      await expect
        .poll(
          async () => {
            const p = await probeInEditor(page, ".inline-error");
            return p.formBottom <= p.innerHeight && p.bottom <= p.innerHeight && p.hit;
          },
          { message: "the save error inside the viewport and hit-testable", timeout: 4_000 },
        )
        .toBe(true);
    });
  }
}

test("appearance editor: tabbing between controls and clicking the colour input keep it open", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await registerAndLogin(page, request, { ...AUTH, label: "editor-focus" });
  const form = await openEditor(page, "dark");
  const first = form
    .getByRole("group", { name: "Dashboard appearance presets" })
    .getByRole("button")
    .first();
  await first.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(form).toBeVisible();
  await form.getByLabel("Dashboard background color").click();
  await expect(form).toBeVisible();
  await form.getByLabel("Dashboard grid background color").focus();
  await expect(form).toBeVisible();
});

for (const theme of ["light", "dark"] as const) {
  test(`appearance editor: a save error alone (no contrast warning) stays reachable (1280x320, ${theme})`, async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
    await page.setViewportSize({ width: 1280, height: 900 });
    await registerAndLogin(page, request, { ...AUTH, label: `editor-error-${theme}` });
    await page.setViewportSize({ width: 1280, height: 320 });
    const form = await openEditor(page, theme);
    await page.route("**/api/dashboards/*", (route) =>
      route.request().method() === "PATCH"
        ? route.fulfill({ status: 500, body: "{}" })
        : route.continue(),
    );
    await form.getByRole("button", { name: "Save dashboard style" }).click();
    const error = form.locator(".inline-error");
    await expect(error).toContainText("Failed to save dashboard appearance.");
    await error.scrollIntoViewIfNeeded();
    await expect
      .poll(
        async () => {
          const p = await probeInEditor(page, ".inline-error");
          return p.formBottom <= p.innerHeight && p.bottom <= p.innerHeight && p.hit;
        },
        { message: "the save error inside the viewport and hit-testable", timeout: 4_000 },
      )
      .toBe(true);
  });
}

// A keyboard user opens the editor with Enter on its trigger: focus must land inside the form (it is portalled to the end of
// <body>), and a real Tab must keep it open with focus inside it (the hook closes a popover whose focus leaves trigger+panel).
for (const theme of ["light", "dark"] as const) {
  test(`appearance editor: a keyboard open puts focus in the form and Tab keeps it open (${theme})`, async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
    await page.setViewportSize({ width: 1280, height: 900 });
    await registerAndLogin(page, request, { ...AUTH, label: `editor-kbd-${theme}` });
    const res = await page.request.post("/api/dashboards", {
      data: { name: `HEL-1756 kbd ${theme}` },
      headers: CSRF,
    });
    const { id } = (await res.json()) as { id: string };
    await page.goto(`/dashboards/${id}`);
    const trigger = page
      .getByRole("button", { name: "Customize dashboard appearance" })
      .locator("visible=true");
    await expect(trigger).toHaveCount(1, { timeout: 20_000 });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const form = page.locator("form.popover__panel");
    await expect(form).toBeVisible();
    const focusInForm = () =>
      page.evaluate(
        () => document.querySelector("form")?.contains(document.activeElement) ?? false,
      );
    await expect.poll(focusInForm).toBe(true);
    await page.keyboard.press("Tab");
    await expect(form).toBeVisible();
    expect(await focusInForm()).toBe(true);
  });
}
