import { expect, test, type Locator, type Page } from "@playwright/test";

import { registerAndLogin } from "./support/auth";
import { evidencePath } from "./support/evidencePath";
import { clickRowMenuItem, spineRows } from "./support/pipelineSpine";
import { settleTransitions } from "./support/settleTransitions";

// HEL-1752: the Output editor sheet's footer buttons must contain their own labels. At 375px the footer row used to
// squeeze its longest-label buttons ("Confirm delete (removes from 1 dashboard)", "Add as tail with aggregate") far
// below their content width, so the label wrapped past the fixed-height box. Everything here is measured geometry
// (scrollWidth/clientWidth, scrollHeight/clientHeight, the label's text Range rects against the button's rect), never
// CSS text and never a hard-coded pixel width: the e2e font changes (HEL-1757) move every width.

const CSRF = { "X-Helio-Requested-With": "1" };
const AUTH = { prefix: "hel1752", displayName: "HEL-1752", domain: "example.test" } as const;
const CONFIRM_TEXT = "Confirm delete (removes from 1 dashboard)";
const OUTPUT_NAME = "hel1752 chart";
const EPS = 0.75;

type Theme = "light" | "dark";

async function post<T>(page: Page, url: string, data: unknown): Promise<T> {
  const res = await page.request.post(url, { data, headers: CSRF });
  expect(res.status(), `${url} ${await res.text()}`).toBeLessThan(300);
  return (await res.json()) as T;
}

/** A pipeline with one step and a chart Output bound to one panel on one dashboard. */
async function seed(page: Page): Promise<{ pipelineId: string }> {
  const source = await post<{ id: string }>(page, "/api/data-sources", {
    name: "hel1752-src",
    type: "static",
    columns: [
      { name: "date", type: "string" },
      { name: "status", type: "string" },
      { name: "duration_s", type: "integer" },
    ],
    rows: Array.from({ length: 8 }, (_, i) => [
      `2026-09-${String(i + 10).padStart(2, "0")}`,
      i % 3 === 0 ? "failed" : "success",
      260 + i * 7,
    ]),
  });
  const pipeline = await post<{ id: string }>(page, "/api/pipelines", {
    name: "hel1752-pipe",
    roots: [{ sourceId: source.id }],
  });
  const sort = await post<{ id: string }>(page, `/api/pipelines/${pipeline.id}/steps`, {
    type: "sort",
    config: { sortBy: [{ field: "date", direction: "asc" }] },
  });
  const output = await post<{ id: string }>(page, `/api/pipelines/${pipeline.id}/outputs`, {
    kind: "chart",
    name: OUTPUT_NAME,
    nodeStepId: sort.id,
    config: { chartType: "line", fieldMapping: { xAxis: "date", yAxis: "duration_s" } },
  });
  await post(page, `/api/pipelines/${pipeline.id}/run`, {});
  const dashboard = await post<{ id: string }>(page, "/api/dashboards", { name: "hel1752-dash" });
  await post(page, "/api/panels", {
    dashboardId: dashboard.id,
    title: "hel1752 panel",
    type: "output",
    config: { outputId: output.id },
  });
  return { pipelineId: pipeline.id };
}

const outputSheet = (page: Page) => page.getByRole("dialog", { name: /^(New output|Edit )/ });
const stepSheet = (page: Page) => page.getByRole("dialog", { name: "Step editor" });

async function openPipeline(page: Page, pipelineId: string, theme: Theme): Promise<void> {
  await page.evaluate((t) => window.localStorage.setItem("helio-theme", t), theme);
  await page.goto(`/pipelines/${pipelineId}`);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(spineRows(page).first()).toBeVisible();
  await expect(page.getByRole("button", { name: `Open ${OUTPUT_NAME} output` })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

async function sheetReady(page: Page): Promise<void> {
  const s = outputSheet(page);
  await expect(s.getByLabel("Name")).toBeVisible();
  await expect(s.getByText("Checking column types")).toHaveCount(0);
  await settleTransitions(page);
}

async function openConfirmDelete(page: Page): Promise<void> {
  const s = outputSheet(page);
  await page.getByRole("button", { name: `Open ${OUTPUT_NAME} output` }).click();
  await sheetReady(page);
  await s.getByRole("button", { name: "Delete", exact: true }).click();
  // The count comes from the placements fetch; wait for it so the label is the full one.
  await expect(
    s.getByRole("button", { name: /^Confirm delete \(removes from 1 dashboard\)/ }),
  ).toBeVisible();
}

async function stepMenu(page: Page, phone: boolean, item: string): Promise<void> {
  if (!phone) {
    await clickRowMenuItem(page, 0, item);
    return;
  }
  await spineRows(page).nth(0).locator(".spine-row__select").click();
  await expect(stepSheet(page)).toBeVisible();
  await settleTransitions(page);
  await stepSheet(page)
    .getByRole("button", { name: /^Step actions for / })
    .click();
  await page.getByRole("menuitem", { name: item }).click();
}

async function pickOption(page: Page, label: string, option: string | RegExp): Promise<void> {
  await outputSheet(page).getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: option }).first().click();
}

