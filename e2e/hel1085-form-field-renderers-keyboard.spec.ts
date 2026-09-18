import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// HEL-1085 design.md D9/task 4.8 — live-browser proof of keyboard completability, computed
// accessible name/description and error association (C1: jsdom cannot measure focus or
// computed-ARIA reliably enough to stand alone for these claims). Seeds a real dataset + dashboard
// + form panel through the API, then drives the six controls entirely by keyboard against this
// run's own dev/backend servers.
const CSRF_HEADER = "X-Helio-Requested-With";

function uniqueEmail(label: string): string {
  return `hel1085-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.test`;
}

async function registerAndLogin(page: Page, request: APIRequestContext, label: string) {
  const email = uniqueEmail(label);
  const password = "correcthorsebattery1";
  const res = await request.post("/api/auth/register", {
    data: { email, password, displayName: `HEL-1085 ${label}` },
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

async function seedDataset(request: APIRequestContext): Promise<Created> {
  const res = await request.post("/api/data-sources", {
    data: {
      name: "HEL-1085 e2e Orders",
      // `static` is the accepted wire alias for the `dataset` source kind
      // (DataSource.scala:266-280).
      type: "static",
      columns: [
        { name: "name", type: "string" },
        { name: "notes", type: "string" },
        { name: "quantity", type: "integer", required: true },
        { name: "shipBy", type: "timestamp" },
        { name: "size", type: "integer" },
        { name: "active", type: "boolean" },
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
    data: { name: "HEL-1085 e2e Dashboard" },
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
  // Body shape per `FormPanelRoundTripSpec.scala:20-27`.
  const res = await request.post("/api/panels", {
    data: {
      dashboardId,
      title: "HEL-1085 Order Form",
      type: "form",
      config: {
        dataSourceId,
        fields: [
          { sourceField: "name", control: "text", label: "Name", helpText: "The item's name" },
          {
            sourceField: "notes",
            control: "textarea",
            label: "Notes",
            helpText: "Any extra detail",
          },
          {
            sourceField: "quantity",
            control: "number",
            label: "Quantity",
            helpText: "How many units",
          },
          { sourceField: "shipBy", control: "date", label: "Ship by", helpText: "Target date" },
          {
            sourceField: "size",
            control: "select",
            label: "Size",
            helpText: "Pick a size",
            options: [1, 2, 3],
          },
          { sourceField: "active", control: "checkbox", label: "Active", helpText: "Is it live" },
        ],
        submit: { writeMode: "append" },
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

test.describe("HEL-1085 form field renderers — keyboard completion (real backend)", () => {
  test.setTimeout(60_000);

  test("all six controls are reachable and completable by keyboard alone, with computed name/description and error association", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, "keyboard");
    const source = await seedDataset(request);
    try {
      const dashboard = await seedDashboard(request);
      const panel = await seedFormPanel(request, dashboard.id, source.id);

      // Placed via `/auto-layout` deliberately undersized (w:1,h:1) — also exercises the D8
      // clamp (`PanelPackerSpec` covers the pure-function case; this is the live proof it's wired
      // through the route).
      const layoutRes = await request.post(`/api/dashboards/${dashboard.id}/auto-layout`, {
        data: { items: [{ panelId: panel.id, w: 1, h: 1 }] },
        headers: { [CSRF_HEADER]: "1" },
      });
      expect(layoutRes.status()).toBe(200);

      await page.goto("/");
      await expect(page.getByRole("heading", { name: "HEL-1085 e2e Dashboard" })).toBeVisible();
      await expect(page.locator(".react-grid-item")).toHaveCount(1);

      const form = page.getByRole("form", { name: "HEL-1085 Order Form" });
      await expect(form).toBeVisible();

      // — text —
      const nameField = form.getByRole("textbox", { name: "Name" });
      await expect(nameField).toHaveAccessibleDescription("The item's name");
      await nameField.focus();
      await page.keyboard.type("Widget");
      await expect(nameField).toHaveValue("Widget");

      // — textarea —
      await page.keyboard.press("Tab");
      const notesField = form.getByRole("textbox", { name: "Notes" });
      await expect(notesField).toBeFocused();
      await expect(notesField).toHaveAccessibleDescription("Any extra detail");
      await page.keyboard.type("Handle with care");
      await expect(notesField).toHaveValue("Handle with care");

      // — number: reached, then left empty to prove the required-empty association —
      await page.keyboard.press("Tab");
      const quantityField = form.getByRole("spinbutton", { name: "Quantity" });
      await expect(quantityField).toBeFocused();
      await expect(quantityField).toHaveAccessibleDescription("How many units");
      await page.keyboard.press("Tab"); // leave it empty
      await expect(quantityField).toHaveAttribute("aria-invalid", "true");
      await expect(quantityField).toHaveAccessibleDescription("Quantity is required");

      // Correct it, then continue the keyboard-only traversal from the date field.
      await quantityField.focus();
      await page.keyboard.type("5");
      await expect(quantityField).not.toHaveAttribute("aria-invalid", "true");
      await expect(quantityField).toHaveAccessibleDescription("How many units");

      // — date —
      await page.keyboard.press("Tab");
      const dateField = form.locator('input[type="date"]');
      await expect(dateField).toBeFocused();
      await expect(dateField).toHaveAccessibleName("Ship by");
      await expect(dateField).toHaveAccessibleDescription("Target date");
      await page.keyboard.type("01152027");
      await expect(dateField).toHaveValue("2027-01-15");

      // — select: operable without a pointer (ArrowDown then Enter picks the first option) —
      // Chromium's native `<input type=date>` inserts its own "clear" affordance as an extra tab
      // stop once it holds a value — a real browser behavior, not an app defect — so leaving a
      // populated date field takes two Tab presses here.
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      const sizeTrigger = form.getByRole("combobox", { name: "Size" });
      await expect(sizeTrigger).toBeFocused();
      await expect(sizeTrigger).toHaveAccessibleDescription("Pick a size");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await expect(sizeTrigger).toHaveText(/^1$/);
      await expect(sizeTrigger).toBeFocused();

      // — checkbox: toggled with Space —
      await page.keyboard.press("Tab");
      const activeField = form.getByRole("switch", { name: "Active" });
      await expect(activeField).toBeFocused();
      await expect(activeField).toHaveAccessibleDescription("Is it live");
      await expect(activeField).not.toBeChecked();
      await page.keyboard.press("Space");
      await expect(activeField).toBeChecked();

      // Leaving the last field with Tab never traps focus inside the form.
      await page.keyboard.press("Tab");
      await expect(activeField).not.toBeFocused();

      for (const theme of ["dark", "light"] as const) {
        if (theme === "light") {
          await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
          await page.keyboard.press("Control+k");
          await page.fill('input[aria-label="Search commands"]', "light theme");
          await page.getByRole("option", { name: "Switch to light theme" }).click();
          await expect(page.locator(".command-palette[open]")).toHaveCount(0);
          await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
          await page.waitForTimeout(400); // let the theme-switch color transition settle
        }
        await page.screenshot({
          path: `.concertino/runs/HEL-1085/evidence/form-panel-fields-${theme}.png`,
        });
      }
    } finally {
      await deleteSource(request, source.id);
    }
  });
});
