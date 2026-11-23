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

// HEL-1819 -- the multi-field form's always-mounted alert and status regions each took a flex gap slot while empty, so
// a standard form card was two gaps taller than its content. Mirrors HEL-1804 (compact counter). Measured from rendered
// boxes (jsdom has no layout); no geometry assertion hardcodes a px value: the row gap is read from computed style.
// This change alters no other kind's height: the per-kind table is recorded (HEL1819_LABEL=before|after) and compared.
// Kept out of hel1791's spec because HEL-1826 is editing that file.

const CSRF = { "X-Helio-Requested-With": "1" };
const DEV_PORT = process.env.DEV_PORT ?? "5173";
const BASE_URL = `http://localhost:${DEV_PORT}`;
const RUN = Date.now();
const WIDTHS = [390, 768, 1100] as const;
const THEMES = ["light", "dark"] as const;
const FORM_TITLE = `HEL1819 multi-field form ${RUN}`;
const LABEL = process.env.HEL1819_LABEL ?? "run";

interface Actor {
  context: BrowserContext;
}

async function newActor(browser: Browser, label: string): Promise<Actor> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  await registerUser(context.request, { prefix: "hel1819", label, displayName: "HEL1819" });
  return { context };
}

async function postJson<T>(request: APIRequestContext, url: string, data: unknown): Promise<T> {
  const res = await request.post(url, { data, headers: CSRF });
  expect(res.status(), `${url}: ${await res.text()}`).toBeLessThan(300);
  return (await res.json()) as T;
}

let owner: Actor;
let measurer: Actor;
let dashboardId: string;
const sourceIds: string[] = [];

