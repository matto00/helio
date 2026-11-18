import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { currentUserId, registerUser } from "./support/auth";
import { evidencePath } from "./support/evidencePath";
import { setUserTierForTest } from "./support/historySeed";
import {
  SEEDED_COST_MICROS,
  SEEDED_INPUT_TOKENS,
  SEEDED_MODEL,
  SEEDED_OUTPUT_TOKENS,
  seedInsightRender,
} from "./support/insightSeed";
import { loginThenIsolate } from "./support/isolateLivePage";
import { showOutputs } from "./support/pipelineSpine";

// HEL-1744 -- insight authoring in the Output editor and the insight panel with citation chips, on a real build:
//   * add an insight to an existing pipeline through the sheet without typing a prompt (the POST body carries no
//     `prompt`; defaults and the pre-ticked Outputs are asserted);
//   * with a stored `ok` render (seeded through a test-only helper, support/insightSeed.ts, because HEL-1743's render
//     trigger is not merged: there is no production path that renders), the panel shows two cited sentences, each with
//     a chip; a chip opens the cited provenance popover, focus moves into it (computed style + elementFromPoint +
//     document.activeElement, not jsdom) and Escape returns focus to the chip;
//   * the public viewer opens the placed panel's provenance for a placed citation and the insight panel's own for an
//     unplaced one, and neither the page nor the public insight response carries the seeded model, tokens or cost;
//   * a free-tier pipeline owner with no render sees the upsell.
// Throwaway users are recorded by registerUser and deleted by exact id in the run's global teardown.

const CSRF = { "X-Helio-Requested-With": "1" };

async function api<T>(
  request: APIRequestContext,
  method: "post" | "get",
  url: string,
  data: unknown,
  status: number,
): Promise<T> {
  const res =
    method === "post"
      ? await request.post(url, { data, headers: CSRF })
      : await request.get(url, { headers: CSRF });
  expect(res.status(), `${url}: ${await res.text()}`).toBe(status);
  return (await res.json()) as T;
}

/** Computed-style, geometry, hit-test and focus facts about the open popover, read in the real page. */
async function popoverFacts(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLElement>(".provenance-popover");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      visibility: getComputedStyle(el).visibility,
      width: r.width,
      height: r.height,
      hitInside: hit !== null && el.contains(hit),
      focusInside: el.contains(document.activeElement),
    };
  });
}

async function expectPopoverOpenWithFocus(page: Page) {
  await expect
    .poll(async () => {
      const f = await popoverFacts(page);
      return (
        f !== null &&
        f.visibility === "visible" &&
        f.width > 0 &&
        f.height > 0 &&
        f.hitInside &&
        f.focusInside
      );
    })
    .toBe(true);
}

const RICH_MARKDOWN = [
  "Leaders:",
  "1. north 640 [c1]",
  "2. west 575 [c1]",
  "",
  "## A heading",
  "",
  "> a quote line",
  "",
  "__strong__ and _soft_ and snake_case_word.",
  "",
  "<script>window.__pwned = 1</script>",
  "",
  '<img src="x" onerror="window.__pwned = 2">',
  "",
  "[click me](https://evil.example/x) and <https://evil.example/auto>",
  "",
  "![pic](https://evil.example/p.png)",
  "",
  "[c1]: https://evil.example/def",
  "",
  "Unknown [c9] marker.",
].join("\n");

