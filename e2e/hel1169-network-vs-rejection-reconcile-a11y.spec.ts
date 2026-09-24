import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// HEL-1169 tasks.md 3.3 — live-browser proof that a definite rejection and an indeterminate
// (no-response) failure produce visually and textually DISTINCT states, and that a definite
// rejection's own error survives its trailing reconciliation fetch resolving (design.md D3a).
// Mirrors `hel1095-optimistic-pending-writing-panel-a11y.spec.ts`'s harness shape (register/login
// via the API, seed dataset+dashboard+panel, drive the real UI, compare both themes).
//
// The indeterminate case is driven via `page.route(...).abort()` on the submit request rather
// than literally killing the backend process — this exercises the REAL browser network stack (a
// genuine no-response condition axios sees identically to a killed server) without tearing down
// the shared dev server other specs in this worktree may still be using.

const CSRF_HEADER = "X-Helio-Requested-With";

function uniqueEmail(label: string): string {
  return `hel1169-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.test`;
}

async function registerAndLogin(page: Page, request: APIRequestContext, label: string) {
  const email = uniqueEmail(label);
  const password = "correcthorsebattery1";
  const res = await request.post("/api/auth/register", {
    data: { email, password, displayName: `HEL-1169 ${label}` },
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
    data: { name: "HEL-1169 e2e Dashboard" },
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
      title: "HEL-1169 Widget Counter",
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

test.describe("HEL-1169 network-vs-rejection reconcile ARIA state (real backend)", () => {
  test.setTimeout(90_000);

  for (const theme of ["dark", "light"] as const) {
    test(`a definite (400) rejection rolls back, marks the control invalid, and survives its own successful reconciliation (${theme} theme)`, async ({
      page,
      request,
    }) => {
      await registerAndLogin(page, request, `definite-${theme}`);
      const source = await seedCounterDataset(request, `HEL-1169 e2e Definite (${theme})`);
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
        const control = page.getByRole("spinbutton", { name: "Widgets" });
        await expect(control).toBeVisible();
        if (theme === "light") await switchToLightTheme(page);

        // Force a genuine server-shaped 400, with a body — the trailing aggregate GET is left
        // UNINTERCEPTED, so it reaches the real backend and succeeds (proving the reconciliation
        // fetch's own success doesn't clear the rejection's aria-invalid — design.md D3a).
        await page.route(`**/api/panels/${panel.id}/submit`, async (route) => {
          await route.fulfill({
            status: 400,
            contentType: "application/json",
            body: JSON.stringify({
              message: "bad",
              fieldErrors: [{ field: "delta", reason: "delta must be positive" }],
            }),
          });
        });
        const increaseButton = page.getByRole("button", { name: /increase widgets/i });
        await increaseButton.click();

        // Rollback: optimistic delta reverted, control marked invalid via computed ARIA.
        await expect(control).toHaveAttribute("aria-valuenow", "0", { timeout: 5000 });
        await expect(control).toHaveAttribute("aria-invalid", "true", { timeout: 5000 });
        await expect(control).toHaveAccessibleDescription(/delta must be positive/i);
        const alert = page.locator(".form-panel-view__alert");
        await expect(alert).not.toHaveText("");

        await page.unroute(`**/api/panels/${panel.id}/submit`);
        // Give the (now-unintercepted) reconciliation fetch time to land against the real
        // backend, then re-assert the error survived it (D3a's own claim, proven live).
        await page.waitForTimeout(500);
        await expect(control).toHaveAttribute("aria-invalid", "true");
        await expect(control).toHaveAccessibleDescription(/delta must be positive/i);

        await page.screenshot({
          path: `.concertino/runs/HEL-1169/evidence/definite-rejection-${theme}.png`,
        });
      } finally {
        if (dashboard) await deleteDashboard(request, dashboard.id);
        await deleteSource(request, source.id);
      }
    });

    test(`an indeterminate failure whose reconciliation also fails does not roll back and announces "couldn't confirm", distinct from a rejection (${theme} theme)`, async ({
      page,
      request,
    }) => {
      await registerAndLogin(page, request, `indeterminate-${theme}`);
      const source = await seedCounterDataset(request, `HEL-1169 e2e Indeterminate (${theme})`);
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
        const control = page.getByRole("spinbutton", { name: "Widgets" });
        await expect(control).toBeVisible();
        if (theme === "light") await switchToLightTheme(page);

        const alert = page.locator(".form-panel-view__alert");
        await expect(alert).toHaveText("");

        // Abort at the network layer — a genuine no-response condition, the real browser
        // equivalent of a killed backend / dropped connection (no HTTP exchange completes at
        // all). The trailing reconciliation GET is ALSO aborted, so the "couldn't confirm" path
        // is the one exercised (not the silent successful-reconcile path already covered by the
        // Jest suite's 1.1).
        await page.route(`**/api/panels/${panel.id}/submit`, (route) => route.abort("failed"));
        await page.route(`**/api/data-sources/${source.id}/rows/aggregate**`, (route) =>
          route.abort("failed"),
        );
        const increaseButton = page.getByRole("button", { name: /increase widgets/i });
        await increaseButton.click();

        // NOT rolled back — the optimistic delta stays displayed (this is the AC #2 behavior
        // this ticket exists to fix).
        await expect(control).toHaveAttribute("aria-valuenow", "5", { timeout: 5000 });
        // No field-level error — an indeterminate failure never calls `setExternalErrors`.
        await expect(control).not.toHaveAttribute("aria-invalid", "true");
        // The assertive region announces an unconfirmed state once the reconciliation fetch
        // itself also fails — distinct wording from the definite-rejection test's own error.
        await expect(alert).toHaveText(/couldn't confirm/i, { timeout: 5000 });
        await expect(alert).not.toHaveText(/delta must be positive/i);

        await page.screenshot({
          path: `.concertino/runs/HEL-1169/evidence/indeterminate-unconfirmed-${theme}.png`,
        });
      } finally {
        if (dashboard) await deleteDashboard(request, dashboard.id);
        await deleteSource(request, source.id);
      }
    });
  }
});
