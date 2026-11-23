import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { evidencePath } from "./support/evidencePath";
import { registerAndLogin } from "./support/auth";

// HEL-1818 — a rejected compact counter step renders and announces its message exactly once: in the
// always-mounted assertive region, with the control described by it, in both themes at 390 and 1440 px.
// "Once" is scoped to the panel (the global toast region is excluded). The 400 is route-fulfilled.

const CSRF_HEADER = "X-Helio-Requested-With";

const AUTH = { prefix: "hel1818", displayName: "HEL-1818", isolate: true } as const;

interface Created {
  id: string;
}

async function seedCounterDataset(request: APIRequestContext, name: string): Promise<Created> {
  const res = await request.post("/api/data-sources", {
    data: {
      name,
      type: "static",
      columns: [
        { name: "occurred_at", type: "timestamp" },
        { name: "delta", type: "integer", required: true },
        { name: "value", type: "integer" },
      ],
      rows: [],
    },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(res.status()).toBe(201);
  return res.json();
}

async function seedDashboard(request: APIRequestContext): Promise<Created> {
  const res = await request.post("/api/dashboards", {
    data: { name: "HEL-1818 e2e Dashboard" },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(res.status()).toBe(201);
  return res.json();
}

async function seedCompactCounterPanel(
  request: APIRequestContext,
  dashboardId: string,
  dataSourceId: string,
): Promise<Created> {
  const res = await request.post("/api/panels", {
    data: {
      dashboardId,
      title: "HEL-1818 Widget Counter",
      type: "form",
      config: {
        dataSourceId,
        fields: [{ sourceField: "delta", control: "counter", label: "Widgets", step: 5 }],
        submit: { writeMode: "append", resetOnSuccess: false },
      },
    },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(res.status()).toBe(201);
  return res.json();
}

async function deleteSource(request: APIRequestContext, id: string): Promise<void> {
  await request.delete(`/api/data-sources/${id}`, { headers: { [CSRF_HEADER]: "1" } });
}

async function deleteDashboard(request: APIRequestContext, id: string): Promise<void> {
  await request.delete(`/api/dashboards/${id}`, { headers: { [CSRF_HEADER]: "1" } });
}

async function switchToLightTheme(page: Page): Promise<void> {
  await page.keyboard.press("Control+k");
  await page.fill('input[aria-label="Search commands"]', "light theme");
  await page.getByRole("option", { name: "Switch to light theme" }).click();
  await expect(page.locator(".command-palette[open]")).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.waitForTimeout(400);
}

test.describe("HEL-1818 compact counter rejection shows and announces once (real backend)", () => {
  test.setTimeout(90_000);

  for (const theme of ["dark", "light"] as const) {
    for (const width of [390, 1440] as const) {
      test(`a rejected step renders the message once (${theme}, ${width}px)`, async ({
        page,
        request,
      }) => {
        await page.setViewportSize({ width, height: 900 });
        await registerAndLogin(page, request, { ...AUTH, label: `once-${theme}-${width}` });
        const source = await seedCounterDataset(request, `HEL-1818 e2e (${theme} ${width})`);
        let dashboard: Created | undefined;
        try {
          dashboard = await seedDashboard(request);
          const panel = await seedCompactCounterPanel(request, dashboard.id, source.id);
          const layoutRes = await request.post(`/api/dashboards/${dashboard.id}/auto-layout`, {
            data: { items: [{ panelId: panel.id, w: 3, h: 5 }] },
            headers: { [CSRF_HEADER]: "1" },
          });
          expect(layoutRes.status()).toBe(200);

          await page.goto("/dashboards");
          const control = page.getByRole("spinbutton", { name: "Widgets" });
          await expect(control).toBeVisible();
          if (theme === "light") await switchToLightTheme(page);

          await page.route(`**/api/panels/${panel.id}/submit`, (route) =>
            route.fulfill({
              status: 400,
              contentType: "application/json",
              body: JSON.stringify({
                message: "bad",
                fieldErrors: [{ field: "delta", reason: "delta must be positive" }],
              }),
            }),
          );
          await page.getByRole("button", { name: /increase widgets/i }).click();

          const panelEl = page.locator(".form-panel-view__compact-counter");
          const alert = panelEl.locator(".form-panel-view__alert");
          await expect(alert).toHaveText("delta must be positive", { timeout: 5000 });
          await expect(control).toHaveAttribute("aria-invalid", "true");
          await expect(control).toHaveAccessibleDescription(/delta must be positive/i);
          await expect(panelEl.locator(".ui-form-field__error")).toHaveCount(0);
          await expect(
            panelEl.getByRole("alert").filter({ hasText: "delta must be positive" }),
          ).toHaveCount(1);
          await expect(panelEl.getByText("delta must be positive")).toHaveCount(1);
          await expect(panelEl.locator(".form-panel-view__status")).toHaveCount(1);

          await page.screenshot({
            path: evidencePath("HEL-1818", `single-error-${theme}-${width}.png`),
          });
        } finally {
          if (dashboard) await deleteDashboard(request, dashboard.id);
          await deleteSource(request, source.id);
        }
      });
    }
  }
});