/** The rich and hostile insight, in the real browser: markdown renders, nothing from it is a link, image, script or frame. */
async function expectRichMarkdown(page: Page) {
  const md = page.locator(".insight-markdown").filter({ hasText: "Unknown [c9] marker." });
  await expect(md).toBeVisible({ timeout: 20_000 });
  await expect(md.locator("ol > li")).toHaveCount(2);
  await expect(md.locator("blockquote")).toContainText("a quote line");
  await expect(md.locator("strong").filter({ hasText: "A heading" })).toHaveCount(1);
  await expect(md.locator("strong").filter({ hasText: /^strong$/ })).toHaveCount(1);
  await expect(md.locator("em").filter({ hasText: /^soft$/ })).toHaveCount(1);
  await expect(md).toContainText("snake_case_word");
  await expect(md).not.toContainText("##");
  await expect(md).not.toContainText("evil.example/def");
  await expect(md).toContainText("click me");
  // Only the two list chips: [c9] is unknown, the definition line is removed.
  await expect(md.getByRole("button", { name: /^Source: / })).toHaveCount(2);
  await expect(md.locator("a, img, script, iframe, h1, h2, h3, h4, h5, h6")).toHaveCount(0);
  await expect(md.locator("[href], [src], [onerror], [onclick]")).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned),
  ).toBeUndefined();
}

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "phone", width: 390, height: 844 },
] as const;

