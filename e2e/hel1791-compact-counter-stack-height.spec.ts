import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { writeFileSync } from "node:fs";

import { currentUserId, registerUser } from "./support/auth";
import { evidencePath } from "./support/evidencePath";
import { LIVE_STACK_ITEMS } from "./support/panelGridReady";

// HEL-1791 -- a compact counter form card in the single-column panel stack (phone, 768 px, and 1100 px with the sidebar
// open) used to collapse to 30-42 px: `.panel-grid-card` is `container-type: size`, which needs a definite height, and
// the stack's intrinsic-height rule listed no `--form` selector, so the card, its `.crossfade` (flex 1, min-height 0)
// and `.panel-content--form` (overflow-y: auto) all shrank and the counter scrolled inside a 24 px body.
// Measured from rendered boxes (jsdom has no layout). No geometry assertion hardcodes a padding value: the phone-only
// card padding does not apply at 1100 px.

const CSRF = { "X-Helio-Requested-With": "1" };
const DEV_PORT = process.env.DEV_PORT ?? "5173";
const BASE_URL = `http://localhost:${DEV_PORT}`;
const RUN = Date.now();
const WIDTHS = [390, 768, 1100] as const;
const THEMES = ["light", "dark"] as const;
const CAPTION = "Your net change this session";
const COUNTER_TITLE = `HEL1791 counter ${RUN}`;
const LABEL = process.env.HEL1791_LABEL ?? "run";

interface Actor {
  context: BrowserContext;
  id: string;
}

async function newActor(browser: Browser, label: string): Promise<Actor> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  await registerUser(context.request, { prefix: "hel1791", label, displayName: "HEL1791" });
  return { context, id: await currentUserId(context.request) };
}

async function postJson<T>(request: APIRequestContext, url: string, data: unknown): Promise<T> {
  const res = await request.post(url, { data, headers: CSRF });
  expect(res.status(), `${url}: ${await res.text()}`).toBeLessThan(300);
  return (await res.json()) as T;
}

let owner: Actor;
let editor: Actor;
// A third principal for the per-kind height table: the general /api limiter is per principal, and the geometry tests
// already spend most of one user's window on page loads.
let measurer: Actor;
let dashboardId: string;
const sourceIds: string[] = [];

