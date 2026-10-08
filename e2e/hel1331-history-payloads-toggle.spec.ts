import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { CSRF_HEADER, registerAndLogin } from "./support/auth";
import { evidencePath } from "./support/evidencePath";
import { setUserTierForTest } from "./support/historySeed";
import { waitForSettingsAuditTable } from "./support/settingsReady";

// HEL-1331 — the Output editor's "Keep each run's rows" toggle (`config.historyPayloads`).
//  * a BETA-owned pipeline: the switch is enabled; turning it on and saving sends
//    `config.historyPayloads: true`, and reopening the editor shows it on;
//  * a FREE-owned pipeline: the switch is visible but disabled, with the "Free stores run summaries
//    only" note; the "Request Beta access" link opens Settings in a new tab with the "Beta access" heading in
//    the viewport (after the audit section's fetch settles).
// Both themes; screenshots go through support/evidencePath.ts. Every created id is logged and
// deleted by exact id in `finally`.

const CSRF = { [CSRF_HEADER]: "1" };

async function postJson<T>(request: APIRequestContext, url: string, data: unknown): Promise<T> {
  const res = await request.post(url, { data, headers: CSRF });
  expect(res.status(), `${url}: ${await res.text()}`).toBe(201);
  return (await res.json()) as T;
}

async function seedOutput(request: APIRequestContext, theme: string, tier: string) {
  const source = await postJson<{ id: string }>(request, "/api/data-sources", {
    name: `HEL-1331 ${tier} ${theme}`,
    type: "static",
    columns: [
      { name: "day", type: "string" },
      { name: "amount", type: "integer" },
    ],
    rows: [
      ["Mon", 10],
      ["Tue", 20],
    ],
  });
  const pipeline = await postJson<{ id: string }>(request, "/api/pipelines", {
    name: `HEL-1331 ${tier} ${theme}`,
    roots: [{ sourceId: source.id }],
  });
  const output = await postJson<{ id: string }>(request, `/api/pipelines/${pipeline.id}/outputs`, {
    kind: "metric",
    name: `HEL-1331 ${tier} metric`,
    config: { fieldMapping: {}, aggregation: { value: "amount", agg: "sum" } },
  });
  console.log(
    `[HEL-1331 e2e] created source ${source.id} pipeline ${pipeline.id} output ${output.id}`,
  );
  return { source: source.id, pipeline: pipeline.id, output: output.id };
}

async function cleanup(
  request: APIRequestContext,
  ids: { source: string; pipeline: string } | undefined,
) {
  if (!ids) return;
  console.log(`[HEL-1331 e2e] deleting pipeline ${ids.pipeline} source ${ids.source}`);
  await request.delete(`/api/pipelines/${ids.pipeline}`, { headers: CSRF });
  await request.delete(`/api/data-sources/${ids.source}`, { headers: CSRF });
}

async function openEditor(page: Page, pipelineId: string, tier: string, theme: string) {
  await page.goto(`/pipelines/${pipelineId}`);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await page.getByRole("tab", { name: /^Outputs/ }).click();
  await page.getByRole("button", { name: `Open HEL-1331 ${tier} metric output` }).click();
}

const toggle = (page: Page) => page.getByRole("switch", { name: "Keep each run's rows" });