for (const theme of ["light", "dark"] as const) {
  for (const viewport of VIEWPORTS) {
    test(`insight: author, two cited sentences, chip popover focus, public viewer (${theme} ${viewport.name})`, async ({
      page,
      request,
    }) => {
      test.setTimeout(240_000);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
      const credentials = await registerUser(request, {
        prefix: "hel1744",
        label: `${theme}-${viewport.name}`,
        displayName: "HEL-1744",
        logEmail: false,
      });
      const userId = await currentUserId(request);
      console.log(
        `[HEL-1744 e2e] created user ${userId}; tier set for ${setUserTierForTest(userId, "beta")}`,
      );
      await loginThenIsolate(page, credentials);

      const source = await api<{ id: string }>(
        request,
        "post",
        "/api/data-sources",
        {
          name: `HEL-1744 orders ${theme}`,
          type: "static",
          columns: [
            { name: "region", type: "string" },
            { name: "amount", type: "integer" },
          ],
          rows: [
            ["east", 500],
            ["west", 575],
            ["north", 640],
          ],
        },
        201,
      );
      const pipeline = await api<{ id: string }>(
        request,
        "post",
        "/api/pipelines",
        { name: `HEL-1744 pipeline ${theme}`, roots: [{ sourceId: source.id }] },
        201,
      );
      const table = await api<{ id: string }>(
        request,
        "post",
        `/api/pipelines/${pipeline.id}/outputs`,
        { kind: "table", name: "Orders table", config: {} },
        201,
      );
      const metric = await api<{ id: string }>(
        request,
        "post",
        `/api/pipelines/${pipeline.id}/outputs`,
        {
          kind: "metric",
          name: "Total amount",
          config: {
            fieldMapping: { value: "amount" },
            aggregation: { value: "amount", agg: "sum" },
          },
        },
        201,
      );
      await api(request, "post", `/api/pipelines/${pipeline.id}/run`, {}, 200);
      console.log(
        `[HEL-1744 e2e] created source ${source.id} pipeline ${pipeline.id} outputs ${table.id} ${metric.id}`,
      );

      // ── Author an insight through the sheet, never typing a prompt ──
      await page.goto(`/pipelines/${pipeline.id}`);
      await showOutputs(page);
      await page
        .getByRole("button", { name: /New output/ })
        .first()
        .click();
      const sheet = page.getByRole("dialog", { name: /^New output/ });
      await expect(sheet).toBeVisible();
      await sheet.getByRole("combobox", { name: "Output kind" }).click();
      await page.getByRole("option", { name: "Insight" }).click();
      await sheet.getByLabel("Name").fill("HEL-1744 insight");
      await expect(sheet.getByRole("combobox", { name: "Preset" })).toContainText("Auto");
      await expect(sheet.getByRole("radio", { name: "On every run" })).toHaveAttribute(
        "aria-checked",
        "true",
      );
      await expect(sheet.getByRole("checkbox", { name: /Orders table/ })).toBeChecked();
      await expect(sheet.getByRole("checkbox", { name: /Total amount/ })).toBeChecked();
      await expect(
        sheet.locator("details").filter({ hasText: "Custom prompt" }),
      ).not.toHaveAttribute("open", "");
      // The card and the sheet body never scroll sideways (a phone-width regression of the first cut).
      const overflow = await sheet.evaluate((dialog) => {
        const card = dialog.querySelector<HTMLElement>(".output-editor-sheet__group--card");
        const body = dialog.querySelector<HTMLElement>(".ui-modal__body");
        return {
          cardOver: card ? card.scrollWidth - card.clientWidth : -1,
          bodyOver: body ? body.scrollWidth - body.clientWidth : -1,
        };
      });
      expect(overflow, JSON.stringify(overflow)).toEqual({ cardOver: 0, bodyOver: 0 });
      await page.screenshot({
        path: evidencePath("HEL-1744", `insight-card-${theme}-${viewport.name}.png`),
      });
      const created = page.waitForResponse(
        (r) =>
          r.url().includes(`/api/pipelines/${pipeline.id}/outputs`) &&
          r.request().method() === "POST",
      );
      await sheet.getByRole("button", { name: "Save" }).click();
      const createdRes = await created;
      expect(createdRes.status()).toBe(201);
      const posted = createdRes.request().postDataJSON() as {
        kind: string;
        config: Record<string, unknown>;
      };
      expect(posted.kind).toBe("insight");
      expect(posted.config.prompt).toBeUndefined();
      const insight = (await createdRes.json()) as { id: string };

      // ── Place the insight and the table Output; the metric Output stays unplaced ──
      const dashboard = await api<{ id: string }>(
        request,
        "post",
        "/api/dashboards",
        { name: `HEL-1744 board ${theme}` },
        201,
      );
      const insightPanel = await api<{ id: string }>(
        request,
        "post",
        "/api/panels",
        {
          dashboardId: dashboard.id,
          title: "HEL-1744 insight panel",
          type: "output",
          config: { outputId: insight.id },
        },
        201,
      );
      const tablePanel = await api<{ id: string }>(
        request,
        "post",
        "/api/panels",
        {
          dashboardId: dashboard.id,
          title: "Orders",
          type: "output",
          config: { outputId: table.id },
        },
        201,
      );

      // Cold load: how many rows requests an insight Output gets (measured; the kind is unknown until its metadata arrives).
      let rowsRequests = 0;
      page.on("request", (r) => {
        if (r.url().includes(`/api/outputs/${insight.id}/rows`)) rowsRequests += 1;
      });

      // A second insight Output and panel carry rich and hostile markdown (seeded below), asserted against the real build.
      const rich = await api<{ id: string }>(
        request,
        "post",
        `/api/pipelines/${pipeline.id}/outputs`,
        { kind: "insight", name: "HEL-1744 rich", config: {} },
        201,
      );
      await api(
        request,
        "post",
        "/api/panels",
        {
          dashboardId: dashboard.id,
          title: "HEL-1744 rich panel",
          type: "output",
          config: { outputId: rich.id },
        },
        201,
      );

      // Before any render: the not-yet-rendered state is a status.
      await page.goto(`/dashboards/${dashboard.id}`);
      // The desktop grid card carries data-panel-id; the phone stack's card does not, so both are found by their title.
      const card = page
        .locator("article.panel-grid-card")
        .filter({ hasText: "HEL-1744 insight panel" });
      await expect(card.getByRole("status").filter({ hasText: "Not yet rendered" })).toBeVisible({
        timeout: 20_000,
      });

      expect(rowsRequests).toBeLessThanOrEqual(1);
      console.log(`[HEL-1744 e2e] cold-load rows requests for the insight Output: ${rowsRequests}`);

      // Dated five days back, so the footer must show the render's date and not today's (panel.meta.lastUpdated).
      const renderedAt = new Date(Date.now() - 5 * 24 * 3600 * 1000);
      seedInsightRender({
        insightOutputId: insight.id,
        pipelineId: pipeline.id,
        userId,
        createdAt: renderedAt.toISOString().replace(/\.\d+Z$/, "Z"),
        markdown: "Orders hold three regions [c1]. The total amount is 1715 [c2].",
        citations: [
          { id: "c1", outputId: table.id, field: "region", number: 3 },
          { id: "c2", outputId: metric.id, field: "amount", number: 1715 },
        ],
      });

      seedInsightRender({
        insightOutputId: rich.id,
        pipelineId: pipeline.id,
        userId,
        markdown: RICH_MARKDOWN,
        citations: [{ id: "c1", outputId: table.id, field: "region", number: 3 }],
      });

      await page.goto(`/dashboards/${dashboard.id}`);
      await expect(card.getByText(/Orders hold three regions/)).toBeVisible({ timeout: 20_000 });
      await expectRichMarkdown(page);
      const chips = card.getByRole("button", { name: /^Source: / });
      await expect(chips).toHaveCount(2);
      if (viewport.name === "desktop") {
        // The desktop card's footer shows the render's time (the phone stack has no footer).
        const dates = await page.evaluate((ms) => {
          return {
            rendered: new Date(ms).toLocaleDateString(),
            today: new Date().toLocaleDateString(),
          };
        }, renderedAt.getTime());
        await expect(card.getByText(`Updated ${dates.rendered}`)).toBeVisible();
        await expect(card.getByText(`Updated ${dates.today}`)).toHaveCount(0);
      }
      await page.screenshot({
        path: evidencePath("HEL-1744", `insight-panel-${theme}-${viewport.name}.png`),
      });

      // A run completes while the board is open: the panel re-reads its insight and makes no rows request.
      let insightReads = 0;
      page.on("request", (r) => {
        if (r.url().includes(`/api/outputs/${insight.id}/insight`)) insightReads += 1;
      });
      const rowsBeforeRun = rowsRequests;
      const readsBeforeRun = insightReads;
      await api(request, "post", `/api/pipelines/${pipeline.id}/run`, {}, 200);
      await expect.poll(() => insightReads, { timeout: 20_000 }).toBeGreaterThan(readsBeforeRun);
      await page.waitForTimeout(1000);
      expect(rowsRequests).toBe(rowsBeforeRun);

      // A chip opens the cited provenance popover, focus moves in, Escape returns it.
      for (const index of [0, 1]) {
        const chip = chips.nth(index);
        await chip.scrollIntoViewIfNeeded();
        await chip.click();
        await expectPopoverOpenWithFocus(page);
        if (index === 0) {
          await page.screenshot({
            path: evidencePath("HEL-1744", `insight-chip-popover-${theme}-${viewport.name}.png`),
          });
        }
        await page.keyboard.press("Escape");
        await expect(page.locator(".provenance-popover")).toHaveCount(0);
        await expect.poll(() => chip.evaluate((el) => el === document.activeElement)).toBe(true);
      }

      // Never any cost, model or token value or word on the authenticated panel or its popover.
      await chips.first().click();
      await expectPopoverOpenWithFocus(page);
      const authText = await page.locator("body").innerText();
      for (const leak of [
        SEEDED_MODEL,
        String(SEEDED_INPUT_TOKENS),
        String(SEEDED_OUTPUT_TOKENS),
        String(SEEDED_COST_MICROS),
      ]) {
        expect(authText).not.toContain(leak);
      }
      expect(authText).not.toMatch(/\btokens?\b|\bcost\b/i);
      await page.keyboard.press("Escape");

      // ── Public viewer ──
      const share = await api<{ token: string }>(
        request,
        "post",
        `/api/dashboards/${dashboard.id}/share-tokens`,
        {},
        201,
      );
      const publicRes = await request.get(
        `/api/dashboards/${dashboard.id}/panels/${insightPanel.id}/insight`,
        { params: { token: share.token } },
      );
      expect(publicRes.status()).toBe(200);
      const publicBody = await publicRes.text();
      for (const leak of [
        SEEDED_MODEL,
        String(SEEDED_INPUT_TOKENS),
        String(SEEDED_OUTPUT_TOKENS),
        String(SEEDED_COST_MICROS),
        table.id,
        metric.id,
      ]) {
        expect(publicBody).not.toContain(leak);
      }
      const citations = (
        JSON.parse(publicBody) as { render: { citations: { id: string; panelId?: string }[] } }
      ).render.citations;
      expect(citations.find((c) => c.id === "c1")?.panelId).toBe(tablePanel.id);
      expect(citations.find((c) => c.id === "c2")?.panelId).toBeUndefined();

      await page.goto(`/dashboards/${dashboard.id}/panels?token=${share.token}`);
      expect(new URL(page.url()).port).toBe(
        new URL(test.info().project.use.baseURL ?? page.url()).port,
      );
      await expect(page.getByText(/Orders hold three regions/)).toBeVisible({ timeout: 20_000 });
      await expectRichMarkdown(page);
      const publicChips = page
        .locator("li.public-dashboard-viewer__panel-row")
        .filter({ hasText: "HEL-1744 insight panel" })
        .getByRole("button", { name: /^Source: / });
      await expect(publicChips.first()).toBeVisible();

      const placedProvenance = page.waitForRequest((r) =>
        r.url().includes(`/api/dashboards/${dashboard.id}/panels/${tablePanel.id}/provenance`),
      );
      await publicChips.nth(0).click();
      await placedProvenance;
      await expectPopoverOpenWithFocus(page);
      await page.keyboard.press("Escape");

      const fallbackProvenance = page.waitForRequest((r) =>
        r.url().includes(`/api/dashboards/${dashboard.id}/panels/${insightPanel.id}/provenance`),
      );
      await publicChips.nth(1).click();
      await fallbackProvenance;
      await expectPopoverOpenWithFocus(page);
      await page.keyboard.press("Escape");

      const publicText = await page.locator("body").innerText();
      for (const leak of [SEEDED_MODEL, String(SEEDED_INPUT_TOKENS), String(SEEDED_COST_MICROS)]) {
        expect(publicText).not.toContain(leak);
      }
      expect(publicText).not.toMatch(/\btokens?\b|\bcost\b/i);
      await page.screenshot({
        path: evidencePath("HEL-1744", `insight-public-${theme}-${viewport.name}.png`),
      });
    });
  }
}

