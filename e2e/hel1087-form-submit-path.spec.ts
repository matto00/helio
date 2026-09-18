import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// HEL-1087 design.md D10 — live-browser proof of the submit path: server-side enforcement via
// API-bypass, the announced/associated/preserved-input rejection states (C1: jsdom cannot measure
// focus or computed ARIA reliably enough to stand alone for these claims), and a real successful
// append landing on exactly the bound source. Seeds two real datasets + a dashboard + a form panel
// through the API, mirroring `hel1085-form-field-renderers-keyboard.spec.ts`'s harness shape.

const CSRF_HEADER = "X-Helio-Requested-With";

function uniqueEmail(label: string): string {
  return `hel1087-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.test`;
}

async function registerAndLogin(page: Page, request: APIRequestContext, label: string) {
  const email = uniqueEmail(label);
  const password = "correcthorsebattery1";
  const res = await request.post("/api/auth/register", {
    data: { email, password, displayName: `HEL-1087 ${label}` },
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

async function seedDataset(request: APIRequestContext, name: string): Promise<Created> {
  const res = await request.post("/api/data-sources", {
    data: {
      name,
      type: "static",
      columns: [
        // `note` declared OPTIONAL — the form tightens it to required (D3(v)'s
        // form-required-but-declared-optional fixture).
        { name: "note", type: "string" },
        { name: "quantity", type: "integer", required: true },
        { name: "status", type: "string" },
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
    data: { name: "HEL-1087 e2e Dashboard" },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(res.status()).toBe(201);
  return res.json();
}

async function seedFormPanel(
  request: APIRequestContext,
  dashboardId: string,
  dataSourceId: string,
): Promise<Created> {
  const res = await request.post("/api/panels", {
    data: {
      dashboardId,
      title: "HEL-1087 Order Form",
      type: "form",
      config: {
        dataSourceId,
        fields: [
          { sourceField: "note", control: "text", label: "Note", required: true },
          { sourceField: "quantity", control: "number", label: "Quantity", required: true },
          {
            sourceField: "status",
            control: "select",
            label: "Status",
            options: ["open", "closed"],
          },
        ],
        submit: { writeMode: "append" },
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

test.describe("HEL-1087 form submit path (real backend)", () => {
  test.setTimeout(60_000);

  test("API-bypass client-blocked payloads are rejected server-side, writing nothing", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, "api-bypass");
    const sourceA = await seedDataset(request, "HEL-1087 e2e Source A (bypass)");
    let dashboard: Created | undefined;
    try {
      dashboard = await seedDashboard(request);
      const panel = await seedFormPanel(request, dashboard.id, sourceA.id);

      const before = await rowCount(request, sourceA.id);

      const whitespaceRes = await request.post(`/api/panels/${panel.id}/submit`, {
        data: { values: { note: "   ", quantity: 1, status: "open" } },
        headers: { [CSRF_HEADER]: "1" },
      });
      expect(whitespaceRes.status()).toBe(400);

      const optionRes = await request.post(`/api/panels/${panel.id}/submit`, {
        data: { values: { note: "hi", quantity: 1, status: "unknown" } },
        headers: { [CSRF_HEADER]: "1" },
      });
      expect(optionRes.status()).toBe(400);

      expect(await rowCount(request, sourceA.id)).toBe(before);
    } finally {
      if (dashboard) await deleteDashboard(request, dashboard.id);
      await deleteSource(request, sourceA.id);
    }
  });

  test("UI server rejection is announced, associates the invalid control, preserves input, and focuses it", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, "server-rejection");
    const sourceA = await seedDataset(request, "HEL-1087 e2e Source A (reject)");
    let dashboard: Created | undefined;
    try {
      dashboard = await seedDashboard(request);
      const panel = await seedFormPanel(request, dashboard.id, sourceA.id);

      const layoutRes = await request.post(`/api/dashboards/${dashboard.id}/auto-layout`, {
        data: { items: [{ panelId: panel.id, w: 2, h: 2 }] },
        headers: { [CSRF_HEADER]: "1" },
      });
      expect(layoutRes.status()).toBe(200);

      await page.goto("/");
      const form = page.getByRole("form", { name: "HEL-1087 Order Form" });
      await expect(form).toBeVisible();

      // Alert region exists and is empty before any submit attempt (D8).
      const alert = form.locator(".form-panel-view__alert");
      await expect(alert).toHaveText("");

      const noteField = form.getByRole("textbox", { name: "Note" });
      await noteField.fill("hello");
      // Bypasses the client's own type check via a raw fill of a valid-looking value; the
      // server-side rejection below is driven by a route rewrite forcing a field error instead
      // (simpler and more deterministic than crafting a client-bypassable payload through the UI
      // — the point under test is the UI's handling of a `400`, not re-deriving D3 through
      // keystrokes HEL-1087's own unit/route specs already exhaustively cover).
      await page.route(`**/api/panels/${panel.id}/submit`, async (route) => {
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({
            message: "field 'quantity' — required",
            fieldErrors: [{ field: "quantity", reason: "required" }],
          }),
        });
      });

      const submitButton = form.getByRole("button", { name: "Submit" });
      await submitButton.click();

      await expect(alert).toContainText(/quantity/i);
      const quantityField = form.getByRole("spinbutton", { name: "Quantity" });
      await expect(quantityField).toHaveAttribute("aria-invalid", "true");
      await expect(quantityField).toHaveAccessibleDescription(/required/i);
      await expect(quantityField).toBeFocused();
      await expect(noteField).toHaveValue("hello");
    } finally {
      if (dashboard) await deleteDashboard(request, dashboard.id);
      await deleteSource(request, sourceA.id);
    }
  });

  test("a transport failure announces, preserves input, and leaves focus on the submit button", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, "transport");
    const sourceA = await seedDataset(request, "HEL-1087 e2e Source A (transport)");
    let dashboard: Created | undefined;
    try {
      dashboard = await seedDashboard(request);
      const panel = await seedFormPanel(request, dashboard.id, sourceA.id);

      const layoutRes = await request.post(`/api/dashboards/${dashboard.id}/auto-layout`, {
        data: { items: [{ panelId: panel.id, w: 2, h: 2 }] },
        headers: { [CSRF_HEADER]: "1" },
      });
      expect(layoutRes.status()).toBe(200);

      await page.goto("/");
      const form = page.getByRole("form", { name: "HEL-1087 Order Form" });
      await expect(form).toBeVisible();

      const noteField = form.getByRole("textbox", { name: "Note" });
      await noteField.fill("hello");
      await form.getByRole("spinbutton", { name: "Quantity" }).fill("5");

      await page.route(`**/api/panels/${panel.id}/submit`, (route) => route.abort());

      const submitButton = form.getByRole("button", { name: "Submit" });
      await submitButton.click();

      const alert = form.locator(".form-panel-view__alert");
      await expect(alert).toContainText(/could not be completed/i);
      await expect(noteField).toHaveValue("hello");
      await expect(submitButton).toBeFocused();
    } finally {
      if (dashboard) await deleteDashboard(request, dashboard.id);
      await deleteSource(request, sourceA.id);
    }
  });

  test("a successful submit appends exactly one row to the bound source, none to another, and announces success", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, "success");
    const sourceA = await seedDataset(request, "HEL-1087 e2e Source A (success)");
    const sourceB = await seedDataset(request, "HEL-1087 e2e Source B (unchanged)");
    let dashboard: Created | undefined;
    try {
      dashboard = await seedDashboard(request);
      const panel = await seedFormPanel(request, dashboard.id, sourceA.id);

      const layoutRes = await request.post(`/api/dashboards/${dashboard.id}/auto-layout`, {
        data: { items: [{ panelId: panel.id, w: 2, h: 2 }] },
        headers: { [CSRF_HEADER]: "1" },
      });
      expect(layoutRes.status()).toBe(200);

      const beforeA = await rowCount(request, sourceA.id);
      const beforeB = await rowCount(request, sourceB.id);

      await page.goto("/");
      const form = page.getByRole("form", { name: "HEL-1087 Order Form" });
      await expect(form).toBeVisible();

      const alert = form.locator(".form-panel-view__alert");
      await expect(alert).toHaveText("");

      await form.getByRole("textbox", { name: "Note" }).fill("hello");
      await form.getByRole("spinbutton", { name: "Quantity" }).fill("5");
      await form.getByRole("combobox", { name: "Status" }).click();
      await page.getByRole("option", { name: "open" }).click();

      const submitButton = form.getByRole("button", { name: "Submit" });
      await submitButton.click();

      const status = form.locator(".form-panel-view__status");
      await expect(status).toContainText(/added/i);

      expect(await rowCount(request, sourceA.id)).toBe(beforeA + 1);
      expect(await rowCount(request, sourceB.id)).toBe(beforeB);

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
          path: `.concertino/runs/HEL-1087/evidence/form-submit-path-${theme}.png`,
        });
      }
    } finally {
      if (dashboard) await deleteDashboard(request, dashboard.id);
      await deleteSource(request, sourceA.id);
      await deleteSource(request, sourceB.id);
    }
  });
});