test.describe("HEL-1791 compact counter height in the panel stack", () => {
  test.setTimeout(90_000);

  test.beforeAll(async ({ browser }) => {
    owner = await newActor(browser, "owner");
    editor = await newActor(browser, "editor");
    measurer = await newActor(browser, "measurer");
    const api = owner.context.request;
    const counterSource = await postJson<{ id: string }>(api, "/api/data-sources", {
      name: `HEL1791 counts ${RUN}`,
      type: "static",
      columns: [
        { name: "occurred_at", type: "timestamp" },
        { name: "delta", type: "integer", required: true },
        { name: "value", type: "integer" },
      ],
      rows: [],
    });
    const noteSource = await postJson<{ id: string }>(api, "/api/data-sources", {
      name: `HEL1791 notes ${RUN}`,
      type: "static",
      columns: [
        { name: "note", type: "string", required: true },
        { name: "qty", type: "integer" },
      ],
      rows: [],
    });
    const chartSource = await postJson<{ id: string }>(api, "/api/data-sources", {
      name: `HEL1791 chart ${RUN}`,
      type: "static",
      columns: [
        { name: "region", type: "string", required: true },
        { name: "revenue", type: "integer", required: true },
      ],
      rows: [
        ["East", 100],
        ["West", 150],
      ],
    });
    sourceIds.push(counterSource.id, noteSource.id, chartSource.id);
    const pipeline = await postJson<{ id: string }>(api, "/api/pipelines", {
      name: `HEL1791 pipeline ${RUN}`,
      roots: [{ sourceId: chartSource.id }],
    });
    const output = await postJson<{ id: string }>(api, `/api/pipelines/${pipeline.id}/outputs`, {
      kind: "chart",
      name: `HEL1791 output ${RUN}`,
      config: { chartType: "bar", fieldMapping: { xAxis: "region", yAxis: "revenue" } },
    });
    await postJson(api, `/api/pipelines/${pipeline.id}/run`, {});
    dashboardId = (
      await postJson<{ id: string }>(api, "/api/dashboards", { name: `HEL1791 ${RUN}` })
    ).id;
    const panel = (title: string, type: string, config: unknown) =>
      postJson(api, "/api/panels", { dashboardId, title, type, config });
    await panel("Output panel", "output", { outputId: output.id });
    await panel("Text panel", "text", { content: "Ticker text" });
    await panel("Markdown panel", "markdown", { content: "# Heading\nBody text body text" });
    await panel("Image panel", "image", { imageUrl: "/favicon.svg", imageFit: "cover" });
    await panel("Divider panel", "divider", { orientation: "horizontal" });
    await panel("Multi-field form", "form", {
      dataSourceId: noteSource.id,
      fields: [
        { sourceField: "note", control: "text", label: "Note" },
        { sourceField: "qty", control: "number", label: "Quantity" },
      ],
      submit: { writeMode: "append" },
    });
    await panel(COUNTER_TITLE, "form", {
      dataSourceId: counterSource.id,
      fields: [{ sourceField: "delta", control: "counter", label: "Widgets", step: 5 }],
      submit: { writeMode: "append", resetOnSuccess: false },
    });
    await postJson(api, `/api/dashboards/${dashboardId}/permissions`, {
      granteeId: editor.id,
      role: "editor",
    });
    await postJson(api, `/api/dashboards/${dashboardId}/permissions`, {
      granteeId: measurer.id,
      role: "editor",
    });
  });

  test.afterAll(async () => {
    const api = owner.context.request;
    await api.delete(`/api/dashboards/${dashboardId}`, { headers: CSRF });
    for (const id of sourceIds) await api.delete(`/api/data-sources/${id}`, { headers: CSRF });
    await Promise.all([owner, editor, measurer].map((a) => a.context.close()));
  });

  async function openStack(page: Page, width: number, theme: string): Promise<void> {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
    await page.goto(`/dashboards/${dashboardId}`);
    await expect(page.locator(LIVE_STACK_ITEMS)).toHaveCount(7, { timeout: 20_000 });
    await expect(page.getByLabel("Loading panels")).toHaveCount(0);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
  }

  async function expectInside(target: Locator, card: Locator, what: string): Promise<void> {
    await expect(target, `${what} visible`).toBeVisible();
    const [t, c] = await Promise.all([target.boundingBox(), card.boundingBox()]);
    expect(t, `${what} box`).not.toBeNull();
    expect(c, `card box`).not.toBeNull();
    expect(t!.height, `${what} has height`).toBeGreaterThan(0);
    expect(t!.y, `${what} top inside card`).toBeGreaterThanOrEqual(c!.y - 0.5);
    expect(t!.y + t!.height, `${what} bottom inside card`).toBeLessThanOrEqual(
      c!.y + c!.height + 0.5,
    );
  }

  for (const role of ["owner", "editor"] as const) {
    for (const theme of THEMES) {
      test(`${role}: the compact counter card shows value, both buttons${role === "editor" ? " and the caption" : ""} with no inner scroll, ${theme}`, async () => {
        const actor = role === "owner" ? owner : editor;
        const page = await actor.context.newPage();
        try {
          for (const width of WIDTHS) {
            const at = `${role} ${theme} ${width}px`;
            await openStack(page, width, theme);
            const card = page
              .locator(".mobile-panel-stack__item--form")
              .filter({ has: page.getByRole("spinbutton", { name: "Widgets" }) });
            await expect(card, `${at}: counter card`).toBeVisible();
            await expectInside(
              page.getByRole("spinbutton", { name: "Widgets" }),
              card,
              `${at} value`,
            );
            await expectInside(
              page.getByRole("button", { name: /increase widgets/i }),
              card,
              `${at} +`,
            );
            await expectInside(
              page.getByRole("button", { name: /decrease widgets/i }),
              card,
              `${at} -`,
            );
            const caption = card.getByText(CAPTION);
            if (role === "editor") await expectInside(caption, card, `${at} caption`);
            else await expect(caption, `${at}: owner has no caption`).toHaveCount(0);

            const scroll = await card.locator(".panel-content--form").evaluate((el) => ({
              scrollHeight: el.scrollHeight,
              clientHeight: el.clientHeight,
            }));
            expect(scroll.scrollHeight, `${at}: no inner scroll`).toBeLessThanOrEqual(
              scroll.clientHeight + 1,
            );
            // The whole card must be at least as tall as its own content, not a clipped sliver.
            const heights = await card.evaluate((el) => ({
              card: el.getBoundingClientRect().height,
              content: el.scrollHeight,
              client: el.clientHeight,
            }));
            expect(heights.content, `${at}: card content not clipped`).toBeLessThanOrEqual(
              heights.client + 1,
            );
          }
        } finally {
          await page.close();
        }
      });
    }
  }

  test("per-kind stack heights at 390/768/1100 (recorded; other kinds must not change)", async () => {
    const page = await measurer.context.newPage();
    const table: Record<string, Record<string, number>> = {};
    try {
      for (const width of WIDTHS) {
        await openStack(page, width, "light");
        // Let the chart and image settle so their heights are the steady-state ones.
        await page.waitForTimeout(1500);
        table[String(width)] = await page.evaluate(() => {
          const out: Record<string, number> = {};
          for (const el of Array.from(
            document.querySelectorAll<HTMLElement>(".mobile-panel-stack__item"),
          )) {
            const title =
              el.querySelector(".panel-grid-card__title, h3")?.textContent?.trim() ??
              /mobile-panel-stack__item--(\w+)/.exec(el.className)?.[1] ??
              "unknown";
            out[title.replace(/ \d{10,}$/, "")] =
              Math.round(el.getBoundingClientRect().height * 10) / 10;
          }
          return out;
        });
      }
    } finally {
      await page.close();
    }
    writeFileSync(
      evidencePath("HEL-1791", `heights-${LABEL}.json`),
      JSON.stringify(table, null, 2),
    );
    for (const width of WIDTHS) {
      expect(Object.keys(table[String(width)]).length, `${width}px: all seven cards measured`).toBe(
        7,
      );
    }
  });
});
