import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { registerAndLogin } from "./support/auth";
import { evidencePath } from "./support/evidencePath";
import { settleTransitions } from "./support/settleTransitions";
import { compositeStack, contrastRatio, parseColor } from "./support/stateContrast.mjs";

// HEL-1822: the Run History `Auto-run` trigger badge must look different from the `Manual` one, in both
// themes, and meet the contrast floors. jsdom applies no stylesheet, so this is measured on the rendered page.
//  - the fill is composited over the row's own opaque fill (the badge sits on the row, not on the modal);
//  - fill-vs-row uses the HEL-866 1.10 state-surface floor; text-on-fill uses the 4.5:1 small-text floor.
// The run-history response is the shared wire fixture (one run per trigger source, held to the real route by
// PipelineRunHistorySchemaSpec), with only its placeholders replaced.

const CSRF = { "X-Helio-Requested-With": "1" };
const FIXTURE = resolve(
  __dirname,
  "../shared-test-fixtures/pipeline-run/run-history-response.json",
);
const STATE_SURFACE_FLOOR = 1.1;
const TEXT_FLOOR = 4.5;

function fixtureBody(pipelineId: string): unknown {
  const stamp = "2026-05-01T11:00:00Z";
  const raw = readFileSync(FIXTURE, "utf8")
    .replaceAll("{{TIMESTAMP}}", stamp)
    .replaceAll("{{PIPELINE_1}}", pipelineId)
    .replace(/\{\{RUN_([a-z-]+)\}\}/g, (_m, src: string) => `hel1822-run-${src}`);
  return JSON.parse(raw);
}

interface Measured {
  fill: string;
  border: string;
  color: string;
  rowFill: string;
}

async function measure(page: Page, label: string): Promise<Measured> {
  const badge = page
    .getByRole("dialog", { name: /^Run history/ })
    .locator(".run-history-modal__trigger", { hasText: new RegExp(`^${label}$`) });
  await expect(badge).toHaveCount(1);
  return badge.evaluate((el) => {
    const cs = getComputedStyle(el);
    const row = el.closest(".run-history-modal__row") as HTMLElement;
    return {
      fill: cs.backgroundColor,
      border: cs.borderTopColor,
      color: cs.color,
      rowFill: getComputedStyle(row).backgroundColor,
    };
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`HEL-1822 auto-run trigger badge is distinct from manual and meets the floors (${theme})`, async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, {
      prefix: "hel1822",
      displayName: "HEL-1822",
      domain: "example.test",
    });
    const src = await page.request.post("/api/data-sources", {
      data: {
        name: "hel1822-src",
        type: "static",
        columns: [{ name: "n", type: "integer" }],
        rows: [[1], [2]],
      },
      headers: CSRF,
    });
    expect(src.status()).toBeLessThan(300);
    const sourceId = ((await src.json()) as { id: string }).id;
    const pipeRes = await page.request.post("/api/pipelines", {
      data: { name: "hel1822-pipe", roots: [{ sourceId }] },
      headers: CSRF,
    });
    expect(pipeRes.status()).toBeLessThan(300);
    const pipelineId = ((await pipeRes.json()) as { id: string }).id;

    await page.route("**/api/pipelines/*/run-history", (route) =>
      route.fulfill({ json: fixtureBody(pipelineId) }),
    );

    await page.evaluate((t) => window.localStorage.setItem("helio-theme", t), theme);
    await page.goto(`/pipelines/${pipelineId}`);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.evaluate(() => document.fonts.ready);
    await page
      .getByRole("button", { name: /^Pipeline actions/ })
      .first()
      .click();
    await page.getByRole("menuitem", { name: "Run history" }).click();
    const dialog = page.getByRole("dialog", { name: /^Run history/ });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".run-history-modal__trigger")).toHaveCount(4);
    await settleTransitions(page);

    const auto = await measure(page, "Auto-run");
    const manual = await measure(page, "Manual");
    const autoFill = compositeStack([parseColor(auto.fill), parseColor(auto.rowFill)]);
    const manualFill = compositeStack([parseColor(manual.fill), parseColor(manual.rowFill)]);
    const rowFill = parseColor(auto.rowFill);
    const autoText = parseColor(auto.color);
    const manualText = parseColor(manual.color);

    const fillVsRow = contrastRatio(autoFill, rowFill);
    const fillVsManual = contrastRatio(autoFill, manualFill);
    const textOnFill = contrastRatio(autoText, autoFill);
    const manualTextOnFill = contrastRatio(manualText, manualFill);

    writeFileSync(
      evidencePath("HEL-1822", `auto-run-badge-${theme}.json`),
      JSON.stringify(
        { theme, auto, manual, fillVsRow, fillVsManual, textOnFill, manualTextOnFill },
        null,
        2,
      ),
    );

    const autoBadge = dialog.locator(".run-history-modal__trigger", { hasText: /^Auto-run$/ });
    // (a) the badge carries its own modifier.
    await expect(autoBadge).toHaveClass(/run-history-modal__trigger--auto-run/);
    // (b) it differs visibly from manual: its fill is distinct from the row (= manual's fill) and its text differs.
    expect.soft(fillVsRow, `fill vs row (${theme})`).toBeGreaterThanOrEqual(STATE_SURFACE_FLOOR);
    expect
      .soft(fillVsManual, `fill vs manual fill (${theme})`)
      .toBeGreaterThanOrEqual(STATE_SURFACE_FLOOR);
    expect.soft(auto.color, `text colour differs from manual (${theme})`).not.toBe(manual.color);
    // (c) the text on the composited fill meets the small-text floor.
    expect.soft(textOnFill, `text on fill (${theme})`).toBeGreaterThanOrEqual(TEXT_FLOOR);
  });
}
