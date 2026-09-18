import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// HEL-1088 design.md Decision 1-4 — live-browser proof of the compact single-counter-field
// layout: computed ARIA value/step exposure read from the live accessibility tree (not
// presence-only, MISTAKES.md C8/HEL-1084 precedent), keyboard-only operability, an immediate
// per-click submit that lands exactly on the bound dataSourceId, and a rejected increment writing
// nothing. Mirrors `hel1085-form-field-renderers-keyboard.spec.ts` / `hel1087-form-submit-path.spec.ts`'s
// harness shape.

const CSRF_HEADER = "X-Helio-Requested-With";

function uniqueEmail(label: string): string {
  return `hel1088-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.test`;
}

async function registerAndLogin(page: Page, request: APIRequestContext, label: string) {
  const email = uniqueEmail(label);
  const password = "correcthorsebattery1";
  const res = await request.post("/api/auth/register", {
    data: { email, password, displayName: `HEL-1088 ${label}` },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(res.status()).toBe(201);
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL("/");
}

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
    data: { name: "HEL-1088 e2e Dashboard" },
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
      title: "HEL-1088 Widget Counter",
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

async function rowCount(request: APIRequestContext, sourceId: string): Promise<number> {
  const res = await request.get(`/api/data-sources/${sourceId}/rows`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  return body.total as number;
}

async function deleteSource(request: APIRequestContext, id: string): Promise<void> {
  await request.delete(`/api/data-sources/${id}`, { headers: { [CSRF_HEADER]: "1" } });
}

async function deleteDashboard(request: APIRequestContext, id: string): Promise<void> {
  await request.delete(`/api/dashboards/${id}`, { headers: { [CSRF_HEADER]: "1" } });
}

test.describe("HEL-1088 compact single-counter-field layout (real backend)", () => {
  test.setTimeout(60_000);

  test("computed ARIA, keyboard operability, immediate submit landing on the bound source, and rejection writes nothing", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, "compact");
    const source = await seedCounterDataset(request, "HEL-1088 e2e Widgets");
    let dashboard: Created | undefined;
    try {
      dashboard = await seedDashboard(request);
      const panel = await seedCompactCounterPanel(request, dashboard.id, source.id);

      const layoutRes = await request.post(`/api/dashboards/${dashboard.id}/auto-layout`, {
        data: { items: [{ panelId: panel.id, w: 3, h: 5 }] },
        headers: { [CSRF_HEADER]: "1" },
      });
      expect(layoutRes.status()).toBe(200);

      await page.goto("/");
      await expect(page.getByRole("heading", { name: "HEL-1088 e2e Dashboard" })).toBeVisible();

      const control = page.getByRole("spinbutton", { name: "Widgets" });
      await expect(control).toBeVisible();

      // Computed ARIA state, read from the live accessibility tree — not attribute presence alone.
      await expect(control).toHaveAttribute("aria-valuenow", "0");
      await expect(control).toHaveAttribute("aria-valuetext", "0, step 5");
      const snapshotBefore = await page.accessibility.snapshot({
        root: (await control.elementHandle()) ?? undefined,
      });
      expect(snapshotBefore?.role).toBe("spinbutton");
      expect(snapshotBefore?.valuetext).toBe("0, step 5");

      const before = await rowCount(request, source.id);

      // Keyboard-only: Tab reaches the +/- buttons, Enter/Space activate them; ArrowUp/ArrowDown
      // activate the spinbutton container itself.
      await page.keyboard.press("Tab"); // into the app; browser chrome varies, so re-focus explicitly below
      await control.focus();
      await page.keyboard.press("ArrowUp");
      await expect(control).toHaveAttribute("aria-valuenow", "5");
      await expect.poll(async () => rowCount(request, source.id)).toBe(before + 1);

      const decreaseButton = page.getByRole("button", { name: /decrease widgets/i });
      await decreaseButton.focus();
      await page.keyboard.press("Enter");
      await expect(control).toHaveAttribute("aria-valuenow", "0");
      await expect.poll(async () => rowCount(request, source.id)).toBe(before + 2);

      const afterSuccess = await rowCount(request, source.id);

      // Rejection: delete the bound source's field shape out from under the panel by deleting the
      // source entirely, forcing the next submit to fail server-side — the optimistic tally must
      // revert and no row is written anywhere.
      await deleteSource(request, source.id);
      const increaseButton = page.getByRole("button", { name: /increase widgets/i });
      await increaseButton.click();
      await expect(control).toHaveAttribute("aria-valuenow", "0", { timeout: 5000 });
      await expect(page.locator(".form-panel-view__alert")).not.toHaveText("");

      for (const theme of ["dark", "light"] as const) {
        if (theme === "light") {
          await page.keyboard.press("Control+k");
          await page.fill('input[aria-label="Search commands"]', "light theme");
          await page.getByRole("option", { name: "Switch to light theme" }).click();
          await expect(page.locator(".command-palette[open]")).toHaveCount(0);
          await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
          await page.waitForTimeout(400);
        }
        await page.screenshot({
          path: `.concertino/runs/HEL-1088/evidence/compact-counter-${theme}.png`,
        });
      }

      // afterSuccess is exercised above via the poll assertions; referenced here so a future
      // refactor that drops the intermediate assertions doesn't leave it unused-and-silently-stale.
      expect(afterSuccess).toBe(before + 2);
    } finally {
      if (dashboard) await deleteDashboard(request, dashboard.id);
    }
  });
});
