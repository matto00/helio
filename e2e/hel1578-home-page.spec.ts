import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { registerAndLogin, currentUserId, CSRF_HEADER } from "./support/auth";
import { seedPipelineRuns } from "./support/homeSeed";

// HEL-1578 tasks.md 3.2 -- the Home page against the real backend: a new user's empty states; one summary request
// and no per-pipeline request for a seeded user; a failed run under Needs attention; Retry posts exactly one run.
// Layout assertions wait for `document.fonts.ready` (HEL-1606) so a late font swap cannot move what is measured.

test.describe.configure({ mode: "parallel" });
test.setTimeout(120_000);

const AUTH = { prefix: "hel1578", displayName: "HEL-1578", domain: "example.com" } as const;

async function fontsReady(page: Page) {
  await page.evaluate(() => document.fonts.ready);
}

async function post<T>(
  request: APIRequestContext,
  url: string,
  data: unknown,
  status = 201,
): Promise<T> {
  const res = await request.post(url, { data, headers: { [CSRF_HEADER]: "1" } });
  expect(res.status()).toBe(status);
  return (await res.json()) as T;
}

test.describe("HEL-1578 Home page (real backend)", () => {
  test("a brand-new user lands on /home and sees the empty states, with no error and no horizontal scroll", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await registerAndLogin(page, request, { ...AUTH, label: "new" });
    await expect(page).toHaveURL(/\/home$/);
    const home = page.getByRole("region", { name: "Home" });
    await expect(
      home.getByText("All quiet: nothing has changed, failed or been missed."),
    ).toBeVisible();
    await expect(home.getByRole("button", { name: "Set up step by step" })).toBeVisible();
    await expect(home.getByText("No pipeline runs yet")).toBeVisible();
    await expect(home.getByText("Nothing needs attention.")).toBeVisible();
    await expect(home.getByText("Nothing is scheduled.")).toBeVisible();
    await expect(home.getByRole("alert")).toHaveCount(0);
    await fontsReady(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("'Set up step by step' on Home opens /dashboards with the checklist", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, { ...AUTH, label: "steps" });
    await page.getByRole("button", { name: "Set up step by step" }).click();
    await expect(page).toHaveURL(/\/dashboards$/);
    await expect(page.getByText("in three steps", { exact: false })).toBeVisible();
  });

  test("a seeded user: one summary request, no per-pipeline request, a failed run under Needs attention, Retry posts one run", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, { ...AUTH, label: "seeded", isolate: true });
    const userId = await currentUserId(request);

    await post(request, "/api/dashboards", { name: "HEL-1578 Dashboard" });
    const source = await post<{ id: string }>(request, "/api/data-sources", {
      name: "HEL-1578 Source",
      type: "static",
      columns: [{ name: "note", type: "string", required: true }],
      rows: [["seed"]],
    });
    const pipeline = await post<{ id: string }>(request, "/api/pipelines", {
      name: "hel1578-orders-sync",
      roots: [{ sourceId: source.id }],
    });
    await post(request, `/api/pipelines/${pipeline.id}/outputs`, {
      kind: "table",
      name: "T",
      config: {},
    });
    seedPipelineRuns(pipeline.id, userId, [
      { status: "succeeded", hoursAgo: 8 },
      { status: "failed", hoursAgo: 3, errorLog: "source returned 0 rows" },
    ]);

    const summaryRequests: string[] = [];
    const perPipelineRequests: string[] = [];
    page.on("request", (req) => {
      const url = new URL(req.url());
      if (url.pathname === "/api/home-summary") summaryRequests.push(req.url());
      if (/^\/api\/pipelines\/[^/]+\//.test(url.pathname))
        perPipelineRequests.push(`${req.method()} ${url.pathname}`);
    });

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/home");
    const home = page.getByRole("region", { name: "Home" });
    const attention = home.getByRole("region", { name: "Needs attention" });
    await expect(attention.getByText(/source returned 0 rows/)).toBeVisible();
    await expect(home.getByText("One run failed, everything else is quiet.")).toBeVisible();
    await expect(home.getByRole("link", { name: /HEL-1578 Dashboard/ })).toBeVisible();
    await fontsReady(page);

    const timeline = home.getByRole("group", { name: "Pipeline runs, last 24 hours" });
    await expect(
      timeline.getByRole("button", { name: /hel1578-orders-sync, failed/ }),
    ).toBeVisible();
    await expect(
      timeline.getByRole("button", { name: /hel1578-orders-sync, succeeded/ }),
    ).toBeVisible();

    expect(summaryRequests).toHaveLength(1);
    expect(perPipelineRequests, "no /api/pipelines/<id>/... request on /home").toEqual([]);

    // Keyboard: focus enters the timeline as ONE tab stop and Right Arrow moves to the next mark.
    const marks = timeline.getByRole("button");
    await marks.first().focus();
    await page.keyboard.press("ArrowRight");
    await expect(marks.nth(1)).toBeFocused();
    await expect(page.getByRole("tooltip")).toBeVisible();

    // Retry submits exactly one real run through the guarded endpoint.
    const runPosts: string[] = [];
    page.on("request", (req) => {
      if (
        req.method() === "POST" &&
        new URL(req.url()).pathname === `/api/pipelines/${pipeline.id}/run`
      ) {
        runPosts.push(req.url());
      }
    });
    await attention.getByRole("button", { name: "Retry" }).click();
    await expect.poll(() => runPosts.length).toBe(1);
    // The run may take a while: the button stays disabled and readable, then the summary refreshes once.
    await expect(attention.getByRole("button", { name: /Retry|Running…/ })).toBeVisible();
    await expect.poll(() => summaryRequests.length, { timeout: 60_000 }).toBeGreaterThanOrEqual(2);
    expect(runPosts).toHaveLength(1);
  });
});
