import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// HEL-1079 tasks.md 4.1-4.4 — real Playwright e2e driving the ACTUAL backend (not a jest mock),
// mirroring HEL-1080's own template (e2e/hel1080-dataset-row-grid-live.spec.ts). Each test
// creates its own resources through the UI (real keyboard input, not fixture-injected state) and
// tears down what it created in a `finally`.
const CSRF_HEADER = "X-Helio-Requested-With";

function uniqueEmail(label: string): string {
  return `hel1079-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.test`;
}

async function registerAndLogin(page: Page, request: APIRequestContext, label: string) {
  const email = uniqueEmail(label);
  const password = "correcthorsebattery1";
  await request.post("/api/auth/register", {
    data: { email, password, displayName: `HEL-1079 ${label}` },
    headers: { [CSRF_HEADER]: "1" },
  });
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL("/");
  await expect(page.getByRole("button", { name: "Add dashboard" })).toBeVisible();
}

async function deleteSource(request: APIRequestContext, id: string): Promise<void> {
  await request.delete(`/api/data-sources/${id}`, { headers: { [CSRF_HEADER]: "1" } });
}

interface CreatedSource {
  id: string;
}

async function createDatasetSourceViaApi(
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

test.describe("HEL-1079 dataset management UI — real backend", () => {
  test.setTimeout(60_000);

  // task 4.1: create a dataset with 3+ fields (a required field with a default, and a
  // non-legacy canonical type) via real keyboard input, then verify the created schema.
  test("creates a dataset with 3 fields via keyboard input and the declared schema matches", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, "create");
    const datasetName = `HEL-1079 e2e create ${Date.now()}`;
    let createdId: string | null = null;

    try {
      await page.goto("/sources");
      await page.locator("#app-main-content").getByRole("button", { name: "Add source" }).click();
      await page.getByRole("button", { name: "Manual" }).click();

      await page.getByLabel("Source name").fill(datasetName);

      // Field 1: string, required with a default.
      await page.getByLabel("Field 1 name").fill("id");
      await page.getByLabel("Field 1 required").check();
      await page.getByLabel("Field 1 default value").fill("unassigned");

      // Field 2: a non-legacy canonical type (timestamp), added via keyboard.
      await page.getByRole("button", { name: "+ Add field" }).click();
      await page.getByLabel("Field 2 name").fill("seenAt");
      await page.getByRole("combobox", { name: "Field 2 type" }).click();
      await page.getByRole("option", { name: "timestamp", exact: true }).click();

      // Field 3: an optional string field.
      await page.getByRole("button", { name: "+ Add field" }).click();
      await page.getByLabel("Field 3 name").fill("notes");

      await page.getByRole("button", { name: "Next: Add rows" }).click();
      await page.getByRole("button", { name: "Create source" }).click();

      await expect(page.getByText(`Data source "${datasetName}" created.`).first()).toBeVisible();

      const sourcesRes = await request.get("/api/data-sources");
      const sources = (await sourcesRes.json()).items as Array<{ id: string; name: string }>;
      const created = sources.find((s) => s.name === datasetName);
      expect(created).toBeDefined();
      createdId = created!.id;

      const schemaRes = await request.get(`/api/data-sources/${createdId}/schema`);
      expect(schemaRes.status()).toBe(200);
      const schema = await schemaRes.json();
      expect(schema.fields).toEqual([
        { name: "id", type: "string", required: true, default: "unassigned" },
        { name: "seenAt", type: "timestamp", required: false },
        { name: "notes", type: "string", required: false },
      ]);
    } finally {
      if (createdId) await deleteSource(request, createdId);
    }
  });

  // task 4.2: retype an existing field to an incompatible type against a stored row value; the
  // UI must surface the 409 reason inline without closing the editor or losing the in-progress
  // edit.
  test("retyping a field to an incompatible type surfaces the 409 reason inline, editor stays open", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, "retype-reject");
    const source = await createDatasetSourceViaApi(
      request,
      `HEL-1079 e2e retype-reject ${Date.now()}`,
      [{ name: "label", type: "string", required: false }],
      [["not-a-number"]],
    );

    try {
      await page.goto(`/sources/${source.id}`);
      await page.waitForSelector('td[role="gridcell"]', { timeout: 20_000 });

      await page.getByRole("combobox", { name: "Field 1 type" }).click();
      await page.getByRole("option", { name: "integer", exact: true }).click();
      await page.getByRole("button", { name: "Save schema" }).click();

      await expect(page.getByText(/do not satisfy the new type/i)).toBeVisible();
      // Editor stays open with the in-progress retype intact.
      await expect(page.getByRole("combobox", { name: "Field 1 type" })).toHaveText("integer");
    } finally {
      await deleteSource(request, source.id);
    }
  });

  // task 4.3: drop a field on a dataset with existing rows, confirm the dialog, and verify (a)
  // the request carried confirmDrop: true, and (b) the row's value for that field is gone.
  test("dropping a field on a non-empty dataset requires confirmation, then the field's data is gone", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, "drop-confirm");
    const source = await createDatasetSourceViaApi(
      request,
      `HEL-1079 e2e drop-confirm ${Date.now()}`,
      [
        { name: "keep", type: "string", required: false },
        { name: "drop_me", type: "string", required: false },
      ],
      [["kept-value", "doomed-value"]],
    );

    try {
      await page.goto(`/sources/${source.id}`);
      await page.waitForSelector('td[role="gridcell"]', { timeout: 20_000 });

      await page.getByLabel("Remove field 2").click();
      await expect(page.getByText(/permanently delete "drop_me"/i)).toBeVisible();

      const patchRequestPromise = page.waitForRequest(
        (r) => r.url().includes(`/api/data-sources/${source.id}/schema`) && r.method() === "PATCH",
      );
      await page.getByRole("button", { name: "Delete field data" }).click();
      const patchRequest = await patchRequestPromise;
      const body = patchRequest.postDataJSON();
      expect(body.confirmDrop).toBe(true);

      await expect(page.getByText(/schema updated/i).first()).toBeVisible();

      // evaluation-1.md CR1 regression: the on-screen field table must reflect the drop
      // immediately once the PATCH succeeds -- never only after a hard reload.
      await expect(page.getByLabel("Field 1 name")).toHaveValue("keep");
      await expect(page.getByLabel("Remove field 2")).not.toBeVisible();

      // evaluation-1.md CR2 / design.md Decision 6 regression: focus must land on the next
      // remaining field's name input after confirming, never lost to <body>.
      await expect(page.getByLabel("Field 1 name")).toBeFocused();

      const schemaRes = await request.get(`/api/data-sources/${source.id}/schema`);
      const schema = await schemaRes.json();
      expect(schema.fields.map((f: { name: string }) => f.name)).toEqual(["keep"]);

      const rowsRes = await request.get(`/api/data-sources/${source.id}/rows`);
      const rowsBody = await rowsRes.json();
      expect(rowsBody.rows[0].data).toEqual(["kept-value"]);
    } finally {
      await deleteSource(request, source.id);
    }
  });

  // task 4.4: attempt to add a required field with no default to a non-empty dataset; submit
  // must be disabled with an inline reason and NO request sent.
  test("adding a required field with no default to a non-empty dataset blocks submit, no request sent", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, "block-required");
    const source = await createDatasetSourceViaApi(
      request,
      `HEL-1079 e2e block-required ${Date.now()}`,
      [{ name: "existing", type: "string", required: false }],
      [["value"]],
    );

    try {
      await page.goto(`/sources/${source.id}`);
      await page.waitForSelector('td[role="gridcell"]', { timeout: 20_000 });

      await page.getByRole("button", { name: "+ Add field" }).click();
      await page.getByLabel("Field 2 name").fill("mustHave");
      await page.getByLabel("Field 2 required").check();

      await expect(page.getByText(/is required with no default value/i)).toBeVisible();
      await expect(page.getByRole("button", { name: "Save schema" })).toBeDisabled();

      let patchSent = false;
      page.on("request", (r) => {
        if (r.url().includes(`/api/data-sources/${source.id}/schema`) && r.method() === "PATCH") {
          patchSent = true;
        }
      });
      // Give any in-flight request a moment to fire, if the guard were broken.
      await page.waitForTimeout(500);
      expect(patchSent).toBe(false);
    } finally {
      await deleteSource(request, source.id);
    }
  });

  // skeptic-final-1.md CR1: combining a retype (incompatible, so the whole edit is rejected) with
  // a confirmed drop in the SAME submission — the ready-made repro from the report. The server
  // rejects the whole request atomically; the UI must never present the drop as applied.
  test("a confirmed drop combined with a rejected retype in the same submission leaves BOTH fields on screen", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, "combined-retype-drop-reject");
    const source = await createDatasetSourceViaApi(
      request,
      `HEL-1079 e2e combined-reject ${Date.now()}`,
      [
        { name: "label", type: "string", required: false },
        { name: "drop_me", type: "string", required: false },
      ],
      [["not-a-number", "doomed"]],
    );

    try {
      await page.goto(`/sources/${source.id}`);
      await page.waitForSelector('td[role="gridcell"]', { timeout: 20_000 });

      // Retype field 1 to an incompatible type first (queued, not yet submitted).
      await page.getByRole("combobox", { name: "Field 1 type" }).click();
      await page.getByRole("option", { name: "integer", exact: true }).click();

      // Then remove field 2 and confirm the drop — this is what actually submits (task 2.3's
      // "on confirm, submit"), carrying the still-pending retype along with it.
      await page.getByLabel("Remove field 2").click();
      await expect(page.getByText(/permanently delete "drop_me"/i)).toBeVisible();
      await page.getByRole("button", { name: "Delete field data" }).click();

      // Server rejects the WHOLE request (the retype is incompatible) -- nothing is applied.
      await expect(page.getByText(/do not satisfy the new type/i)).toBeVisible();

      // Both fields remain on screen -- the drop must never be presented as applied when the
      // server rejected the combined edit.
      await expect(page.getByLabel("Field 1 name")).toHaveValue("label");
      await expect(page.getByLabel("Field 2 name")).toHaveValue("drop_me");
      await expect(page.getByLabel("Remove field 2")).toBeVisible();

      // Server-side truth, independently verified: both fields still present.
      const schemaRes = await request.get(`/api/data-sources/${source.id}/schema`);
      const schema = await schemaRes.json();
      expect(schema.fields.map((f: { name: string }) => f.name)).toEqual(["label", "drop_me"]);

      // Recoverable: the field's own Remove button still works to re-trigger the confirm dialog.
      await page.getByLabel("Remove field 2").click();
      await expect(page.getByText(/permanently delete "drop_me"/i)).toBeVisible();
    } finally {
      await deleteSource(request, source.id);
    }
  });
});
