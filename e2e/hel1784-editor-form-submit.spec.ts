import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import { currentUserId, registerUser, type Credentials } from "./support/auth";

// HEL-1784 -- a dashboard EDITOR submits its form panels; a viewer and a stranger cannot.
//   The owner's ruling: a user with edit access to a dashboard can submit its forms. The server admits the dashboard's
//   owner and editors (`POST /api/panels/:id/submit`), writes the row onto the FORM OWNER's source, and omits each row's
//   `seq` for anyone but the form's owner. A user who is not the form's owner may not read the dataset: their form loads
//   the bound fields from `GET /api/panels/:id/form-schema` and a counter shows only their own clicks, so the editor's
//   page must never request /api/data-sources/*.
// The grants go through the real `POST /api/dashboards/:id/permissions` with an explicit granteeId (an omitted one
// writes a PUBLIC grant and would void the test). Users are registered over the API and deleted by exact id in the
// run's global teardown.

const CSRF = { "X-Helio-Requested-With": "1" };
const DEV_PORT = process.env.DEV_PORT ?? "5173";
const BASE_URL = `http://localhost:${DEV_PORT}`;
const RUN = Date.now();
const FORM_TITLE = `HEL1784 note form ${RUN}`;
const COUNTER_TITLE = `HEL1784 counter ${RUN}`;

interface Actor {
  context: BrowserContext;
  page: Page;
  id: string;
  credentials: Credentials;
}

async function newActor(browser: Browser, label: string): Promise<Actor> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  const credentials = await registerUser(context.request, {
    prefix: "hel1784",
    label,
    displayName: "HEL1784",
  });
  const id = await currentUserId(context.request);
  const page = await context.newPage();
  return { context, page, id, credentials };
}

async function postJson<T>(
  request: APIRequestContext,
  url: string,
  data: unknown,
  status: number,
): Promise<T> {
  const res = await request.post(url, { data, headers: CSRF });
  expect(res.status(), `${url}: ${await res.text()}`).toBe(status);
  return (await res.json()) as T;
}

async function rowTotal(request: APIRequestContext, sourceId: string): Promise<number> {
  const res = await request.get(`/api/data-sources/${sourceId}/rows`);
  expect(res.status()).toBe(200);
  return ((await res.json()) as { total: number }).total;
}

/** Records every request to /api/data-sources and every console error from `watch()` on. */
function watchPage(page: Page) {
  const dataSourceRequests: string[] = [];
  const consoleErrors: string[] = [];
  const onRequest = (request: { url(): string; method(): string }) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith("/api/data-sources")) {
      dataSourceRequests.push(`${request.method()} ${pathname}`);
    }
  };
  const onConsole = (message: { type(): string; text(): string }) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  };
  page.on("request", onRequest);
  page.on("console", onConsole);
  return {
    stop() {
      page.off("request", onRequest);
      page.off("console", onConsole);
      return { dataSourceRequests, consoleErrors };
    },
  };
}

let owner: Actor;
let editor: Actor;
let viewer: Actor;
let stranger: Actor;
let dashboardId: string;
let noteSourceId: string;
let counterSourceId: string;
let noteFormId: string;
let counterFormId: string;