/** Create mode with the "Add as tail with aggregate" button showing (same steps as HEL-1733's aggregate-tail case). */
async function openAddTail(page: Page, phone: boolean): Promise<void> {
  await stepMenu(page, phone, "Add output");
  const s = outputSheet(page);
  await sheetReady(page);
  await s.getByLabel("Name").fill("hel1752 by status");
  await pickOption(page, "Group by field", "status");
  await pickOption(page, "Aggregation value field", "duration_s");
  await pickOption(page, "Aggregation function", /sum/i);
  await expect(s.getByRole("button", { name: "Add as tail with aggregate" })).toBeVisible();
}

interface ButtonGeometry {
  text: string;
  rect: { left: number; right: number; top: number; bottom: number; width: number; height: number };
  scrollW: number;
  clientW: number;
  scrollH: number;
  clientH: number;
  lines: number;
  /** Largest distance a label line's rect lies outside the button's rect (<= 0 when contained). */
  labelOutside: number;
  /** Number of label line rects found (0 would make the containment check vacuous). */
  labelRects: number;
  /** Computed height of the ::after hit expander (0 when it has none). */
  expanderH: number;
}
interface FooterGeometry {
  controlMd: number;
  footer: { left: number; right: number; width: number };
  /** Content-box right edge of the Modal's own footer that holds the sheet's footer. */
  modalFooterContentRight: number;
  buttons: ButtonGeometry[];
}

async function measure(sheet: Locator): Promise<FooterGeometry> {
  return sheet.evaluate((root) => {
    const footerEl = root.querySelector(".output-editor-sheet__footer") as HTMLElement;
    const probe = document.createElement("div");
    probe.style.cssText = "position:absolute;visibility:hidden;height:var(--control-md);width:1px";
    document.body.appendChild(probe);
    const controlMd = probe.getBoundingClientRect().height;
    probe.remove();
    const fr = footerEl.getBoundingClientRect();
    const modalFooter = footerEl.parentElement as HTMLElement;
    const mcs = getComputedStyle(modalFooter);
    const modalFooterContentRight =
      modalFooter.getBoundingClientRect().right -
      parseFloat(mcs.borderRightWidth) -
      parseFloat(mcs.paddingRight);
    const buttons = [...footerEl.querySelectorAll("button")].map((b) => {
      const r = b.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(b);
      const rects = [...range.getClientRects()].filter((x) => x.width > 0 && x.height > 0);
      const tops = new Set(rects.map((x) => Math.round(x.top)));
      const outside = rects.reduce(
        (m, x) =>
          Math.max(m, r.left - x.left, x.right - r.right, r.top - x.top, x.bottom - r.bottom),
        -Infinity,
      );
      return {
        text: (b.textContent ?? "").trim(),
        rect: {
          left: r.left,
          right: r.right,
          top: r.top,
          bottom: r.bottom,
          width: r.width,
          height: r.height,
        },
        scrollW: b.scrollWidth,
        clientW: b.clientWidth,
        scrollH: b.scrollHeight,
        clientH: b.clientHeight,
        lines: tops.size,
        labelOutside: outside,
        labelRects: rects.length,
        expanderH: parseFloat(getComputedStyle(b, "::after").height) || 0,
      };
    });
    return {
      controlMd,
      footer: { left: fr.left, right: fr.right, width: fr.width },
      modalFooterContentRight,
      buttons,
    };
  });
}

/** The invariants that hold at every width: containment, at most two lines, never wider than the footer. */
function expectContained(g: FooterGeometry): void {
  for (const b of g.buttons) {
    const tag = `"${b.text}"`;
    expect(b.scrollW, `${tag} scrollWidth`).toBeLessThanOrEqual(b.clientW + 1);
    // The phone's centred 44px ::after hit expander (Modal.css) adds its own overflow to scrollHeight on a button
    // shorter than it: half the difference, below. That is computed from the live styles, not hard-coded.
    const expanderOverflow = Math.max(0, (b.expanderH - b.rect.height) / 2);
    expect(
      b.scrollH,
      `${tag} scrollHeight ${b.scrollH} vs clientHeight ${b.clientH} (+ expander ${expanderOverflow})`,
    ).toBeLessThanOrEqual(b.clientH + expanderOverflow + 1);
    // The label's Range rects against the button rect guard both vertical directions; none found would pass vacuously.
    expect(b.labelRects, `${tag} label rects`).toBeGreaterThan(0);
    expect(
      b.labelOutside,
      `${tag} label rect outside its button by ${b.labelOutside}`,
    ).toBeLessThanOrEqual(EPS);
    expect(b.lines, `${tag} line count`).toBeLessThanOrEqual(2);
    expect(b.rect.width, `${tag} wider than the footer`).toBeLessThanOrEqual(g.footer.width + EPS);
    expect(b.rect.left, `${tag} left of the footer`).toBeGreaterThanOrEqual(g.footer.left - EPS);
    expect(b.rect.right, `${tag} right of the footer`).toBeLessThanOrEqual(g.footer.right + EPS);
  }
}

