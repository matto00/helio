import { expect, test, type Page } from "@playwright/test";

import { registerAndLogin } from "./support/auth";
import { evidencePath } from "./support/evidencePath";
import { selectRow } from "./support/pipelineSpine";
import { settleTransitions } from "./support/settleTransitions";

// HEL-1734: adding and removing a source (a root) are DRAFT entries while a pipeline draft is open. Each action, with a draft already
// open: is enabled; sends no `/roots` write; shows the change in the spine's Sources section (a drafted source reads "New · not
// saved"); and Save & run sends ONE `draft/save` whose body carries `roots`. Discard drops them, a kept draft restores them after a
// reload, and a stale base keeps them through "Reload the saved pipeline". Desktop runs in light, the 375px phone in dark.

const CSRF = { "X-Helio-Requested-With": "1" };
const AUTH = { prefix: "hel1734", displayName: "HEL-1734", domain: "example.test" } as const;
const DRAFT_TEXT = "Draft · unsaved changes";

type Viewport = "desktop" | "phone";
type Theme = "light" | "dark";

async function post<T>(page: Page, url: string, data: unknown): Promise<T> {
  const res = await page.request.post(url, { data, headers: CSRF });
  expect(res.status(), `${url} ${await res.text()}`).toBeLessThan(300);
  return (await res.json()) as T;
}

interface Seeded {
  pipelineId: string;
  rootIds: string[];
  names: { a: string; b: string; c: string; d: string };
  sourceIds: { a: string; b: string; c: string; d: string };
}

/** Four static sources; a pipeline rooted on a and b with a filter step on a. c and d are free to add. */
async function seed(page: Page): Promise<Seeded> {
  const rows = Array.from({ length: 14 }, (_, i) => [
    `2026-09-${String(i + 10).padStart(2, "0")}`,
    i % 5 === 0 ? "failed" : "success",
    260 + i * 7,
  ]);
  const make = async (letter: string) => {
    const name = `hel1734-src-${letter}`;
    const s = await post<{ id: string }>(page, "/api/data-sources", {
      name,
      type: "static",
      columns: [
        { name: "date", type: "string" },
        { name: "status", type: "string" },
        { name: "duration_s", type: "integer" },
      ],
      rows,
    });
    return { name, id: s.id };
  };
  const [a, b, c, d] = [await make("a"), await make("b"), await make("c"), await make("d")];
  const pipeline = await post<{ id: string; roots: { id: string }[] }>(page, "/api/pipelines", {
    name: "hel1734-pipe",
    roots: [{ sourceId: a.id }, { sourceId: b.id }],
  });
  await post(page, `/api/pipelines/${pipeline.id}/steps`, {
    type: "filter",
    rootId: pipeline.roots[0].id,
    config: {
      combinator: "and",
      conditions: [{ field: "duration_s", operator: ">=", value: "260" }],
    },
  });
  await post(page, `/api/pipelines/${pipeline.id}/run`, {});
  return {
    pipelineId: pipeline.id,
    rootIds: pipeline.roots.map((r) => r.id),
    names: { a: a.name, b: b.name, c: c.name, d: d.name },
    sourceIds: { a: a.id, b: b.id, c: c.id, d: d.id },
  };
}

/** Every /api request (any method) from now until `stop`. */
function recordApi(page: Page): { stop: () => string[] } {
  const log: string[] = [];
  const onRequest = (r: { method(): string; url(): string }) => {
    const { pathname } = new URL(r.url());
    if (pathname.startsWith("/api/")) log.push(`${r.method()} ${pathname}`);
  };
  page.on("request", onRequest);
  return {
    stop: () => {
      page.off("request", onRequest);
      return log;
    },
  };
}

const sourceCards = (page: Page) => page.locator(".spine-source-card");
const draftCards = (page: Page) => page.locator('.spine-source-card[data-draft-root="true"]');
const stepSheet = (page: Page) => page.getByRole("dialog", { name: "Step editor" });

async function openPipeline(page: Page, pipelineId: string, theme: Theme): Promise<void> {
  await page.evaluate((t) => window.localStorage.setItem("helio-theme", t), theme);
  await page.goto(`/pipelines/${pipelineId}`);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(page.getByRole("button", { name: /^Step 1: Filter rows, 14 rows/ })).toBeVisible();
  await expect(sourceCards(page)).toHaveCount(2);
  await page.evaluate(() => document.fonts.ready);
}

