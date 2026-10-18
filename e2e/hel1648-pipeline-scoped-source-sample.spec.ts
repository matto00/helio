import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

import { currentUserId, registerAndLogin, registerUser } from "./support/auth";
import { evidencePath } from "./support/evidencePath";

// HEL-1648: an editor grantee on a shared pipeline sees the source sample label (it was "Sample unavailable");
// a viewer sees no label and sends no sample request. Real backend, real grants, both themes, desktop + phone.

const CSRF = { "X-Helio-Requested-With": "1" };
const SAMPLE_URL = /\/api\/data-sources\/[^/]+\/sample(\?|$)/;

async function post<T>(page: Page, url: string, data: unknown): Promise<T> {
  const res = await page.request.post(url, { data, headers: CSRF });
  expect(res.status(), `${url} ${await res.text()}`).toBeLessThan(300);
  return (await res.json()) as T;
}

async function collaborator(
  browser: Browser,
  baseURL: string | undefined,
  label: string,
): Promise<{ context: BrowserContext; page: Page; id: string }> {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await registerUser(context.request, { prefix: "hel1648", label, displayName: "HEL-1648" });
  return { context, page, id: await currentUserId(context.request) };
}

async function setTheme(page: Page, theme: "dark" | "light") {
  await page.evaluate((t) => window.localStorage.setItem("helio-theme", t), theme);
}

test.describe("HEL-1648 pipeline-scoped source sample (live)", () => {
  test("editor sees the label desktop + phone in both themes; viewer sees none and sends no request", async ({
    page,
    request,
    browser,
    baseURL,
  }) => {
    test.setTimeout(180_000);
    await registerAndLogin(page, request, {
      prefix: "hel1648",
      label: "owner",
      displayName: "HEL-1648",
    });
    const source = await post<{ id: string }>(page, "/api/data-sources", {
      name: "shared-orders",
      type: "static",
      columns: [{ name: "n", type: "integer" }],
      rows: [[1], [2], [3]],
    });
    const pipeline = await post<{ id: string }>(page, "/api/pipelines", {
      name: `shared-pipe-${Date.now()}`,
      roots: [{ sourceId: source.id }],
    });
    const editor = await collaborator(browser, baseURL, "editor");
    const viewer = await collaborator(browser, baseURL, "viewer");
    for (const [who, role] of [
      [editor, "editor"],
      [viewer, "viewer"],
    ] as const) {
      await post(page, `/api/pipelines/${pipeline.id}/permissions`, { granteeId: who.id, role });
    }

    // The unscoped endpoint still refuses a non-owner; only the pipeline-scoped request admits the editor.
    const unscoped = await editor.context.request.get(`/api/data-sources/${source.id}/sample`);
    expect(unscoped.status()).toBe(404);
    const scoped = await editor.context.request.get(
      `/api/data-sources/${source.id}/sample?pipelineId=${pipeline.id}`,
    );
    expect(scoped.status()).toBe(200);
    const viewerScoped = await viewer.context.request.get(
      `/api/data-sources/${source.id}/sample?pipelineId=${pipeline.id}`,
    );
    expect(viewerScoped.status()).toBe(404);
    expect(await viewerScoped.text()).toBe(await unscoped.text());

    // Editor: desktop, both themes.
    await editor.page.setViewportSize({ width: 1280, height: 800 });
    for (const theme of ["dark", "light"] as const) {
      await editor.page.goto("/home");
      await setTheme(editor.page, theme);
      await editor.page.goto(`/pipelines/${pipeline.id}`);
      const label = editor.page.locator(".spine-source-card .source-sample-label");
      await expect(label.locator(".source-sample-label__text")).toHaveText("Static · 3 rows");
      await expect(editor.page.getByRole("button", { name: /^Refresh sample of / })).toBeVisible();
      await editor.page.screenshot({
        path: evidencePath("HEL-1648", `editor-desktop-${theme}.png`),
      });
    }

    // Editor: refresh sends exactly one scoped request.
    const refreshUrls: string[] = [];
    editor.page.on("request", (r) => {
      if (SAMPLE_URL.test(new URL(r.url()).pathname + new URL(r.url()).search))
        refreshUrls.push(r.url());
    });
    await editor.page.getByRole("button", { name: /^Refresh sample of / }).click();
    await expect.poll(() => refreshUrls.length).toBe(1);
    expect(refreshUrls[0]).toContain(`?pipelineId=${pipeline.id}`);

    // Editor: phone, both themes.
    await editor.page.setViewportSize({ width: 390, height: 844 });
    for (const theme of ["dark", "light"] as const) {
      await editor.page.goto("/home");
      await setTheme(editor.page, theme);
      await editor.page.goto(`/pipelines/${pipeline.id}`);
      const chip = editor.page.locator(
        ".pipeline-detail-header__source-chip-group .source-sample-label",
      );
      await expect(chip).toContainText("Static · 3 rows");
      await editor.page.screenshot({ path: evidencePath("HEL-1648", `editor-phone-${theme}.png`) });
    }

    // Viewer: no label anywhere, and no sample request at all.
    const viewerRequests: string[] = [];
    viewer.page.on("request", (r) => {
      if (SAMPLE_URL.test(new URL(r.url()).pathname + new URL(r.url()).search))
        viewerRequests.push(r.url());
    });
    for (const [width, height, name] of [
      [1280, 800, "desktop"],
      [390, 844, "phone"],
    ] as const) {
      await viewer.page.setViewportSize({ width, height });
      for (const theme of ["dark", "light"] as const) {
        await viewer.page.goto("/home");
        await setTheme(viewer.page, theme);
        await viewer.page.goto(`/pipelines/${pipeline.id}`);
        await expect(viewer.page.getByText("shared-orders").first()).toBeVisible();
        await viewer.page.waitForTimeout(1500);
        await expect(viewer.page.locator(".source-sample-label")).toHaveCount(0);
        await viewer.page.screenshot({
          path: evidencePath("HEL-1648", `viewer-${name}-${theme}.png`),
        });
      }
    }
    expect(viewerRequests).toEqual([]);

    await editor.context.close();
    await viewer.context.close();
  });
});