/** The desktop arrangement measured before the fix (task 1.0): one row, and the first button sits at the footer's left. */
function expectDesktopArrangement(g: FooterGeometry): void {
  const tops = new Set(g.buttons.map((b) => Math.round(b.rect.top)));
  expect(tops.size, "all footer buttons share one row").toBe(1);
  expect(g.buttons[0].rect.left, "first button at the footer's left").toBeCloseTo(g.footer.left, 0);
  expect(g.footer.right, "footer right edge at the modal footer's content right").toBeCloseTo(
    g.modalFooterContentRight,
    0,
  );
}

/** Every single-line button is exactly `--control-md` tall. */
function expectControlHeight(g: FooterGeometry, only?: RegExp): void {
  for (const b of g.buttons) {
    if (only && !only.test(b.text)) continue;
    if (b.lines !== 1) continue;
    expect(b.rect.height, `"${b.text}" height vs --control-md ${g.controlMd}`).toBeCloseTo(
      g.controlMd,
      0,
    );
  }
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: evidencePath("HEL-1752", name) });
}

for (const theme of ["light", "dark"] as const) {
  test.describe(`HEL-1752 Output editor footer fit: 375px, ${theme}`, () => {
    test.use({ viewport: { width: 375, height: 812 }, actionTimeout: 15_000 });
    test.setTimeout(120_000);

    test("confirm delete keeps its full label inside its button", async ({ page, request }) => {
      await registerAndLogin(page, request, { ...AUTH, label: `phone-confirm-${theme}` });
      const { pipelineId } = await seed(page);
      await openPipeline(page, pipelineId, theme);
      await openConfirmDelete(page);
      const g = await measure(outputSheet(page));
      await shot(page, `phone-${theme}-confirm-delete.png`);
      const confirm = g.buttons.find((b) => b.text.startsWith("Confirm delete"));
      expect(confirm?.text).toBe(CONFIRM_TEXT);
      expectContained(g);
      expectControlHeight(g, /^(Cancel|Save)$/);
    });

    test("create mode: Add as tail with aggregate is contained, not squeezed", async ({
      page,
      request,
    }) => {
      await registerAndLogin(page, request, { ...AUTH, label: `phone-tail-${theme}` });
      const { pipelineId } = await seed(page);
      await openPipeline(page, pipelineId, theme);
      await openAddTail(page, true);
      const g = await measure(outputSheet(page));
      await shot(page, `phone-${theme}-add-tail.png`);
      const tail = g.buttons.find((b) => b.text === "Add as tail with aggregate");
      expect(tail?.lines, "Add as tail with aggregate must fit one line").toBe(1);
      expectContained(g);
      expectControlHeight(g);
    });
  });
}

test.describe("HEL-1752 Output editor footer: desktop 1280x800 unchanged", () => {
  test.use({ viewport: { width: 1280, height: 800 }, actionTimeout: 15_000 });
  test.setTimeout(120_000);

  test("confirm state: one row of single-line --control-md buttons", async ({ page, request }) => {
    await registerAndLogin(page, request, { ...AUTH, label: "desktop-confirm" });
    const { pipelineId } = await seed(page);
    await openPipeline(page, pipelineId, "light");
    await openConfirmDelete(page);
    const g = await measure(outputSheet(page));
    await shot(page, "desktop-light-confirm-delete.png");
    console.log(`[HEL-1752 measure] confirm ${JSON.stringify(g)}`);
    expect(g.buttons.find((b) => b.text.startsWith("Confirm delete"))?.text).toBe(CONFIRM_TEXT);
    expectContained(g);
    for (const b of g.buttons) expect(b.lines, `"${b.text}" single line`).toBe(1);
    expectDesktopArrangement(g);
    expectControlHeight(g);
  });

  test("create mode with add-tail: one row of single-line --control-md buttons", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, { ...AUTH, label: "desktop-tail" });
    const { pipelineId } = await seed(page);
    await openPipeline(page, pipelineId, "light");
    await openAddTail(page, false);
    const g = await measure(outputSheet(page));
    await shot(page, "desktop-light-add-tail.png");
    console.log(`[HEL-1752 measure] tail ${JSON.stringify(g)}`);
    expectContained(g);
    for (const b of g.buttons) expect(b.lines, `"${b.text}" single line`).toBe(1);
    expectDesktopArrangement(g);
    expectControlHeight(g);
  });
});