async function closeStepSheet(page: Page): Promise<void> {
  const s = stepSheet(page);
  if (await s.isVisible()) {
    await s.getByRole("button", { name: "Close" }).first().click();
    await expect(s).toBeHidden();
  }
}

/** Opens a draft by editing step 1's filter threshold. */
async function openDraft(page: Page, viewport: Viewport): Promise<void> {
  if (viewport === "phone") {
    await page.getByRole("button", { name: /^Step 1:/ }).click();
    await expect(stepSheet(page)).toBeVisible();
    await settleTransitions(page);
    await stepSheet(page)
      .locator(".pipeline-detail-page__filter-condition-row input")
      .last()
      .fill("300");
    await closeStepSheet(page);
  } else {
    await selectRow(page, 0);
    await page.locator(".pipeline-detail-page__filter-condition-row input").last().fill("300");
  }
  await expect(page.getByText(DRAFT_TEXT).first()).toBeVisible();
}

/** "Add source" -> the modal -> pick `name` -> confirm. The button is enabled in a draft (HEL-1734). */
async function addSource(page: Page, viewport: Viewport, name: string): Promise<void> {
  if (viewport === "desktop") {
    const button = page.getByRole("button", { name: "Add source", exact: true });
    await expect(button).toBeEnabled();
    await button.click();
  } else {
    await page.getByRole("button", { name: "Pipeline actions" }).click();
    const item = page.getByRole("menuitem", { name: "Add source" });
    await expect(item).toBeEnabled();
    await item.click();
  }
  const dialog = page.getByRole("dialog", { name: "Add a source" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("combobox", { name: "Data source" }).click();
  await page
    .getByRole("option", { name: new RegExp(name) })
    .first()
    .click();
  await dialog.getByRole("button", { name: "Add source", exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function removeSource(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: `Source actions for ${name}` }).click();
  const item = page.getByRole("menuitem", { name: `Remove source ${name} from this pipeline` });
  await expect(item).toBeEnabled();
  await item.click();
}

interface Body {
  roots?: { id?: string; clientId?: string; sourceId?: string }[];
  steps: { id?: string; clientId?: string }[];
  confirmCascade?: { rootIds?: string[] };
}

async function saveAndRun(page: Page): Promise<Body> {
  const saved = page.waitForResponse(
    (r) => r.url().includes("/draft/save") && r.request().method() === "POST" && r.status() < 300,
  );
  await page.getByRole("button", { name: "Save and run" }).click();
  const response = await saved;
  return JSON.parse(response.request().postData() ?? "{}") as Body;
}

async function storedRoots(page: Page, pipelineId: string): Promise<string[]> {
  const res = await page.request.get(`/api/pipelines/${pipelineId}`);
  const body = (await res.json()) as { roots: { dataSourceName: string }[] };
  return body.roots.map((r) => r.dataSourceName);
}

/** The forbidden writes while a draft is open: a root add or remove, or any request that names a client id. */
function forbidden(log: string[]): string[] {
  return log.filter(
    (r) =>
      (!r.startsWith("GET ") && /\/roots(\/|$)/.test(r)) ||
      /draft-[0-9a-z]/.test(r.replace(/\/draft\/save|\/draft-preview/g, "")),
  );
}

const VARIANTS: { viewport: Viewport; theme: Theme; size: { width: number; height: number } }[] = [
  { viewport: "desktop", theme: "light", size: { width: 1280, height: 800 } },
  { viewport: "phone", theme: "dark", size: { width: 375, height: 812 } },
];

test.describe("HEL-1734 draft roots (live)", () => {
  test.setTimeout(180_000);

  for (const v of VARIANTS) {
    test(`${v.viewport} ${v.theme}: add a source in a draft, see it, and Save & run sends it in ONE draft/save`, async ({
      page,
      request,
    }) => {
      await page.setViewportSize(v.size);
      await registerAndLogin(page, request, { ...AUTH, label: `add-${v.viewport}` });
      const seeded = await seed(page);
      await openPipeline(page, seeded.pipelineId, v.theme);
      await openDraft(page, v.viewport);

      const recording = recordApi(page);
      await addSource(page, v.viewport, seeded.names.c);
      await expect(sourceCards(page)).toHaveCount(3);
      await expect(draftCards(page)).toHaveCount(1);
      await expect(draftCards(page).first()).toContainText(seeded.names.c);
      await expect(draftCards(page).first()).toContainText("New · not saved");
      await page.screenshot({
        path: evidencePath("HEL-1734", `add-source-${v.viewport}-${v.theme}.png`),
      });

      const body = await saveAndRun(page);
      expect(forbidden(recording.stop())).toEqual([]);
      expect(body.roots).toHaveLength(3);
      expect(body.roots?.slice(0, 2)).toEqual([
        { id: seeded.rootIds[0] },
        { id: seeded.rootIds[1] },
      ]);
      expect(body.roots?.[2]).toMatchObject({ sourceId: seeded.sourceIds.c });
      expect(body.roots?.[2].clientId).toMatch(/^draft-/);
      await expect(page.getByLabel("Notifications").getByText("Saved.")).toBeVisible();
      await expect(draftCards(page)).toHaveCount(0);
      await expect(sourceCards(page)).toHaveCount(3);
      expect(await storedRoots(page, seeded.pipelineId)).toEqual([
        seeded.names.a,
        seeded.names.b,
        seeded.names.c,
      ]);
    });

    test(`${v.viewport} ${v.theme}: remove a source in a draft, confirm the cascade, and Save & run removes it`, async ({
      page,
      request,
    }) => {
      await page.setViewportSize(v.size);
      await registerAndLogin(page, request, { ...AUTH, label: `remove-${v.viewport}` });
      const seeded = await seed(page);
      await openPipeline(page, seeded.pipelineId, v.theme);
      await openDraft(page, v.viewport);

      const recording = recordApi(page);
      await removeSource(page, seeded.names.b);
      await expect(sourceCards(page)).toHaveCount(1);
      await page.screenshot({
        path: evidencePath("HEL-1734", `remove-source-${v.viewport}-${v.theme}.png`),
      });

      const first = page.waitForResponse(
        (r) => r.url().includes("/draft/save") && r.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Save and run" }).click();
      expect((await first).status()).toBe(422);
      const dialog = page.getByRole("dialog", { name: "Confirm removals" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText(`Source: ${seeded.names.b}`)).toBeVisible();
      const saved = page.waitForResponse(
        (r) =>
          r.url().includes("/draft/save") && r.request().method() === "POST" && r.status() < 300,
      );
      await dialog.getByRole("button", { name: "Remove and save" }).click();
      const body = JSON.parse((await saved).request().postData() ?? "{}") as Body;
      expect(forbidden(recording.stop())).toEqual([]);
      expect(body.roots).toEqual([{ id: seeded.rootIds[0] }]);
      expect(body.confirmCascade?.rootIds).toEqual([seeded.rootIds[1]]);
      await expect(page.getByLabel("Notifications").getByText("Saved.")).toBeVisible();
      expect(await storedRoots(page, seeded.pipelineId)).toEqual([seeded.names.a]);
      // The last source stays: its remove item is disabled.
      await page.getByRole("button", { name: `Source actions for ${seeded.names.a}` }).click();
      await expect(
        page.getByRole("menuitem", { name: `Remove source ${seeded.names.a} from this pipeline` }),
      ).toBeDisabled();
    });
  }

  test("Discard drops a drafted source and a drafted removal: no root request is made", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await registerAndLogin(page, request, { ...AUTH, label: "discard" });
    const seeded = await seed(page);
    await openPipeline(page, seeded.pipelineId, "dark");
    await openDraft(page, "desktop");
    const recording = recordApi(page);
    await addSource(page, "desktop", seeded.names.c);
    await removeSource(page, seeded.names.b);
    await expect(sourceCards(page)).toHaveCount(2);
    await expect(draftCards(page)).toHaveCount(1);
    await page.getByRole("button", { name: "Discard draft" }).click();
    await expect(sourceCards(page)).toHaveCount(2);
    await expect(draftCards(page)).toHaveCount(0);
    await expect(sourceCards(page).nth(1)).toContainText(seeded.names.b);
    expect(forbidden(recording.stop())).toEqual([]);
    expect(await storedRoots(page, seeded.pipelineId)).toEqual([seeded.names.a, seeded.names.b]);
  });

  test("a kept draft restores a drafted add and a drafted removal after a reload, and saves them", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await registerAndLogin(page, request, { ...AUTH, label: "kept" });
    const seeded = await seed(page);
    await openPipeline(page, seeded.pipelineId, "light");
    await openDraft(page, "desktop");
    await addSource(page, "desktop", seeded.names.c);
    await removeSource(page, seeded.names.b);
    await expect(sourceCards(page)).toHaveCount(2);

    await page.reload();
    await expect(page.getByText(DRAFT_TEXT).first()).toBeVisible();
    await expect(sourceCards(page)).toHaveCount(2);
    await expect(draftCards(page)).toHaveCount(1);
    await expect(draftCards(page).first()).toContainText(seeded.names.c);
    await expect(page.getByRole("alert").filter({ hasText: "changed since" })).toHaveCount(0);
    await expect(page.locator(".spine-source-card", { hasText: seeded.names.b })).toHaveCount(0);

    const first = page.waitForResponse(
      (r) => r.url().includes("/draft/save") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Save and run" }).click();
    expect((await first).status()).toBe(422);
    const saved = page.waitForResponse(
      (r) => r.url().includes("/draft/save") && r.request().method() === "POST" && r.status() < 300,
    );
    await page
      .getByRole("dialog", { name: "Confirm removals" })
      .getByRole("button", { name: "Remove and save" })
      .click();
    await saved;
    expect(await storedRoots(page, seeded.pipelineId)).toEqual([seeded.names.a, seeded.names.c]);
  });

  test("a stale base (another writer added a source) keeps the drafted source through Reload, then saves", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await registerAndLogin(page, request, { ...AUTH, label: "stale" });
    const seeded = await seed(page);
    await openPipeline(page, seeded.pipelineId, "light");
    await openDraft(page, "desktop");
    await addSource(page, "desktop", seeded.names.c);

    await post(page, `/api/pipelines/${seeded.pipelineId}/roots`, { sourceId: seeded.sourceIds.d });

    await page.getByRole("button", { name: "Save and run" }).click();
    const notice = page
      .getByRole("alert")
      .filter({ hasText: "This pipeline changed since you started editing." });
    await expect(notice).toBeVisible();
    await notice.getByRole("button", { name: "Reload the saved pipeline" }).click();
    await expect(notice).toHaveCount(0);
    // The saved roots now include d; the draft's own added source follows them.
    await expect(sourceCards(page)).toHaveCount(4);
    await expect(draftCards(page)).toHaveCount(1);
    await expect(draftCards(page).first()).toContainText(seeded.names.c);

    const body = await saveAndRun(page);
    expect(body.roots).toHaveLength(4);
    expect(await storedRoots(page, seeded.pipelineId)).toEqual([
      seeded.names.a,
      seeded.names.b,
      seeded.names.d,
      seeded.names.c,
    ]);
  });

  // The visual record: a drafted source and a drafted removal side by side, in every theme and width.
  for (const size of [
    { viewport: "desktop" as const, width: 1280, height: 800 },
    { viewport: "phone" as const, width: 375, height: 812 },
  ]) {
    for (const theme of ["light", "dark"] as const) {
      test(`${size.viewport} ${theme}: the drafted source card and the drafted removal read as draft changes (screenshots)`, async ({
        page,
        request,
      }) => {
        await page.setViewportSize({ width: size.width, height: size.height });
        await registerAndLogin(page, request, {
          ...AUTH,
          label: `shots-${size.viewport}-${theme}`,
        });
        const seeded = await seed(page);
        await openPipeline(page, seeded.pipelineId, theme);
        await openDraft(page, size.viewport);
        await addSource(page, size.viewport, seeded.names.c);
        await expect(draftCards(page)).toHaveCount(1);
        await page.screenshot({
          path: evidencePath("HEL-1734", `shots-added-${size.viewport}-${theme}.png`),
        });
        await removeSource(page, seeded.names.b);
        await expect(sourceCards(page)).toHaveCount(2);
        await page.screenshot({
          path: evidencePath("HEL-1734", `shots-added-and-removed-${size.viewport}-${theme}.png`),
        });
      });
    }
  }
});
