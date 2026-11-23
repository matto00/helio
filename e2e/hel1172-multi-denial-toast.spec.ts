import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { registerAndLogin } from "./support/auth";
import { bisectHitExtent } from "./support/touchTargetProbe";

// HEL-1172 — live-browser proof of the multi-denial toast: ONE dataset write denying TWO pipelines
// shows one persistent toast whose rows link to each pipeline's page and carry their own
// "Run to update". Denial mechanism is hel1096's: 21 enabled no-op `assert` steps per pipeline
// (`steps-above-bound`) -- deliberately not an AI step, so a real manual run never needs a model.
test.describe("HEL-1172 multi-denial toast (real backend)", () => {
  test.setTimeout(180_000);

  const CSRF_HEADER = "X-Helio-Requested-With";
  const AUTH = {
    prefix: "hel1172",
    displayName: "HEL-1172",
    domain: "example.com",
    isolate: true,
  } as const;

  interface Created {
    id: string;
  }

  async function seed(request: APIRequestContext, names = ["HEL-1172 Alpha", "HEL-1172 Beta"]) {
    const headers = { [CSRF_HEADER]: "1" };
    const sourceRes = await request.post("/api/data-sources", {
      data: {
        name: "HEL-1172 e2e Source",
        type: "static",
        columns: [{ name: "note", type: "string", required: true }],
        rows: [["seed"]],
      },
      headers,
    });
    expect(sourceRes.status()).toBe(201);
    const source = (await sourceRes.json()) as Created;

    const pipelines: Created[] = [];
    for (const name of names) {
      const pipelineRes = await request.post("/api/pipelines", {
        data: { name, roots: [{ sourceId: source.id }] },
        headers,
      });
      expect(pipelineRes.status()).toBe(201);
      const pipeline = (await pipelineRes.json()) as Created;
      for (let i = 0; i < 21; i++) {
        const stepRes = await request.post(`/api/pipelines/${pipeline.id}/steps`, {
          data: { type: "assert", config: { rules: [] } },
          headers,
        });
        expect(stepRes.status()).toBe(201);
      }
      const outputRes = await request.post(`/api/pipelines/${pipeline.id}/outputs`, {
        data: { kind: "table", name: `${name} Table`, config: {} },
        headers,
      });
      expect(outputRes.status()).toBe(201);
      pipelines.push(pipeline);
    }

    const dashRes = await request.post("/api/dashboards", {
      data: { name: "HEL-1172 e2e Dashboard" },
      headers,
    });
    expect(dashRes.status()).toBe(201);
    const dashboard = (await dashRes.json()) as Created;
    const panelRes = await request.post("/api/panels", {
      data: {
        dashboardId: dashboard.id,
        title: "HEL-1172 e2e Form",
        type: "form",
        config: {
          dataSourceId: source.id,
          fields: [{ sourceField: "note", control: "text", label: "Note", required: true }],
          submit: { writeMode: "append" },
        },
      },
      headers,
    });
    expect(panelRes.status()).toBe(201);
    return { alpha: pipelines[0], beta: pipelines[1] };
  }

  async function submitNote(page: Page, text: string) {
    const form = page.getByRole("form", { name: "HEL-1172 e2e Form" });
    await form.getByRole("textbox", { name: "Note" }).fill(text);
    await form.getByRole("button", { name: "Submit" }).click();
    await expect(form.locator(".form-panel-view__status")).toContainText(/added/i);
    return form;
  }

  /** Describes the focused element: its tag, accessible-ish label and href. */
  function activeElementInfo(page: Page) {
    return page.evaluate(() => {
      const el = document.activeElement;
      return {
        tag: el?.tagName ?? null,
        label: el?.getAttribute("aria-label") ?? el?.textContent?.trim() ?? null,
        href: el?.getAttribute("href") ?? null,
        isBody: el === document.body,
      };
    });
  }

  test("one toast lists both pipelines, persists, exposes computed ARIA, and each row runs only its pipeline; focus never drops to body", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, { ...AUTH, label: "rows" });
    const { alpha, beta } = await seed(request);

    const runPosts: string[] = [];
    page.on("request", (req) => {
      const m = /\/api\/pipelines\/([^/]+)\/run$/.exec(new URL(req.url()).pathname);
      if (req.method() === "POST" && m) runPosts.push(m[1]);
    });

    await page.goto("/dashboards");
    const form = await submitNote(page, "denies two");

    const toast = page.locator(".toast--warning").filter({ has: page.locator(".toast__list") });
    await expect(toast).toHaveCount(1);
    await expect(toast.getByRole("link", { name: "HEL-1172 Alpha" })).toHaveAttribute(
      "href",
      `/pipelines/${alpha.id}`,
    );
    await expect(toast.getByRole("link", { name: "HEL-1172 Beta" })).toHaveAttribute(
      "href",
      `/pipelines/${beta.id}`,
    );
    const runAlpha = toast.getByRole("button", { name: "Run to update: HEL-1172 Alpha" });
    const runBeta = toast.getByRole("button", { name: "Run to update: HEL-1172 Beta" });
    await expect(runAlpha).toBeVisible();
    await expect(runBeta).toBeVisible();
    await expect(runAlpha).toHaveAccessibleDescription(/too many steps/i);

    // Persistent: still there well past the 4 s default auto-dismiss.
    await page.waitForTimeout(5500);
    await expect(toast).toHaveCount(1);

    // Keyboard order: Alpha link -> Alpha run -> Beta link -> Beta run.
    await toast.getByRole("link", { name: "HEL-1172 Alpha" }).focus();
    await page.keyboard.press("Tab");
    await expect(runAlpha).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(toast.getByRole("link", { name: "HEL-1172 Beta" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(runBeta).toBeFocused();

    // Enter on Beta's run: only Beta runs, its action goes, focus lands on Beta's own link.
    await form.getByRole("button", { name: "Submit" }).focus();
    await runBeta.focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => runPosts).toEqual([beta.id]);
    await expect(runBeta).toHaveCount(0);
    await expect(runAlpha).toBeVisible();
    await expect(toast.getByRole("link", { name: "HEL-1172 Beta" })).toBeFocused();

    // Enter on Alpha's run (the last action): the toast closes and focus returns to the control focus came
    // from -- the form's Submit button here, since focus entered the toast straight from it.
    await form.getByRole("button", { name: "Submit" }).focus();
    await runAlpha.focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => runPosts).toEqual([beta.id, alpha.id]);
    await expect(toast).toHaveCount(0);
    const active = await activeElementInfo(page);
    expect(active.isBody).toBe(false);
    expect(active).toMatchObject({ tag: "BUTTON", label: "Submit" });
  });

  test("a row's pipeline link opens that pipeline's page", async ({ page, request }) => {
    await registerAndLogin(page, request, { ...AUTH, label: "link" });
    const { beta } = await seed(request);
    await page.goto("/dashboards");
    await submitNote(page, "link test");

    await page.getByRole("link", { name: "HEL-1172 Beta" }).click();
    await expect(page).toHaveURL(new RegExp(`/pipelines/${beta.id}`));
  });

  test("rapid identical writes leave one toast", async ({ page, request }) => {
    await registerAndLogin(page, request, { ...AUTH, label: "storm" });
    await seed(request);
    await page.goto("/dashboards");
    await submitNote(page, "one");
    await submitNote(page, "two");
    await submitNote(page, "three");

    await expect(
      page.locator(".toast--warning").filter({ has: page.locator(".toast__list") }),
    ).toHaveCount(1);
  });

  // DESIGN.md §3: every touch control clears 44px. bisectHitExtent walks outward from each control's centre with
  // elementFromPoint and asserts >= 44 - samplingStep itself, so a row whose expander is truncated by a neighbour
  // (tiling) or clipped by the scroll list fails here.
  test("390px: every in-toast link and run action has a 44px hit region on the y axis", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, { ...AUTH, label: "touch" });
    await seed(request);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dashboards");
    await submitNote(page, "touch");

    const toast = page.locator(".toast--warning").filter({ has: page.locator(".toast__list") });
    await expect(toast).toHaveCount(1);
    for (const name of ["HEL-1172 Alpha", "HEL-1172 Beta"]) {
      await toast.getByRole("link", { name }).scrollIntoViewIfNeeded();
      await bisectHitExtent(page, toast.getByRole("link", { name }), "y");
      await toast.getByRole("button", { name: `Run to update: ${name}` }).scrollIntoViewIfNeeded();
      await bisectHitExtent(
        page,
        toast.getByRole("button", { name: `Run to update: ${name}` }),
        "y",
      );
    }
  });

  test("390px: the single-pipeline toast's 'Run to update' has a 44px hit region", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, { ...AUTH, label: "touch-single" });
    await seed(request, ["HEL-1172 Solo"]);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dashboards");
    await submitNote(page, "touch single");

    const runBtn = page.locator(".toast--warning").getByRole("button", { name: "Run to update" });
    await expect(runBtn).toBeVisible();
    await bisectHitExtent(page, runBtn, "y");
  });
});