test("insight: a free-tier pipeline owner with no render sees the upsell", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const credentials = await registerUser(request, {
    prefix: "hel1744",
    label: "free",
    displayName: "HEL-1744",
    logEmail: false,
  });
  console.log(`[HEL-1744 e2e] created free user ${await currentUserId(request)}`);
  await loginThenIsolate(page, credentials);
  const source = await api<{ id: string }>(
    request,
    "post",
    "/api/data-sources",
    {
      name: "HEL-1744 free orders",
      type: "static",
      columns: [{ name: "amount", type: "integer" }],
      rows: [[1], [2]],
    },
    201,
  );
  const pipeline = await api<{ id: string }>(
    request,
    "post",
    "/api/pipelines",
    { name: "HEL-1744 free pipeline", roots: [{ sourceId: source.id }] },
    201,
  );
  const insight = await api<{ id: string }>(
    request,
    "post",
    `/api/pipelines/${pipeline.id}/outputs`,
    { kind: "insight", name: "Free insight", config: {} },
    201,
  );
  const dashboard = await api<{ id: string }>(
    request,
    "post",
    "/api/dashboards",
    { name: "HEL-1744 free board" },
    201,
  );
  await api(
    request,
    "post",
    "/api/panels",
    {
      dashboardId: dashboard.id,
      title: "Insight",
      type: "output",
      config: { outputId: insight.id },
    },
    201,
  );
  await page.goto(`/dashboards/${dashboard.id}`);
  await expect(page.getByText("Insights render on the beta plan.")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole("link", { name: /beta access/i })).toBeVisible();
});
