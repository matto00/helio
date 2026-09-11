import { expect, test, type APIRequestContext, type Page, type Request } from "@playwright/test";

// HEL-1080 skeptic-final-3.md CR-G — the owner condition this round attached: real Playwright
// e2e specs driving the ACTUAL backend (not a jest mock), for the three cases round 2's evaluator
// PASS rested on mocked evidence for. Each test seeds its own dataset ("static"-kind) source
// through the API and tears it down in the same test (a `finally`, so cleanup runs even on
// failure) — no shared fixture, no cross-test state.
const CSRF_HEADER = "X-Helio-Requested-With";

function uniqueEmail(label: string): string {
  return `hel1080-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.test`;
}

async function registerAndLogin(page: Page, request: APIRequestContext, label: string) {
  const email = uniqueEmail(label);
  const password = "correcthorsebattery1";
  await request.post("/api/auth/register", {
    data: { email, password, displayName: `HEL-1080 ${label}` },
    headers: { [CSRF_HEADER]: "1" },
  });
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL("/");
  await expect(page.getByRole("button", { name: "Add dashboard" })).toBeVisible();
}

interface CreatedSource {
  id: string;
}

async function createDatasetSource(
  request: APIRequestContext,
  name: string,
  columns: unknown[],
  rows: unknown[][],
): Promise<CreatedSource> {
  const res = await request.post("/api/data-sources", {
    data: { name, type: "static", columns, rows },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(res.status()).toBe(201);
  return res.json();
}

async function deleteSource(request: APIRequestContext, id: string): Promise<void> {
  await request.delete(`/api/data-sources/${id}`, { headers: { [CSRF_HEADER]: "1" } });
}

async function goToSource(page: Page, id: string) {
  await page.goto(`/sources/${id}`);
  await page.waitForSelector('td[role="gridcell"]', { timeout: 20_000 });
}

test.describe("HEL-1080 dataset row grid — real backend (skeptic-final-3.md CR-G)", () => {
  test.setTimeout(60_000);

  // Case (a): a row deleted by another client, then edited by this one, must hit the REAL 404
  // path (HEL-1078 D5: RowMutationFailure.RowNotFound -> ServiceError.NotFound) and render the
  // "already deleted" recovery UI -- DISTINCT from a 409 stale-value conflict, which shows
  // current-value/Retry instead.
  test("editing a row concurrently deleted by another client shows the 404 'already deleted' recovery UI, not a 409 conflict", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, "concurrent-delete");
    const source = await createDatasetSource(
      request,
      "HEL-1080 e2e concurrent-delete",
      [{ name: "name", type: "string", required: true }],
      [["r0"], ["r1"]],
    );
    try {
      await goToSource(page, source.id);

      const rowsBefore = await request
        .get(`/api/data-sources/${source.id}/rows`)
        .then((r) => r.json());
      const targetRow = rowsBefore.rows[0];

      const cell = page.locator(`td[data-grid-row-id="${targetRow.id}"][data-grid-col-key="name"]`);
      await cell.click();

      // A second client deletes the SAME row out from under the grid.
      const deleteRes = await request.delete(
        `/api/data-sources/${source.id}/rows/${targetRow.id}?updatedAt=${encodeURIComponent(targetRow.updatedAt)}`,
        { headers: { [CSRF_HEADER]: "1" } },
      );
      expect(deleteRes.status()).toBe(204);

      const patchResponse = page.waitForResponse(
        (r) => r.url().includes(`/rows/${targetRow.id}`) && r.request().method() === "PATCH",
      );
      await page.keyboard.press("Enter");
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.type("EDIT-ON-DELETED");
      await page.keyboard.press("Enter");

      // The REAL backend status for this case -- the whole point of this spec.
      expect((await patchResponse).status()).toBe(404);

      const alert = page.locator('[role="alert"]', { hasText: "already deleted" });
      await expect(alert).toBeVisible();
      // Never the 409 stale-value conflict UI (which shows "changed concurrently" + Retry).
      await expect(page.getByText("changed concurrently")).toHaveCount(0);
      await expect(page.getByRole("button", { name: /Retry/ })).toHaveCount(0);
      // The phantom row is removed from the grid entirely.
      await expect(page.locator(`td[data-grid-row-id="${targetRow.id}"]`)).toHaveCount(0);

      // Discard, via keyboard, clears the banner and leaves focus on a real gridcell (CR-D).
      const discardBtn = page.getByRole("button", { name: "Discard" });
      await discardBtn.focus();
      await page.keyboard.press("Enter");
      await expect(page.locator('[role="alert"]', { hasText: "already deleted" })).toHaveCount(0);
      // Focus-return is deferred a frame past the state update (see `focusActiveCell` in
      // DatasetRowGrid.tsx) -- poll rather than asserting on a single, possibly-premature tick.
      await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe("TD");
    } finally {
      await deleteSource(request, source.id);
    }
  });

  // Case (b): add-row on a schema with a required field and no declared default must actually
  // succeed -- the real DatasetRowValidator 400s an all-null append for such a schema, which is
  // exactly the bug this spec exists to catch if it regresses.
  test("add row succeeds on a schema with a required field and no default, driven entirely by keyboard", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, "add-row-required");
    const source = await createDatasetSource(
      request,
      "HEL-1080 e2e add-row-required",
      [
        { name: "name", type: "string", required: true },
        { name: "qty", type: "integer" },
      ],
      [["seed", 1]],
    );
    try {
      await goToSource(page, source.id);

      const addRowButton = page.getByRole("button", { name: "Add row" });
      await addRowButton.focus();
      await page.keyboard.press("Enter");
      await expect(page.locator(".dataset-row-grid__draft")).toBeVisible();
      // skeptic-final-3.md CR-H: opening the form via keyboard moves focus INTO it (the first
      // field), not to `<body>`.
      await expect(page.locator("#dataset-row-grid__draft-name")).toBeFocused();

      // Saving with the required field blank must be blocked client-side -- no request at all.
      let sawPost = false;
      const requestGuard = (r: Request) => {
        if (r.url().includes(`/data-sources/${source.id}/rows`) && r.method() === "POST") {
          sawPost = true;
        }
      };
      page.on("request", requestGuard);
      const nameInput = page.locator("#dataset-row-grid__draft-name");
      await nameInput.focus();
      // Tab to Save row and press it while name is still blank.
      let tabs = 0;
      while (
        (await page.evaluate(() => document.activeElement?.textContent)) !== "Save row" &&
        tabs < 10
      ) {
        await page.keyboard.press("Tab");
        tabs++;
      }
      await page.keyboard.press("Enter");
      await expect(page.getByText(/is required and has no default/)).toBeVisible();
      expect(sawPost).toBe(false);
      page.off("request", requestGuard);

      // Now fill it in via the keyboard and save for real.
      await nameInput.focus();
      await page.keyboard.type("NEWROW");
      await page.keyboard.press("Tab");
      await page.keyboard.type("42");
      tabs = 0;
      while (
        (await page.evaluate(() => document.activeElement?.textContent)) !== "Save row" &&
        tabs < 10
      ) {
        await page.keyboard.press("Tab");
        tabs++;
      }
      const postResponse = page.waitForResponse(
        (r) =>
          r.url().includes(`/data-sources/${source.id}/rows`) && r.request().method() === "POST",
      );
      await page.keyboard.press("Enter");
      expect((await postResponse).status()).toBe(200);

      // skeptic-final-3.md CR-H: a successful Save leaves focus on a deliberate target (the
      // "Add row" button), never nowhere.
      await expect(addRowButton).toBeFocused();
      await expect(page.locator('td[role="gridcell"]', { hasText: "NEWROW" })).toBeVisible();
      const rowsAfter = await request
        .get(`/api/data-sources/${source.id}/rows`)
        .then((r) => r.json());
      expect(rowsAfter.total).toBe(2);
    } finally {
      await deleteSource(request, source.id);
    }
  });

  // Case (c): pager state (the "Page N" label, Prev/Next enabled-state) must stay consistent
  // with the page actually rendered after an add-row on a multi-page dataset.
  test("pager state stays correct after an add-row lands on page 2", async ({ page, request }) => {
    await registerAndLogin(page, request, "pager-after-add");
    const rows = Array.from({ length: 100 }, (_, i) => [`p${i}`, i]);
    const source = await createDatasetSource(
      request,
      "HEL-1080 e2e pager-after-add",
      [
        { name: "label", type: "string" },
        { name: "n", type: "integer" },
      ],
      rows,
    );
    try {
      await goToSource(page, source.id);
      await expect(page.locator(".dataset-row-grid__pager span")).toHaveText("Page 1");

      await page.getByRole("button", { name: "Add row" }).click();
      await page.locator("#dataset-row-grid__draft-label").fill("ADDED");
      await page.locator("#dataset-row-grid__draft-n").fill("999");
      const postResponse = page.waitForResponse(
        (r) =>
          r.url().includes(`/data-sources/${source.id}/rows`) && r.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Save row" }).click();
      await postResponse;

      // The new row is the 101st -- it lands on page 2, and the pager must say so.
      await expect(page.locator(".dataset-row-grid__pager span")).toHaveText("Page 2");
      await expect(page.locator('td[role="gridcell"]', { hasText: "ADDED" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Prev" })).toBeEnabled();
      await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();

      // Prev actually works and matches page 1's real content.
      await page.getByRole("button", { name: "Prev" }).click();
      await expect(page.locator(".dataset-row-grid__pager span")).toHaveText("Page 1");
      await expect(page.locator('td[role="gridcell"]', { hasText: "p0" }).first()).toBeVisible();

      // Refresh from page 1 stays on page 1 (does not jump to a stale cursor).
      await page.getByRole("button", { name: "Refresh" }).click();
      await expect(page.locator(".dataset-row-grid__pager span")).toHaveText("Page 1");
    } finally {
      await deleteSource(request, source.id);
    }
  });

  // skeptic-final-4.md CR-J: cycle 5's "successful Save returns focus to the Add row button" fix
  // only worked because the mocked/localhost POST resolved near-instantly. Under any real
  // latency, "Add row" was still natively `disabled` (only cleared in a `.finally` that runs
  // AFTER the `.then()`'s focus call) at the moment `.focus()` ran, which silently no-ops on a
  // disabled element -- reproduced live 6/6 at 300-800ms by the skeptic. This test delays the
  // REAL POST response (via `page.route` + a timeout before `route.continue()`, not a mock) to
  // force that exact race, against the real backend.
  test("a successful add-row Save under injected network latency still leaves focus on the 'Add row' button (CR-J)", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, "add-row-latency");
    const source = await createDatasetSource(
      request,
      "HEL-1080 e2e add-row-latency",
      [{ name: "name", type: "string", required: false }],
      [["seed"]],
    );
    try {
      await goToSource(page, source.id);

      // Delay only the row-append POST -- every other request (including the page's own initial
      // load) continues immediately, so this isolates the exact race without slowing the whole
      // test down.
      await page.route(`**/data-sources/${source.id}/rows`, async (route) => {
        if (route.request().method() === "POST") {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        await route.continue();
      });

      const addRowButton = page.getByRole("button", { name: "Add row" });
      await addRowButton.click();
      await page.locator("#dataset-row-grid__draft-name").fill("LATENCY-ROW");

      const postResponse = page.waitForResponse(
        (r) =>
          r.url().includes(`/data-sources/${source.id}/rows`) && r.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Save row" }).click();
      expect((await postResponse).status()).toBe(200);

      await expect(page.locator('td[role="gridcell"]', { hasText: "LATENCY-ROW" })).toBeVisible();
      // The actual assertion this test exists for.
      await expect(addRowButton).toBeFocused();
    } finally {
      await page.unroute(`**/data-sources/${source.id}/rows`);
      await deleteSource(request, source.id);
    }
  });
});