for (const theme of ["light", "dark"] as const) {
  test(`beta-owned pipeline: enable the toggle, save, reopen shows it on (${theme})`, async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
    await registerAndLogin(page, request, {
      prefix: "hel1331",
      label: `beta-${theme}`,
      displayName: "HEL-1331",
      isolate: true,
    });
    const me = await request.get("/api/auth/me");
    const userId = ((await me.json()) as { id: string }).id;
    console.log(`[HEL-1331 e2e] created user ${userId}`);
    setUserTierForTest(userId, "beta");

    let ids: { source: string; pipeline: string; output: string } | undefined;
    try {
      ids = await seedOutput(request, theme, "beta");
      await openEditor(page, ids.pipeline, "beta", theme);
      await expect(toggle(page)).toBeVisible();
      await expect(toggle(page)).toBeEnabled();
      await expect(toggle(page)).not.toBeChecked();
      await expect(page.getByText("Free stores run summaries only")).toHaveCount(0);
      await expect(page.getByText(/Stores the full rows of every run/)).toBeVisible();
      // HEL-1372: the figures come from the server's historyPayloadLimits, not a frontend constant.
      const served = await request.get(`/api/outputs/${ids.output}`);
      const limits = ((await served.json()) as { historyPayloadLimits: { maxRows: number } })
        .historyPayloadLimits;
      expect(limits.maxRows).toBeGreaterThan(0);
      await expect(page.getByText(/Stores the full rows of every run/)).toContainText(
        `A run over ${limits.maxRows.toLocaleString("en-US")} rows`,
      );

      // The native switch is visually hidden; the visible control is its label's track.
      await page.locator("label.ui-toggle", { hasText: "Keep each run's rows" }).click();
      await expect(toggle(page)).toBeChecked();
      await page.screenshot({ path: evidencePath("HEL-1331", `editor-beta-on-${theme}.png`) });
      const patched = page.waitForRequest(
        (r) => r.method() === "PATCH" && r.url().includes(`/api/outputs/${ids!.output}`),
      );
      await page.getByRole("button", { name: "Save" }).click();
      const body = (await patched).postDataJSON() as { config: { historyPayloads?: unknown } };
      expect(body.config.historyPayloads).toBe(true);
      await expect(toggle(page)).toBeHidden();

      await openEditor(page, ids.pipeline, "beta", theme);
      await expect(toggle(page)).toBeChecked();
      const stored = await request.get(`/api/outputs/${ids.output}`);
      const out = (await stored.json()) as {
        config: { historyPayloads?: unknown };
        historyPayloadsAvailable?: boolean;
      };
      expect(out.config.historyPayloads).toBe(true);
      expect(out.historyPayloadsAvailable).toBe(true);
    } finally {
      await cleanup(request, ids);
    }
  });

  test(`free-owned pipeline: disabled toggle, note, and the link lands on Beta access (${theme})`, async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
    await registerAndLogin(page, request, {
      prefix: "hel1331",
      label: `free-${theme}`,
      displayName: "HEL-1331",
      isolate: true,
    });

    let ids: { source: string; pipeline: string; output: string } | undefined;
    try {
      ids = await seedOutput(request, theme, "free");
      await openEditor(page, ids.pipeline, "free", theme);
      await expect(toggle(page)).toBeVisible();
      await expect(toggle(page)).toBeDisabled();
      await expect(page.getByText("Free stores run summaries only")).toBeVisible();
      await page.getByText("Free stores run summaries only").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: evidencePath("HEL-1331", `editor-free-disabled-${theme}.png`),
      });

      // HEL-1372: the note matches the help text's computed font size.
      const helpSize = await page
        .getByText(/Stores the full rows of every run/)
        .evaluate((el) => getComputedStyle(el).fontSize);
      const noteSize = await page
        .getByText("Free stores run summaries only")
        .evaluate((el) => getComputedStyle(el.parentElement as HTMLElement).fontSize);
      expect(noteSize).toBe(helpSize);

      // HEL-1372: an unsaved edit survives the upsell link, which opens a NEW tab.
      await page.locator("#output-name").fill("HEL-1372 unsaved edit");
      const popupPromise = page.context().waitForEvent("page");
      await page.getByRole("link", { name: "Request Beta access (opens in a new tab)" }).click();
      const settings = await popupPromise;
      await settings.waitForLoadState();
      await expect(settings).toHaveURL(/\/settings#beta-access$/);
      await waitForSettingsAuditTable(settings);
      await expect(settings.getByRole("heading", { name: "Beta access" })).toBeInViewport();
      await settings.screenshot({
        path: evidencePath("HEL-1331", `settings-beta-access-${theme}.png`),
      });
      await settings.close();

      // The original tab is untouched: still on the pipeline page, editor open, edit intact.
      await expect(page).toHaveURL(new RegExp(`/pipelines/${ids.pipeline}`));
      await expect(page.locator("#output-name")).toHaveValue("HEL-1372 unsaved edit");
      await expect(toggle(page)).toBeVisible();
    } finally {
      await cleanup(request, ids);
    }
  });
}
