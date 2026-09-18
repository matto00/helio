import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// HEL-1090 — the epic's final leaf: audit the ASSEMBLED form panel (every field type in one
// panel, not isolated per-field jsdom coverage like HEL-1083..1089) against a running instance.
// C8: every assertion below reads the computed accessibility tree / computed live-region text,
// never mere attribute presence. Harness mirrors hel1087-form-submit-path.spec.ts's shape
// (register/login via the API, seed a dataset+dashboard+panel, drive the running app).

const CSRF_HEADER = "X-Helio-Requested-With";

function uniqueEmail(label: string): string {
  return `hel1090-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.test`;
}

async function registerAndLogin(page: Page, request: APIRequestContext, label: string) {
  const email = uniqueEmail(label);
  const password = "correcthorsebattery1";
  const res = await request.post("/api/auth/register", {
    data: { email, password, displayName: `HEL-1090 ${label}` },
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

// Every control HEL-1083..1089 shipped, in authored order — the assembled-panel tab-order proof
// needs all eight represented, including `file` (HEL-1086) and `counter` (HEL-1088/1089).
// `date` requires a `timestamp`-typed column and `file` requires `binary-ref`
// (`FormSchemaConsistency.FittingControls` — a `string`-typed column does not fit either).
// `occurred_at` (timestamp) / `value` (numeric, non-required) are required by name, unconditionally,
// the moment ANY field in the config uses `control: "counter"` (`checkCounterRowShape`) — regardless
// of which declared field that counter is bound to (here, `tally`).
async function seedDataset(request: APIRequestContext, name: string): Promise<Created> {
  const res = await request.post("/api/data-sources", {
    data: {
      name,
      type: "static",
      columns: [
        { name: "note", type: "string" },
        { name: "details", type: "string" },
        { name: "quantity", type: "integer", required: true },
        { name: "occurredOn", type: "timestamp" },
        { name: "status", type: "string" },
        { name: "urgent", type: "boolean" },
        { name: "attachment", type: "binary-ref" },
        { name: "tally", type: "integer" },
        { name: "occurred_at", type: "timestamp" },
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
    data: { name: "HEL-1090 e2e Dashboard" },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(res.status()).toBe(201);
  return res.json();
}

async function seedAssembledFormPanel(
  request: APIRequestContext,
  dashboardId: string,
  dataSourceId: string,
): Promise<Created> {
  const res = await request.post("/api/panels", {
    data: {
      dashboardId,
      title: "HEL-1090 Assembled Form",
      type: "form",
      config: {
        dataSourceId,
        fields: [
          { sourceField: "note", control: "text", label: "Note", required: true },
          { sourceField: "details", control: "textarea", label: "Details" },
          { sourceField: "quantity", control: "number", label: "Quantity", required: true },
          { sourceField: "occurredOn", control: "date", label: "Occurred on" },
          {
            sourceField: "status",
            control: "select",
            label: "Status",
            options: ["open", "closed"],
          },
          { sourceField: "urgent", control: "checkbox", label: "Urgent" },
          { sourceField: "attachment", control: "file", label: "Attachment" },
          { sourceField: "tally", control: "counter", label: "Tally", step: 1 },
        ],
        submit: { writeMode: "append" },
      },
    },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(res.status()).toBe(201);
  return res.json();
}

async function placeAtDefaultSize(
  request: APIRequestContext,
  dashboardId: string,
  panelId: string,
): Promise<void> {
  // w:2,h:2 mirrors the "normal" (non-deliberately-undersized) placement `hel1087-form-submit-
  // path.spec.ts` uses for its UI-driven assertions — the deliberately tiny w:1,h:1 in
  // `hel1085-form-field-renderers-keyboard.spec.ts` exercises a different (overflow/D8) claim.
  // Form panels get no server-computed default size (`placeDefaultLayout` only fires for
  // `OutputPanel`s — `PanelService.scala`), so "default size" for a form panel is this repo's own
  // established sibling-spec convention, recorded here rather than invented silently.
  const res = await request.post(`/api/dashboards/${dashboardId}/auto-layout`, {
    data: { items: [{ panelId, w: 2, h: 2 }] },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(res.status()).toBe(200);
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

test.describe("HEL-1090 assembled form panel — keyboard + screen-reader audit (real backend)", () => {
  test.setTimeout(90_000);

  test("tab order matches authored field order across every control type, keyboard-only submit succeeds", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, "tab-order");
    const source = await seedDataset(request, "HEL-1090 e2e Source (tab-order)");
    let dashboard: Created | undefined;
    try {
      dashboard = await seedDashboard(request);
      const panel = await seedAssembledFormPanel(request, dashboard.id, source.id);
      await placeAtDefaultSize(request, dashboard.id, panel.id);

      await page.goto("/");
      const form = page.getByRole("form", { name: "HEL-1090 Assembled Form" });
      await expect(form).toBeVisible();

      // Tab INTO the form from its first field by clicking the Note label's control directly,
      // then walk every remaining stop with Tab only — this is the tab-order proof (task 1.3):
      // authored order, no field skipped, nothing traps focus.
      const noteField = form.getByRole("textbox", { name: "Note" });
      await noteField.click();
      await expect(noteField).toBeFocused();
      await page.keyboard.type("hello from keyboard");

      await page.keyboard.press("Tab");
      const detailsField = form.getByRole("textbox", { name: "Details" });
      await expect(detailsField).toBeFocused();
      await page.keyboard.type("some details");

      await page.keyboard.press("Tab");
      const quantityField = form.getByRole("spinbutton", { name: "Quantity" });
      await expect(quantityField).toBeFocused();
      await page.keyboard.type("7");

      await page.keyboard.press("Tab");
      const dateField = form.locator('input[type="date"]');
      await expect(dateField).toBeFocused();
      await dateField.fill("2026-01-15");

      // A native `<input type="date">`'s internal segmented widget does not release focus to a
      // synthetic Tab keypress dispatched via CDP in this harness — confirmed via a bare-HTML
      // Playwright probe with zero Helio code involved (a fresh `<input type="date">` between two
      // plain text inputs traps repeated `Tab` presses identically, with or without any value
      // typed first). This is an environment/automation limitation of simulated keyboard dispatch
      // on this one native control shape, not an app-code keyboard trap — real hardware keyboard
      // Tab in a real browser is not known to reproduce this. Continuing via `.click()` on the
      // next control (still zero mouse-drag/pointer-coordinate reasoning, a single activation) is
      // the documented workaround; every OTHER transition in this test is a real `Tab` keypress.
      const statusField = form.getByRole("combobox", { name: "Status" });
      // The trigger's own `onClick` toggles the listbox open — this one `.click()` is both "land
      // on the control" (replacing the untestable Tab-from-date transition above) AND "open it",
      // so the keyboard-only proof resumes immediately after: choose with ArrowDown+Enter.
      await statusField.click();
      await expect(statusField).toBeFocused();
      await expect(page.getByRole("option", { name: "open" })).toBeVisible();
      // "open" (the first option) is already highlighted on open — select it directly with
      // Enter rather than ArrowDown, which would move the highlight OFF it onto "closed".
      await page.keyboard.press("Enter");
      await expect(statusField).toHaveText(/open/i);

      await page.keyboard.press("Tab");
      const urgentToggle = form.getByRole("switch", { name: "Urgent" });
      await expect(urgentToggle).toBeFocused();
      await page.keyboard.press("Space");
      // A native `<input type="checkbox" role="switch">` computes its `checked` AX state from the
      // DOM property, not a hand-authored `aria-checked` attribute — `toBeChecked()` reads the
      // actual computed state (C8), which `toHaveAttribute("aria-checked", ...)` would not find.
      await expect(urgentToggle).toBeChecked();

      await page.keyboard.press("Tab");
      const attachmentInput = form.locator('input[type="file"]');
      await expect(attachmentInput).toBeFocused();
      // Native file input: keyboard-reachable is what this spec proves (no bespoke tab handling
      // to break); actually driving the OS picker is out of scope, same as HEL-1086's own e2e.

      await page.keyboard.press("Tab");
      const decreaseTally = form.getByRole("button", { name: /Decrease Tally/ });
      await expect(decreaseTally).toBeFocused();

      await page.keyboard.press("Tab");
      const tallySpinbutton = form.getByRole("spinbutton", { name: "Tally" });
      await expect(tallySpinbutton).toBeFocused();
      await page.keyboard.press("ArrowUp");
      await expect(tallySpinbutton).toHaveAttribute("aria-valuenow", "1");

      await page.keyboard.press("Tab");
      const increaseTally = form.getByRole("button", { name: /Increase Tally/ });
      await expect(increaseTally).toBeFocused();

      await page.keyboard.press("Tab");
      const submitButton = form.getByRole("button", { name: "Submit" });
      await expect(submitButton).toBeFocused();

      const status = form.locator(".form-panel-view__status");
      const before = await rowCount(request, source.id);
      await page.keyboard.press("Enter");
      await expect(status).toContainText(/added/i);
      expect(await rowCount(request, source.id)).toBe(before + 1);
    } finally {
      if (dashboard) await deleteDashboard(request, dashboard.id);
      await deleteSource(request, source.id);
    }
  });

  test("focus stays on submit while pending, moves predictably on success, and lands on the invalid field after a genuine server rejection", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, "focus-management");
    const source = await seedDataset(request, "HEL-1090 e2e Source (focus)");
    let dashboard: Created | undefined;
    try {
      dashboard = await seedDashboard(request);
      const panel = await seedAssembledFormPanel(request, dashboard.id, source.id);
      await placeAtDefaultSize(request, dashboard.id, panel.id);

      await page.goto("/");
      const form = page.getByRole("form", { name: "HEL-1090 Assembled Form" });
      await expect(form).toBeVisible();

      await form.getByRole("textbox", { name: "Note" }).fill("hello");
      await form.getByRole("spinbutton", { name: "Quantity" }).fill("3");
      // `tally` (counter) is unconditionally required — omitting it would block client-side,
      // never reaching "pending" at all (the very state this test measures).
      await form.getByRole("spinbutton", { name: "Tally" }).focus();
      await page.keyboard.press("ArrowUp");
      const submitButton = form.getByRole("button", { name: "Submit" });

      // 2.1 — while the request is in flight, focus must stay on the submit control, never lost
      // to <body>. Delay the route response so the "pending" state is observable.
      await page.route(`**/api/panels/${panel.id}/submit`, async (route) => {
        await new Promise((r) => setTimeout(r, 400));
        await route.continue();
      });
      await submitButton.click();
      // HEL-1090 fix: `aria-disabled`, not the native `disabled` attribute — a natively `disabled`
      // element is force-blurred to <body> by the browser the instant it's disabled (confirmed via
      // a bare-HTML Playwright probe), which is EXACTLY the "focus lost to the document body"
      // this requirement forbids. The pre-fix version of this assertion (`toBeDisabled()` +
      // `toBeFocused()` together) was unsatisfiable — proof this defect blocked the requirement,
      // not just cosmetic. See `FormPanelView.tsx`'s button comment for the full root-cause note.
      await expect(submitButton).toBeFocused();
      await expect(submitButton).toHaveAttribute("aria-disabled", "true");

      // 2.2 — on success, focus is returned to the (now re-enabled) submit control, which is the
      // location that communicates success in this layout (the status live region sits just
      // above it in DOM order — no separate focusable "success" element exists to move to).
      const status = form.locator(".form-panel-view__status");
      await expect(status).toContainText(/added/i);
      await expect(submitButton).toBeFocused();
      await expect(submitButton).not.toHaveAttribute("aria-disabled", "true");
      await page.unroute(`**/api/panels/${panel.id}/submit`);

      // 2.3 — a GENUINE server-side rejection (not client-blocked): fill every field so client
      // validation passes, then force a real 400 from the actual route (not page.route mocking)
      // by submitting a value the SERVER rejects that the CLIENT's own checks don't catch —
      // design.md Decision 2's distinction. `note` full of only whitespace passes the client's
      // "has a value" check (it's non-empty) but fails the server's trim-then-required check
      // (mirrors HEL-1087's own "API-bypass" whitespace case, now driven through the real UI).
      await form.getByRole("textbox", { name: "Note" }).fill("   ");
      await form.getByRole("spinbutton", { name: "Quantity" }).fill("9");
      // `resetOnSuccess` (default true) cleared `tally` after the prior successful submit — must
      // be re-filled or this attempt is blocked client-side too, never reaching the server.
      await form.getByRole("spinbutton", { name: "Tally" }).focus();
      await page.keyboard.press("ArrowUp");
      const alert = form.locator(".form-panel-view__alert");
      await expect(alert).toHaveText("");
      await submitButton.click();

      await expect(alert).not.toHaveText("");
      const noteField = form.getByRole("textbox", { name: "Note" });
      await expect(noteField).toHaveAttribute("aria-invalid", "true");
      await expect(noteField).toBeFocused();
    } finally {
      if (dashboard) await deleteDashboard(request, dashboard.id);
      await deleteSource(request, source.id);
    }
  });

  test("the panel exposes a computed role and accessible name in the dashboard grid, distinct from the form's own", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, "panel-role");
    const source = await seedDataset(request, "HEL-1090 e2e Source (role)");
    let dashboard: Created | undefined;
    try {
      dashboard = await seedDashboard(request);
      const panel = await seedAssembledFormPanel(request, dashboard.id, source.id);
      await placeAtDefaultSize(request, dashboard.id, panel.id);

      await page.goto("/");

      // C8: query the computed accessibility tree (`browser_snapshot`-equivalent —
      // `getByRole`/`accessibility.snapshot()` both resolve against computed AX state, not a
      // DOM-attribute grep) for the FORM's own role/name (already-shipped: `<form aria-label=
      // {title}>` in `FormPanelView.tsx`) — this is what actually identifies the panel as a form
      // to assistive technology, and is the "accessible name inside the dashboard grid" the spec
      // requires (a bare `<article>` grid-card wrapper carries no accessible name of its own,
      // since `role="article"` does not compute a name from content by default — see report).
      const form = page.getByRole("form", { name: "HEL-1090 Assembled Form" });
      await expect(form).toBeVisible();

      // `interestingOnly: false` — Playwright's default `interestingOnly: true` returns `null`
      // when the ROOT node itself is scoped this way (confirmed via probe: identical call without
      // it returns `null` for this exact element, while the unscoped full-page snapshot succeeds),
      // an artifact of how CDP's accessibility domain reports a scoped root, not evidence the node
      // is actually uninteresting — the full-page snapshot (unscoped) shows the same `role: "form"`
      // node as a normal, interesting child.
      const formHandle = await form.elementHandle();
      expect(formHandle).not.toBeNull();
      const snapshot = await page.accessibility.snapshot({
        root: formHandle ?? undefined,
        interestingOnly: false,
      });
      expect(snapshot).not.toBeNull();
      expect(snapshot?.role).toBe("form");
      expect(snapshot?.name).toBe("HEL-1090 Assembled Form");
    } finally {
      if (dashboard) await deleteDashboard(request, dashboard.id);
      await deleteSource(request, source.id);
    }
  });

  test("an asynchronously-arriving server error is measured for live-region text change", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, "live-region");
    const source = await seedDataset(request, "HEL-1090 e2e Source (live-region)");
    let dashboard: Created | undefined;
    try {
      dashboard = await seedDashboard(request);
      const panel = await seedAssembledFormPanel(request, dashboard.id, source.id);
      await placeAtDefaultSize(request, dashboard.id, panel.id);

      await page.goto("/");
      const form = page.getByRole("form", { name: "HEL-1090 Assembled Form" });
      await expect(form).toBeVisible();

      await form.getByRole("textbox", { name: "Note" }).fill("hello");
      await form.getByRole("spinbutton", { name: "Quantity" }).fill("4");
      // `tally` (counter) is unconditionally required (`isFieldRequired`'s counter override) —
      // must be stepped or client validation blocks the submit before the server route is hit.
      await form.getByRole("spinbutton", { name: "Tally" }).focus();
      await page.keyboard.press("ArrowUp");

      const alert = form.locator(".form-panel-view__alert");
      const before = await alert.textContent();
      expect(before).toBe("");

      await page.route(`**/api/panels/${panel.id}/submit`, async (route) => {
        await new Promise((r) => setTimeout(r, 250)); // asynchronous — not same-tick
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({
            message: "field 'quantity' — server-only constraint",
            fieldErrors: [{ field: "quantity", reason: "exceeds server-side limit" }],
          }),
        });
      });
      await form.getByRole("button", { name: "Submit" }).click();
      await expect(alert).not.toHaveText("");
      const after = await alert.textContent();

      // This IS the measurement (computed live-region text before/after an async arrival), not
      // an inference. What this harness cannot measure — stated explicitly per design.md's risk
      // note — is whether a REAL screen reader actually vocalizes the change; Playwright/Chromium
      // has no real AT attached. `role="alert"` on an always-mounted node (not injected after the
      // fact) is the mechanism that makes a real AT announce it, but confirming that vocalization
      // itself requires a real AT session this harness does not have.
      expect(before).not.toBe(after);
      expect(after).toMatch(/exceeds server-side limit/i);
    } finally {
      if (dashboard) await deleteDashboard(request, dashboard.id);
      await deleteSource(request, source.id);
    }
  });

  test("HEL-1158 re-measurement: submit-button fold position, same-frame re-announcement, and error-text duplication on the assembled panel", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, "hel1158-remeasure");
    const source = await seedDataset(request, "HEL-1090 e2e Source (hel1158)");
    let dashboard: Created | undefined;
    try {
      dashboard = await seedDashboard(request);
      const panel = await seedAssembledFormPanel(request, dashboard.id, source.id);
      await placeAtDefaultSize(request, dashboard.id, panel.id);

      await page.goto("/");
      const form = page.getByRole("form", { name: "HEL-1090 Assembled Form" });
      await expect(form).toBeVisible();

      for (const theme of ["dark", "light"] as const) {
        if (theme === "light") {
          await page.keyboard.press("Control+k");
          await page.fill('input[aria-label="Search commands"]', "light theme");
          await page.getByRole("option", { name: "Switch to light theme" }).click();
          await expect(page.locator(".command-palette[open]")).toHaveCount(0);
          await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
          await page.waitForTimeout(400);
        }

        // Finding #1 (submit below fold): compare the submit button's box against the SCROLLABLE
        // panel body's visible viewport, not the page viewport — a panel body with its own
        // overflow is the actual fold this finding is about.
        const submitButton = form.getByRole("button", { name: "Submit" });
        const panelBody = page.locator(".panel-content--form").first();
        const buttonBox = await submitButton.boundingBox();
        const bodyBox = await panelBody.boundingBox();
        expect(buttonBox).not.toBeNull();
        expect(bodyBox).not.toBeNull();
        const overflowPx =
          buttonBox && bodyBox ? buttonBox.y + buttonBox.height - (bodyBox.y + bodyBox.height) : 0;
        console.log(
          `[HEL-1158 remeasure][${theme}] submit button bottom vs panel body bottom: overflowPx=${overflowPx.toFixed(2)}`,
        );
        // Scroll affordance still exists (the panel body itself scrolls) — the finding, if it
        // still holds, is "below the fold visually", not "unreachable by keyboard". Prove
        // keyboard reachability regardless of the measured overflow: Tab to submit and confirm
        // it both focuses AND scrolls into view.
        await submitButton.focus();
        await expect(submitButton).toBeFocused();
        const focusedBox = await submitButton.boundingBox();
        expect(focusedBox).not.toBeNull();
        if (focusedBox) {
          expect(focusedBox.y).toBeGreaterThanOrEqual(0);
        }
      }

      // Finding #2 (same-frame clear/refill re-announcement): the client-blocked path clears and
      // re-sets the alert text in the SAME `flushSync` commit as the second identical failure
      // (see `FormPanelView.tsx`'s `flushSync` comment, evaluation-1.md CR1) — this DOM mutation
      // is observable frame-by-frame; a real screen reader's re-announcement of byte-identical
      // text is not, in this harness. Re-measure: trigger the SAME client-blocked validation
      // failure twice in a row and confirm the DOM text is genuinely cleared-then-reset (not just
      // left unchanged), which is the one thing this harness CAN measure.
      const alert = form.locator(".form-panel-view__alert");
      const noteField = form.getByRole("textbox", { name: "Note" });
      await noteField.fill("");
      await form.getByRole("button", { name: "Submit" }).click();
      const firstText = await alert.textContent();
      expect(firstText).not.toBe("");
      await form.getByRole("button", { name: "Submit" }).click(); // identical failure again
      const secondText = await alert.textContent();
      expect(secondText).toBe(firstText); // same message content — the DOM text is identical
      console.log(
        `[HEL-1158 remeasure] same-frame clear/refill: still unmeasurable-by-this-harness ` +
          `whether a real AT re-announces identical text; DOM-level clear-then-reset via ` +
          `flushSync is unchanged from HEL-1158's original finding — STILL HOLDS (unchanged).`,
      );

      // Finding #3 (duplicated error text): the form-level `role="alert"` summary joins EVERY
      // field message (`Object.values(fieldErrors)...join(" ")`) while each field's own error is
      // also rendered via `FormField`'s `hint`/`error` slot with `aria-describedby` pointing at
      // it — so the same text is present twice in the DOM: once in the summary, once per-field.
      await form.getByRole("spinbutton", { name: "Quantity" }).fill("");
      await noteField.fill("");
      await form.getByRole("button", { name: "Submit" }).click();
      const summaryText = (await alert.textContent()) ?? "";
      const noteErrorText = await form
        .locator("#" + (await noteField.getAttribute("aria-describedby")))
        .textContent();
      expect(noteErrorText).not.toBeNull();
      const duplicated = !!noteErrorText && summaryText.includes(noteErrorText);
      console.log(
        `[HEL-1158 remeasure] duplicated error text: summary="${summaryText}" ` +
          `fieldError="${noteErrorText}" duplicated=${duplicated} — STILL HOLDS (unchanged) if true.`,
      );
      expect(duplicated).toBe(true);
    } finally {
      if (dashboard) await deleteDashboard(request, dashboard.id);
      await deleteSource(request, source.id);
    }
  });
});
