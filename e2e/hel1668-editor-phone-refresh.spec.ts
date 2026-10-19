import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

import { currentUserId, registerAndLogin, registerUser } from "./support/auth";
import { evidencePath } from "./support/evidencePath";
import { CSRF } from "./support/hel1668";

// HEL-1668 item 7 (a GUARD, not a red-first test: it covers behaviour HEL-1648 already shipped): an editor grantee on a
// shared pipeline refreshes a source's sample from the PHONE source card. One tap sends exactly one pipeline-scoped
// sample request, it is answered 200, and the label still renders. At 375 and 768, both themes. Proven failable by a
// mutation (the refresh dropping its `pipelineId` scope: the request is then the unscoped 404 and the label degrades).

const SAMPLE_PATH = /\/api\/data-sources\/[^/]+\/sample$/;

async function post<T>(page: Page, url: string, data: unknown): Promise<T> {
  const res = await page.request.post(url, { data, headers: CSRF });
  expect(res.status(), `${url} ${await res.text()}`).toBeLessThan(300);
  return (await res.json()) as T;
}

async function editorOf(browser: Browser, baseURL: string | undefined) {
  const context: BrowserContext = await browser.newContext({
    baseURL,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await registerUser(context.request, {
    prefix: "hel1668",
    label: "editor",
    displayName: "HEL-1668",
  });
  return { context, page, id: await currentUserId(context.request) };
}

for (const size of [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
]) {
  const at = `${size.width}x${size.height}`;
  test(`an editor's phone refresh sends one pipeline-scoped sample request, answered 200, and the label stays (${at})`, async ({
    page,
    request,
    browser,
    baseURL,
  }) => {
    test.setTimeout(150_000);
    await registerAndLogin(page, request, {
      prefix: "hel1668",
      label: `owner-${size.width}`,
      displayName: "HEL-1668",
    });
    const source = await post<{ id: string }>(page, "/api/data-sources", {
      name: "shared-orders",
      type: "static",
      columns: [{ name: "n", type: "integer" }],
      rows: [[1], [2], [3]],
    });
    const pipeline = await post<{ id: string }>(page, "/api/pipelines", {
      name: `hel1668-shared-${Date.now()}`,
      roots: [{ sourceId: source.id }],
    });
    const editor = await editorOf(browser, baseURL);
    await post(page, `/api/pipelines/${pipeline.id}/permissions`, {
      granteeId: editor.id,
      role: "editor",
    });
    await editor.page.setViewportSize(size);

    for (const theme of ["dark", "light"] as const) {
      await editor.page.goto("/home");
      await editor.page.evaluate((t) => window.localStorage.setItem("helio-theme", t), theme);
      await editor.page.goto(`/pipelines/${pipeline.id}`);
      await expect(editor.page.locator(".pipeline-detail-page--mobile")).toBeVisible();
      const label = editor.page.locator(".spine-source-card .source-sample-label");
      await expect(label.locator(".source-sample-label__text")).toHaveText("Static · 3 rows");

      const requests: string[] = [];
      const onRequest = (r: { url(): string }) => {
        const url = new URL(r.url());
        if (SAMPLE_PATH.test(url.pathname)) requests.push(url.pathname + url.search);
      };
      editor.page.on("request", onRequest);
      const responded = editor.page.waitForResponse((r) =>
        SAMPLE_PATH.test(new URL(r.url()).pathname),
      );
      await editor.page.getByRole("button", { name: /^Refresh sample of / }).tap();
      const response = await responded;
      expect(response.status()).toBe(200);
      await expect(label.locator(".source-sample-label__text")).toHaveText("Static · 3 rows");
      await editor.page.waitForTimeout(500);
      editor.page.off("request", onRequest);
      expect(requests, "exactly one sample request, scoped to the pipeline").toEqual([
        `/api/data-sources/${source.id}/sample?pipelineId=${pipeline.id}`,
      ]);
      await editor.page.screenshot({
        path: evidencePath("HEL-1668", `editor-refresh-${at}-${theme}.png`),
      });
    }
    await editor.context.close();
  });
}
