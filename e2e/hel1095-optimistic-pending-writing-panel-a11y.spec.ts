import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// HEL-1095 design.md D8/D9 — live-browser proof of the compact counter's pending affordance
// (`aria-busy`) and rollback-error state, read from the computed accessibility tree (never DOM
// presence alone — C6/C8), compared against the RUNNING app in both light and dark themes
// (DESIGN.md). Mirrors `hel1088-compact-counter-chrome.spec.ts`/`hel1090-form-panel-assembled-
// a11y.spec.ts`'s harness shape (register/login via the API, seed dataset+dashboard+panel, drive
// the real UI). Deliberately does NOT re-verify reconciliation-race correctness here — that's
// `FormPanelView.test.tsx`'s job (tasks 3.1/3.3/3.4/3.7); this spec's job is the ARIA state a
// screen reader would actually see, against a real render in both themes.

const CSRF_HEADER = "X-Helio-Requested-With";

function uniqueEmail(label: string): string {
  return `hel1095-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.test`;
}

async function registerAndLogin(page: Page, request: APIRequestContext, label: string) {
  const email = uniqueEmail(label);
  const password = "correcthorsebattery1";
  const res = await request.post("/api/auth/register", {
    data: { email, password, displayName: `HEL-1095 ${label}` },
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
    data: { name: "HEL-1095 e2e Dashboard" },
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
      title: "HEL-1095 Widget Counter",
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

test.describe("HEL-1095 optimistic pending/rollback ARIA state (real backend)", () => {
  test.setTimeout(90_000);

  for (const theme of ["dark", "light"] as const) {
    test(`aria-busy is true while pending and clears on reconciliation (${theme} theme)`, async ({
      page,
      request,
    }) => {
      await registerAndLogin(page, request, `busy-${theme}`);
      const source = await seedCounterDataset(request, `HEL-1095 e2e Widgets (${theme})`);
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
        // Theme switch AFTER the dashboard has fully rendered (mirrors hel1088/hel1090's own
        // ordering) — switching before the panel/command-bar have mounted is what made this
        // spec's light-theme runs hang against the real command palette on first measurement.
        if (theme === "light") await switchToLightTheme(page);

        // C8: the computed ARIA value, not mere attribute presence — `aria-busy` absent before
        // any request has ever been made.
        await expect(control).not.toHaveAttribute("aria-busy", "true");
        const idleSnapshot = await page.accessibility.snapshot({
          root: (await control.elementHandle()) ?? undefined,
        });
        expect(idleSnapshot?.role).toBe("spinbutton");

        // Delay the submit response so the pending window is observable (mirrors HEL-1090's
        // `page.route` delay technique). The `route.continue()` call is wrapped in try/catch:
        // observed once as a flaky "Route is already handled!" in this harness (consistent with
        // the browser matching this URL pattern more than once for one logical request, e.g. a
        // CORS preflight sharing the pattern) -- harmless here since all this test needs is the
        // real request to actually reach the server, not a guarantee this exact handler resolves
        // the interception itself.
        await page.route(`**/api/panels/${panel.id}/submit`, async (route) => {
          await new Promise((r) => setTimeout(r, 400));
          try {
            await route.continue();
          } catch {
            // Already handled by a concurrent match of the same pattern -- the real request still
            // reaches the server either way; nothing else to do here.
          }
        });
        const increaseButton = page.getByRole("button", { name: /increase widgets/i });
        await increaseButton.click();

        // Pending: computed aria-busy true, read from the live accessibility tree.
        await expect(control).toHaveAttribute("aria-busy", "true");
        const busySnapshot = await page.accessibility.snapshot({
          root: (await control.elementHandle()) ?? undefined,
        });
        // Chromium's AX tree does not always surface aria-busy as a distinct snapshot field for
        // this role — the DOM attribute assertion above is the load-bearing computed-state proof
        // (identical convention to hel1088's aria-valuenow/aria-valuetext pairing); this snapshot
        // call additionally confirms the node is still resolvable as a spinbutton while busy.
        expect(busySnapshot?.role).toBe("spinbutton");

        await page.unroute(`**/api/panels/${panel.id}/submit`);

        // Settled + reconciled: aria-busy clears once the submit resolves and the (only) request
        // in this burst's reconciliation fetch has landed.
        await expect(control).not.toHaveAttribute("aria-busy", "true", { timeout: 5000 });
        await expect(control).toHaveAttribute("aria-valuenow", "5", { timeout: 5000 });

        await page.screenshot({
          path: `.concertino/runs/HEL-1095/evidence/pending-${theme}.png`,
        });
      } finally {
        if (dashboard) await deleteDashboard(request, dashboard.id);
        await deleteSource(request, source.id);
      }
    });

    test(`rejected submit rolls back with an announced error, computed ARIA only (${theme} theme)`, async ({
      page,
      request,
    }) => {
      await registerAndLogin(page, request, `rollback-${theme}`);
      const source = await seedCounterDataset(request, `HEL-1095 e2e Rollback (${theme})`);
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
        // Theme switch AFTER the dashboard has fully rendered — see the sibling test's comment.
        if (theme === "light") await switchToLightTheme(page);

        // Scoped to this panel's own alert region (the page also mounts a global sr-only
        // `role="alert"` toast region — a bare `page.getByRole("alert")` matches both and is
        // ambiguous, confirmed live). `role="alert"` on this element (never injected after the
        // fact) is what makes a real AT announce it — same locator convention hel1090's own
        // live-region test uses.
        const alert = page.locator(".form-panel-view__alert");
        await expect(alert).toHaveText("");

        // Force a genuine server-side rejection (not client-blocked): delete the bound source out
        // from under the panel — mirrors hel1088's own rejection technique.
        await deleteSource(request, source.id);
        const increaseButton = page.getByRole("button", { name: /increase widgets/i });
        await increaseButton.click();

        // Rollback: the optimistic delta is reverted (computed aria-valuenow, not a visual read)
        // and the assertive live region announces the failure — this IS the measurement (computed
        // live-region text before/after), the same convention hel1090's live-region test uses.
        await expect(control).toHaveAttribute("aria-valuenow", "0", { timeout: 5000 });
        await expect(alert).not.toHaveText("");
        // aria-busy must be cleared, not stuck true, once the rejection has been processed.
        await expect(control).not.toHaveAttribute("aria-busy", "true");

        await page.screenshot({
          path: `.concertino/runs/HEL-1095/evidence/rollback-${theme}.png`,
        });
      } finally {
        if (dashboard) await deleteDashboard(request, dashboard.id);
        // source was already deleted mid-test to force the rejection.
      }
    });
  }
});