test.describe("HEL-1784 editors submit form panels", () => {
  test.beforeAll(async ({ browser }) => {
    owner = await newActor(browser, "owner");
    editor = await newActor(browser, "editor");
    viewer = await newActor(browser, "viewer");
    stranger = await newActor(browser, "stranger");
    const api = owner.context.request;

    const noteSource = await postJson<{ id: string }>(
      api,
      "/api/data-sources",
      {
        name: `HEL1784 notes ${RUN}`,
        type: "static",
        columns: [
          { name: "note", type: "string", required: true },
          { name: "secret", type: "string" },
        ],
        rows: [],
      },
      201,
    );
    noteSourceId = noteSource.id;
    const counterSource = await postJson<{ id: string }>(
      api,
      "/api/data-sources",
      {
        name: `HEL1784 counts ${RUN}`,
        type: "static",
        columns: [
          { name: "occurred_at", type: "timestamp" },
          { name: "delta", type: "integer", required: true },
          { name: "value", type: "integer" },
        ],
        rows: [],
      },
      201,
    );
    counterSourceId = counterSource.id;
    dashboardId = (
      await postJson<{ id: string }>(api, "/api/dashboards", { name: `HEL1784 board ${RUN}` }, 201)
    ).id;
    noteFormId = (
      await postJson<{ id: string }>(
        api,
        "/api/panels",
        {
          dashboardId,
          title: FORM_TITLE,
          type: "form",
          config: {
            dataSourceId: noteSourceId,
            fields: [{ sourceField: "note", control: "text", label: "Note", required: true }],
            submit: { writeMode: "append" },
          },
        },
        201,
      )
    ).id;
    counterFormId = (
      await postJson<{ id: string }>(
        api,
        "/api/panels",
        {
          dashboardId,
          title: COUNTER_TITLE,
          type: "form",
          config: {
            dataSourceId: counterSourceId,
            fields: [{ sourceField: "delta", control: "counter", label: "Widgets", step: 5 }],
            submit: { writeMode: "append", resetOnSuccess: false },
          },
        },
        201,
      )
    ).id;
    await postJson(
      api,
      `/api/dashboards/${dashboardId}/permissions`,
      { granteeId: editor.id, role: "editor" },
      201,
    );
    await postJson(
      api,
      `/api/dashboards/${dashboardId}/permissions`,
      { granteeId: viewer.id, role: "viewer" },
      201,
    );
  });

  test.afterAll(async () => {
    const api = owner.context.request;
    await api.delete(`/api/dashboards/${dashboardId}`, { headers: CSRF });
    await api.delete(`/api/data-sources/${noteSourceId}`, { headers: CSRF });
    await api.delete(`/api/data-sources/${counterSourceId}`, { headers: CSRF });
    await Promise.all([owner, editor, viewer, stranger].map((a) => a.context.close()));
  });

  test("an editor submits the note form through the UI and the row lands on the owner's source", async () => {
    const watch = watchPage(editor.page);
    const before = await rowTotal(owner.context.request, noteSourceId);
    await editor.page.goto(`/dashboards/${dashboardId}`);
    const form = editor.page.getByRole("form", { name: FORM_TITLE });
    await expect(form).toBeVisible();
    await form.getByRole("textbox", { name: "Note" }).fill("from the editor");
    await form.getByRole("button", { name: "Submit" }).click();
    await expect(editor.page.getByText("The row was added.")).toBeVisible();

    await expect.poll(() => rowTotal(owner.context.request, noteSourceId)).toBe(before + 1);
    const seen = watch.stop();
    expect(seen.dataSourceRequests, "editor's page requests to /api/data-sources").toEqual([]);
    expect(seen.consoleErrors, "console errors").toEqual([]);
  });

  test("an editor's compact counter is enabled and + lands a row, with no dataset read", async () => {
    const watch = watchPage(editor.page);
    const before = await rowTotal(owner.context.request, counterSourceId);
    await editor.page.goto(`/dashboards/${dashboardId}`);
    const control = editor.page.getByRole("spinbutton", { name: "Widgets" });
    await expect(control).toBeVisible();
    const plus = editor.page.getByRole("button", { name: /increase widgets/i });
    await expect(plus).toBeEnabled();
    await plus.click();

    await expect(control).toHaveAttribute("aria-valuenow", "5");
    await expect.poll(() => rowTotal(owner.context.request, counterSourceId)).toBe(before + 1);
    const seen = watch.stop();
    expect(seen.dataSourceRequests, "editor's page requests to /api/data-sources").toEqual([]);
  });

  test("a direct submit: the owner's response carries seq, the editor's does not", async () => {
    const asOwner = await owner.context.request.post(`/api/panels/${noteFormId}/submit`, {
      data: { values: { note: "owner row" } },
      headers: CSRF,
    });
    expect(asOwner.status()).toBe(201);
    const ownerRows = ((await asOwner.json()) as { rows: Array<Record<string, unknown>> }).rows;
    expect(Object.keys(ownerRows[0]).sort()).toEqual(["id", "seq", "updatedAt"]);

    const asEditor = await editor.context.request.post(`/api/panels/${noteFormId}/submit`, {
      data: { values: { note: "editor row" } },
      headers: CSRF,
    });
    expect(asEditor.status()).toBe(201);
    const editorRows = ((await asEditor.json()) as { rows: Array<Record<string, unknown>> }).rows;
    expect(Object.keys(editorRows[0]).sort()).toEqual(["id", "updatedAt"]);
  });

  test("a viewer sees no submit control and a direct submit is 403", async () => {
    const before = await rowTotal(owner.context.request, noteSourceId);
    await viewer.page.goto(`/dashboards/${dashboardId}`);
    await expect(viewer.page.getByText("Only editors can submit this form").first()).toBeVisible();
    await expect(viewer.page.getByRole("button", { name: "Submit" })).toHaveCount(0);
    await expect(viewer.page.getByRole("spinbutton", { name: "Widgets" })).toHaveCount(0);

    const res = await viewer.context.request.post(`/api/panels/${noteFormId}/submit`, {
      data: { values: { note: "viewer row" } },
      headers: CSRF,
    });
    expect(res.status()).toBe(403);
    expect(await rowTotal(owner.context.request, noteSourceId)).toBe(before);
  });

  test("a stranger sees Dashboard not found and a direct submit is 404", async () => {
    const before = await rowTotal(owner.context.request, counterSourceId);
    await stranger.page.goto(`/dashboards/${dashboardId}`);
    await expect(stranger.page.getByText("Dashboard not found")).toBeVisible();

    const submit = await stranger.context.request.post(`/api/panels/${counterFormId}/submit`, {
      data: { values: { delta: 5 } },
      headers: CSRF,
    });
    expect(submit.status()).toBe(404);
    const schema = await stranger.context.request.get(`/api/panels/${counterFormId}/form-schema`);
    expect(schema.status()).toBe(404);
    expect(await rowTotal(owner.context.request, counterSourceId)).toBe(before);
  });

  test("the form-schema route returns only the bound fields to an editor, and 403 to a viewer", async () => {
    const asEditor = await editor.context.request.get(`/api/panels/${noteFormId}/form-schema`);
    expect(asEditor.status()).toBe(200);
    const fields = ((await asEditor.json()) as { fields: Array<{ name: string }> }).fields;
    expect(fields.map((f) => f.name)).toEqual(["note"]);
    const asViewer = await viewer.context.request.get(`/api/panels/${noteFormId}/form-schema`);
    expect(asViewer.status()).toBe(403);
  });
});