test.describe("HEL-1819 multi-field form empty live regions", () => {
  test.setTimeout(90_000);

  test.beforeAll(async ({ browser }) => {
    owner = await newActor(browser, "owner");
    measurer = await newActor(browser, "measurer");
    const api = owner.context.request;
    const counterSource = await postJson<{ id: string }>(api, "/api/data-sources", {
      name: `HEL1819 counts ${RUN}`,
      type: "static",
      columns: [
        { name: "occurred_at", type: "timestamp" },
        { name: "delta", type: "integer", required: true },
        { name: "value", type: "integer" },
      ],
      rows: [],
    });
    const noteSource = await postJson<{ id: string }>(api, "/api/data-sources", {
      name: `HEL1819 notes ${RUN}`,
      type: "static",
      columns: [
        { name: "note", type: "string", required: true },
        { name: "qty", type: "integer" },
      ],
      rows: [],
    });
    const chartSource = await postJson<{ id: string }>(api, "/api/data-sources", {
      name: `HEL1819 chart ${RUN}`,
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
      name: `HEL1819 pipeline ${RUN}`,
      roots: [{ sourceId: chartSource.id }],
    });
    const output = await postJson<{ id: string }>(api, `/api/pipelines/${pipeline.id}/outputs`, {
      kind: "chart",
      name: `HEL1819 output ${RUN}`,
      config: { chartType: "bar", fieldMapping: { xAxis: "region", yAxis: "revenue" } },
    });
    await postJson(api, `/api/pipelines/${pipeline.id}/run`, {});
    dashboardId = (
      await postJson<{ id: string }>(api, "/api/dashboards", { name: `HEL1819 ${RUN}` })
    ).id;
    const panel = (title: string, type: string, config: unknown) =>
      postJson(api, "/api/panels", { dashboardId, title, type, config });
    await panel("Output panel", "output", { outputId: output.id });
    await panel("Text panel", "text", { content: "Ticker text" });
    await panel("Markdown panel", "markdown", { content: "# Heading\nBody text body text" });
    await panel("Image panel", "image", { imageUrl: "/favicon.svg", imageFit: "cover" });
    await panel("Divider panel", "divider", { orientation: "horizontal" });
    await panel(FORM_TITLE, "form", {
      dataSourceId: noteSource.id,
      fields: [
        { sourceField: "note", control: "text", label: "Note" },
        { sourceField: "qty", control: "number", label: "Quantity" },
      ],
      submit: { writeMode: "append" },
    });
    await panel("Compact counter", "form", {
      dataSourceId: counterSource.id,
      fields: [{ sourceField: "delta", control: "counter", label: "Widgets", step: 5 }],
      submit: { writeMode: "append", resetOnSuccess: false },
    });
    await postJson(api, `/api/dashboards/${dashboardId}/permissions`, {
      granteeId: await currentUserId(measurer.context.request),
      role: "editor",
    });
  });

  test.afterAll(async () => {
    const api = owner.context.request;
    await api.delete(`/api/dashboards/${dashboardId}`, { headers: CSRF });
    for (const id of sourceIds) await api.delete(`/api/data-sources/${id}`, { headers: CSRF });
    await Promise.all([owner, measurer].map((a) => a.context.close()));
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

  function formCard(page: Page): Locator {
    return page
      .locator(".mobile-panel-stack__item--form")
      .filter({ has: page.getByRole("textbox", { name: "Note" }) });
  }

  for (const theme of THEMES) {
    test(`empty alert/status regions leave one gap between the last field and Submit, ${theme}`, async () => {
      const page = await owner.context.newPage();
      try {
        for (const width of WIDTHS) {
          const at = `${theme} ${width}px`;
          await openStack(page, width, theme);
          const card = formCard(page);
          await expect(card, `${at}: form card`).toBeVisible();
          await expect(
            card.locator(".form-panel-view__alert"),
            `${at}: alert mounted`,
          ).toHaveAttribute("role", "alert");
          await expect(
            card.locator(".form-panel-view__status"),
            `${at}: status mounted`,
          ).toHaveAttribute("role", "status");
          await expect(card.locator(".form-panel-view__alert")).toHaveText("");
          await expect(card.locator(".form-panel-view__status")).toHaveText("");
          const m = await card.locator(".form-panel-view__fields").evaluate((form) => {
            const kids = Array.from(form.children) as HTMLElement[];
            const fields = kids.filter(
              (k) =>
                !k.classList.contains("form-panel-view__alert") &&
                !k.classList.contains("form-panel-view__status") &&
                !k.classList.contains("form-panel-view__submit"),
            );
            const last = fields[fields.length - 1];
            const submit = form.querySelector(".form-panel-view__submit") as HTMLElement;
            return {
              gap: parseFloat(getComputedStyle(form).rowGap),
              between: submit.getBoundingClientRect().top - last.getBoundingClientRect().bottom,
              fieldCount: fields.length,
            };
          });
          expect(m.fieldCount, `${at}: two fields`).toBe(2);
          expect(
            m.between,
            `${at}: gap below the last field (${m.between}px) is at most one stack gap (${m.gap}px)`,
          ).toBeLessThanOrEqual(m.gap + 1);
        }
      } finally {
        await page.close();
      }
    });
  }

  // A message must still render in the SAME always-mounted region, in flow between the last field and Submit.
  test("a status message and an alert message render in flow in the same live regions", async () => {
    const page = await owner.context.newPage();
    try {
      await openStack(page, 390, "light");
      const card = formCard(page);
      await expect(card).toBeVisible();

      async function region(sel: string, role: "status" | "alert") {
        const loc = card.locator(sel);
        const handle = await loc.elementHandle();
        expect(handle, `${role} region mounted before the submit`).not.toBeNull();
        return {
          async verify(text: RegExp, what: string) {
            await expect(loc, `${what}: text`).toHaveText(text);
            await expect(loc, `${what}: visible`).toBeVisible();
            await expect(loc, `${what}: role`).toHaveAttribute("role", role);
            console.log(`[HEL-1819] ${what} region text: ${await loc.innerText()}`);
            const r = await handle!.evaluate((el) => {
              const box = el.getBoundingClientRect();
              const submit = (
                el.parentElement!.querySelector(".form-panel-view__submit") as HTMLElement
              ).getBoundingClientRect();
              const kids = Array.from(el.parentElement!.children) as HTMLElement[];
              const lastField = kids
                .filter(
                  (k) =>
                    !k.classList.contains("form-panel-view__alert") &&
                    !k.classList.contains("form-panel-view__status") &&
                    !k.classList.contains("form-panel-view__submit"),
                )
                .pop()!;
              return {
                connected: el.isConnected,
                position: getComputedStyle(el).position,
                top: box.top,
                bottom: box.bottom,
                height: box.height,
                fieldBottom: lastField.getBoundingClientRect().bottom,
                submitTop: submit.top,
              };
            });
            expect(r.connected, `${what}: same element still attached`).toBe(true);
            expect(r.position, `${what}: in flow`).toBe("static");
            expect(r.height, `${what}: has height`).toBeGreaterThan(0);
            expect(r.top, `${what}: below the last field`).toBeGreaterThanOrEqual(
              r.fieldBottom - 0.5,
            );
            expect(r.bottom, `${what}: above Submit`).toBeLessThanOrEqual(r.submitTop + 0.5);
          },
        };
      }

      const status = await region(".form-panel-view__status", "status");
      await card.getByRole("textbox", { name: "Note" }).fill("hello");
      await card.getByRole("button", { name: "Submit" }).click();
      await status.verify(/\S/, "status message");

      await page.route(/\/api\/panels\/[^/]+\/submit$/, async (route) => {
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ message: "HEL1819 rejected submit" }),
        });
      });
      const alert = await region(".form-panel-view__alert", "alert");
      await card.getByRole("textbox", { name: "Note" }).fill("again");
      await card.getByRole("button", { name: "Submit" }).click();
      await alert.verify(/\S/, "alert message");
    } finally {
      await page.close();
    }
  });

  // Declared last (fullyParallel is false, so file order holds).
  test("per-kind stack heights at 390/768/1100 (recorded; other kinds must not change)", async () => {
    const page = await measurer.context.newPage();
    const table: Record<string, Record<string, number>> = {};
    try {
      for (const width of WIDTHS) {
        await openStack(page, width, "light");
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
      evidencePath("HEL-1819", `heights-${LABEL}.json`),
      JSON.stringify(table, null, 2),
    );
    for (const width of WIDTHS) {
      expect(Object.keys(table[String(width)]).length, `${width}px: all seven cards measured`).toBe(
        7,
      );
    }
  });
});
